/**
 * ============================================================================
 * SSD.Storage — Persistenzschicht (Supabase-Cloud-Datenbank + JSON-Dateien)
 * ============================================================================
 * Kapselt sämtlichen Zugriff auf die gemeinsame Datenablage. Die gesamte
 * Anwendung arbeitet weiterhin mit einem einzigen JSON-Objekt (siehe
 * `js/core/models.js`), das jetzt aber nicht mehr im `localStorage` eines
 * einzelnen Browsers liegt, sondern in genau einer Zeile einer Supabase-
 * Tabelle (`ssd_dienstplan_state`) — dadurch sehen alle Geräte/Browser
 * denselben, live aktuellen Datenstand.
 *
 * Nebenläufigkeit: Da mehrere Personen gleichzeitig speichern können, nutzt
 * `save()` eine optimistische Versionsprüfung (Spalte `version`): Ein
 * Speichervorgang schlägt fehl, wenn zwischenzeitlich jemand anderes bereits
 * gespeichert hat, statt dessen Änderungen stillschweigend zu überschreiben.
 * Der Aufrufer (`SSD.Store`) zeigt in diesem Fall einen Hinweis und lädt die
 * aktuellen Daten neu.
 *
 * Sicherheit: Der Zeilenzugriff ist per Row-Level-Security auf Lesen/
 * Aktualisieren beschränkt (keine INSERT-/DELETE-Rechte für den Client) — die
 * einzige Zeile wird einmalig per Datenbank-Migration angelegt. Der
 * inhaltliche Zugriffsschutz erfolgt weiterhin über den Login-Bildschirm der
 * Anwendung (gehashte Passwörter), siehe README-Hinweis zum Sicherheitsmodell.
 */
window.SSD = window.SSD || {};

