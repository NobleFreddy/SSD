/**
 * ============================================================================
 * SSD.MeetingsService — Teamtreffen
 * ============================================================================
 * Interne Treffen des Teams (z. B. Halbjahresbesprechung, Übungsabend).
 * Eingeladen sind immer alle aktiven Sanis/Azubis: Sie sagen im Dashboard
 * zu oder ab, die Team-Koordination erfasst danach die Anwesenheit. Bewusst
 * getrennt von den Veranstaltungen (SSD.EventsService, freiwillige Anmeldung
 * mit Platzlimit) und ohne Einfluss auf den Dienstplan.
 *
 * Rechte: Anlegen und Anwesenheit erfassen dürfen alle Koordinator:innen
 * (die Sanisprecher:in leitet z. B. ein Treffen, das der Administrator
 * angelegt hat); Bearbeiten/Löschen der Administrator alle Treffen,
 * Sanisprecher:innen nur selbst angelegte (siehe `SSD.Auth.canManageItem`).
 *
 * Teams (Kategorie „Teamtreffen“): Neue kommende Treffen werden angekündigt,
 * bei kommenden Treffen außerdem geänderte Zeit/Ort und Absagen gemeldet.
 * Nachträglich erfasste (vergangene) Treffen und einzelne Zu-/Absagen nicht.
 */
window.SSD = window.SSD || {};

