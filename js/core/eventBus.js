/**
 * ============================================================================
 * SSD.EventBus — einfacher Publish/Subscribe-Mechanismus
 * ============================================================================
 * Entkoppelt Module voneinander: Der Store meldet Datenänderungen, ohne die
 * UI-Module zu kennen; UI-Module abonnieren die für sie relevanten Events.
 */
window.SSD = window.SSD || {};

SSD.EventBus = (function () {
  'use strict';

  const listeners = new Map(); // eventName -> Set<callback>

  function on(eventName, callback) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(callback);
    return () => off(eventName, callback);
  }

  function off(eventName, callback) {
    if (listeners.has(eventName)) listeners.get(eventName).delete(callback);
  }

  function emit(eventName, payload) {
    if (!listeners.has(eventName)) return;
    // Kopie iterieren, damit sich ein Listener während der Ausführung sicher abmelden kann.
    Array.from(listeners.get(eventName)).forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[EventBus] Fehler in Listener für "${eventName}":`, err);
      }
    });
  }

  return { on, off, emit };
})();
