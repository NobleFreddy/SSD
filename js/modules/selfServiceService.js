/**
 * ============================================================================
 * SSD.SelfServiceService — Eigenständige Dienstübernahme & Vertretungsanfragen
 * ============================================================================
 * Ermöglicht Schüler:innen/Azubis zwei Selbstbedienungs-Aktionen, ohne dass
 * der Administrator jedes Mal manuell eingreifen muss:
 *
 *   1. "Offenen Dienst übernehmen": ein Dienst, dem noch Personen fehlen
 *      (Lücke aus der automatischen Planung), kann direkt von einer
 *      berechtigten Person beansprucht werden.
 *   2. "Vertretung anfragen": eine Person, die einen bereits zugeteilten
 *      eigenen Dienst nicht wahrnehmen kann, markiert ihren Platz als
 *      "Vertretung gesucht" — sie bleibt bis zur Übernahme offiziell
 *      eingeteilt (der Dienst wird dadurch nie schlechter besetzt als
 *      vorher), der Platz erscheint aber zusätzlich in der offenen Liste,
 *      damit eine andere berechtigte Person ihn übernehmen kann.
 *
 * Beide Fälle laufen am Ende auf dieselbe "Platz übernehmen"-Funktion hinaus
 * und nutzen zur Prüfung der harten Regeln (Verfügbarkeit, Wochenlimit, keine
 * Doppelbelegung, …) denselben `SSD.Scheduler.SchedulingContext` wie die
 * automatische Planung und der administrative Vertretungsmodus — dieselben
 * Regeln gelten also garantiert überall gleich, ohne zweite Implementierung.
 * Anders als der administrative Vertretungsassistent wird hier bewusst NICHT
 * automatisch die "beste" Person vorgeschlagen: Die Schüler:innen wählen
 * selbst aus der Liste der für sie zulässigen offenen Dienste.
 */
window.SSD = window.SSD || {};

