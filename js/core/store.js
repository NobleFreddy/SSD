/**
 * ============================================================================
 * SSD.Store — zentraler Anwendungszustand mit Undo/Redo
 * ============================================================================
 * Der Store ist die einzige "Quelle der Wahrheit" für alle persistierten
 * Fachdaten (Schüler, Kalender, Einstellungen, Dienstplan). Änderungen
 * erfolgen ausschließlich über `commit()`, wodurch:
 *   1. jede Änderung automatisch gespeichert wird (falls Auto-Save aktiv ist),
 *   2. ein Undo/Redo-Verlauf entsteht (Snapshot-basiert — bei der Datenmenge
 *      einer Schule performant genug und deutlich robuster als ein
 *      Befehls-Muster, das jede einzelne Mutation nachbilden müsste),
 *   3. die UI über den EventBus informiert wird und sich neu rendern kann.
 */
window.SSD = window.SSD || {};

SSD.Store = (function () {
  'use strict';

  const MAX_HISTORY = 60;

  let state = null;
  let undoStack = []; // { label, snapshot }
  let redoStack = [];
  let dirty = false; // true, wenn bei deaktiviertem Auto-Save ungespeicherte Änderungen bestehen

  function init() {
    state = SSD.Storage.load() || SSD.Models.createDefaultAppData();
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
    return state;
  }

  /** Persistiert nur, wenn Auto-Save aktiv ist; merkt sich sonst, dass manuell gespeichert werden muss. */
  function saveOrMarkDirty() {
    if (state.settings && state.settings.autoSave === false) {
      dirty = true;
      SSD.EventBus.emit('store:dirty', { dirty: true });
    } else {
      SSD.Storage.save(state);
    }
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
    SSD.Storage.save(state);
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

  function forceSave() {
    const ok = SSD.Storage.save(state);
    dirty = false;
    SSD.EventBus.emit('store:dirty', { dirty: false });
    return ok;
  }

  return {
    init, getState, isSetupComplete,
    commit, replaceState,
    undo, redo, canUndo, canRedo, peekUndoLabel, peekRedoLabel,
    forceSave, isDirty,
  };
})();
