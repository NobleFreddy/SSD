/**
 * ============================================================================
 * SSD.Auth — Benutzerverwaltung, Login & Sitzungen
 * ============================================================================
 * Es gibt zwei Rollen: "admin" (genau ein Konto, im Setup-Assistenten
 * angelegt) und "student" (beliebig viele, vom Administrator angelegte
 * Konten). Passwörter werden nicht im Klartext gespeichert, sondern als
 * SHA-256-Hash mit individuellem Salt (Web-Crypto-API, ohne externe
 * Bibliothek). Die Prüfung selbst läuft im Browser-JavaScript der Anwendung,
 * nicht auf einem eigenen Server — der Hash verhindert lediglich das
 * versehentliche Klartext-Mitlesen von Passwörtern (z. B. in exportierten
 * JSON-Dateien oder direkt in der Datenbank), siehe README-Sicherheitshinweis.
 */
window.SSD = window.SSD || {};

SSD.Auth = (function () {
  'use strict';

  const SESSION_KEY = 'ssd_session_v1';

  /* ---------------------------------------------------------------------
   * Hashing
   * ------------------------------------------------------------------- */

  function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function generateSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return bufferToHex(bytes.buffer);
  }

  async function hashPassword(password, salt) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      const data = new TextEncoder().encode(`${salt}::${password}`);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return bufferToHex(digest);
    }
    // Fallback ohne Web-Crypto (z. B. sehr alte Umgebungen): einfacher,
    // nicht kryptografisch starker Hash — besser als Klartext, aber nur
    // ein Sicherheitsnetz für den unwahrscheinlichen Fall fehlender SubtleCrypto-Unterstützung.
    let hash = 0;
    const str = `${salt}::${password}`;
    for (let i = 0; i < str.length; i++) {
      hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
    }
    return `fallback_${hash}`;
  }

  async function verifyPassword(password, salt, expectedHash) {
    const hash = await hashPassword(password, salt);
    return hash === expectedHash;
  }

  /* ---------------------------------------------------------------------
   * Sitzung (sessionStorage — endet, wenn der Browser-Tab geschlossen wird)
   * ------------------------------------------------------------------- */

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function setSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    SSD.EventBus.emit('auth:changed', session);
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    SSD.EventBus.emit('auth:changed', null);
  }

  /** Verwirft eine veraltete Sitzung still (ohne 'auth:changed') — für den Router während des Seitenwechsels. */
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
  }

  function getCurrentStudent() {
    const session = getSession();
    if (!session || (session.role !== 'student' && session.role !== 'azubi')) return null;
    const state = SSD.Store.getState();
    return state.students.find((s) => s.id === session.studentId) || null;
  }

  /* ---------------------------------------------------------------------
   * Team-Koordination (Administrator + Sanisprecher:innen)
   * ---------------------------------------------------------------------
   * Pinnwand, Teamtreffen, Aufgaben anlegen, Lücken füllen, Registrierungen
   * freigeben und die Engagement-Übersicht stehen dem Administrator und den
   * Personen mit Zusatzbezeichnung (Sanisprecher:in / Stellv.) offen. Wie alle
   * Rechte dieser App wird das im Browser geprüft (siehe README, Sicherheit).
   */

  function isAdminSession() {
    const session = getSession();
    return !!(session && session.role === 'admin');
  }

  function canCoordinate() {
    if (isAdminSession()) return true;
    const student = getCurrentStudent();
    return !!(student && student.active && SSD.StudentService.isTeamLead(student));
  }

  /** ID der angemeldeten Schüler:in/des Azubis — `null` beim Administrator (= "von der Administration"). */
  function currentPersonId() {
    const session = getSession();
    return session && session.role !== 'admin' ? session.studentId || null : null;
  }

  /**
   * Darf die angemeldete Person einen Eintrag der Team-Koordination
   * (Pinnwand-Beitrag, Teamtreffen, Aufgabe) bearbeiten oder löschen?
   * Administrator: alle; Sanisprecher:innen: nur selbst angelegte.
   */
  function canManageItem(item) {
    if (!item || !canCoordinate()) return false;
    if (isAdminSession()) return true;
    return !!item.createdBy && item.createdBy === currentPersonId();
  }

  /* ---------------------------------------------------------------------
   * Schulcode für die Selbstregistrierung
   * ---------------------------------------------------------------------
   * Wer sich mit dem richtigen Code registriert, ist sofort freigeschaltet.
   * Gespeichert wird nur ein gesalzener Hash — der gesamte Datenstand ist
   * mit dem öffentlichen Datenbankschlüssel lesbar, ein Klartext-Code wäre
   * also für jeden in den Entwicklertools sichtbar. Wie die Passwortprüfung
   * läuft auch diese Prüfung im Browser (Komfort-Hürde, keine harte
   * Zugangskontrolle — siehe README).
   */

  const REGISTRATION_CODE_MIN_LENGTH = 6;
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne verwechselbare Zeichen (0/O, 1/I)

  /** Groß-/Kleinschreibung, Leerzeichen und Bindestriche spielen bei der Eingabe keine Rolle. */
  function normalizeRegistrationCode(code) {
    return String(code || '').toUpperCase().replace(/[\s-]/g, '');
  }

  function isValidRegistrationCode(code) {
    return normalizeRegistrationCode(code).length >= REGISTRATION_CODE_MIN_LENGTH;
  }

  /** Zufälliger, gut diktierbarer Code im Format SANI-XXXX-XXXX. */
  function generateRegistrationCode() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    return `SANI-${chars.slice(0, 4)}-${chars.slice(4)}`;
  }

  async function hashRegistrationCode(code) {
    const salt = generateSalt();
    return { registrationCodeHash: await hashPassword(normalizeRegistrationCode(code), salt), registrationCodeSalt: salt };
  }

  function hasRegistrationCode() {
    const settings = SSD.Store.getState().settings;
    return !!(settings.registrationCodeHash && settings.registrationCodeSalt);
  }

  async function verifyRegistrationCode(code) {
    const settings = SSD.Store.getState().settings;
    if (!hasRegistrationCode()) return false;
    return verifyPassword(normalizeRegistrationCode(code), settings.registrationCodeSalt, settings.registrationCodeHash);
  }

  /** Setzt einen neuen Schulcode oder entfernt ihn (`code` leer/null). */
  async function setRegistrationCode(code) {
    const patch = code
      ? await hashRegistrationCode(code)
      : { registrationCodeHash: null, registrationCodeSalt: null };
    SSD.Store.commit(code ? 'Schulcode festgelegt' : 'Schulcode entfernt', (draft) => {
      Object.assign(draft.settings, patch);
    }, { trackHistory: false });
  }

  /* ---------------------------------------------------------------------
   * Ersteinrichtung
   * ------------------------------------------------------------------- */

  async function completeSetup({ schoolName, adminUsername, adminPassword, registrationCode }) {
    const salt = generateSalt();
    const passwordHash = await hashPassword(adminPassword, salt);
    const codePatch = registrationCode ? await hashRegistrationCode(registrationCode) : null;
    SSD.Store.commit('Ersteinrichtung abgeschlossen', (draft) => {
      draft.school.name = schoolName || 'Meine Schule';
      draft.admin = { username: adminUsername, passwordHash, salt };
      if (codePatch) Object.assign(draft.settings, codePatch);
      draft.meta.setupComplete = true;
    }, { trackHistory: false });
    setSession({ role: 'admin' });
  }

  /* ---------------------------------------------------------------------
   * Login
   * ------------------------------------------------------------------- */

  async function loginAdmin(username, password) {
    const state = SSD.Store.getState();
    const admin = state.admin;
    if (!admin || admin.username.toLowerCase() !== String(username).trim().toLowerCase()) {
      return { ok: false, error: 'Benutzername oder Passwort ist falsch.' };
    }
    const valid = await verifyPassword(password, admin.salt, admin.passwordHash);
    if (!valid) return { ok: false, error: 'Benutzername oder Passwort ist falsch.' };
    setSession({ role: 'admin' });
    return { ok: true };
  }

  async function loginStudent(username, password) {
    const state = SSD.Store.getState();
    const uname = String(username).trim().toLowerCase();
    const student = state.students.find((s) => s.username.toLowerCase() === uname);
    if (!student) return { ok: false, error: 'Benutzername oder Passwort ist falsch.' };
    if (!student.active && student.pendingApproval) {
      return { ok: false, error: 'Ihr Konto wartet noch auf die Freischaltung durch die Administration oder die Sanisprecher:innen.' };
    }
    if (!student.active) return { ok: false, error: 'Dieses Konto ist deaktiviert. Bitte an den Administrator wenden.' };
    const valid = await verifyPassword(password, student.salt, student.passwordHash);
    if (!valid) return { ok: false, error: 'Benutzername oder Passwort ist falsch.' };
    setSession({ role: student.role || 'student', studentId: student.id });
    return { ok: true };
  }

  async function setStudentPassword(student, newPassword) {
    const salt = generateSalt();
    const passwordHash = await hashPassword(newPassword, salt);
    student.salt = salt;
    student.passwordHash = passwordHash;
  }

  async function changeAdminCredentials({ username, newPassword }) {
    const state = SSD.Store.getState();
    let passwordHash = state.admin.passwordHash;
    let salt = state.admin.salt;
    if (newPassword) {
      salt = generateSalt();
      passwordHash = await hashPassword(newPassword, salt);
    }
    SSD.Store.commit('Admin-Zugangsdaten geändert', (draft) => {
      draft.admin.username = username || draft.admin.username;
      draft.admin.passwordHash = passwordHash;
      draft.admin.salt = salt;
    }, { trackHistory: false });
  }

  function isUsernameTaken(username, excludeStudentId) {
    const state = SSD.Store.getState();
    const uname = String(username).trim().toLowerCase();
    if (state.admin && state.admin.username.toLowerCase() === uname) return true;
    return state.students.some((s) => s.id !== excludeStudentId && s.username.toLowerCase() === uname);
  }

  return {
    generateSalt, hashPassword, verifyPassword,
    getSession, setSession, logout, clearSession, getCurrentStudent,
    isAdminSession, canCoordinate, currentPersonId, canManageItem,
    completeSetup, loginAdmin, loginStudent,
    setStudentPassword, changeAdminCredentials, isUsernameTaken,
    REGISTRATION_CODE_MIN_LENGTH, normalizeRegistrationCode, isValidRegistrationCode,
    generateRegistrationCode, hasRegistrationCode, verifyRegistrationCode, setRegistrationCode,
  };
})();
