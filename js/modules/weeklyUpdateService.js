/**
 * ============================================================================
 * SSD.WeeklyUpdateService — Wochen-Aktualisierung (sonntags 12 Uhr)
 * ============================================================================
 * Der Dienstplan wird nicht neu berechnet. Für die kommende Woche (Montag bis
 * Sonntag) prüft die Aktualisierung nur, ob eingeteilte Personen inzwischen
 * verhindert sind:
 *   - Klausur/Termin eingetragen,
 *   - für diesen Block "Gesperrt" (Wocheneintrag oder Standardwoche),
 *   - Konto deaktiviert oder gelöscht.
 * Nur für diese Plätze sucht sie Ersatz, nach denselben Regeln wie jede
 * Vertretung. Findet sich niemand, bleibt der Platz offen (und erscheint wie
 * jede Lücke in der Übersicht). Alles andere bleibt unverändert.
 *
 * Ausgelöst wird sie serverseitig durch einen Zeitplan in Supabase (Edge
 * Function "ssd-weekly-update", siehe supabase/functions), der genau diesen
 * Code ausführt; der Administrator kann sie zusätzlich von Hand starten.
 * `settings.weeklyUpdate.lastRunWeek` verhindert doppelte Läufe.
 */
window.SSD = window.SSD || {};

