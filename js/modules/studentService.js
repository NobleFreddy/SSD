/**
 * ============================================================================
 * SSD.StudentService — Schülerverwaltung
 * ============================================================================
 * Kapselt sämtliche Lese-/Schreiboperationen auf Schülerdaten sowie davon
 * abgeleitete Informationen (Verfügbarkeitsfenster, Dienst-Historie,
 * Suche/Filter). UI-Views greifen ausschließlich über dieses Modul auf
 * Schülerdaten zu, nie direkt auf `SSD.Store`.
 */
window.SSD = window.SSD || {};

SSD.StudentService = (function () {
  'use strict';

  const U = SSD.Utils;

  function getAll() {
    return SSD.Store.getState().students;
  }

  function getById(id) {
    return getAll().find((s) => s.id === id) || null;
  }

  function getActive() {
    return getAll().filter((s) => s.active);
  }

  /** Aktive Personen einer bestimmten Kategorie ('student' oder 'azubi'). */
  function getActiveByRole(role) {
    return getActive().filter((s) => (s.role || 'student') === role);
  }

  async function create({ firstName, lastName, username, password, role, gender, schoolClass, yearGroup, maxDutiesPerWeek, notes, adminMessage, active, pendingApproval }) {
    const salt = SSD.Auth.generateSalt();
    const passwordHash = await SSD.Auth.hashPassword(password, salt);
    const student = SSD.Models.createStudent({
      firstName, lastName, username, gender, schoolClass, yearGroup,
      role: role || 'student',
      maxDutiesPerWeek: maxDutiesPerWeek || null,
      notes: notes || '', adminMessage: adminMessage || '',
      passwordHash, salt,
      active: active !== false,
      pendingApproval: !!pendingApproval,
    });
    SSD.Store.commit(`Schüler "${firstName} ${lastName}" angelegt`, (draft) => {
      draft.students.push(student);
    });
    return student;
  }

  /**
   * Selbstregistrierung durch Schüler:innen/Azubis über den Login-Bildschirm.
   * Ohne Schulcode ist das neue Konto bewusst inaktiv, bis ein Administrator
   * es freischaltet. Mit gültigem Schulcode (`autoApprove`, vorher per
   * `SSD.Auth.verifyRegistrationCode` geprüft) ist es sofort aktiv.
   */
  async function registerSelf({ firstName, lastName, username, password, role, gender, schoolClass, yearGroup, autoApprove }) {
    const student = await create({
      firstName, lastName, username, password, role, gender, schoolClass, yearGroup,
      active: !!autoApprove, pendingApproval: !autoApprove,
    });
    return student;
  }

  /** Anzahl der Selbstregistrierungen, die noch auf eine Entscheidung des Administrators warten. */
  function getPendingApprovalCount() {
    return getAll().filter((s) => s.pendingApproval).length;
  }

  function update(id, patch) {
    SSD.Store.commit('Schülerdaten bearbeitet', (draft) => {
      const student = draft.students.find((s) => s.id === id);
      if (!student) return;
      Object.assign(student, patch);
      if ('active' in patch) student.pendingApproval = false; // Administrator hat die Zusage/Ablehnung bearbeitet
    });
  }

  async function resetPassword(id, newPassword) {
    const state = SSD.Store.getState();
    const student = state.students.find((s) => s.id === id);
    if (!student) return;
    await SSD.Auth.setStudentPassword(student, newPassword);
    SSD.Store.commit('Passwort zurückgesetzt', (draft) => {
      const target = draft.students.find((s) => s.id === id);
      target.salt = student.salt;
      target.passwordHash = student.passwordHash;
    });
  }

  function remove(id) {
    const student = getById(id);
    SSD.Store.commit(`Schüler "${student ? student.firstName + ' ' + student.lastName : ''}" gelöscht`, (draft) => {
      draft.students = draft.students.filter((s) => s.id !== id);
      draft.schedule.entries.forEach((entry) => {
        entry.studentIds = entry.studentIds.filter((sid) => sid !== id);
        if (entry.azubiId === id) entry.azubiId = null;
      });
      draft.students.forEach((s) => {
        if (Array.isArray(s.preferredPartnerIds)) s.preferredPartnerIds = s.preferredPartnerIds.filter((pid) => pid !== id);
      });
      draft.settings.pairRules = (draft.settings.pairRules || []).filter((r) => r.a !== id && r.b !== id);
    });
  }

  /* ---------------------------------------------------------------------
   * Wunschpartner:innen (nur Kategorie "student" — Azubis haben einen
   * eigenen Einzelplatz und werden nicht gepaart)
   * ------------------------------------------------------------------- */

  const MAX_PREFERRED_PARTNERS = 3;

  function isPairable(person) {
    return !!(person && person.active && (person.role || 'student') === 'student');
  }

  /** Aktuell gültige Wunschpartner:innen einer Person (gelöschte/inaktive werden übersprungen). */
  function getPreferredPartners(student) {
    return (student.preferredPartnerIds || []).map(getById).filter(isPairable);
  }

  function setPreferredPartners(id, partnerIds) {
    const student = getById(id);
    if (!student || (student.role || 'student') !== 'student') return [];
    const valid = Array.from(new Set(partnerIds))
      .filter((pid) => pid !== id && isPairable(getById(pid)))
      .slice(0, MAX_PREFERRED_PARTNERS);
    SSD.Store.commit('Wunschpartner:innen geändert', (draft) => {
      const target = draft.students.find((s) => s.id === id);
      if (target) target.preferredPartnerIds = valid;
    }, { trackHistory: false });
    return valid;
  }

  function setActive(id, active) {
    const student = getById(id);
    SSD.Store.commit(active ? `Schüler "${student.firstName}" aktiviert` : `Schüler "${student.firstName}" deaktiviert`, (draft) => {
      const target = draft.students.find((s) => s.id === id);
      target.active = active;
      target.pendingApproval = false; // Administrator hat eine Entscheidung getroffen
    });
  }

  /* ---------------------------------------------------------------------
   * Sanisprecher:in / Stellv. Sanisprecher:in — Zusatzbezeichnung
   * ------------------------------------------------------------------- */

  /** Aktive Person mit einer bestimmten Zusatzbezeichnung ('sanisprecher' | 'vize_sanisprecher'), falls vergeben. */
  function getLeadershipHolder(key) {
    return getActive().find((s) => s.leadershipRole === key) || null;
  }

  function isTeamLead(student) {
    return !!(student && student.leadershipRole);
  }

  /**
   * Vergibt eine Zusatzbezeichnung an eine Person. Da es je Bezeichnung immer
   * nur eine Trägerin/einen Träger gibt, wird eine evtl. bisherige Inhaberin
   * automatisch abgelöst; hält die Zielperson bereits die jeweils andere
   * Bezeichnung, wird diese ersetzt (niemand trägt beide gleichzeitig).
   */
  function setLeadershipRole(studentId, key) {
    const student = getById(studentId);
    if (!student) return;
    const label = SSD.Models.LEADERSHIP_ROLES.find((r) => r.key === key)?.label || key;
    SSD.Store.commit(`${label} festgelegt: ${fullName(student)}`, (draft) => {
      draft.students.forEach((s) => {
        if (s.id === studentId || s.leadershipRole === key) s.leadershipRole = null;
      });
      const target = draft.students.find((s) => s.id === studentId);
      if (target) target.leadershipRole = key;
    });
  }

  function clearLeadershipRole(studentId) {
    const student = getById(studentId);
    if (!student) return;
    SSD.Store.commit(`Zusatzbezeichnung entfernt: ${fullName(student)}`, (draft) => {
      const target = draft.students.find((s) => s.id === studentId);
      if (target) target.leadershipRole = null;
    });
  }

  function setAvailabilityCell(id, dayKey, blockIndex, newState) {
    SSD.Store.commit('Verfügbarkeit geändert', (draft) => {
      const student = draft.students.find((s) => s.id === id);
      if (!student) return;
      student.availability[dayKey][blockIndex] = newState;
      student.availabilityUpdatedAt = new Date().toISOString();
    });
  }

  /* ---------------------------------------------------------------------
   * Änderungsfrist ("Zeitraum, in dem Änderungen erlaubt sind")
   * ------------------------------------------------------------------- */

  /**
   * Berechnet das aktuelle Verfügbarkeitsfenster für Schüler-Änderungen.
   * Regel: Die Vorlage für die kommende Woche kann bis N Tage vor deren
   * Montag bearbeitet werden; danach ist sie gesperrt, bis die neue Woche
   * beginnt und sich das Fenster für die übernächste Woche neu öffnet.
   */
  function getAvailabilityWindow(referenceDate) {
    const settings = SSD.Store.getState().settings;
    const ref = referenceDate || U.today();
    const thisMonday = U.getMondayOfWeek(ref);
    const nextMonday = U.addDays(thisMonday, 7);
    const lockDate = U.addDays(nextMonday, -settings.changeDeadlineDaysBeforeWeek);
    const isOpen = ref < lockDate;
    return {
      isOpen,
      lockDate,
      nextMonday,
      daysUntilLock: Math.max(0, U.dayDiff(ref, lockDate)),
    };
  }

  /* ---------------------------------------------------------------------
   * Abgeleitete Dienst-Historie (aus dem generierten Dienstplan)
   * ------------------------------------------------------------------- */

  /** Findet alle Diensteinträge einer Person — berücksichtigt sowohl die regulären
   * Schüler-Plätze als auch (für Azubis) den dritten, einzelnen Azubi-Platz. */
  function getDutiesForStudent(id) {
    const entries = SSD.Store.getState().schedule.entries;
    return entries
      .filter((e) => e.studentIds.includes(id) || e.azubiId === id)
      .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
  }

  function getDutySummary(id) {
    const todayIso = U.toIsoDate(U.today());
    const duties = getDutiesForStudent(id);
    const past = duties.filter((d) => d.date < todayIso);
    const upcoming = duties.filter((d) => d.date >= todayIso);
    return { total: duties.length, past, upcoming };
  }

  /* ---------------------------------------------------------------------
   * Suche & Filter
   * ------------------------------------------------------------------- */

  function filterStudents(students, filters = {}) {
    const query = U.normalizeForSearch(filters.query || '');
    return students.filter((s) => {
      if (filters.role && (s.role || 'student') !== filters.role) return false;
      if (filters.schoolClass && s.schoolClass !== filters.schoolClass) return false;
      if (filters.gender && s.gender !== filters.gender) return false;
      if (filters.yearGroup && String(s.yearGroup) !== String(filters.yearGroup)) return false;
      if (filters.status === 'active' && !s.active) return false;
      if (filters.status === 'inactive' && s.active) return false;
      if (query) {
        const haystack = U.normalizeForSearch(`${s.firstName} ${s.lastName} ${s.username} ${s.schoolClass}`);
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function getDistinctClasses() {
    return Array.from(new Set(getAll().map((s) => s.schoolClass).filter(Boolean))).sort();
  }

  function getDistinctYearGroups() {
    return Array.from(new Set(getAll().map((s) => s.yearGroup).filter(Boolean))).sort((a, b) => a - b);
  }

  function fullName(student) {
    return `${student.firstName} ${student.lastName}`.trim();
  }

  return {
    getAll, getById, getActive, getActiveByRole, create, registerSelf, update, remove, setActive,
    MAX_PREFERRED_PARTNERS, getPreferredPartners, setPreferredPartners,
    getLeadershipHolder, isTeamLead, setLeadershipRole, clearLeadershipRole,
    setAvailabilityCell, resetPassword, getAvailabilityWindow, getPendingApprovalCount,
    getDutiesForStudent, getDutySummary,
    filterStudents, getDistinctClasses, getDistinctYearGroups, fullName,
  };
})();