SSD.SelfServiceService = (function () {
  'use strict';

  const U = SSD.Utils;

  /**
   * Baut einen auf genau einen Dienst-Slot beschränkten Planungskontext für
   * die gegebene Rolle. Die übrige aktuelle Besetzung des Dienstes wird
   * vorbelegt (ohne die Person, deren Platz gerade übernommen wird), damit
   * Paar-Regeln wie "nie zusammen" auch beim Selbst-Übernehmen greifen.
   */
  function buildSoloContext(role, targetEntry, replacedId) {
    const baseSettings = SSD.SettingsService.get();
    const settings = role === 'azubi' ? SSD.Scheduler.azubiSettingsFrom(baseSettings) : baseSettings;
    const roster = SSD.StudentService.getActiveByRole(role);
    const slot = SSD.Scheduler.slotFromEntry(targetEntry);
    const history = role === 'azubi'
      ? SSD.Scheduler.buildAzubiHistoryEntries(new Set([slot.key]))
      : SSD.Store.getState().schedule.entries;
    const context = new SSD.Scheduler.SchedulingContext(roster, history, [slot], settings);
    if (role !== 'azubi') {
      targetEntry.studentIds
        .filter((id) => id !== replacedId && context.studentsById.has(id))
        .forEach((id) => context.assign(slot, id));
    }
    return { context, slot };
  }

  /**
   * Alle in der Zukunft liegenden, für die Selbstübernahme offenen Plätze.
   * - Reguläre Schüler-Lücken (aus der Planung unbesetzt gebliebene Plätze).
   * - Plätze mit einer aktiven Vertretungsanfrage der eingeteilten Person
   *   (Schüler:in- oder Azubi-Platz) — die anfragende Person bleibt bis zur
   *   Übernahme im Eintrag stehen, siehe Modulbeschreibung oben.
   * @returns {Array<{entry: object, seatType: 'student'|'azubi', reason: 'gap'|'requested', requestedBy?: string}>}
   */
  function getOpenSeats() {
    const todayIso = U.toIsoDate(U.today());
    const settings = SSD.SettingsService.get();
    const entries = SSD.Store.getState().schedule.entries
      .filter((e) => e.date >= todayIso && SSD.CalendarService.isDayUsable(e.date))
      .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));

    const seats = [];
    entries.forEach((entry) => {
      const requests = entry.substitutionRequests || [];
      const gapCount = Math.max(0, settings.studentsPerDuty - entry.studentIds.length);
      for (let i = 0; i < gapCount; i++) seats.push({ entry, seatType: 'student', reason: 'gap' });

      requests.forEach((r) => {
        if (entry.studentIds.includes(r.studentId)) {
          seats.push({ entry, seatType: 'student', reason: 'requested', requestedBy: r.studentId });
        } else if (entry.azubiId === r.studentId) {
          seats.push({ entry, seatType: 'azubi', reason: 'requested', requestedBy: r.studentId });
        }
      });
    });
    return seats;
  }

  /** Offene Plätze, die für die gegebene Person überhaupt infrage kommen (passende Rolle, nicht die anfragende Person selbst). */
  function getOpenSeatsForPerson(person) {
    return getOpenSeats().filter((seat) => seat.seatType === (person.role || 'student') && seat.requestedBy !== person.id);
  }

  /**
   * Prüft, ob eine Person einen bestimmten Platz übernehmen dürfte (dieselben
   * harten Regeln wie überall sonst — siehe Modulbeschreibung).
   * @returns {{ok: boolean, reason?: string}}
   */
  function canClaim(personId, entry, seatType, requestedBy) {
    const person = SSD.StudentService.getById(personId);
    if (!person || !person.active) return { ok: false, reason: 'Konto ist inaktiv.' };
    if ((person.role || 'student') !== seatType) return { ok: false, reason: 'Dieser Platz ist für eine andere Kategorie vorgesehen.' };
    if (entry.studentIds.includes(personId) || entry.azubiId === personId) {
      return { ok: false, reason: 'Sie sind diesem Dienst bereits zugeteilt.' };
    }
    const { context, slot } = buildSoloContext(seatType, entry, requestedBy);
    if (!context.isEligible(personId, slot)) {
      return { ok: false, reason: SSD.SubstitutionService.explainIneligibility(context, slot, person) };
    }
    return { ok: true };
  }

  /**
   * Übernimmt einen offenen Platz. Bei einer zuvor angefragten Vertretung
   * (`requestedBy` gesetzt) ersetzt die übernehmende Person die anfragende;
   * bei einer reinen Lücke wird der Platz einfach zusätzlich besetzt.
   * Schreibt zusätzlich einen Eintrag in `substitutionLog`, damit dieselbe
   * Badge-Anzeige wie beim administrativen Vertretungsmodus greift.
   */
  function claimSeat(personId, entry, seatType, requestedBy) {
    const check = canClaim(personId, entry, seatType, requestedBy);
    if (!check.ok) throw new Error(check.reason);

    const person = SSD.StudentService.getById(personId);
    const settings = SSD.SettingsService.get();
    const appliedAt = new Date().toISOString();
    let applied = false;

    SSD.Store.commit(`Dienst eigenständig übernommen (${SSD.StudentService.fullName(person)})`, (draft) => {
      const target = draft.schedule.entries.find((e) => e.id === entry.id);
      if (!target) throw new Error('Dieser Dienst existiert nicht mehr.');

      if (requestedBy) {
        const stillPending = (target.substitutionRequests || []).some((r) => r.studentId === requestedBy);
        const stillAssigned = seatType === 'azubi' ? target.azubiId === requestedBy : target.studentIds.includes(requestedBy);
        if (!stillPending || !stillAssigned) throw new Error('Diese Anfrage wurde inzwischen bereits von jemand anderem übernommen.');
      } else if (seatType === 'student' && target.studentIds.length >= settings.studentsPerDuty) {
        throw new Error('Dieser Dienst ist inzwischen bereits vollständig besetzt.');
      } else if (seatType === 'azubi' && target.azubiId) {
        throw new Error('Für diesen Dienst ist inzwischen bereits ein Azubi eingeteilt.');
      }

      target.substitutionRequests = (target.substitutionRequests || []).filter((r) => r.studentId !== requestedBy);
      if (seatType === 'azubi') {
        target.azubiId = personId;
      } else if (requestedBy) {
        const idx = target.studentIds.indexOf(requestedBy);
        if (idx >= 0) target.studentIds[idx] = personId; else target.studentIds.push(personId);
      } else {
        target.studentIds.push(personId);
      }
      target.isManual = true;
      target.substitutionLog = target.substitutionLog || [];
      target.substitutionLog.push({
        originalStudentId: requestedBy || null,
        replacementStudentId: personId,
        reason: requestedBy ? 'Vertretung eigenständig übernommen' : 'Offener Dienst eigenständig übernommen',
        appliedAt,
      });
      const N = SSD.NotificationService;
      const seatNote = seatType === 'azubi' ? ' (Azubi-Platz)' : '';
      N.add(draft, 'substitution', requestedBy
        ? `${N.personName(personId)} übernimmt den Dienst von ${N.personName(requestedBy)}${seatNote} — ${N.dutyLabel(target)}.`
        : `${N.personName(personId)} übernimmt einen offenen Dienst${seatNote} — ${N.dutyLabel(target)}.`);
      applied = true;
    });
    return applied;
  }

  /** Markiert den eigenen Platz in einem Dienst als "Vertretung gesucht" (Person bleibt bis zur Übernahme eingeteilt). */
  function requestSubstitution(personId, entry) {
    requestSubstitutions(personId, [entry.id]);
  }

  /** Ist die Person in diesem Dienst eingeteilt (regulärer oder Azubi-Platz)? */
  function isAssigned(personId, entry) {
    return entry.studentIds.includes(personId) || entry.azubiId === personId;
  }

  /**
   * Kommende, tatsächlich stattfindende Dienste einer Person (ab heute, ohne
   * gesperrte Tage) — Grundlage für die Schnell-Meldung "Ich falle aus".
   */
  function getUpcomingDutiesOf(personId) {
    const todayIso = U.toIsoDate(U.today());
    return SSD.Store.getState().schedule.entries
      .filter((e) => e.date >= todayIso && isAssigned(personId, e) && SSD.CalendarService.isDayUsable(e.date))
      .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
  }

  /** Teilt die App bei einer Selbst-Abmeldung automatisch eine Vertretung ein? (Einstellung des Administrators) */
  function isAutoSubstitutionEnabled() {
    return SSD.SettingsService.get().autoSubstitution !== false;
  }

  /**
   * "Ich falle aus": meldet die Person für mehrere eigene Dienste auf einmal
   * ab — bewusst in EINEM Speichervorgang (eine Sammelmeldung, kein Wettlauf
   * mehrerer Speicherungen). Vergangene Dienste, bereits angefragte und
   * solche, in denen die Person nicht (mehr) eingeteilt ist, werden
   * übersprungen.
   *
   * Mit automatischer Vertretung (Standard, abschaltbar) trägt die App sofort
   * die passendste verfügbare Person ein (`SSD.SubstitutionService.proposeAutoReplacements`);
   * diese sieht beim Anmelden einen Hinweis. Nur Dienste ohne zulässige
   * Ersatzperson bleiben — wie ohne Automatik — als "Vertretung gesucht" offen,
   * die Person bleibt dort eingeteilt, bis jemand übernimmt.
   *
   * @returns {{ requested: number, replaced: Array<{entryId:string, replacementId:string}>, open: string[] }}
   */
  function requestSubstitutions(personId, entryIds) {
    const todayIso = U.toIsoDate(U.today());
    const wanted = new Set(entryIds);
    const isNew = (e) => wanted.has(e.id) && e.date >= todayIso && isAssigned(personId, e) && !hasOpenRequest(personId, e);
    const byDate = (a, b) => (a.date + a.block).localeCompare(b.date + b.block);
    const candidates = SSD.Store.getState().schedule.entries.filter(isNew);
    const result = { requested: candidates.length, replaced: [], open: [] };
    if (!candidates.length) return result;

    const replacements = new Map();
    if (isAutoSubstitutionEnabled()) {
      SSD.SubstitutionService.proposeAutoReplacements(personId, candidates.map((e) => e.id))
        .filter((p) => p.replacementStudentId)
        .forEach((p) => replacements.set(p.entryId, p));
    }

    const label = candidates.length === 1 ? 'Vertretung angefragt' : `Vertretung angefragt (${candidates.length} Dienste)`;
    SSD.Store.commit(label, (draft) => {
      const at = new Date().toISOString();
      const N = SSD.NotificationService;
      const lines = [];
      draft.schedule.entries.filter(isNew).sort(byDate).forEach((target) => {
        const choice = replacements.get(target.id);
        if (choice) {
          if (choice.isAzubiSeat) target.azubiId = choice.replacementStudentId;
          else target.studentIds[target.studentIds.indexOf(personId)] = choice.replacementStudentId;
          target.isManual = true;
          target.substitutionLog = target.substitutionLog || [];
          target.substitutionLog.push({
            originalStudentId: personId,
            replacementStudentId: choice.replacementStudentId,
            reason: 'Automatische Vertretung (selbst abgemeldet)',
            appliedAt: at,
            auto: true,
            acknowledgedAt: null, // die eingeteilte Person bestätigt den Hinweis im Dashboard
          });
          result.replaced.push({ entryId: target.id, replacementId: choice.replacementStudentId });
          lines.push(`${N.dutyLabel(target)}: ${N.personName(choice.replacementStudentId)} übernimmt (automatisch eingeteilt)`);
        } else {
          target.substitutionRequests = target.substitutionRequests || [];
          target.substitutionRequests.push({ studentId: personId, requestedAt: at });
          result.open.push(target.id);
          lines.push(`${N.dutyLabel(target)}: Vertretung gesucht`);
        }
      });

      const name = N.personName(personId);
      if (!result.replaced.length) {
        // Wie bisher (ohne Automatik bzw. ohne passende Person)
        if (lines.length === 1) {
          const target = draft.schedule.entries.find((e) => e.id === result.open[0]);
          N.add(draft, 'substitution', `${name} sucht eine Vertretung — ${N.dutyLabel(target)}.`);
        } else {
          N.add(draft, 'substitution', N.withDetails(`${name} sucht eine Vertretung für ${lines.length} Dienste:`, lines.map((l) => l.replace(/: Vertretung gesucht$/, ''))));
        }
      } else if (lines.length === 1) {
        N.add(draft, 'substitution', `${name} fällt aus — ${lines[0]}.`);
      } else {
        N.add(draft, 'substitution', N.withDetails(`${name} fällt aus (${lines.length} Dienste):`, lines));
      }
    });
    return result;
  }

  /* ---------------------------------------------------------------------
   * Automatisch eingeteilte Vertretungen — Hinweis für die eingeteilte
   * Person, Überblick für Team-Leitung und Administrator
   * ------------------------------------------------------------------- */

  /** Letzter Protokolleintrag, mit dem `personId` in diesen Dienst gekommen ist. */
  function latestLogFor(entry, personId) {
    const logs = (entry.substitutionLog || []).filter((log) => log.replacementStudentId === personId);
    return logs.length ? logs[logs.length - 1] : null;
  }

  /** Kommende automatisch eingeteilte Vertretungen (alle Personen), sortiert. */
  function getUpcomingAutoSubstitutions() {
    const todayIso = U.toIsoDate(U.today());
    const list = [];
    SSD.Store.getState().schedule.entries.forEach((entry) => {
      if (entry.date < todayIso) return;
      const people = entry.studentIds.concat(entry.azubiId ? [entry.azubiId] : []);
      people.forEach((id) => {
        const log = latestLogFor(entry, id);
        if (log && log.auto) list.push({ entry, log, replacementId: id, originalId: log.originalStudentId });
      });
    });
    return list.sort((a, b) => (a.entry.date + a.entry.block).localeCompare(b.entry.date + b.entry.block));
  }

  /** Automatisch übernommene Dienste der Person, deren Hinweis sie noch nicht bestätigt hat. */
  function getUnseenAutoSubstitutions(personId) {
    return getUpcomingAutoSubstitutions().filter((item) => item.replacementId === personId && !item.log.acknowledgedAt);
  }

  /** "Verstanden" — die eingeteilte Person hat den Hinweis gesehen. */
  function acknowledgeAutoSubstitutions(personId) {
    SSD.Store.commit('Vertretung zur Kenntnis genommen', (draft) => {
      const at = new Date().toISOString();
      draft.schedule.entries.forEach((entry) => {
        (entry.substitutionLog || []).forEach((log) => {
          if (log.auto && log.replacementStudentId === personId && !log.acknowledgedAt) log.acknowledgedAt = at;
        });
      });
    }, { trackHistory: false });
  }

  /**
   * Kommende Dienste, die die Person abgegeben hat, mit der Person, die sie
   * jetzt tatsächlich macht (gibt die Vertretung den Dienst weiter, wird die
   * Kette im Protokoll bis zur aktuell eingeteilten Person verfolgt).
   */
  function getCoveredDutiesOf(personId) {
    const todayIso = U.toIsoDate(U.today());
    const lastHandover = (entry, fromId) => (entry.substitutionLog || []).filter((log) => log.originalStudentId === fromId && log.replacementStudentId).pop() || null;
    return SSD.Store.getState().schedule.entries
      .filter((e) => e.date >= todayIso && !isAssigned(personId, e))
      .map((entry) => {
        const first = lastHandover(entry, personId);
        if (!first) return null;
        let current = first.replacementStudentId;
        const seen = new Set([personId]);
        while (current && !isAssigned(current, entry) && !seen.has(current)) {
          seen.add(current);
          const next = lastHandover(entry, current);
          current = next ? next.replacementStudentId : null;
        }
        return { entry, replacementId: current && isAssigned(current, entry) ? current : null, auto: !!first.auto };
      })
      .filter(Boolean)
      .sort((a, b) => (a.entry.date + a.entry.block).localeCompare(b.entry.date + b.entry.block));
  }

  /** Zieht eine noch unbeantwortete eigene Vertretungsanfrage zurück. */
  function cancelSubstitutionRequest(personId, entry) {
    SSD.Store.commit('Vertretungsanfrage zurückgezogen', (draft) => {
      const target = draft.schedule.entries.find((e) => e.id === entry.id);
      if (!target) return;
      const hadRequest = (target.substitutionRequests || []).some((r) => r.studentId === personId);
      target.substitutionRequests = (target.substitutionRequests || []).filter((r) => r.studentId !== personId);
      if (hadRequest) {
        const N = SSD.NotificationService;
        N.add(draft, 'substitution', `${N.personName(personId)} braucht doch keine Vertretung — ${N.dutyLabel(target)}.`);
      }
    });
  }

  function hasOpenRequest(personId, entry) {
    return (entry.substitutionRequests || []).some((r) => r.studentId === personId);
  }

  /** Gesamtzahl noch unbeantworteter Vertretungsanfragen in der Zukunft (für den Admin-Hinweis). */
  function getOpenRequestCount() {
    const todayIso = U.toIsoDate(U.today());
    return SSD.Store.getState().schedule.entries
      .filter((e) => e.date >= todayIso)
      .reduce((sum, e) => sum + (e.substitutionRequests || []).length, 0);
  }

  return {
    getOpenSeats, getOpenSeatsForPerson, canClaim, claimSeat,
    requestSubstitution, requestSubstitutions, cancelSubstitutionRequest, hasOpenRequest,
    getUpcomingDutiesOf, getOpenRequestCount, isAutoSubstitutionEnabled,
    getUpcomingAutoSubstitutions, getUnseenAutoSubstitutions, acknowledgeAutoSubstitutions, getCoveredDutiesOf, latestLogFor,
  };
})();
