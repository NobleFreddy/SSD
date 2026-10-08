/**
 * ============================================================================
 * SSD.Storage — Persistenzschicht (Supabase-Cloud-Datenbank + JSON-Dateien)
 * ============================================================================
 * Kapselt sämtlichen Zugriff auf die gemeinsame Datenablage. Die Anwendung
 * arbeitet weiterhin mit einem einzigen JSON-Objekt (siehe
 * `js/core/models.js`), das in genau einer Zeile der Supabase-Tabelle
 * `ssd_dienstplan_state` liegt — alle Geräte sehen denselben Stand.
 *
 * Zugriffsschutz: Die Tabelle selbst ist für den öffentlichen Schlüssel
 * gesperrt. Gelesen und geschrieben wird ausschließlich über Datenbank-
 * funktionen (`ssd_load`, `ssd_save` …, siehe supabase/migrations), die eine
 * gültige Sitzung verlangen. Die Sitzung entsteht beim Login auf dem Server
 * (`ssd_login`, Passwortprüfung mit bcrypt); der Browser kennt nur ein
 * zufälliges Token. Jede Rolle bekommt nur, was sie braucht, und darf nur
 * speichern, was sie ändern darf — das prüft der Server, nicht der Browser.
 *
 * Nebenläufigkeit: `save()` nutzt eine optimistische Versionsprüfung. Hat
 * zwischenzeitlich jemand anderes gespeichert, liefert der Server den
 * aktuellen Stand zurück, statt fremde Änderungen zu überschreiben.
 *
 * Live-Aktualisierung: Nach jeder Änderung schickt die Datenbank nur die neue
 * Versionsnummer (Realtime-Broadcast, keine Daten); die App lädt dann über
 * `ssd_load` nach. Zusätzlich fragt sie jede Minute die Version ab, falls die
 * Live-Verbindung ausfällt.
 */
window.SSD = window.SSD || {};

