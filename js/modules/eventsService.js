/**
 * ============================================================================
 * SSD.EventsService — außerschulische Veranstaltungen
 * ============================================================================
 * Verwaltet freiwillige Veranstaltungen (z. B. Schulfest, Sporttag, Sanitäts-
 * dienst bei einem externen Event), die der Administrator anlegt und für die
 * sich Schüler:innen/Azubis selbstständig eintragen. Bewusst vollständig
 * getrennt vom regulären Dienstplan (`SSD.Scheduler`/`schedule.entries`):
 * Veranstaltungen fließen nicht in die Fairness-/Dienststatistik ein und
 * werden nicht automatisch verplant — reine Freiwilligen-Anmeldeliste.
 */
window.SSD = window.SSD || {};

SSD.EventsService = (function () {
  'use strict';

  const U = SSD.Utils;

  function getAll() {
    return SSD.Store.getState().events.slice().sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));
  }

  function getById(id) {
    return SSD.Store.getState().events.find((e) => e.id === id) || null;
  }

  function getUpcoming() {
    const todayIso = U.toIsoDate(U.today());
    return getAll().filter((e) => e.date >= todayIso);
  }

  /** „Samstag, 17.10.2026, 10:00–14:00 Uhr, Aula“ — für Teams-Meldungen. */
  function whenText(event) {
    const day = U.formatDateLong(U.parseIsoDate(event.date));
    const time = event.startTime && event.endTime ? `, ${event.startTime}–${event.endTime} Uhr` : (event.startTime ? `, ab ${event.startTime} Uhr` : '');
    return `${day}${time}${event.location ? `, ${event.location}` : ''}`;
  }

  function create(data) {
    const event = SSD.Models.createEvent(data);
    SSD.Store.commit(`Veranstaltung "${event.title}" angelegt`, (draft) => {
      draft.events.push(event);
      SSD.NotificationService.add(draft, 'event', `Neue Veranstaltung: ${event.title} — ${whenText(event)}.`);
    });
    return event;
  }

  function update(id, patch) {
    SSD.Store.commit('Veranstaltung bearbeitet', (draft) => {
      const event = draft.events.find((e) => e.id === id);
      if (!event) return;
      Object.assign(event, patch);
      SSD.NotificationService.add(draft, 'event', `Veranstaltung geändert: ${event.title} — ${whenText(event)}.`);
    });
  }

  function remove(id) {
    const event = getById(id);
    SSD.Store.commit(`Veranstaltung "${event ? event.title : ''}" gelöscht`, (draft) => {
      draft.events = draft.events.filter((e) => e.id !== id);
      if (event) SSD.NotificationService.add(draft, 'event', `Veranstaltung gelöscht: ${event.title} (${U.formatDateMedium(U.parseIsoDate(event.date))}).`);
    });
  }

  function isFull(event) {
    return event.capacity != null && event.participantIds.length >= event.capacity;
  }

  function isSignedUp(event, personId) {
    return event.participantIds.includes(personId);
  }

  function signUp(eventId, personId) {
    const event = getById(eventId);
    if (!event) throw new Error('Diese Veranstaltung existiert nicht mehr.');
    if (isSignedUp(event, personId)) return;
    if (isFull(event)) throw new Error('Diese Veranstaltung ist bereits ausgebucht.');
    const person = SSD.StudentService.getById(personId);
    SSD.Store.commit(`Für "${event.title}" angemeldet (${person ? SSD.StudentService.fullName(person) : ''})`, (draft) => {
      const target = draft.events.find((e) => e.id === eventId);
      if (!target) return;
      if (target.capacity != null && target.participantIds.length >= target.capacity) throw new Error('Diese Veranstaltung ist inzwischen bereits ausgebucht.');
      if (!target.participantIds.includes(personId)) target.participantIds.push(personId);
    }, { trackHistory: false });
  }

  function withdraw(eventId, personId) {
    SSD.Store.commit('Anmeldung zurückgezogen', (draft) => {
      const target = draft.events.find((e) => e.id === eventId);
      if (!target) return;
      target.participantIds = target.participantIds.filter((id) => id !== personId);
    }, { trackHistory: false });
  }

  /** Entfernt eine Person aus der Teilnehmerliste (Administrator-Aktion). */
  function removeParticipant(eventId, personId) {
    withdraw(eventId, personId);
  }

  function getParticipants(event) {
    return event.participantIds
      .map((id) => SSD.StudentService.getById(id))
      .filter(Boolean)
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  }

  /** Anzahl bisheriger Anmeldungen je Person über ALLE Veranstaltungen (Grundlage für die faire Auto-Zuteilung). */
  function getParticipationCounts() {
    const counts = new Map();
    getAll().forEach((e) => {
      e.participantIds.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    });
    return counts;
  }

  /** Aktive, noch nicht angemeldete Personen für eine Veranstaltung, aufsteigend nach bisheriger Teilnahmezahl sortiert (wenigste zuerst). */
  function getFillCandidates(eventId) {
    const event = getById(eventId);
    if (!event) return [];
    const counts = getParticipationCounts();
    return SSD.StudentService.getAll()
      .filter((p) => p.active && !event.participantIds.includes(p.id))
      .sort((a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0) || a.lastName.localeCompare(b.lastName));
  }

  /**
   * Füllt freie Plätze einer Veranstaltung automatisch auf, bevorzugt mit
   * Personen, die bisher an den wenigsten Veranstaltungen teilgenommen haben.
   * Ergänzt bewusst nur die freiwillige Selbstanmeldung, ersetzt sie nicht.
   * @returns {object[]} die tatsächlich hinzugefügten Personen
   */
  function autoFillParticipants(eventId, count) {
    const event = getById(eventId);
    if (!event) throw new Error('Diese Veranstaltung existiert nicht mehr.');
    const room = event.capacity != null ? Math.max(0, event.capacity - event.participantIds.length) : Infinity;
    const toAdd = getFillCandidates(eventId).slice(0, Math.max(0, Math.min(count, room)));
    if (!toAdd.length) return [];

    SSD.Store.commit(`Automatisch aufgefüllt: "${event.title}" (+${toAdd.length})`, (draft) => {
      const target = draft.events.find((e) => e.id === eventId);
      if (!target) return;
      toAdd.forEach((p) => {
        if (!target.participantIds.includes(p.id)) target.participantIds.push(p.id);
      });
      SSD.NotificationService.add(draft, 'event', `${target.title}: ${toAdd.length === 1 ? '1 Person' : `${toAdd.length} Personen`} automatisch eingeteilt (${toAdd.map((p) => SSD.StudentService.fullName(p)).join(', ')}).`);
    });
    return toAdd;
  }

  return {
    getAll, getById, getUpcoming, create, update, remove,
    isFull, isSignedUp, signUp, withdraw, removeParticipant, getParticipants,
    getParticipationCounts, getFillCandidates, autoFillParticipants,
  };
})();
