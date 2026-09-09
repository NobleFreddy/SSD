/**
 * ============================================================================
 * SSD.SettingsService — Anwendungseinstellungen
 * ============================================================================
 */
window.SSD = window.SSD || {};

SSD.SettingsService = (function () {
  'use strict';

  function get() {
    return SSD.Store.getState().settings;
  }

  function update(patch) {
    SSD.Store.commit('Einstellungen gespeichert', (draft) => {
      Object.assign(draft.settings, patch);
    }, { trackHistory: false });
  }

  function getSchool() {
    return SSD.Store.getState().school;
  }

  function updateSchool(patch) {
    SSD.Store.commit('Schulinformationen aktualisiert', (draft) => {
      Object.assign(draft.school, patch);
    }, { trackHistory: false });
  }

  return { get, update, getSchool, updateSchool };
})();
