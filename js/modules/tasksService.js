/**
 * ============================================================================
 * SSD.TasksService — Sonstige Aufgaben (offener Pool)
 * ============================================================================
 * Aufgaben abseits des regulären Dienstplans (z. B. Material sichten,
 * Erste-Hilfe-Koffer auffüllen), angelegt vom Administrator oder von
 * Sanisprecher:innen. Bewusst ein offener Pool ohne feste Zuweisung: sichtbar
 * für alle aktiven Sanis/Azubis, wer sie erledigt hat, markiert sie selbst
 * als "Erledigt" — analog zur freiwilligen Anmeldung bei Veranstaltungen
 * (SSD.EventsService), nur ohne Kapazitätsgrenze. Bearbeiten/Löschen darf
 * der Administrator alle Aufgaben, Sanisprecher:innen nur selbst angelegte.
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

  /** Darf die angemeldete Person diese Aufgabe bearbeiten/löschen? (siehe `SSD.Auth.canManageItem`) */
  function canManage(task) {
    return SSD.Auth.canManageItem(task);
  }

  function create(data) {
    if (!SSD.Auth.canCoordinate()) throw new Error('Dafür fehlt die Berechtigung.');
    const task = SSD.Models.createTask(Object.assign({}, data, { createdBy: SSD.Auth.currentPersonId() }));
    SSD.Store.commit(`Aufgabe "${task.title}" angelegt`, (draft) => {
      draft.tasks.push(task);
      const due = task.dueDate ? ` (fällig ${SSD.Utils.formatDateMedium(SSD.Utils.parseIsoDate(task.dueDate))})` : '';
      SSD.NotificationService.add(draft, 'task', `Neue Aufgabe: ${task.title}${due}.`);
    });
    return task;
  }

  function update(id, patch) {
    if (!canManage(getById(id))) throw new Error('Diese Aufgabe darf nur die Person bearbeiten, die sie angelegt hat, oder der Administrator.');
    SSD.Store.commit('Aufgabe bearbeitet', (draft) => {
      const task = draft.tasks.find((t) => t.id === id);
      if (task) Object.assign(task, patch);
    });
  }

  function remove(id) {
    const task = getById(id);
    if (!canManage(task)) throw new Error('Diese Aufgabe darf nur die Person löschen, die sie angelegt hat, oder der Administrator.');
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
      SSD.NotificationService.add(draft, 'task', `Aufgabe erledigt: ${task.title} (von ${SSD.NotificationService.personName(personId)}).`);
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
      SSD.NotificationService.add(draft, 'task', `Aufgabe wieder geöffnet: ${task.title}.`);
    });
  }

  return { getAll, getOpen, getById, canManage, create, update, remove, markDone, reopen };
})();