SSD.MeetingsService = (function () {
  'use strict';

  const U = SSD.Utils;

  function todayIso() {
    return U.toIsoDate(U.today());
  }

  function compare(a, b) {
    return (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || ''));
  }

  function getAll() {
    return (SSD.Store.getState().meetings || []).slice().sort(compare);
  }

  function getById(id) {
    return (SSD.Store.getState().meetings || []).find((m) => m.id === id) || null;
  }

  function getUpcoming() {
    const ref = todayIso();
    return getAll().filter((m) => m.date >= ref);
  }

  /** Vergangene Treffen, neueste zuerst. */
  function getPast() {
    const ref = todayIso();
    return getAll().filter((m) => m.date < ref).reverse();
  }

  function canManage(meeting) {
    return SSD.Auth.canManageItem(meeting);
  }

  /** Eingeladen: alle aktiven Sanis und Azubis, alphabetisch. */
  function getInvitees() {
    return SSD.StudentService.getActive()
      .slice()
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  }

  function clean(data) {
    const title = String(data.title || '').trim();
    if (!title) throw new Error('Bitte einen Titel angeben.');
    if (!data.date) throw new Error('Bitte ein Datum angeben.');
    if (data.startTime && data.endTime && data.endTime <= data.startTime) throw new Error('Die Endzeit muss nach der Beginnzeit liegen.');
    return {
      title,
      date: data.date,
      startTime: data.startTime || '',
      endTime: data.endTime || '',
      location: String(data.location || '').trim(),
      agenda: String(data.agenda || '').trim(),
    };
  }

  /* ---------------------------------------------------------------------
   * Teams-Meldungen
   * ------------------------------------------------------------------- */

  function isUpcoming(meeting) {
    return meeting.date >= todayIso();
  }

  /** Was Teilnehmende wissen müssen — reine Titel- oder Tagesordnungsänderungen melden wir nicht. */
  function scheduleKey(meeting) {
    return [meeting.date, meeting.startTime, meeting.endTime, meeting.location].join('|');
  }

  /** Ankündigung: Kopfzeile plus die ersten Punkte der Tagesordnung. */
  function announcementText(meeting) {
    const agenda = (meeting.agenda || '').split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*•–]\s*/, '').trim())
      .filter(Boolean)
      .map((line) => (line.length > 160 ? `${line.slice(0, 159)}…` : line));
    return SSD.NotificationService.withDetails(
      `Neues Teamtreffen: ${meeting.title} — ${whenText(meeting)}. Bitte im Dashboard unter „Teamtreffen“ zu- oder absagen.`,
      agenda, 5);
  }

  /* ---------------------------------------------------------------------
   * Anlegen, Bearbeiten, Löschen
   * ------------------------------------------------------------------- */

  function create(data) {
    if (!SSD.Auth.canCoordinate()) throw new Error('Dafür fehlt die Berechtigung.');
    const meeting = SSD.Models.createMeeting(Object.assign(clean(data), { createdBy: SSD.Auth.currentPersonId() }));
    SSD.Store.commit(`Teamtreffen "${meeting.title}" angelegt`, (draft) => {
      draft.meetings = draft.meetings || [];
      draft.meetings.push(meeting);
      if (isUpcoming(meeting)) SSD.NotificationService.add(draft, 'meeting', announcementText(meeting));
    });
    return meeting;
  }

  function update(id, data) {
    const original = getById(id);
    if (!canManage(original)) throw new Error('Dieses Treffen darf nur die Person bearbeiten, die es angelegt hat, oder der Administrator.');
    const patch = clean(data);
    const before = Object.assign({}, original); // der Commit ändert das Objekt direkt
    SSD.Store.commit('Teamtreffen bearbeitet', (draft) => {
      const meeting = (draft.meetings || []).find((m) => m.id === id);
      if (!meeting) return;
      Object.assign(meeting, patch);
      if (!isUpcoming(meeting) || scheduleKey(meeting) === scheduleKey(before)) return;
      // Lag das Treffen bisher in der Vergangenheit, wurde es nie angekündigt — dann jetzt wie ein neues.
      SSD.NotificationService.add(draft, 'meeting', isUpcoming(before)
        ? SSD.NotificationService.withDetails(`Teamtreffen geändert: ${meeting.title} — jetzt ${whenText(meeting)}.`, [`bisher: ${whenText(before)}`])
        : announcementText(meeting));
    });
  }

  function remove(id) {
    const meeting = getById(id);
    if (!canManage(meeting)) throw new Error('Dieses Treffen darf nur die Person löschen, die es angelegt hat, oder der Administrator.');
    const notice = isUpcoming(meeting) ? `Teamtreffen abgesagt: ${meeting.title} — ${whenText(meeting)}.` : null;
    SSD.Store.commit(`Teamtreffen "${meeting.title}" gelöscht`, (draft) => {
      draft.meetings = (draft.meetings || []).filter((m) => m.id !== id);
      if (notice) SSD.NotificationService.add(draft, 'meeting', notice);
    });
  }

  /* ---------------------------------------------------------------------
   * Zu-/Absagen (durch die eingeladene Person selbst)
   * ------------------------------------------------------------------- */

  /** 'yes' | 'no' | null (noch keine Antwort). */
  function getResponse(meeting, personId) {
    const found = (meeting.responses || []).find((r) => r.personId === personId);
    return found ? found.status : null;
  }

  /** Antwort setzen oder mit `status = null` zurücknehmen. Nur für eigene Antworten und kommende Treffen. */
  function respond(meetingId, personId, status) {
    if (!personId || personId !== SSD.Auth.currentPersonId()) throw new Error('Zu- oder Absagen kann nur die eingeladene Person selbst.');
    const meeting = getById(meetingId);
    if (!meeting) throw new Error('Dieses Treffen existiert nicht mehr.');
    if (meeting.date < todayIso()) throw new Error('Das Treffen liegt bereits in der Vergangenheit.');
    if (status !== null && status !== 'yes' && status !== 'no') throw new Error('Ungültige Antwort.');
    SSD.Store.commit(status === 'yes' ? 'Teamtreffen zugesagt' : (status === 'no' ? 'Teamtreffen abgesagt' : 'Antwort zurückgenommen'), (draft) => {
      const target = (draft.meetings || []).find((m) => m.id === meetingId);
      if (!target) return;
      target.responses = (target.responses || []).filter((r) => r.personId !== personId);
      if (status) target.responses.push({ personId, status, at: new Date().toISOString() });
    }, { trackHistory: false });
  }

  /** Zu-/Absagen aller aktuell Eingeladenen: { yes: Person[], no: Person[], open: Person[] }. */
  function summarize(meeting) {
    const result = { yes: [], no: [], open: [] };
    getInvitees().forEach((person) => {
      const status = getResponse(meeting, person.id);
      if (status === 'yes') result.yes.push(person);
      else if (status === 'no') result.no.push(person);
      else result.open.push(person);
    });
    return result;
  }

  /* ---------------------------------------------------------------------
   * Anwesenheit (Team-Koordination)
   * ------------------------------------------------------------------- */

  function setAttendance(meetingId, attendeeIds) {
    if (!SSD.Auth.canCoordinate()) throw new Error('Dafür fehlt die Berechtigung.');
    const meeting = getById(meetingId);
    if (!meeting) throw new Error('Dieses Treffen existiert nicht mehr.');
    const validIds = new Set(SSD.StudentService.getAll().map((s) => s.id));
    const ids = Array.from(new Set(attendeeIds)).filter((id) => validIds.has(id));
    SSD.Store.commit(`Anwesenheit erfasst: ${meeting.title}`, (draft) => {
      const target = (draft.meetings || []).find((m) => m.id === meetingId);
      if (!target) return;
      target.attendanceTaken = true;
      target.attendanceTakenAt = new Date().toISOString();
      target.attendeeIds = ids;
    });
    return ids.length;
  }

  /** 'present' | 'absent' | null (Anwesenheit noch nicht erfasst). */
  function attendanceOf(meeting, personId) {
    if (!meeting.attendanceTaken) return null;
    return (meeting.attendeeIds || []).includes(personId) ? 'present' : 'absent';
  }

  /** Anzahl kommender Treffen, auf die die Person noch nicht geantwortet hat (Badge im Dashboard). */
  function countUnanswered(personId) {
    return getUpcoming().filter((m) => !getResponse(m, personId)).length;
  }

  /** "Mittwoch, 14.10.2026 · 13:30 – 14:15 Uhr · Raum 104" */
  function whenText(meeting) {
    const day = U.formatDateLong(U.parseIsoDate(meeting.date));
    let time = '';
    if (meeting.startTime && meeting.endTime) time = ` · ${meeting.startTime} – ${meeting.endTime} Uhr`;
    else if (meeting.startTime) time = ` · ab ${meeting.startTime} Uhr`;
    return `${day}${time}${meeting.location ? ` · ${meeting.location}` : ''}`;
  }

  function creatorLabel(meeting) {
    if (!meeting.createdBy) return 'Administration';
    const person = SSD.StudentService.getById(meeting.createdBy);
    return person ? SSD.StudentService.fullName(person) : '(gelöscht)';
  }

  return {
    getAll, getById, getUpcoming, getPast, getInvitees,
    canManage, create, update, remove,
    getResponse, respond, summarize,
    setAttendance, attendanceOf, countUnanswered,
    whenText, creatorLabel,
  };
})();