SSD.WeeklyUpdateService = (function () {
  'use strict';

  const U = SSD.Utils;
  const RUN_WEEKDAY = 0; // Sonntag
  const RUN_HOUR = 12;
  const TIME_ZONE = 'Europe/Berlin';
  const AUTO_SENDER = 'Wochen-Aktualisierung (automatisch)';

  function settings() {
    return Object.assign(SSD.Models.createDefaultWeeklyUpdateSettings(), SSD.Store.getState().settings.weeklyUpdate || {});
  }

  /** Datum, Wochentag (0 = Sonntag) und Stunde in Europe/Berlin — unabhängig von der Zeitzone des Geräts oder Servers. */
  function berlinParts(now) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    });
    const parts = {};
    fmt.formatToParts(now).forEach((p) => { parts[p.type] = p.value; });
    return {
      dateIso: `${parts.year}-${parts.month}-${parts.day}`,
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
      hour: Number(parts.hour) % 24,
    };
  }

  /** Montag der als Nächstes beginnenden Woche (am Sonntag: der folgende Tag). */
  function upcomingMonday(dateIso) {
    return U.toIsoDate(U.addDays(U.getMondayOfWeek(U.parseIsoDate(dateIso)), 7));
  }

  function weekLabel(mondayIso) {
    const monday = U.parseIsoDate(mondayIso);
    return `KW ${U.getIsoWeekNumber(monday)} (${U.formatDateShort(monday)}–${U.formatDateShort(U.addDays(monday, 4))})`;
  }

  /** Ist der Sonntagslauf jetzt fällig? `{ due, mondayIso, reason? }` */
  function dueInfo(now) {
    const p = berlinParts(now || new Date());
    const mondayIso = upcomingMonday(p.dateIso);
    const cfg = settings();
    if (cfg.enabled === false) return { due: false, mondayIso, reason: 'ausgeschaltet' };
    if (p.weekday !== RUN_WEEKDAY || p.hour < RUN_HOUR) return { due: false, mondayIso, reason: 'noch nicht fällig (sonntags ab 12 Uhr)' };
    if (cfg.lastRunWeek === mondayIso) return { due: false, mondayIso, reason: 'für diese Woche bereits erledigt' };
    return { due: true, mondayIso };
  }

  function entriesOfWeek(mondayIso) {
    const end = U.toIsoDate(U.addDays(U.parseIsoDate(mondayIso), 6));
    return SSD.Store.getState().schedule.entries.filter((e) => e.date >= mondayIso && e.date <= end);
  }

  /** Eingeteilte Personen, die in der Woche verhindert sind. */
  function findConflicts(mondayIso) {
    const conflicts = [];
    entriesOfWeek(mondayIso).forEach((entry) => {
      (entry.studentIds || []).concat(entry.azubiId ? [entry.azubiId] : []).forEach((personId) => {
        const person = SSD.StudentService.getById(personId);
        let reason = null;
        if (!person) reason = 'nicht mehr im Team';
        else if (!person.active) reason = 'Konto deaktiviert';
        else {
          const r = SSD.AvailabilityService.reasonAt(person, entry.date, entry.block);
          if (r.source === 'exam') reason = 'Klausur/Termin';
          else if (r.state === 'blocked') reason = 'gesperrt';
        }
        if (reason) conflicts.push({ entryId: entry.id, personId, reason, date: entry.date, block: entry.block });
      });
    });
    return conflicts.sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
  }

  /**
   * Prüft die Woche und setzt (außer bei `dryRun`) die Vertretungen in einem
   * einzigen Speichervorgang um.
   * @param {{mondayIso?: string, trigger?: 'auto'|'manual', dryRun?: boolean}} [options]
   * @returns {{ summary: object, conflicts: object[], proposals: object[] }}
   */
  function run(options) {
    const opts = options || {};
    const mondayIso = opts.mondayIso || upcomingMonday(berlinParts(new Date()).dateIso);
    const trigger = opts.trigger || 'manual';
    const at = new Date().toISOString();
    const conflicts = findConflicts(mondayIso);
    const proposals = conflicts.length ? SSD.SubstitutionService.proposeForConflicts(conflicts) : [];
    const replaced = proposals.filter((p) => p.replacementStudentId).length;
    const summary = {
      mondayIso, at, trigger,
      checked: entriesOfWeek(mondayIso).length,
      conflicts: conflicts.length,
      replaced,
      open: proposals.length - replaced,
    };
    if (opts.dryRun) return { summary, conflicts, proposals };

    SSD.Store.commit(`Wochen-Aktualisierung ${weekLabel(mondayIso)}`, (draft) => {
      const N = SSD.NotificationService;
      const lines = [];
      proposals.forEach((p) => {
        const entry = draft.schedule.entries.find((e) => e.id === p.entryId);
        if (!entry) return;
        if (p.isAzubiSeat) {
          if (entry.azubiId !== p.absentStudentId) return;
          entry.azubiId = p.replacementStudentId || null;
        } else {
          const idx = entry.studentIds.indexOf(p.absentStudentId);
          if (idx === -1) return;
          if (p.replacementStudentId) entry.studentIds[idx] = p.replacementStudentId;
          else entry.studentIds.splice(idx, 1);
        }
        entry.isManual = true;
        entry.substitutionRequests = (entry.substitutionRequests || []).filter((r) => r.studentId !== p.absentStudentId);
        entry.substitutionLog = entry.substitutionLog || [];
        entry.substitutionLog.push({
          originalStudentId: p.absentStudentId,
          replacementStudentId: p.replacementStudentId || null,
          reason: 'Wochen-Aktualisierung (verhindert)', // bewusst ohne Grund
          appliedAt: at,
          auto: !!p.replacementStudentId, // die eingeteilte Person sieht einen Hinweis im Dashboard
          acknowledgedAt: null,
        });
        const seat = p.isAzubiSeat ? ' (Azubi-Platz)' : '';
        lines.push(p.replacementStudentId
          ? `${N.dutyLabel(entry)}: ${N.personName(p.replacementStudentId)} übernimmt für ${N.personName(p.absentStudentId)}${seat}`
          : `${N.dutyLabel(entry)}: ${N.personName(p.absentStudentId)} ist verhindert — Platz bleibt offen${seat}`);
      });
      draft.settings.weeklyUpdate = Object.assign(SSD.Models.createDefaultWeeklyUpdateSettings(), draft.settings.weeklyUpdate || {}, {
        lastRunWeek: mondayIso, lastRunAt: at, lastSummary: summary,
      });
      if (lines.length) {
        const parts = [];
        if (replaced) parts.push(`${replaced} ${replaced === 1 ? 'Dienst' : 'Dienste'} neu besetzt`);
        if (summary.open) parts.push(`${summary.open} ${summary.open === 1 ? 'Platz' : 'Plätze'} offen`);
        N.add(draft, 'substitution', N.withDetails(`Wochen-Aktualisierung ${weekLabel(mondayIso)}: ${parts.join(', ')}`, lines, 12),
          trigger === 'auto' ? { by: AUTO_SENDER } : undefined);
      }
    }, { trackHistory: trigger !== 'auto' });

    return { summary, conflicts, proposals };
  }

  /** Text für die letzte Aktualisierung, z. B. in den Einstellungen. */
  function describeLastRun() {
    const cfg = settings();
    if (!cfg.lastRunAt || !cfg.lastSummary) return 'Noch keine Wochen-Aktualisierung gelaufen.';
    const s = cfg.lastSummary;
    const when = U.formatDateTime(new Date(cfg.lastRunAt));
    const how = s.trigger === 'auto' ? 'automatisch' : 'von Hand';
    if (!s.conflicts) return `Zuletzt ${how} am ${when} für ${weekLabel(s.mondayIso)}: keine gesperrten Dienste.`;
    return `Zuletzt ${how} am ${when} für ${weekLabel(s.mondayIso)}: ${s.conflicts} gesperrt, ${s.replaced} neu besetzt, ${s.open} offen.`;
  }

  return { RUN_HOUR, berlinParts, upcomingMonday, weekLabel, dueInfo, findConflicts, run, describeLastRun, settings };
})();
