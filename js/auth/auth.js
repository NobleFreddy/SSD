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

  function getCurrentStudent() {
    const session = getSession();
    if (!session || (session.role !== 'student' && session.role !== 'azubi')) return null;
    const state = SSD.Store.getState();
    return state.students.find((s) => s.id === session.studentId) || null;
  }

  /* ---------------------------------------------------------------------
   * Ersteinrichtung
   * ------------------------------------------------------------------- */

  async function completeSetup({ schoolName, adminUsername, adminPassword }) {
    const salt = generateSalt();
    const passwordHash = await hashPassword(adminPassword, salt);
    SSD.Store.commit('Ersteinrichtung abgeschlossen', (draft) => {
      draft.school.name = schoolName || 'Meine Schule';
      draft.admin = { username: adminUsername, passwordHash, salt };
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
    getSession, setSession, logout, getCurrentStudent,
    completeSetup, loginAdmin, loginStudent,
    setStudentPassword, changeAdminCredentials, isUsernameTaken,
  };
})();
