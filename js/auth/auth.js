/**
 * ============================================================================
 * SSD.Auth — Anmeldung, Sitzungen & Berechtigungen
 * ============================================================================
 * Es gibt zwei Rollen: "admin" (genau ein Konto, im Setup-Assistenten
 * angelegt) und "student"/"azubi" (beliebig viele Konten).
 *
 * Passwörter prüft ausschließlich der Server (Datenbankfunktion `ssd_login`,
 * bcrypt). Sie verlassen die Datenbank nie und stehen auch nicht im
 * Datenbestand. Der Browser erhält nach erfolgreicher Anmeldung nur ein
 * zufälliges Sitzungs-Token. Normalerweise liegt es im sessionStorage (endet
 * mit dem Schließen des Tabs, serverseitig spätestens nach 12 Stunden). Wer bei
 * der Anmeldung „Auf diesem Gerät angemeldet bleiben“ wählt (nur Sanis und
 * Azubis), behält es im localStorage — bis zum Abmelden, sonst 60 Tage nach der
 * letzten Nutzung. Rechte wie `canCoordinate()` steuern hier nur die Oberfläche;
 * was jemand tatsächlich lesen und speichern darf, entscheidet der Server
 * anhand des Tokens.
 */
window.SSD = window.SSD || {};

SSD.Auth = (function () {
  'use strict';

  const SESSION_KEY = 'ssd_session_v1';
  const PASSWORD_MIN_LENGTH = 10;
  const RENEW_INTERVAL_MS = 12 * 3600 * 1000;

  /* ---------------------------------------------------------------------
   * Sitzung dieses Tabs
   * ---------------------------------------------------------------------
   * Beim Start einmal aus dem Browser-Speicher gelesen und dann im Speicher
   * des Tabs gehalten: Meldet sich in einem anderen Tab jemand anderes an,
   * darf dieser Tab seine Daten nie mit dessen Token speichern.
   * ------------------------------------------------------------------- */

  let current = null;
  let restored = false;

  /** 'session' = bis zum Schließen des Tabs, 'local' = „Angemeldet bleiben“. */
  function browserStorage(kind) {
    try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (err) { return null; }
  }

  /** Sitzungen ohne Token stammen aus alten Versionen und gelten nicht. */
  function readStored(kind) {
    try {
      const raw = browserStorage(kind).getItem(SESSION_KEY);
      const session = raw ? JSON.parse(raw) : null;
      return session && session.token && (kind === 'session' || session.remembered) ? session : null;
    } catch (err) {
      return null;
    }
  }

  function writeStored(kind, session) {
    try {
      browserStorage(kind).setItem(SESSION_KEY, JSON.stringify(session));
      return true;
    } catch (err) {
      return false; // z. B. Speicher gesperrt — die Sitzung gilt dann nur in diesem Tab
    }
  }

  function removeStored(kind) {
    try { browserStorage(kind).removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
  }

  /** { role, studentId, token, mustChangePassword?, weakPassword?, remembered?, renewedAt? } */
  function getSession() {
    if (!restored) {
      restored = true;
      current = readStored('session') || readStored('local');
    }
    return current ? Object.assign({}, current) : null;
  }

  function storeSession(session) {
    restored = true;
    current = Object.assign({}, session);
    if (session.remembered && writeStored('local', session)) removeStored('session');
    else writeStored('session', session);
  }

  function getToken() {
    const session = getSession();
    return session ? session.token : null;
  }

  /** Verwirft die Sitzung still (ohne 'auth:changed') — für den Router und den App-Start. */
  function clearSession() {
    const token = getToken();
    current = null;
    removeStored('session');
    // Eine dauerhafte Anmeldung nur entfernen, wenn es die eigene ist (nicht die aus einem anderen Tab).
    const stored = readStored('local');
    if (!stored || stored.token === token) removeStored('local');
  }

  /* ---------------------------------------------------------------------
   * „Auf diesem Gerät angemeldet bleiben“
   * ------------------------------------------------------------------- */

  /** Grobe Gerätebezeichnung für „Mein Konto“, z. B. „iPhone · Safari“. */
  function deviceLabel() {
    const nav = window.navigator || {};
    const ua = String(nav.userAgent || '');
    const first = (pairs) => { const hit = pairs.find(([re]) => re.test(ua)); return hit ? hit[1] : ''; };
    const isIpadAsMac = /Macintosh/.test(ua) && nav.maxTouchPoints > 1; // iPads melden sich als Mac
    const device = isIpadAsMac ? 'iPad' : first([
      [/iPhone|iPod/, 'iPhone'], [/iPad/, 'iPad'], [/Android.*Mobile/, 'Android-Handy'], [/Android/, 'Android-Tablet'],
      [/Windows/, 'Windows-PC'], [/Macintosh/, 'Mac'], [/CrOS/, 'Chromebook'], [/Linux/, 'Linux-PC'],
    ]) || 'Gerät';
    const browser = first([
      [/Edg(e|A|iOS)?\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/SamsungBrowser\//, 'Samsung Internet'],
      [/Firefox\/|FxiOS\//, 'Firefox'], [/Chrome\/|CriOS\//, 'Chrome'], [/Safari\//, 'Safari'],
    ]);
    return browser ? `${device} · ${browser}` : device;
  }

  function canStoreLocally() {
    const storage = browserStorage('local');
    if (!storage) return false;
    try {
      storage.setItem(`${SESSION_KEY}_test`, '1');
      storage.removeItem(`${SESSION_KEY}_test`);
      return true;
    } catch (err) {
      return false;
    }
  }

  /** Macht die eben begonnene Sitzung dauerhaft. Scheitert das, bleibt es bei einer normalen Anmeldung. */
  async function rememberSession() {
    const session = getSession();
    if (!session || session.role === 'admin' || !canStoreLocally()) return false;
    try {
      const res = await SSD.Storage.call('ssd_remember', { p_token: session.token, p_device: deviceLabel() });
      if (!res || !res.ok || getToken() !== session.token) return false;
      storeSession(Object.assign(getSession(), { remembered: true, renewedAt: Date.now() }));
      return true;
    } catch (err) {
      return false; // z. B. Datenbank noch ohne diese Funktion
    }
  }

  /** Verlängert eine dauerhafte Anmeldung — höchstens alle 12 Stunden, beim Öffnen der App. */
  async function renewIfDue() {
    const session = getSession();
    if (!session || !session.remembered) return;
    if (Math.abs(Date.now() - (session.renewedAt || 0)) < RENEW_INTERVAL_MS) return;
    try {
      const res = await SSD.Storage.call('ssd_renew', { p_token: session.token });
      if (res && res.ok && getToken() === session.token) storeSession(Object.assign(getSession(), { renewedAt: Date.now() }));
    } catch (err) { /* offline — beim nächsten Öffnen */ }
  }

  /** Eigene Anmeldungen (Geräte) für „Mein Konto“. */
  async function listSessions() {
    const res = await SSD.Storage.call('ssd_sessions', { p_token: getToken() });
    if (!res || !res.ok) throw new Error(errorText(res));
    return res.sessions || [];
  }

  /** Meldet ein anderes Gerät bzw. (ohne ID) alle anderen Geräte ab. */
  async function endOtherSessions(sessionId) {
    const res = await SSD.Storage.call('ssd_end_sessions', sessionId ? { p_token: getToken(), p_session: sessionId } : { p_token: getToken() });
    if (!res || !res.ok) throw new Error(errorText(res));
    return res.ended || 0;
  }

  // Dauerhafte Anmeldungen teilen sich alle Tabs: Wird sie in einem anderen Tab beendet (oder
  // meldet sich dort jemand anderes dauerhaft an), verschwinden die Daten auch aus diesem Tab.
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY && e.key !== null) return;
    if (!current || !current.remembered) return;
    const stored = readStored('local');
    if (stored && stored.token === current.token) { current = stored; return; } // z. B. Passwort-Hinweis erledigt
    current = null;
    SSD.Store.clear();
    SSD.EventBus.emit('auth:ended-elsewhere', {});
    SSD.EventBus.emit('auth:changed', null);
  });

  /** Abmelden: Sitzung beim Server beenden und alle Daten aus diesem Tab entfernen. */
  async function logout() {
    // Eine eben gemachte Änderung erst fertig speichern (braucht noch die Sitzung).
    try { await SSD.Store.settle(); } catch (err) { /* Fehler meldet die Speicherung selbst */ }
    const token = getToken();
    if (token) SSD.Storage.call('ssd_logout', { p_token: token }).catch(() => { /* offline — läuft serverseitig ohnehin ab */ });
    clearSession();
    SSD.Store.clear();
    SSD.EventBus.emit('auth:changed', null);
    refreshPublicInfo(); // z. B. geänderter Schulname oder Datenschutzangaben für die Anmeldeseite
  }

  function getCurrentStudent() {
    const session = getSession();
    if (!session || (session.role !== 'student' && session.role !== 'azubi')) return null;
    const state = SSD.Store.getState();
    if (!state) return null;
    return state.students.find((s) => s.id === session.studentId) || null;
  }

  /**
   * Speichert die vom Server erhaltene Sitzung, lädt die erlaubten Daten und
   * meldet danach die Anmeldung (Router wechselt die Seite).
   * @param {{remember?: boolean}} [opts]
   * @returns {Promise<{remembered: boolean}>}
   */
  async function startSession(res, opts) {
    storeSession({
      role: res.role,
      studentId: res.personId || null,
      token: res.token,
      mustChangePassword: !!res.mustChangePassword,
      weakPassword: !!res.weakPassword,
    });
    let remembered = false;
    try {
      [remembered] = await Promise.all([opts && opts.remember ? rememberSession() : false, SSD.Store.load()]);
    } catch (err) {
      SSD.Storage.call('ssd_logout', { p_token: res.token }).catch(() => { /* offline — läuft serverseitig ab */ });
      clearSession();
      SSD.Store.clear();
      throw err;
    }
    SSD.EventBus.emit('auth:changed', getSession());
    return { remembered };
  }

  /** Markiert die Passwort-Hinweise als erledigt (nach einem erfolgreichen Passwortwechsel). */
  function clearPasswordFlags() {
    const session = getSession();
    if (!session) return;
    storeSession(Object.assign({}, session, { mustChangePassword: false, weakPassword: false }));
  }

  /* ---------------------------------------------------------------------
   * Team-Koordination (Administrator + Sanisprecher:innen)
   * ---------------------------------------------------------------------
   * Pinnwand, Teamtreffen, Aufgaben anlegen, Lücken füllen, Registrierungen
   * freigeben und die Engagement-Übersicht stehen dem Administrator und den
   * Personen mit Zusatzbezeichnung (Sanisprecher:in / Stellv.) offen. Der
   * Server lässt Sanisprecher:innen beim Speichern zusätzlich nur das
   * Freischalten/Ablehnen von Registrierungen zu (siehe ssd_private.merge_incoming).
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
   * Der Code liegt nur als bcrypt-Hash auf dem Server und wird dort geprüft.
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

  /** Zufälliges Startpasswort (12 Zeichen, gut lesbar) für neu angelegte Konten. */
  function generateInitialPassword() {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length].toLowerCase()).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
  }

  function hasRegistrationCode() {
    return !!SSD.Store.getPublicInfo().hasRegistrationCode;
  }

  async function refreshPublicInfo() {
    try {
      SSD.Store.setPublicInfo(await SSD.Storage.fetchPublicInfo());
    } catch (err) { /* bleibt beim bisherigen Stand */ }
    return SSD.Store.getPublicInfo();
  }

  /** Setzt einen neuen Schulcode oder entfernt ihn (`code` leer/null). */
  async function setRegistrationCode(code) {
    const res = await SSD.Storage.call('ssd_set_registration_code', { p_token: getToken(), p_code: code || '' });
    if (!res || !res.ok) throw new Error(errorText(res));
    await refreshPublicInfo();
  }

  function errorText(res) {
    if (res && res.error === 'session') return 'Die Sitzung ist abgelaufen. Bitte neu anmelden.';
    return (res && res.error) || 'Unbekannter Fehler.';
  }

  /* ---------------------------------------------------------------------
   * Ersteinrichtung
   * ------------------------------------------------------------------- */

  async function completeSetup({ schoolName, adminUsername, adminPassword, registrationCode }) {
    const data = SSD.Models.createDefaultAppData();
    data.school.name = schoolName || 'Meine Schule';
    const res = await SSD.Storage.call('ssd_setup', {
      p_data: data, p_username: adminUsername, p_password: adminPassword, p_code: registrationCode || '',
    });
    if (!res || !res.ok) throw new Error(errorText(res));
    await refreshPublicInfo();
    await startSession(res);
  }

  /* ---------------------------------------------------------------------
   * Login & Registrierung
   * ------------------------------------------------------------------- */

  /**
   * @param {'admin'|'student'} kind
   * @param {{remember?: boolean}} [opts] - „Auf diesem Gerät angemeldet bleiben“ (nie für den Administrator)
   * @returns {Promise<{ok: boolean, remembered?: boolean, error?: string}>}
   */
  async function login(kind, username, password, opts) {
    let res;
    try {
      res = await SSD.Storage.call('ssd_login', { p_role: kind === 'admin' ? 'admin' : 'student', p_username: username, p_password: password });
    } catch (err) {
      return { ok: false, error: 'Keine Verbindung zur Datenbank. Bitte Internetverbindung prüfen.' };
    }
    if (!res || !res.ok) return { ok: false, error: errorText(res) };
    try {
      const { remembered } = await startSession(res, { remember: !!(opts && opts.remember) && res.role !== 'admin' });
      return { ok: true, remembered };
    } catch (err) {
      return { ok: false, error: 'Die Daten konnten nicht geladen werden. Bitte erneut versuchen.' };
    }
  }

  /**
   * Selbstregistrierung über den Login-Bildschirm. Der Server prüft
   * Benutzername, Passwortlänge und Schulcode und legt das Konto an — mit
   * gültigem Schulcode sofort freigeschaltet (und angemeldet), sonst wartend.
   * @returns {Promise<{ok: boolean, pending?: boolean, error?: string}>}
   */
  async function register(student, password, code) {
    let res;
    try {
      res = await SSD.Storage.call('ssd_register', { p_student: student, p_password: password, p_code: code || '' });
    } catch (err) {
      return { ok: false, error: 'Keine Verbindung zur Datenbank. Bitte Internetverbindung prüfen.' };
    }
    if (!res || !res.ok) return { ok: false, error: errorText(res) };
    if (res.pending) return { ok: true, pending: true };
    await startSession(res);
    return { ok: true };
  }

  /* ---------------------------------------------------------------------
   * Passwörter
   * ------------------------------------------------------------------- */

  /**
   * Setzt ein Passwort. Eigenes Passwort: aktuelles Passwort erforderlich.
   * Administrator für andere: ohne aktuelles Passwort — die Person muss es
   * bei der nächsten Anmeldung ändern.
   */
  async function setPassword(personId, newPassword, currentPassword) {
    const res = await SSD.Storage.call('ssd_set_password', {
      p_token: getToken(), p_person: personId, p_new_password: newPassword, p_current_password: currentPassword || null,
    });
    if (!res || !res.ok) throw new Error(errorText(res));
    const session = getSession();
    const ownId = session && (session.role === 'admin' ? 'admin' : session.studentId);
    if (personId === ownId) clearPasswordFlags();
  }

  /** Administrator-Zugang: Benutzername im Datenbestand, Passwort serverseitig. */
  async function changeAdminCredentials({ username, newPassword, currentPassword }) {
    const state = SSD.Store.getState();
    if (newPassword) await setPassword('admin', newPassword, currentPassword);
    if (username && username !== state.admin.username) {
      SSD.Store.commit('Admin-Benutzername geändert', (draft) => {
        draft.admin.username = username;
      }, { trackHistory: false });
    }
  }

  /** Alle Daten zurücksetzen — nur mit dem Administrator-Passwort; der Administrator-Zugang bleibt. */
  async function resetAllData(adminPassword) {
    const res = await SSD.Storage.call('ssd_reset_all', {
      p_token: getToken(), p_password: adminPassword, p_data: SSD.Models.createDefaultAppData(),
    });
    if (!res || !res.ok) throw new Error(errorText(res));
    await SSD.Store.load();
  }

  function isUsernameTaken(username, excludeStudentId) {
    const state = SSD.Store.getState();
    const uname = String(username).trim().toLowerCase();
    if (state.admin && state.admin.username.toLowerCase() === uname) return true;
    return state.students.some((s) => s.id !== excludeStudentId && s.username.toLowerCase() === uname);
  }

  return {
    PASSWORD_MIN_LENGTH,
    getSession, getToken, clearSession, logout, getCurrentStudent, clearPasswordFlags,
    deviceLabel, renewIfDue, listSessions, endOtherSessions,
    isAdminSession, canCoordinate, currentPersonId, canManageItem,
    completeSetup, login, register,
    setPassword, changeAdminCredentials, resetAllData, isUsernameTaken,
    REGISTRATION_CODE_MIN_LENGTH, normalizeRegistrationCode, isValidRegistrationCode,
    generateRegistrationCode, generateInitialPassword, hasRegistrationCode, setRegistrationCode, refreshPublicInfo,
  };
})();
