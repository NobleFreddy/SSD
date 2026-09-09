/**
 * ============================================================================
 * SSD.Store — zentraler Anwendungszustand mit Undo/Redo
 * ============================================================================
 * Der Store ist die einzige "Quelle der Wahrheit" für alle persistierten
 * Fachdaten (Schüler, Kalender, Einstellungen, Dienstplan) im Speicher dieses
 * Tabs. Änderungen erfolgen ausschließlich über `commit()`, wodurch:
 *   1. jede Änderung automatisch (im Hintergrund) nach Supabase gespeichert
 *      wird (falls Auto-Save aktiv ist) — die UI wartet dafür nicht,
 *   2. ein Undo/Redo-Verlauf entsteht (Snapshot-basiert, rein lokal für
 *      diesen Tab — kein geteilter Undo-Verlauf über Geräte hinweg),
 *   3. die UI über den EventBus informiert wird und sich neu rendern kann.
 *
 * Mehrere Geräte/Browser können gleichzeitig verbunden sein: eingehende
 * Änderungen anderer Personen kommen per Supabase Realtime an
 * (`applyRemoteState`) und werden automatisch übernommen — außer es bestehen
 * gerade eigene ungespeicherte Änderungen (Auto-Save deaktiviert); dann bleibt
 * die fremde Änderung bewusst unangewendet, damit sie nicht durch den eigenen,
 * noch ausstehenden Speichervorgang überschrieben wird. Der nächste eigene
 * Speicherversuch erkennt diesen Fall automatisch als Konflikt (siehe
 * `js/core/storage.js`) und informiert die Person, statt fremde Änderungen
 * still zu verwerfen.
 */
window.SSD = window.SSD || {};

SSD.Store = (function () {
  'use strict';

  const MAX_HISTORY = 60;

  let state = null;
  let undoStack = []; // { label, snapshot }
  let redoStack = [];
  let dirty = false; // true, wenn bei deaktiviertem Auto-Save ungespeicherte Änderungen bestehen

  /** Lädt den Anfangszustand aus Supabase und richtet die Live-Synchronisierung ein. */
  async function init() {
    state = await SSD.Storage.load();
    if (!state) state = SSD.Models.createDefaultAppData();

    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    SSD.Storage.subscribeToRemoteChanges(applyRemoteState);

    return state;
  }

  /** Übernimmt eine per Realtime empfangene fremde Änderung — siehe Modulbeschreibung oben. */
  function applyRemoteState(newData, newVersion) {
    if (dirty) {
      SSD.EventBus.emit('store:remote-update-deferred', {});
      return;
    }
    state = newData;
    SSD.Storage.setKnownVersion(newVersion);
    SSD.EventBus.emit('store:changed', { label: 'Von anderem Gerät aktualisiert', remote: true });
  }

  /** Persistiert nur, wenn Auto-Save aktiv ist; merkt sich sonst, dass manuell gespeichert werden muss. */
  function saveOrMarkDirty() {
    if (state.settings && state.settings.autoSave === false) {
      dirty = true;
      SSD.EventBus.emit('store:dirty', { dirty: true });
      return;
    }
    persist(); // bewusst nicht awaited — Commit-Aufrufer sollen nicht auf das Netzwerk warten müssen
  }

  /** Führt den eigentlichen (asynchronen) Speichervorgang aus und meldet das Ergebnis über den EventBus. */
  async function persist() {
    const result = await SSD.Storage.save(state);
    if (result.ok) {
      if (dirty) { dirty = false; SSD.EventBus.emit('store:dirty', { dirty: false }); }
    } else if (result.conflict) {
      SSD.EventBus.emit('store:conflict', {});
    }
    return result;
  }

  function isDirty() { return dirty; }

  function getState() {
    return state;
  }

  function isSetupComplete() {
    return !!(state && state.meta && state.meta.setupComplete && state.admin);
  }

  /**
   * Führt eine Zustandsänderung aus.
   * @param {string} label - Kurzbeschreibung für Undo/Redo-Anzeige (z. B. "Schüler hinzugefügt").
   * @param {(draft: object) => void} mutatorFn - verändert den übergebenen Klon direkt.
   * @param {{ trackHistory?: boolean, silent?: boolean }} [options]
   */
  function commit(label, mutatorFn, options = {}) {
    const trackHistory = options.trackHistory !== false;
    const previousSnapshot = SSD.Utils.deepClone(state);

    mutatorFn(state);
    state.meta = state.meta || {};
    state.meta.lastModifiedAt = new Date().toISOString();

    if (trackHistory) {
      undoStack.push({ label, snapshot: previousSnapshot });
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
    }

    saveOrMarkDirty();

    if (!options.silent) {
      SSD.EventBus.emit('store:changed', { label });
    }
  }

  /** Ersetzt den kompletten Zustand (z. B. nach JSON-Import) und leert die Historie. */
  function replaceState(newState, label) {
    state = newState;
    undoStack = [];
    redoStack = [];
    persist().then((result) => {
      if (!result.ok) {
        SSD.Toast.error(
          'Import nicht gespeichert',
          result.conflict
            ? 'Jemand anderes hat zwischenzeitlich gespeichert. Bitte Seite neu laden und den Import erneut versuchen.'
            : 'Der Import konnte nicht in der Datenbank gespeichert werden (Verbindungsproblem?).'
        );
      }
    });
    SSD.EventBus.emit('store:changed', { label: label || 'Daten importiert' });
    SSD.EventBus.emit('store:replaced', {});
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  function undo() {
    if (!canUndo()) return;
    const entry = undoStack.pop();
    redoStack.push({ label: entry.label, snapshot: SSD.Utils.deepClone(state) });
    state = entry.snapshot;
    saveOrMarkDirty();
    SSD.EventBus.emit('store:changed', { label: `Rückgängig: ${entry.label}` });
    SSD.EventBus.emit('store:undo', { label: entry.label });
  }

  function redo() {
    if (!canRedo()) return;
    const entry = redoStack.pop();
    undoStack.push({ label: entry.label, snapshot: SSD.Utils.deepClone(state) });
    state = entry.snapshot;
    saveOrMarkDirty();
    SSD.EventBus.emit('store:changed', { label: `Wiederholt: ${entry.label}` });
    SSD.EventBus.emit('store:redo', { label: entry.label });
  }

  function peekUndoLabel() { return undoStack.length ? undoStack[undoStack.length - 1].label : null; }
  function peekRedoLabel() { return redoStack.length ? redoStack[redoStack.length - 1].label : null; }

  /** Manuelles Speichern (Button im Topbar, wenn Auto-Save deaktiviert ist). */
  async function forceSave() {
    const result = await persist();
    return result.ok;
  }

  return {
    init, getState, isSetupComplete,
    commit, replaceState,
    undo, redo, canUndo, canRedo, peekUndoLabel, peekRedoLabel,
    forceSave, isDirty,
  };
})();
