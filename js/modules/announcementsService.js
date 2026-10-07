/**
 * ============================================================================
 * SSD.AnnouncementsService — Pinnwand
 * ============================================================================
 * Kurze Mitteilungen der Team-Koordination (Administrator, Sanisprecher:in,
 * Stellv. Sanisprecher:in), die alle Sanis/Azubis nach dem Anmelden oben im
 * Dashboard sehen. Wichtige Beiträge werden oben angeheftet; mit
 * "Sichtbar bis" verschwinden Beiträge automatisch für die Schüler:innen
 * (die Koordination sieht sie weiter unter "Abgelaufen").
 *
 * Rechte: Anlegen dürfen alle Koordinator:innen; Bearbeiten/Löschen der
 * Administrator alle Beiträge, Sanisprecher:innen nur selbst angelegte
 * (siehe `SSD.Auth.canManageItem`).
 */
window.SSD = window.SSD || {};

SSD.AnnouncementsService = (function () {
  'use strict';

  const U = SSD.Utils;
  const MAX_TITLE_LENGTH = 120;
  const MAX_TEXT_LENGTH = 2000;

  function todayIso() {
    return U.toIsoDate(U.today());
  }

  function isVisible(post, refIso) {
    return !post.visibleUntil || post.visibleUntil >= (refIso || todayIso());
  }

  /** Wichtige Beiträge zuerst, danach die neuesten. */
  function compare(a, b) {
    if (!!a.important !== !!b.important) return a.important ? -1 : 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  }

  function getAll() {
    return (SSD.Store.getState().announcements || []).slice().sort(compare);
  }

  function getVisible() {
    const ref = todayIso();
    return getAll().filter((p) => isVisible(p, ref));
  }

  function getExpired() {
    const ref = todayIso();
    return getAll().filter((p) => !isVisible(p, ref));
  }

  function getById(id) {
    return (SSD.Store.getState().announcements || []).find((p) => p.id === id) || null;
  }

  function canManage(post) {
    return SSD.Auth.canManageItem(post);
  }

  function clean(data) {
    const title = String(data.title || '').trim().slice(0, MAX_TITLE_LENGTH);
    if (!title) throw new Error('Bitte einen Titel angeben.');
    const visibleUntil = data.visibleUntil || null;
    if (visibleUntil && visibleUntil < todayIso()) throw new Error('"Sichtbar bis" darf nicht in der Vergangenheit liegen.');
    return {
      title,
      text: String(data.text || '').trim().slice(0, MAX_TEXT_LENGTH),
      important: !!data.important,
      visibleUntil,
    };
  }

  function create(data) {
    if (!SSD.Auth.canCoordinate()) throw new Error('Dafür fehlt die Berechtigung.');
    const post = SSD.Models.createAnnouncement(Object.assign(clean(data), { createdBy: SSD.Auth.currentPersonId() }));
    SSD.Store.commit(`Pinnwand-Beitrag "${post.title}" veröffentlicht`, (draft) => {
      draft.announcements = draft.announcements || [];
      draft.announcements.push(post);
    });
    return post;
  }

  function update(id, data) {
    if (!canManage(getById(id))) throw new Error('Diesen Beitrag darf nur die Person bearbeiten, die ihn verfasst hat, oder der Administrator.');
    const patch = clean(data);
    SSD.Store.commit('Pinnwand-Beitrag bearbeitet', (draft) => {
      const post = (draft.announcements || []).find((p) => p.id === id);
      if (post) Object.assign(post, patch, { updatedAt: new Date().toISOString() });
    });
  }

  function remove(id) {
    const post = getById(id);
    if (!canManage(post)) throw new Error('Diesen Beitrag darf nur die Person löschen, die ihn verfasst hat, oder der Administrator.');
    SSD.Store.commit(`Pinnwand-Beitrag "${post.title}" gelöscht`, (draft) => {
      draft.announcements = (draft.announcements || []).filter((p) => p.id !== id);
    });
  }

  /** "Administration" bzw. Name der Verfasser:in. */
  function authorLabel(post) {
    if (!post.createdBy) return 'Administration';
    const person = SSD.StudentService.getById(post.createdBy);
    return person ? SSD.StudentService.fullName(person) : '(gelöscht)';
  }

  return {
    MAX_TITLE_LENGTH, MAX_TEXT_LENGTH,
    getAll, getVisible, getExpired, getById, isVisible,
    canManage, create, update, remove, authorLabel,
  };
})();
