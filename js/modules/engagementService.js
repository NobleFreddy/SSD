/**
 * ============================================================================
 * SSD.EngagementService — Engagement-Übersicht
 * ============================================================================
 * Zählt je Person, was sie im gewählten Zeitraum für den Schulsanitätsdienst
 * getan hat: geleistete Dienste (davon eingesprungen), Veranstaltungen,
 * erledigte Aufgaben und besuchte Teamtreffen. Grundlage z. B. für
 * Zeugnisbemerkungen — die Bestätigung (Nachweis drucken) bleibt beim
 * Administrator.
 *
 * Gezählt wird nur bis einschließlich heute: geplante, künftige Dienste
 * sind noch nicht "geleistet". Abwesenheitsgründe werden bewusst nicht
 * ausgewertet (Gesundheitsdaten), nur Anzahlen.
 */
window.SSD = window.SSD || {};

SSD.EngagementService = (function () {
  'use strict';

  const U = SSD.Utils;

  /** Schuljahr mit Endjahr `endYear`, z. B. 2027 → 01.08.2026 – 31.07.2027 ("2026/27"). */
  function schoolYearRange(endYear) {
    return { from: `${endYear - 1}-08-01`, to: `${endYear}-07-31`, label: `${endYear - 1}/${String(endYear).slice(2)}` };
  }

  function currentSchoolYearRange() {
    return schoolYearRange(U.schoolYearEnd(U.today()));
  }

  function localDateOf(timestamp) {
    return timestamp ? U.toIsoDate(new Date(timestamp)) : null;
  }

  /**
   * @param {string} fromIso - Beginn (YYYY-MM-DD, einschließlich)
   * @param {string} toIso - Ende (YYYY-MM-DD, einschließlich; wird auf heute begrenzt)
   * @returns {{ rows: Array<{person:object, duties:number, jumpIns:number, events:number, tasks:number, meetingsAttended:number, meetingsTotal:number}>, from:string, to:string, until:string }}
   */
  function compute(fromIso, toIso) {
    const state = SSD.Store.getState();
    const todayIso = U.toIsoDate(U.today());
    const until = toIso < todayIso ? toIso : todayIso;
    const inRange = (dateIso) => !!dateIso && dateIso >= fromIso && dateIso <= until;

    const stats = new Map();
    state.students
      .filter((s) => !s.pendingApproval)
      .forEach((person) => stats.set(person.id, { person, duties: 0, jumpIns: 0, events: 0, tasks: 0, meetingsAttended: 0, meetingsTotal: 0 }));

    state.schedule.entries.forEach((entry) => {
      if (!inRange(entry.date)) return;
      const assigned = new Set(entry.studentIds || []);
      if (entry.azubiId) assigned.add(entry.azubiId);
      assigned.forEach((id) => {
        const row = stats.get(id);
        if (!row) return;
        row.duties += 1;
        // Eingesprungen = als Vertretung oder für einen offenen Platz eingetragen.
        if ((entry.substitutionLog || []).some((log) => log.replacementStudentId === id)) row.jumpIns += 1;
      });
    });

    (state.events || []).forEach((event) => {
      if (!inRange(event.date)) return;
      (event.participantIds || []).forEach((id) => {
        const row = stats.get(id);
        if (row) row.events += 1;
      });
    });

    (state.tasks || []).forEach((task) => {
      if (task.status !== 'done' || !task.completedBy || !inRange(localDateOf(task.completedAt))) return;
      const row = stats.get(task.completedBy);
      if (row) row.tasks += 1;
    });

    (state.meetings || []).forEach((meeting) => {
      if (!meeting.attendanceTaken || !inRange(meeting.date)) return;
      const attendees = new Set(meeting.attendeeIds || []);
      stats.forEach((row, id) => {
        const attended = attendees.has(id);
        // Treffen vor dem Eintritt ins Team zählen nicht als "verpasst".
        const joined = localDateOf(row.person.createdAt);
        if (!attended && joined && joined > meeting.date) return;
        row.meetingsTotal += 1;
        if (attended) row.meetingsAttended += 1;
      });
    });

    const rows = Array.from(stats.values()).filter((r) =>
      r.person.active || r.duties || r.events || r.tasks || r.meetingsAttended
    );
    return { rows, from: fromIso, to: toIso, until };
  }

  const CSV_HEADERS = ['Nachname', 'Vorname', 'Kategorie', 'Klasse', 'Abijahrgang', 'Dienste', 'davon eingesprungen', 'Veranstaltungen', 'Aufgaben erledigt', 'Teamtreffen besucht', 'Teamtreffen gesamt', 'Status'];

  function exportCsv(result) {
    const rows = [CSV_HEADERS].concat(result.rows.map((r) => [
      r.person.lastName, r.person.firstName,
      r.person.role === 'azubi' ? 'Azubi' : 'Schüler:in',
      r.person.schoolClass || '', r.person.yearGroup ?? '',
      r.duties, r.jumpIns, r.events, r.tasks, r.meetingsAttended, r.meetingsTotal,
      r.person.active ? 'aktiv' : 'inaktiv',
    ]));
    U.downloadBlob(`engagement_${result.from}_bis_${result.until}.csv`, SSD.ImportExport.buildCsv(rows), 'text/csv;charset=utf-8');
  }

  return { schoolYearRange, currentSchoolYearRange, compute, exportCsv };
})();
