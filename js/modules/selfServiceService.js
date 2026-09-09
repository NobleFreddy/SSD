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

  /** Baut einen auf genau einen Dienst-Slot beschränkten Planungskontext für die gegebene Rolle. */
  function buildSoloContext(role, targetEntry) {
    const baseSettings = SSD.SettingsService.get();
    const settings = role === 'azubi' ? SSD.Scheduler.azubiSettingsFrom(baseSettings) : baseSettings;
    const roster = SSD.StudentService.getActiveByRole(role);
    const slot = SSD.Scheduler.slotFromEntry(targetEntry);
    const history = role === 'azubi'
      ? SSD.Scheduler.buildAzubiHistoryEntries(new Set([slot.key]))
      : SSD.Store.getState().schedule.entries;
    const context = new SSD.Scheduler.SchedulingContext(roster, history, [slot], settings);
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
  function canClaim(personId, entry, seatType) {
    const person = SSD.StudentService.getById(personId);
    if (!person || !person.active) return { ok: false, reason: 'Konto ist inaktiv.' };
    if ((person.role || 'student') !== seatType) return { ok: false, reason: 'Dieser Platz ist für eine andere Kategorie vorgesehen.' };
    if (entry.studentIds.includes(personId) || entry.azubiId === personId) {
      return { ok: false, reason: 'Sie sind diesem Dienst bereits zugeteilt.' };
    }
    const { context, slot } = buildSoloContext(seatType, entry);
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
    const check = canClaim(personId, entry, seatType);
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
      applied = true;
    });
    return applied;
  }

  /** Markiert den eigenen Platz in einem Dienst als "Vertretung gesucht" (Person bleibt bis zur Übernahme eingeteilt). */
  function requestSubstitution(personId, entry) {
    SSD.Store.commit('Vertretung angefragt', (draft) => {
      const target = draft.schedule.entries.find((e) => e.id === entry.id);
      if (!target) return;
      target.substitutionRequests = target.substitutionRequests || [];
      if (!target.substitutionRequests.some((r) => r.studentId === personId)) {
        target.substitutionRequests.push({ studentId: personId, requestedAt: new Date().toISOString() });
      }
    });
  }

  /** Zieht eine noch unbeantwortete eigene Vertretungsanfrage zurück. */
  function cancelSubstitutionRequest(personId, entry) {
    SSD.Store.commit('Vertretungsanfrage zurückgezogen', (draft) => {
      const target = draft.schedule.entries.find((e) => e.id === entry.id);
      if (!target) return;
      target.substitutionRequests = (target.substitutionRequests || []).filter((r) => r.studentId !== personId);
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
    requestSubstitution, cancelSubstitutionRequest, hasOpenRequest,
    getOpenRequestCount,
  };
})();
