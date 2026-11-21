/**
 * ============================================================================
 * SSD.AvailabilityService — Verfügbarkeit nach Woche & Klausuren
 * ============================================================================
 * Die Verfügbarkeit einer Person ergibt sich für einen Dienst aus drei Ebenen
 * (die erste zutreffende gewinnt):
 *   1. Klausur/Termin (`student.exams`) → "gesperrt"
 *   2. Eintrag für genau diese Woche (`student.availabilityWeeks[Montag]`)
 *   3. Standardwoche (`student.availability`)
 * Planung, Vertretungen und die Wochen-Aktualisierung fragen ausschließlich
 * `stateAt()` — so gilt überall dieselbe Regel.
 *
 * Bearbeiten: Sanis ändern die eigenen Angaben (Standardwoche und einzelne
 * Wochen nur bis zur Änderungsfrist der jeweiligen Woche, Klausuren jederzeit),
 * der Administrator die aller Personen ohne Frist. Der Server lässt fremde
 * Angaben ohnehin nur vom Administrator ändern (ssd_private.merge_incoming).
 */
window.SSD = window.SSD || {};

SSD.AvailabilityService = (function () {
  'use strict';

  const U = SSD.Utils;
  const WEEKS_AHEAD = 8; // so viele Wochen im Voraus lassen sich einzeln eintragen
  const STATES = ['available', 'unavailable', 'blocked'];
  const MAX_EXAM_DAYS = 31;

  function toDate(value) {
    return value instanceof Date ? value : U.parseIsoDate(value);
  }

  /** Montag der Woche als 'YYYY-MM-DD'. */
  function mondayIso(value) {
    return U.toIsoDate(U.getMondayOfWeek(toDate(value)));
  }

  function examCovers(exam, dateIso, blockKey) {
    if (!exam || !exam.startDate || dateIso < exam.startDate || dateIso > (exam.endDate || exam.startDate)) return false;
    return !exam.blocks || !exam.blocks.length || exam.blocks.includes(blockKey);
  }

  /** Klausur/Termin, der die Person zu diesem Zeitpunkt sperrt (oder null). */
  function examAt(student, dateIso, blockKey) {
    return (student.exams || []).find((exam) => examCovers(exam, dateIso, blockKey)) || null;
  }

  /**
   * Verfügbarkeit einer Person für einen Dienst: 'available' | 'unavailable' | 'blocked'.
   * `weekday`/`weekMonday` sind optional (Planungs-Slots bringen sie schon mit).
   */
  function stateAt(student, dateIso, blockKey, weekday, weekMonday) {
    if (!student) return 'unavailable';
    if (examAt(student, dateIso, blockKey)) return 'blocked';
    const day = weekday || U.weekdayKeyFromDate(U.parseIsoDate(dateIso));
    const blockIdx = U.DUTY_BLOCK_KEYS.indexOf(blockKey);
    const week = student.availabilityWeeks && student.availabilityWeeks[weekMonday || mondayIso(dateIso)];
    const row = (week && week[day]) || (student.availability && student.availability[day]);
    return (row && row[blockIdx]) || 'unavailable';
  }

  /** Warum ist die Person (nicht) verfügbar? Für Hinweise in der Oberfläche. */
  function reasonAt(student, dateIso, blockKey) {
    const exam = examAt(student, dateIso, blockKey);
    if (exam) return { state: 'blocked', source: 'exam', exam };
    const monday = mondayIso(dateIso);
    const isWeek = !!(student.availabilityWeeks && student.availabilityWeeks[monday]);
    return { state: stateAt(student, dateIso, blockKey), source: isWeek ? 'week' : 'template' };
  }

  /** Raster einer Woche (Kopie): eigener Wocheneintrag, sonst die Standardwoche. */
  function weekGrid(student, monday) {
    const week = monday && student.availabilityWeeks && student.availabilityWeeks[monday];
    const source = week || student.availability || SSD.Models.createEmptyAvailability();
    const grid = {};
    U.WEEKDAY_KEYS.forEach((day) => { grid[day] = (source[day] || U.DUTY_BLOCK_KEYS.map(() => 'unavailable')).slice(); });
    return { grid, isOverride: !!week };
  }

  /** Hat die Person überhaupt irgendwo "verfügbar" eingetragen (Standardwoche oder eine kommende Woche)? */
  function hasAnyAvailable(student) {
    const has = (grid) => Object.values(grid || {}).some((day) => Array.isArray(day) && day.includes('available'));
    if (has(student.availability)) return true;
    const thisMonday = mondayIso(U.today());
    return Object.keys(student.availabilityWeeks || {}).some((monday) => monday >= thisMonday && has(student.availabilityWeeks[monday]));
  }

  /* ---------------------------------------------------------------------
   * Wochen & Fristen
   * ------------------------------------------------------------------- */

  /** Frist für Sanis: Eine Woche ist bis `Änderungsfrist` Tage vor ihrem Montag änderbar. */
  function weekLock(monday, refDate) {
    const ref = refDate || U.today();
    const deadlineDays = U.clamp(Number(SSD.Store.getState().settings.changeDeadlineDaysBeforeWeek) || 0, 0, 6);
    const lockDate = U.addDays(U.parseIsoDate(monday), -deadlineDays);
    return { editable: ref < lockDate, lockDate };
  }

  /**
   * Die kommenden Wochen zum Eintragen. Mit `includeCurrent` (Administrator)
   * zusätzlich die laufende Woche.
   * @returns {Array<{monday:string, label:string, short:string, editable:boolean, lockDate:Date, isCurrent:boolean}>}
   */
  function upcomingWeeks(options) {
    const opts = options || {};
    const today = U.today();
    const thisMonday = U.getMondayOfWeek(today);
    const weeks = [];
    for (let i = opts.includeCurrent ? 0 : 1; i <= WEEKS_AHEAD; i++) {
      const mondayDate = U.addDays(thisMonday, i * 7);
      const monday = U.toIsoDate(mondayDate);
      const lock = weekLock(monday, today);
      weeks.push({
        monday,
        isCurrent: i === 0,
        short: `KW ${U.getIsoWeekNumber(mondayDate)}`,
        label: `KW ${U.getIsoWeekNumber(mondayDate)} · ${U.formatDateShort(mondayDate)}–${U.formatDateShort(U.addDays(mondayDate, 4))}`,
        editable: lock.editable,
        lockDate: lock.lockDate,
      });
    }
    return weeks;
  }

  function assertCanEdit(studentId) {
    if (SSD.Auth.isAdminSession()) return;
    if (SSD.Auth.currentPersonId() !== studentId) throw new Error('Verfügbarkeiten anderer Personen kann nur der Administrator ändern.');
  }

  /**
   * Setzt einen Block. `scope` = 'template' (Standardwoche) oder der Montag einer
   * Woche — dann entsteht beim ersten Ändern ein eigener Wocheneintrag als Kopie
   * der Standardwoche.
   */
  function setCell(studentId, scope, day, blockIdx, newState) {
    assertCanEdit(studentId);
    if (!STATES.includes(newState)) throw new Error('Ungültiger Wert.');
    if (!SSD.Auth.isAdminSession()) {
      const open = scope === 'template' ? SSD.StudentService.getAvailabilityWindow().isOpen : weekLock(scope).editable;
      if (!open) throw new Error('Die Änderungsfrist für diese Woche ist abgelaufen.');
    }
    SSD.Store.commit(scope === 'template' ? 'Verfügbarkeit geändert' : `Verfügbarkeit für die Woche ab ${U.formatDateShort(U.parseIsoDate(scope))} geändert`, (draft) => {
      const student = draft.students.find((s) => s.id === studentId);
      if (!student) return;
      if (scope === 'template') {
        student.availability[day][blockIdx] = newState;
      } else {
        if (!student.availabilityWeeks || typeof student.availabilityWeeks !== 'object') student.availabilityWeeks = {};
        if (!student.availabilityWeeks[scope]) student.availabilityWeeks[scope] = weekGrid(student, null).grid;
        student.availabilityWeeks[scope][day][blockIdx] = newState;
      }
      student.availabilityUpdatedAt = new Date().toISOString();
    });
  }

  /** Eigenen Wocheneintrag verwerfen — die Woche richtet sich dann wieder nach der Standardwoche. */
  function resetWeek(studentId, monday) {
    assertCanEdit(studentId);
    if (!SSD.Auth.isAdminSession() && !weekLock(monday).editable) throw new Error('Die Änderungsfrist für diese Woche ist abgelaufen.');
    SSD.Store.commit('Woche auf Standardwoche zurückgesetzt', (draft) => {
      const student = draft.students.find((s) => s.id === studentId);
      if (student && student.availabilityWeeks) delete student.availabilityWeeks[monday];
    });
  }

  /* ---------------------------------------------------------------------
   * Klausuren & feste Termine
   * ------------------------------------------------------------------- */

  function getExams(student) {
    return (student.exams || []).slice().sort((a, b) => (a.startDate + (a.blocks || []).join()).localeCompare(b.startDate + (b.blocks || []).join()));
  }

  function upcomingExams(student) {
    const todayIso = U.toIsoDate(U.today());
    return getExams(student).filter((exam) => (exam.endDate || exam.startDate) >= todayIso);
  }

  /** "Mo, 30.11., 1./2. + 3./4. Stunde" bzw. "Mo, 30.11. – Mi, 02.12., ganzer Tag" */
  function describeExam(exam) {
    const day = (iso) => `${U.WEEKDAY_LABELS_SHORT[U.weekdayKeyFromDate(U.parseIsoDate(iso))] || ''}, ${U.formatDateShort(U.parseIsoDate(iso))}`;
    const range = exam.endDate && exam.endDate !== exam.startDate ? `${day(exam.startDate)} – ${day(exam.endDate)}` : day(exam.startDate);
    const blocks = exam.blocks && exam.blocks.length ? exam.blocks.map((b) => U.blockLabel(b).replace(' Stunde', '')).join(' + ') + ' Stunde' : 'ganzer Tag';
    return `${range}, ${blocks}`;
  }

  function cleanExam(data) {
    const startDate = String(data.startDate || '');
    const endDate = String(data.endDate || data.startDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Bitte ein Datum angeben.');
    if (endDate < startDate) throw new Error('Das Enddatum darf nicht vor dem Beginn liegen.');
    if (U.dayDiff(U.parseIsoDate(startDate), U.parseIsoDate(endDate)) > MAX_EXAM_DAYS) throw new Error(`Höchstens ${MAX_EXAM_DAYS} Tage am Stück — für längere Zeiträume bitte die Wochen-Verfügbarkeit nutzen.`);
    if (endDate < U.toIsoDate(U.today())) throw new Error('Der Termin liegt in der Vergangenheit.');
    const blocks = Array.from(new Set((data.blocks || []).filter((b) => U.DUTY_BLOCK_KEYS.includes(b))));
    return {
      title: String(data.title || '').trim().slice(0, 60),
      startDate, endDate,
      blocks: blocks.length === U.DUTY_BLOCK_KEYS.length ? [] : blocks.sort((a, b) => U.DUTY_BLOCK_KEYS.indexOf(a) - U.DUTY_BLOCK_KEYS.indexOf(b)),
    };
  }

  /** Legt eine Klausur an (ohne `data.id`) oder ändert sie. Gibt die gespeicherte Klausur zurück. */
  function saveExam(studentId, data) {
    assertCanEdit(studentId);
    const clean = cleanExam(data);
    const exam = data.id ? Object.assign({}, clean, { id: data.id }) : SSD.Models.createExam(clean);
    SSD.Store.commit(data.id ? 'Klausur geändert' : 'Klausur eingetragen', (draft) => {
      const student = draft.students.find((s) => s.id === studentId);
      if (!student) return;
      if (!Array.isArray(student.exams)) student.exams = [];
      const existing = student.exams.find((e) => e.id === exam.id);
      if (existing) Object.assign(existing, clean);
      else student.exams.push(exam);
    });
    return exam;
  }

  function removeExam(studentId, examId) {
    assertCanEdit(studentId);
    SSD.Store.commit('Klausur gelöscht', (draft) => {
      const student = draft.students.find((s) => s.id === studentId);
      if (student) student.exams = (student.exams || []).filter((e) => e.id !== examId);
    });
  }

  /** Kommende Dienste der Person, die in die Klausurzeit fallen (z. B. um gleich eine Vertretung anzufordern). */
  function dutiesDuringExam(studentId, exam) {
    const todayIso = U.toIsoDate(U.today());
    return SSD.Store.getState().schedule.entries
      .filter((e) => e.date >= todayIso && ((e.studentIds || []).includes(studentId) || e.azubiId === studentId) && examCovers(exam, e.date, e.block))
      .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
  }

  /**
   * Aufräumen (Aufbewahrungsfrist): vergangene Wocheneinträge und Klausuren,
   * die länger als bis `cutoffIso` zurückliegen. Ändert `draft` direkt; gibt die Anzahl zurück.
   */
  function pruneDraft(draft, cutoffIso) {
    let removed = 0;
    draft.students.forEach((s) => {
      Object.keys(s.availabilityWeeks || {}).forEach((monday) => {
        if (U.toIsoDate(U.addDays(U.parseIsoDate(monday), 6)) < cutoffIso) { delete s.availabilityWeeks[monday]; removed++; }
      });
      const before = (s.exams || []).length;
      s.exams = (s.exams || []).filter((e) => (e.endDate || e.startDate) >= cutoffIso);
      removed += before - s.exams.length;
    });
    return removed;
  }

  function countPrunable(state, cutoffIso) {
    let count = 0;
    state.students.forEach((s) => {
      Object.keys(s.availabilityWeeks || {}).forEach((monday) => { if (U.toIsoDate(U.addDays(U.parseIsoDate(monday), 6)) < cutoffIso) count++; });
      count += (s.exams || []).filter((e) => (e.endDate || e.startDate) < cutoffIso).length;
    });
    return count;
  }

  return {
    WEEKS_AHEAD, STATES,
    mondayIso, stateAt, reasonAt, examAt, examCovers, weekGrid, hasAnyAvailable,
    weekLock, upcomingWeeks, setCell, resetWeek,
    getExams, upcomingExams, describeExam, saveExam, removeExam, dutiesDuringExam,
    pruneDraft, countPrunable,
  };
})();
