/**
 * ============================================================================
 * SSD.Storage — Persistenzschicht (localStorage + JSON-Dateien)
 * ============================================================================
 * Kapselt sämtlichen Zugriff auf den Browser-Speicher. Es gibt bewusst keine
 * Datenbank und keinen Server: Die gesamte Anwendung arbeitet mit einem
 * einzigen JSON-Objekt, das in `localStorage` gehalten und per Knopfdruck
 * als Datei exportiert/importiert werden kann.
 *
 * Hinweis zur Sicherheit: `localStorage` ist geräte-/browserlokal und für
 * jede Person mit Zugriff auf den Rechner einsehbar. Für ein rein internes
 * Verwaltungswerkzeug einer Schule ist das ausreichend; es ersetzt keine
 * serverseitige Zugriffskontrolle.
 */
window.SSD = window.SSD || {};

SSD.Storage = (function () {
  'use strict';

  // Bewusst ungewöhnlicher Schlüssel, um Kollisionen mit anderen lokal
  // geöffneten HTML-Dateien zu vermeiden (file://-Ursprünge teilen sich in
  // manchen Browsern denselben localStorage-Namensraum).
  const STORAGE_KEY = 'ssd_schulsanitaetsdienst_dienstplan_v1';
  const BACKUP_KEY = STORAGE_KEY + '__autobackup';

  let cachedData = null;

  function load() {
    if (cachedData) return cachedData;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      // Migration läuft auch beim normalen Laden (nicht nur beim JSON-Import):
      // Wird die App aktualisiert und bekommt z. B. neue Einstellungsfelder,
      // müssen bereits lokal gespeicherte Altdaten dieselben sinnvollen
      // Standardwerte erhalten, statt mit `undefined` weiterzulaufen.
      cachedData = migrateIfNeeded(JSON.parse(raw));
      return cachedData;
    } catch (err) {
      console.error('[Storage] Konnte gespeicherte Daten nicht lesen:', err);
      return null;
    }
  }

  /** Schreibt einen Sicherungs-Snapshot der zuletzt bekannten guten Daten (Schutz vor kaputten Speichervorgängen). */
  function backupBeforeOverwrite() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) localStorage.setItem(BACKUP_KEY, current);
    } catch (err) {
      /* Speicher evtl. voll — Backup ist ein Best-Effort-Mechanismus. */
    }
  }

  function save(data) {
    data.meta = data.meta || {};
    data.meta.lastModifiedAt = new Date().toISOString();
    try {
      backupBeforeOverwrite();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      cachedData = data;
      SSD.EventBus.emit('storage:saved', { at: data.meta.lastModifiedAt });
      return true;
    } catch (err) {
      console.error('[Storage] Speichern fehlgeschlagen:', err);
      SSD.EventBus.emit('storage:error', { error: err });
      return false;
    }
  }

  function clearAll() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BACKUP_KEY);
    cachedData = null;
  }

  function restoreBackup() {
    const backup = localStorage.getItem(BACKUP_KEY);
    if (!backup) return null;
    try {
      cachedData = JSON.parse(backup);
      localStorage.setItem(STORAGE_KEY, backup);
      return cachedData;
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
    data.settings = Object.assign({}, defaults.settings, data.settings || {});
    data.schedule = data.schedule || defaults.schedule;
    data.specialDays = data.specialDays || [];
    data.events = data.events || [];
    data.meta = Object.assign({}, defaults.meta, data.meta || {});
    return data;
  }

  function getStorageUsageInfo() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || '';
      const bytes = new Blob([raw]).size;
      return { bytes, kb: SSD.Utils.round(bytes / 1024, 1) };
    } catch (err) {
      return { bytes: 0, kb: 0 };
    }
  }

  return {
    STORAGE_KEY,
    load, save, clearAll, restoreBackup,
    exportJsonFile, importJsonFile,
    getStorageUsageInfo,
  };
})();
