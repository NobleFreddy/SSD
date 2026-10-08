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

  let state = null; // erst nach der Anmeldung geladen; vorher gibt es nur `publicInfo`
  let publicInfo = null; // { setupComplete, schoolName, selfRegistration, hasRegistrationCode, privacy, retention, teamsEnabled }
  let undoStack = []; // { label, snapshot }
  let redoStack = [];
  let dirty = false; // true, wenn bei deaktiviertem Auto-Save ungespeicherte Änderungen bestehen
  let saveLoop = null; // laufender Speichervorgang (Promise) — es speichert immer nur einer gleichzeitig
  let saveAgain = false; // während des Speicherns kamen weitere Änderungen hinzu
  let deferredRemote = null; // während des Speicherns eingetroffene Realtime-Änderung { data, version }
  let unsubscribeRemote = null;

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  function setPublicInfo(info) { publicInfo = info || null; }
  function getPublicInfo() { return publicInfo || {}; }

  /**
   * Lädt nach der Anmeldung den Stand, den die angemeldete Person sehen darf,
   * und richtet die Live-Synchronisierung ein. Wirft bei ungültiger Sitzung
   * einen Fehler mit `sessionExpired`.
   */
  async function load() {
    state = await SSD.Storage.load();
    undoStack = [];
    redoStack = [];
    dirty = false;
    if (!unsubscribeRemote) unsubscribeRemote = SSD.Storage.subscribeToRemoteChanges(applyRemoteState);
    return state;
  }

  /** Abmelden: nichts von den Daten bleibt im Speicher dieses Tabs. */
  function clear() {
    if (unsubscribeRemote) { unsubscribeRemote(); unsubscribeRemote = null; }
    state = null;
    undoStack = [];
    redoStack = [];
    dirty = false;
    deferredRemote = null;
    SSD.Storage.forget();
  }

  function isLoaded() { return !!state; }

  /** Übernimmt eine per Realtime empfangene fremde Änderung — siehe Modulbeschreibung oben. */
  function applyRemoteState(newData, newVersion) {
    if (dirty) {
      SSD.EventBus.emit('store:remote-update-deferred', {});
      return;
    }
    if (saveLoop) {
      // Während eines eigenen Speichervorgangs nichts überschreiben: Das Realtime-Echo
      // der eigenen Speicherung kann vor der Server-Antwort eintreffen und enthielte
      // dann ältere Daten als der lokale Stand. Entschieden wird nach dem Speichern.
      deferredRemote = { data: newData, version: newVersion };
      return;
    }
    state = newData;
    SSD.Storage.setKnownVersion(newVersion);
    // Rückgängig/Wiederholen arbeitet mit vollständigen Schnappschüssen: Nach einer
    // fremden Änderung würde ein älterer Schnappschuss sie beim Speichern überschreiben
    // (z. B. eine gerade eingegangene Krankmeldung). Daher beginnt der Verlauf neu.
    undoStack = [];
    redoStack = [];
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

  /**
   * Speichert den aktuellen Stand — nacheinander statt parallel: Zwei
   * überlappende Speichervorgänge desselben Tabs würden mit derselben
   * Versionsnummer starten, der zweite liefe in die optimistische Sperre und
   * meldete fälschlich einen Konflikt (z. B. bei schnell hintereinander
   * angetippten Verfügbarkeiten). Kommt während des Speicherns eine weitere
   * Änderung hinzu, wird danach einmal mit dem dann aktuellen Stand nachgespeichert.
   */
  function persist() {
    if (saveLoop) {
      saveAgain = true;
      return saveLoop;
    }
    saveLoop = runSaveLoop();
    return saveLoop;
  }

  /** Führt die (asynchronen) Speichervorgänge aus und meldet das Ergebnis über den EventBus. */
  async function runSaveLoop() {
    let result;
    do {
      saveAgain = false;
      result = await SSD.Storage.save(state);
    } while (result.ok && saveAgain);
    // Synchron direkt nach der letzten Prüfung freigeben — so kann keine Änderung "dazwischen" verloren gehen.
    saveLoop = null;
    const remote = deferredRemote;
    deferredRemote = null;

    if (result.ok) {
      if (dirty) { dirty = false; SSD.EventBus.emit('store:dirty', { dirty: false }); }
      // Neuer als der eigene Stand? Dann war es eine echte fremde Änderung (das Echo der
      // eigenen Speicherung trägt dieselbe Versionsnummer und wird verworfen).
      if (remote && remote.version > SSD.Storage.getKnownVersion()) applyRemoteState(remote.data, remote.version);
    } else if (result.conflict) {
      // Den Stand der anderen Person übernehmen (liefert der Server gleich mit), damit
      // weitere Änderungen wieder gespeichert werden können; der Hinweis bittet um erneute Eingabe.
      const latest = result.remote || remote;
      if (latest) applyRemoteState(latest.data, latest.version);
      SSD.EventBus.emit('store:conflict', {});
    }
    return result;
  }

  /**
   * Wartet, bis der aktuelle Stand gespeichert ist — auch bei abgeschaltetem
   * Auto-Save (z. B. bevor für eine neu angelegte Person ein Passwort gesetzt
   * wird, das der Server nur für gespeicherte Personen annimmt).
   */
  async function flush() {
    const result = await persist();
    return result.ok;
  }

  function isDirty() { return dirty; }

  function getState() {
    return state;
  }

  function isSetupComplete() {
    if (state) return !!(state.meta && state.meta.setupComplete && state.admin);
    return !!(publicInfo && publicInfo.setupComplete);
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
    load, clear, isLoaded, setPublicInfo, getPublicInfo,
    getState, isSetupComplete,
    commit, replaceState, flush,
    undo, redo, canUndo, canRedo, peekUndoLabel, peekRedoLabel,
    forceSave, isDirty,
  };
})();