SSD.Storage = (function () {
  'use strict';

  const BACKUP_KEY = 'ssd_schulsanitaetsdienst_dienstplan_v1__localbackup';
  const { URL: SUPABASE_URL, ANON_KEY, TABLE, ROW_ID } = SSD.SupabaseConfig;

  const client = window.supabase.createClient(SUPABASE_URL, ANON_KEY);

  let cachedData = null;
  let lastKnownVersion = null;

  /** Bestbemühter lokaler Zwischenspeicher — reines Sicherheitsnetz, niemals die primäre Quelle. */
  function writeLocalBackup(data) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(data)); } catch (err) { /* Speicher evtl. voll — Best-Effort */ }
  }

  /**
   * Lädt den aktuellen Anwendungszustand aus Supabase. Wirft bei Netzwerk-/
   * Datenbankfehlern bewusst einen Fehler (statt still mit leeren Daten
   * weiterzumachen), damit `SSD.Store.init()` eine klare Fehlermeldung statt
   * eines verwirrenden "alles ist leer" anzeigen kann.
   */
  async function load() {
    const { data: row, error } = await client.from(TABLE).select('data, version').eq('id', ROW_ID).maybeSingle();
    if (error) throw new Error(error.message || 'Unbekannter Datenbankfehler');
    if (!row) { cachedData = null; lastKnownVersion = null; return null; }
    cachedData = migrateIfNeeded(row.data);
    lastKnownVersion = row.version;
    writeLocalBackup(cachedData);
    return cachedData;
  }

  /**
   * Speichert einen Zustand zurück nach Supabase.
   * @returns {Promise<{ok: true} | {ok: false, conflict?: boolean, error?: any}>}
   */
  async function save(data) {
    data.meta = data.meta || {};
    data.meta.lastModifiedAt = new Date().toISOString();

    try {
      let query = client.from(TABLE).update({
        data, version: (lastKnownVersion || 0) + 1, updated_at: data.meta.lastModifiedAt,
      }).eq('id', ROW_ID);
      if (lastKnownVersion != null) query = query.eq('version', lastKnownVersion);

      const { data: rows, error } = await query.select('version');

      if (error) {
        SSD.EventBus.emit('storage:error', { error });
        return { ok: false, error };
      }
      if (!rows || !rows.length) {
        // Optimistische Sperre: Zwischen unserem letzten Laden und jetzt hat
        // jemand anderes bereits gespeichert. Nicht überschreiben.
        SSD.EventBus.emit('storage:conflict', {});
        return { ok: false, conflict: true };
      }
      lastKnownVersion = rows[0].version;
      cachedData = data;
      writeLocalBackup(data);
      SSD.EventBus.emit('storage:saved', { at: data.meta.lastModifiedAt });
      return { ok: true };
    } catch (err) {
      // z. B. keine Internetverbindung — nie eine unbehandelte Promise-Ablehnung
      // aus dem "fire-and-forget"-Aufruf in SSD.Store werden lassen.
      SSD.EventBus.emit('storage:error', { error: err });
      return { ok: false, error: err };
    }
  }

  /**
   * Setzt die geteilte Zeile auf den Ausgangszustand zurück ("Alle Daten
   * zurücksetzen" in den Einstellungen). Betrifft alle Personen, die auf
   * dieselbe Datenbank zugreifen — nicht nur diesen Browser.
   */
  async function clearAll() {
    const fresh = SSD.Models.createDefaultAppData();
    await save(fresh);
    try { localStorage.removeItem(BACKUP_KEY); } catch (err) { /* ignore */ }
    cachedData = null;
  }

  /** Stellt den zuletzt lokal zwischengespeicherten Stand wieder her (Notfall, z. B. bei Verbindungsproblemen). */
  function restoreBackup() {
    const backup = localStorage.getItem(BACKUP_KEY);
    if (!backup) return null;
    try {
      return JSON.parse(backup);
    } catch (err) {
      return null;
    }
  }

  /**
   * Live-Abonnement auf Änderungen anderer Personen (Supabase Realtime).
   * Ruft `onRemoteChange(newData, newVersion)` bei jeder fremden Änderung auf.
   * Wichtig: übernimmt `newVersion` NICHT automatisch in `lastKnownVersion` —
   * das entscheidet bewusst der Aufrufer (`SSD.Store.setKnownVersion`), damit
   * eine Änderung, die lokal (noch) nicht übernommen wurde (z. B. weil gerade
   * ungespeicherte eigene Bearbeitungen bestehen), beim nächsten eigenen
   * Speichern zuverlässig als Konflikt erkannt wird, statt sie stillschweigend
   * zu überschreiben.
   */
  function subscribeToRemoteChanges(onRemoteChange) {
    const channel = client
      .channel('ssd_dienstplan_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: `id=eq.${ROW_ID}` }, (payload) => {
        const row = payload.new;
        if (!row || row.version === lastKnownVersion) return; // eigene soeben gespeicherte Änderung
        onRemoteChange(migrateIfNeeded(row.data), row.version);
      })
      .subscribe();
    return () => client.removeChannel(channel);
  }

  function setKnownVersion(version) { lastKnownVersion = version; }
  function getKnownVersion() { return lastKnownVersion || 0; }

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
    if (!Array.isArray(data.settings.yearGroupRules)) data.settings.yearGroupRules = [];
    if (!Array.isArray(data.settings.pairRules)) data.settings.pairRules = [];
    const storedTeams = storedSettings.teams || {};
    data.settings.teams = Object.assign({}, defaults.settings.teams, storedTeams, {
      categories: Object.assign({}, defaults.settings.teams.categories, storedTeams.categories || {}),
    });
    if (!Array.isArray(data.teamsOutbox)) data.teamsOutbox = [];

    data.students = Array.isArray(data.students) ? data.students : [];
    data.students.forEach((s) => {
      if (!Array.isArray(s.preferredPartnerIds)) s.preferredPartnerIds = [];
      if (s.availabilityReminderAt === undefined) s.availabilityReminderAt = null;
    });
    data.schedule = data.schedule || defaults.schedule;
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
    load, save, clearAll, restoreBackup, subscribeToRemoteChanges, setKnownVersion, getKnownVersion, fetchTeamsStatus,
    exportJsonFile, importJsonFile,
    getStorageUsageInfo,
  };
})();
