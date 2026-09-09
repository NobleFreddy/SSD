/**
 * ============================================================================
 * SSD.CalendarService — Sondertage & Dienstzeiten-Konfiguration
 * ============================================================================
 * Verwaltet Ferien/Feiertage/Projekttage etc. (als Datumsbereiche) sowie die
 * pro Wochentag ein-/ausschaltbaren Dienstblöcke. Beides fließt direkt in den
 * Dienstplan-Generator ein (deaktivierte Tage/Blöcke werden nie verplant).
 */
window.SSD = window.SSD || {};

SSD.CalendarService = (function () {
  'use strict';

  const U = SSD.Utils;

  function getAll() {
    return SSD.Store.getState().specialDays.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  function create(data) {
    const day = SSD.Models.createSpecialDay(data);
    SSD.Store.commit(`Sondertag "${day.label || SSD.Models.SPECIAL_DAY_TYPES.find((t) => t.key === day.type).label}" angelegt`, (draft) => {
      draft.specialDays.push(day);
    });
    return day;
  }

  function update(id, patch) {
    SSD.Store.commit('Sondertag bearbeitet', (draft) => {
      const day = draft.specialDays.find((d) => d.id === id);
      if (day) Object.assign(day, patch);
    });
  }

  function remove(id) {
    SSD.Store.commit('Sondertag gelöscht', (draft) => {
      draft.specialDays = draft.specialDays.filter((d) => d.id !== id);
    });
  }

  /** Liefert den (ersten) Sondertag, der ein gegebenes ISO-Datum abdeckt, oder null. */
  function getSpecialDayForDate(dateIso) {
    return getAll().find((d) => dateIso >= d.startDate && dateIso <= d.endDate) || null;
  }

  function isDayUsable(dateIso) {
    return !getSpecialDayForDate(dateIso);
  }

  /* ---------------------------------------------------------------------
   * Dienstblock-Konfiguration (pro Wochentag ein-/ausschaltbar)
   * ------------------------------------------------------------------- */

  function getDutyBlockConfig() {
    return SSD.Store.getState().dutyBlockConfig;
  }

  function isBlockEnabled(weekdayKey, blockKey) {
    const config = getDutyBlockConfig();
    return !!(config[weekdayKey] && config[weekdayKey][blockKey]);
  }

  function setBlockEnabled(weekdayKey, blockKey, enabled) {
    SSD.Store.commit('Dienstzeiten angepasst', (draft) => {
      draft.dutyBlockConfig[weekdayKey][blockKey] = enabled;
    });
  }

  function getEnabledBlocksForWeekday(weekdayKey) {
    const config = getDutyBlockConfig();
    return U.DUTY_BLOCK_KEYS.filter((b) => config[weekdayKey] && config[weekdayKey][b]);
  }

  return {
    getAll, create, update, remove,
    getSpecialDayForDate, isDayUsable,
    getDutyBlockConfig, isBlockEnabled, setBlockEnabled, getEnabledBlocksForWeekday,
  };
})();
