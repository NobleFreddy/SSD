/**
 * ============================================================================
 * SSD.TasksService — Sonstige Aufgaben (offener Pool)
 * ============================================================================
 * Vom Administrator erstellte Aufgaben abseits des regulären Dienstplans
 * (z. B. Material sichten, Erste-Hilfe-Koffer auffüllen). Bewusst ein
 * offener Pool ohne feste Zuweisung: sichtbar für alle aktiven Sanis/Azubis,
 * wer sie erledigt hat, markiert sie selbst als "Erledigt" — analog zur
 * freiwilligen Anmeldung bei Veranstaltungen (SSD.EventsService), nur ohne
 * Kapazitätsgrenze.
 */
window.SSD = window.SSD || {};

SSD.TasksService = (function () {
  'use strict';

  function getAll() {
    return SSD.Store.getState().tasks.slice().sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return a.createdAt.localeCompare(b.createdAt);
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });
  }

  function getOpen() {
    return getAll().filter((t) => t.status === 'open');
  }

  function getById(id) {
    return SSD.Store.getState().tasks.find((t) => t.id === id) || null;
  }

  function create(data) {
    const task = SSD.Models.createTask(data);
    SSD.Store.commit(`Aufgabe "${task.title}" angelegt`, (draft) => {
      draft.tasks.push(task);
    });
    return task;
  }

  function update(id, patch) {
    SSD.Store.commit('Aufgabe bearbeitet', (draft) => {
      const task = draft.tasks.find((t) => t.id === id);
      if (task) Object.assign(task, patch);
    });
  }

  function remove(id) {
    const task = getById(id);
    SSD.Store.commit(`Aufgabe "${task ? task.title : ''}" gelöscht`, (draft) => {
      draft.tasks = draft.tasks.filter((t) => t.id !== id);
    });
  }

  /** Markiert eine Aufgabe als erledigt — von der ausführenden Person selbst aufgerufen. */
  function markDone(id, personId) {
    SSD.Store.commit('Aufgabe erledigt', (draft) => {
      const task = draft.tasks.find((t) => t.id === id);
      if (!task) return;
      task.status = 'done';
      task.completedAt = new Date().toISOString();
      task.completedBy = personId;
    }, { trackHistory: false });
  }

  /** Öffnet eine erledigte Aufgabe wieder (Administrator, z. B. bei Fehlklick). */
  function reopen(id) {
    SSD.Store.commit('Aufgabe wieder geöffnet', (draft) => {
      const task = draft.tasks.find((t) => t.id === id);
      if (!task) return;
      task.status = 'open';
      task.completedAt = null;
      task.completedBy = null;
    });
  }

  return { getAll, getOpen, getById, create, update, remove, markDone, reopen };
})();