SSD.Storage = (function () {
  'use strict';

  const { URL: SUPABASE_URL, ANON_KEY } = SSD.SupabaseConfig;
  const POLL_INTERVAL_MS = 60000;

  // Kein Supabase-Auth: Die Bibliothek soll nichts im Browser speichern.
  const client = window.supabase.createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Frühere Versionen legten eine Vollkopie aller Daten im Browser ab — einmalig entfernen.
  try { localStorage.removeItem('ssd_schulsanitaetsdienst_dienstplan_v1__localbackup'); } catch (err) { /* ignore */ }

  let cachedData = null;
  let lastKnownVersion = null;

  /** Fehler, wenn die Sitzung abgelaufen oder ungültig ist (z. B. Konto deaktiviert). */
  class SessionError extends Error {
    constructor() {
      super('Die Sitzung ist abgelaufen. Bitte erneut anmelden.');
      this.sessionExpired = true;
    }
  }

  function token() {
    const session = SSD.Auth.getSession();
    return session ? session.token || null : null;
  }

  /** Ruft eine Datenbankfunktion auf. Netzwerk- und Serverfehler werden als Error geworfen. */
  async function call(name, params) {
    const { data, error } = await client.rpc(name, params || {});
    if (error) throw new Error(error.message || 'Unbekannter Datenbankfehler');
    return data;
  }

  /** Öffentliche Angaben für Anmeldeseite und Datenschutzhinweise — ohne personenbezogene Daten. */
  async function fetchPublicInfo() {
    return call('ssd_public_info');
  }

  async function fetchState() {
    const res = await call('ssd_load', { p_token: token() });
    if (!res || !res.ok) throw new SessionError();
    return { data: migrateIfNeeded(res.data), version: res.version };
  }

  /**
   * Lädt den Stand, den die angemeldete Person sehen darf. Wirft bei
   * Netzwerkfehlern einen Error und bei ungültiger Sitzung einen SessionError.
   */
  async function load() {
    const { data, version } = await fetchState();
    cachedData = data;
    lastKnownVersion = version;
    return cachedData;
  }

  /**
   * Speichert einen Zustand.
   * @returns {Promise<{ok: true} | {ok: false, conflict?: boolean, remote?: {data, version}, session?: boolean, error?: any}>}
   */
  async function save(data) {
    data.meta = data.meta || {};
    data.meta.lastModifiedAt = new Date().toISOString();

    try {
      const res = await call('ssd_save', { p_token: token(), p_data: data, p_expected_version: lastKnownVersion });
      if (res && res.ok) {
        lastKnownVersion = res.version;
        cachedData = data;
        SSD.EventBus.emit('storage:saved', { at: data.meta.lastModifiedAt });
        return { ok: true };
      }
      if (res && res.conflict) {
        // Jemand anderes hat zwischenzeitlich gespeichert — dessen Stand übernimmt der Aufrufer.
        SSD.EventBus.emit('storage:conflict', {});
        return { ok: false, conflict: true, remote: { data: migrateIfNeeded(res.data), version: res.version } };
      }
      if (res && res.error === 'session') {
        SSD.EventBus.emit('auth:expired', {});
        return { ok: false, session: true };
      }
      const error = new Error((res && res.error) || 'Speichern fehlgeschlagen');
      SSD.EventBus.emit('storage:error', { error });
      return { ok: false, error };
    } catch (err) {
      // z. B. keine Internetverbindung — nie eine unbehandelte Promise-Ablehnung
      // aus dem "fire-and-forget"-Aufruf in SSD.Store werden lassen.
      SSD.EventBus.emit('storage:error', { error: err });
      return { ok: false, error: err };
    }
  }

  /**
   * Live-Abonnement auf Änderungen anderer Personen. Ruft
   * `onRemoteChange(newData, newVersion)` auf, sobald eine neuere Version
   * vorliegt. Übernimmt die Version bewusst NICHT selbst in
   * `lastKnownVersion` — das entscheidet der Aufrufer (`SSD.Store`), damit
   * eine noch nicht übernommene Änderung beim nächsten eigenen Speichern
   * zuverlässig als Konflikt erkannt wird.
   * @returns {Function} beendet das Abonnement
   */
  function subscribeToRemoteChanges(onRemoteChange) {
    let fetching = false;
    let stopped = false;

    async function refreshIfNewer(version) {
      if (stopped || fetching) return;
      if (version != null && version <= (lastKnownVersion || 0)) return;
      fetching = true;
      try {
        const remote = await fetchState();
        if (!stopped && remote.version > (lastKnownVersion || 0)) onRemoteChange(remote.data, remote.version);
      } catch (err) {
        if (err.sessionExpired) SSD.EventBus.emit('auth:expired', {});
      } finally {
        fetching = false;
      }
    }

    const channel = client
      .channel('ssd_state')
      .on('broadcast', { event: 'state_changed' }, (message) => {
        const version = message && message.payload ? Number(message.payload.version) : null;
        refreshIfNewer(Number.isFinite(version) ? version : null);
      })
      .subscribe();

    const poll = setInterval(async () => {
      if (stopped || document.hidden) return;
      try {
        const res = await call('ssd_version', { p_token: token() });
        if (res && res.ok) refreshIfNewer(res.version);
        else if (res && res.error === 'session') SSD.EventBus.emit('auth:expired', {});
      } catch (err) { /* offline — nächster Versuch beim nächsten Intervall */ }
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(poll);
      client.removeChannel(channel);
    };
  }

  function setKnownVersion(version) { lastKnownVersion = version; }
  function getKnownVersion() { return lastKnownVersion || 0; }

  /** Vergisst den geladenen Stand (Abmelden). */
  function forget() {
    cachedData = null;
    lastKnownVersion = null;
  }

  /**
   * Status des serverseitigen Teams-Versands (Tabelle `ssd_teams_status`,
   * siehe Supabase-Migration "ssd_teams_notifications") — enthält nur
   * Zeitstempel/Anzahl/Fehlertext, keine Geheimnisse. `null`, falls (noch)
   * nicht verfügbar.
   */
  async function fetchTeamsStatus() {
    try {
      const { data, error } = await client.from('ssd_teams_status').select('*').eq('id', 1).maybeSingle();
      return error ? null : data;
    } catch (err) {
      return null;
    }
  }

  /** Löst den Download der aktuellen Daten als formatierte JSON-Datei aus. */
  function exportJsonFile(data, filename) {
    const pretty = JSON.stringify(data, null, 2);
    const stamp = SSD.Utils.toIsoDate(new Date());
    SSD.Utils.downloadBlob(filename || `dienstplan_export_${stamp}.json`, pretty, 'application/json');
  }

  /**
   * Liest eine vom Benutzer gewählte JSON-Datei ein und prüft grob deren
   * Struktur. Wirft bei ungültigem Format einen Fehler mit verständlicher
   * Meldung (wird von der aufrufenden UI als Toast angezeigt).
   */
  async function importJsonFile(file) {
    const text = await SSD.Utils.readFileAsText(file);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('Die Datei enthält kein gültiges JSON.');
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.students)) {
      throw new Error('Die Datei entspricht nicht dem erwarteten Dienstplan-Datenformat.');
    }
    return migrateIfNeeded(parsed);
  }

  /** Platz für künftige Datenmigrationen, falls sich das Format zwischen Versionen ändert. */
  function migrateIfNeeded(data) {
    if (!data.version || data.version < SSD.Models.DATA_VERSION) {
      data.version = SSD.Models.DATA_VERSION;
    }
    // Fehlende Teilbäume defensiv auffüllen, damit ältere/unvollständige
    // Exporte nicht zu Laufzeitfehlern in der UI führen.
    const defaults = SSD.Models.createDefaultAppData();
    data.school = data.school || defaults.school;
    data.dutyBlockConfig = data.dutyBlockConfig || defaults.dutyBlockConfig;

    const storedSettings = data.settings || {};
    data.settings = Object.assign({}, defaults.settings, storedSettings);
    data.settings.weights = Object.assign({}, defaults.settings.weights, storedSettings.weights || {});
    // Früherer Schalter "Gemischte Paare bevorzugen" lebt jetzt als Gewichtungsstufe weiter.
    if (!storedSettings.weights && storedSettings.preferMixedGender === false) data.settings.weights.genderMix = 0;
    delete data.settings.preferMixedGender;
    // Zugangsgeheimnisse gehören nie in den Datenbestand (liegen serverseitig).
    delete data.settings.registrationCodeHash;
    delete data.settings.registrationCodeSalt;
    if (!Array.isArray(data.settings.yearGroupRules)) data.settings.yearGroupRules = [];
    if (!Array.isArray(data.settings.pairRules)) data.settings.pairRules = [];
    const storedTeams = storedSettings.teams || {};
    data.settings.teams = Object.assign({}, defaults.settings.teams, storedTeams, {
      categories: Object.assign({}, defaults.settings.teams.categories, storedTeams.categories || {}),
    });
    data.settings.privacy = Object.assign({}, defaults.settings.privacy, storedSettings.privacy || {});
    data.settings.retention = Object.assign({}, defaults.settings.retention, storedSettings.retention || {});
    if (!Array.isArray(data.teamsOutbox)) data.teamsOutbox = [];
    if (data.admin && typeof data.admin === 'object') {
      delete data.admin.passwordHash;
      delete data.admin.salt;
    }

    data.students = Array.isArray(data.students) ? data.students : [];
    data.students.forEach((s) => {
      delete s.passwordHash;
      delete s.salt;
      if (!Array.isArray(s.preferredPartnerIds)) s.preferredPartnerIds = [];
      if (s.availabilityReminderAt === undefined) s.availabilityReminderAt = null;
      if (!s.gender) s.gender = 'n';
    });
    data.schedule = data.schedule || defaults.schedule;
    // Frühere Versionen konnten "Krankheit" als Abwesenheitsgrund speichern (Gesundheitsangabe).
    (data.schedule.entries || []).forEach((entry) => {
      (entry.substitutionLog || []).forEach((log) => {
        if (/krank/i.test(log.reason || '')) log.reason = 'Abwesenheit';
      });
    });
    data.specialDays = data.specialDays || [];
    data.events = data.events || [];
    data.tasks = data.tasks || [];
    data.tasks.forEach((t) => {
      if (t.createdBy === undefined) t.createdBy = null; // ältere Aufgaben stammen alle vom Administrator
    });
    data.materials = data.materials || [];
    data.announcements = Array.isArray(data.announcements) ? data.announcements : [];
    data.meetings = Array.isArray(data.meetings) ? data.meetings : [];
    data.meetings.forEach((m) => {
      if (!Array.isArray(m.responses)) m.responses = [];
      if (!Array.isArray(m.attendeeIds)) m.attendeeIds = [];
    });
    data.meta = Object.assign({}, defaults.meta, data.meta || {});
    return data;
  }

  function getStorageUsageInfo() {
    try {
      const raw = cachedData ? JSON.stringify(cachedData) : '';
      const bytes = new Blob([raw]).size;
      return { bytes, kb: SSD.Utils.round(bytes / 1024, 1) };
    } catch (err) {
      return { bytes: 0, kb: 0 };
    }
  }

  return {
    call, fetchPublicInfo,
    load, save, forget, subscribeToRemoteChanges, setKnownVersion, getKnownVersion, fetchTeamsStatus,
    exportJsonFile, importJsonFile, migrateIfNeeded,
    getStorageUsageInfo,
  };
})();
