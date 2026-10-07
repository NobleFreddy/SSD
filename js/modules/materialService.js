/**
 * ============================================================================
 * SSD.MaterialService — Materialliste
 * ============================================================================
 * Gemeinsame Liste, in der Sanis/Azubis zu bestellendes Material für den
 * Administrator dokumentieren. Anlegende Personen dürfen ihre eigenen, noch
 * offenen (nicht "bestellt"/"erledigt") Einträge selbst bearbeiten oder
 * löschen — alles andere macht der Administrator. Die Berechtigungsprüfung
 * (`canEdit`) läuft nicht nur in der UI, sondern auch in `update`/`remove`
 * selbst: das Schüler-Dashboard hat — anders als alle Admin-Views — keine
 * `store:changed`-Subscription (siehe js/views/studentDashboardView.js) und
 * kann einen inzwischen vom Administrator geänderten Status daher kurzzeitig
 * veraltet anzeigen. Die serverseitige Prüfung fängt diesen Wettlauf ab,
 * analog zu `SSD.SelfServiceService.canClaim`.
 */
window.SSD = window.SSD || {};

SSD.MaterialService = (function () {
  'use strict';

  function getAll() {
    return SSD.Store.getState().materials.slice().sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  function getById(id) {
    return SSD.Store.getState().materials.find((m) => m.id === id) || null;
  }

  function canEdit(personId, item) {
    return !!item && item.requestedBy === personId && item.status === 'offen';
  }

  function create(data) {
    const item = SSD.Models.createMaterialRequest(data);
    SSD.Store.commit(`Material angefragt: "${item.name}"`, (draft) => {
      draft.materials.push(item);
      const qty = item.quantity ? ` (${item.quantity})` : '';
      SSD.NotificationService.add(draft, 'material', `Material angefragt: ${item.name}${qty} — von ${SSD.NotificationService.personName(item.requestedBy)}.`);
    });
    return item;
  }

  function update(id, patch, opts) {
    const actingPersonId = opts && opts.actingPersonId;
    if (actingPersonId) {
      const current = getById(id);
      if (!canEdit(actingPersonId, current)) throw new Error('Dieser Eintrag kann nicht mehr bearbeitet werden (evtl. inzwischen vom Administrator bearbeitet).');
    }
    SSD.Store.commit('Material-Eintrag bearbeitet', (draft) => {
      const item = draft.materials.find((m) => m.id === id);
      if (item) { Object.assign(item, patch); item.updatedAt = new Date().toISOString(); }
    });
  }

  function remove(id, opts) {
    const actingPersonId = opts && opts.actingPersonId;
    const current = getById(id);
    if (actingPersonId && !canEdit(actingPersonId, current)) {
      throw new Error('Dieser Eintrag kann nicht mehr gelöscht werden (evtl. inzwischen vom Administrator bearbeitet).');
    }
    SSD.Store.commit(`Material-Eintrag gelöscht: "${current ? current.name : ''}"`, (draft) => {
      draft.materials = draft.materials.filter((m) => m.id !== id);
    });
  }

  /** Statuswechsel durch den Administrator (kein Berechtigungscheck nötig — Admin darf immer). */
  function setStatus(id, status) {
    const STATUS_TEXT = { offen: 'wieder offen', bestellt: 'bestellt', erledigt: 'erledigt' };
    SSD.Store.commit(`Material-Status geändert: ${status}`, (draft) => {
      const item = draft.materials.find((m) => m.id === id);
      if (!item || item.status === status) return;
      item.status = status;
      item.updatedAt = new Date().toISOString();
      SSD.NotificationService.add(draft, 'material', `Material „${item.name}“: ${STATUS_TEXT[status] || status}.`);
    });
  }

  return { getAll, getById, canEdit, create, update, remove, setStatus };
})();
