/**
 * ============================================================================
 * SSD.ReinforcementService — Verstärkung anfordern
 * ============================================================================
 * Jede:r Sani oder Azubi kann für einen Dienstblock (heute oder später)
 * Verstärkung anfordern: selbst verfügbare Sanis auswählen oder eine Anzahl
 * bzw. alle Verfügbaren einteilen lassen. Infrage kommen nur Sanis (keine
 * Azubis), die zu dieser Zeit „Verfügbar“ eingetragen sind — ohne Klausur,
 * nicht schon im Dienst, nicht an dem Tag selbst ausgefallen und nicht schon
 * als Verstärkung für dieselbe Zeit eingeteilt.
 *
 * Eingeteilte sehen einen Hinweis („Verstanden“ / „Kann nicht“). Kommt jemand
 * nicht, nimmt die anfordernde Person ihn heraus und teilt weitere ein.
 *
 * Teams: Eine Meldung (Kategorie `reinforcement`) geht etwa 30 Sekunden nach
 * der Anfrage raus — Änderungen in dieser Zeit fließen noch in dieselbe
 * Meldung ein, eine sofort zurückgenommene Anfrage wird gar nicht gemeldet.
 * Später folgt je Änderung eine neue Meldung. Die Wartezeit hält der Server
 * ein (ssd_private.send_teams_digest, Migration 20261127_ssd_reinforcement.sql).
 *
 * Datenformat (state.reinforcements[]):
 *   { id, date, block, note, requestedBy, createdAt, updatedAt, cancelledAt,
 *     people: [{ personId, assignedAt, assignedBy, auto, seenAt, declinedAt, removedAt }],
 *     teams: { itemId, at, kind } }   // letzte Teams-Meldung zu dieser Anfrage
 */
window.SSD = window.SSD || {};

SSD.ReinforcementService = (function () {
  'use strict';

  const U = SSD.Utils;
  const MAX_NOTE = 100;
  const MAX_DAYS_AHEAD = 56;
  const TEAMS_GRACE_MS = 30 * 1000;
  const RECENT_DAYS = 60;

  function all() {
    return SSD.Store.getState().reinforcements || [];
  }

  function getById(id) {
    return all().find((r) => r.id === id) || null;
  }

  function isOpen(req) {
    return !!req && !req.cancelledAt;
  }

  /** Personen, die (noch) eingeteilt sind — ohne „kann nicht“ und ohne herausgenommene. */
  function activePeople(req) {
    return (req.people || []).filter((p) => !p.declinedAt && !p.removedAt);
  }

  function todayIso() {
    return U.toIsoDate(U.today());
  }

  /** „Fr, 27.11., 3./4. Stunde“ */
  function whenLabel(req) {
    const date = U.parseIsoDate(req.date);
    return `${U.WEEKDAY_LABELS_SHORT[U.weekdayKeyFromDate(date)]}, ${U.formatDateShort(date)}, ${U.blockLabel(req.block)}`;
  }

  function cleanNote(note) {
    return String(note || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);
  }

  /* ---------------------------------------------------------------------
   * Wer kommt infrage?
   * ------------------------------------------------------------------- */

  function isAbsentOn(state, personId, dateIso) {
    return state.schedule.entries.some((e) => e.date === dateIso && (
      (e.substitutionRequests || []).some((r) => r.studentId === personId)
      || (e.substitutionLog || []).some((l) => l.originalStudentId === personId)));
  }

  function busyAsReinforcement(personId, dateIso, block, ownRequestId) {
    return all().some((r) => isOpen(r) && r.date === dateIso && r.block === block && (
      r.id === ownRequestId
        ? (r.people || []).some((p) => p.personId === personId) // auch wer schon abgesagt hat oder herausgenommen wurde
        : activePeople(r).some((p) => p.personId === personId)));
  }

  /**
   * Verfügbare Sanis für einen Block — beste Wahl zuerst: wenigste Dienste in
   * dieser Woche, dann seltenste Verstärkung in letzter Zeit, dann wenigste
   * Dienste insgesamt.
   * @param {{requestId?: string, requesterId?: string}} [opts]
   * @returns {Array<{student: object, weekDuties: number}>}
   */
  function candidates(dateIso, block, opts) {
    const o = opts || {};
    const state = SSD.Store.getState();
    if (!dateIso || !U.weekdayKeyFromDate(U.parseIsoDate(dateIso)) || !U.DUTY_BLOCK_KEYS.includes(block)) return [];
    const entry = state.schedule.entries.find((e) => e.date === dateIso && e.block === block);
    const monday = U.toIsoDate(U.getMondayOfWeek(U.parseIsoDate(dateIso)));
    const sunday = U.toIsoDate(U.addDays(U.parseIsoDate(monday), 6));
    const recentFrom = U.toIsoDate(U.addDays(U.today(), -RECENT_DAYS));
    const assigned = (e, id) => e.studentIds.includes(id) || e.azubiId === id;

    return SSD.StudentService.getActiveByRole('student')
      .filter((s) => !s.pendingApproval && s.id !== o.requesterId)
      .filter((s) => SSD.AvailabilityService.stateAt(s, dateIso, block) === 'available')
      .filter((s) => !(entry && assigned(entry, s.id)))
      .filter((s) => !isAbsentOn(state, s.id, dateIso))
      .filter((s) => !busyAsReinforcement(s.id, dateIso, block, o.requestId))
      .map((s) => ({
        student: s,
        weekDuties: state.schedule.entries.filter((e) => e.date >= monday && e.date <= sunday && assigned(e, s.id)).length,
        recent: all().filter((r) => isOpen(r) && r.date >= recentFrom && activePeople(r).some((p) => p.personId === s.id)).length,
        total: state.schedule.entries.filter((e) => assigned(e, s.id)).length,
      }))
      .sort((a, b) => a.weekDuties - b.weekDuties || a.recent - b.recent || a.total - b.total
        || SSD.StudentService.fullName(a.student).localeCompare(SSD.StudentService.fullName(b.student)))
      .map(({ student, weekDuties }) => ({ student, weekDuties }));
  }

  /** Erlaubte Tage: Mo–Fr, ab heute, höchstens 8 Wochen im Voraus. */
  function checkSlot(dateIso, block) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso || '') || !U.DUTY_BLOCK_KEYS.includes(block)) return 'Bitte Tag und Stunde wählen.';
    if (!U.weekdayKeyFromDate(U.parseIsoDate(dateIso))) return 'Verstärkung gibt es nur von Montag bis Freitag.';
    if (dateIso < todayIso()) return 'Dieser Tag liegt in der Vergangenheit.';
    if (dateIso > U.toIsoDate(U.addDays(U.today(), MAX_DAYS_AHEAD))) return 'Höchstens 8 Wochen im Voraus.';
    return null;
  }

  /* ---------------------------------------------------------------------
   * Teams-Meldungen (siehe Modulbeschreibung)
   * ------------------------------------------------------------------- */

  function teamsText(req, kind) {
    const N = SSD.NotificationService;
    const where = req.note ? ` (${req.note})` : '';
    const active = activePeople(req).map((p) => p.personId);
    const dropped = (req.people || []).filter((p) => p.declinedAt || p.removedAt)
      .map((p) => `${N.personName(p.personId)}${p.declinedAt ? ' (kann nicht)' : ''}`);
    if (kind === 'cancel') {
      return [`Verstärkung zurückgenommen — ${whenLabel(req)}${where}`, active.length ? `Bisher eingeteilt: ${N.names(active)} — bitte nicht kommen.` : null].filter(Boolean).join('\n');
    }
    const head = kind === 'new' ? `Verstärkung angefordert für ${whenLabel(req)}${where}` : `Verstärkung geändert — ${whenLabel(req)}${where}`;
    return [head, `Eingeteilt: ${active.length ? N.names(active) : 'niemand mehr'}`, dropped.length ? `Nicht dabei: ${dropped.join(', ')}` : null].filter(Boolean).join('\n');
  }

  /**
   * Hält die Teams-Meldung zu einer Anfrage aktuell — innerhalb eines Commit-Mutators.
   * Innerhalb der Wartezeit wird die noch nicht versendete Meldung angepasst
   * (bzw. bei sofortiger Rücknahme entfernt), danach eine neue angelegt.
   */
  function syncTeams(draft, req, cancelling) {
    const N = SSD.NotificationService;
    const last = req.teams;
    const outbox = Array.isArray(draft.teamsOutbox) ? draft.teamsOutbox : [];
    const pendingItem = last && outbox.find((n) => n.id === last.itemId);
    const inGrace = pendingItem && Date.now() - new Date(last.at).getTime() < TEAMS_GRACE_MS;

    if (inGrace) {
      if (cancelling && last.kind === 'new') {
        draft.teamsOutbox = outbox.filter((n) => n.id !== last.itemId); // nie gemeldet — nichts zu melden
        req.teams = null;
        return;
      }
      const kind = cancelling ? 'cancel' : last.kind;
      pendingItem.text = teamsText(req, kind);
      pendingItem.by = N.actorName();
      req.teams = Object.assign({}, last, { kind });
      return;
    }
    if (cancelling && !last) return; // nie gemeldet (z. B. Teams aus)
    const kind = cancelling ? 'cancel' : (last ? 'change' : 'new');
    const item = N.add(draft, 'reinforcement', teamsText(req, kind));
    req.teams = item ? { itemId: item.id, at: item.at, kind } : (last || null);
  }

  /* ---------------------------------------------------------------------
   * Ändern
   * ------------------------------------------------------------------- */

  /** Anfrage im Entwurf (vorher mit getById geprüft — im Commit wird nicht mehr geworfen). */
  function findDraft(draft, id) {
    return (draft.reinforcements || []).find((r) => r.id === id) || null;
  }

  function actor() {
    return SSD.Auth.currentPersonId();
  }

  /** Darf die angemeldete Person diese Anfrage ändern? (anfordernde Person, Administration, Team-Leitung) */
  function canManage(req) {
    if (!req) return false;
    return SSD.Auth.canCoordinate() || (!!req.requestedBy && req.requestedBy === actor());
  }

  /** Prüft die Auswahl vor dem Speichern (wirft mit verständlicher Meldung). Gibt die Personen ohne Doppelte zurück. */
  function checkPeople(dateIso, block, personIds, requestId, requesterId) {
    if (!personIds || !personIds.length) throw new Error('Bitte mindestens eine Person auswählen.');
    const allowed = new Set(candidates(dateIso, block, { requestId, requesterId }).map((c) => c.student.id));
    const unique = Array.from(new Set(personIds));
    const notAllowed = unique.filter((id) => !allowed.has(id));
    if (notAllowed.length) {
      throw new Error(`${notAllowed.map((id) => SSD.SubstitutionService.studentName(id)).join(', ')} ${notAllowed.length === 1 ? 'ist' : 'sind'} zu dieser Zeit nicht (mehr) verfügbar.`);
    }
    return unique;
  }

  /** Geprüfte Personen als „eingeteilt“ eintragen (innerhalb eines Commits). */
  function assignInDraft(req, personIds, auto) {
    const at = new Date().toISOString();
    personIds.forEach((personId) => {
      req.people.push({ personId, assignedAt: at, assignedBy: actor(), auto: !!auto, seenAt: null, declinedAt: null, removedAt: null });
    });
    req.updatedAt = at;
  }

  /**
   * Neue Anfrage.
   * @param {{date: string, block: string, note?: string, personIds: string[], auto?: boolean}} data
   * @returns {object} die gespeicherte Anfrage
   */
  function create(data) {
    const problem = checkSlot(data.date, data.block);
    if (problem) throw new Error(problem);
    const personIds = checkPeople(data.date, data.block, data.personIds, null, actor());
    const now = new Date().toISOString();
    const req = {
      id: U.generateId('rf'),
      date: data.date,
      block: data.block,
      note: cleanNote(data.note),
      requestedBy: actor(),
      createdAt: now,
      updatedAt: now,
      cancelledAt: null,
      people: [],
      teams: null,
    };
    SSD.Store.commit(`Verstärkung angefordert (${whenLabel(req)})`, (draft) => {
      if (!Array.isArray(draft.reinforcements)) draft.reinforcements = [];
      draft.reinforcements.push(req);
      assignInDraft(req, personIds, data.auto);
      syncTeams(draft, req, false);
    });
    return getById(req.id);
  }

  /** Weitere Personen einteilen (z. B. wenn jemand nicht kommt). */
  function addPeople(requestId, personIds, auto) {
    const req = getById(requestId);
    if (!isOpen(req)) throw new Error('Diese Anfrage ist nicht mehr aktiv.');
    if (!canManage(req)) throw new Error('Nur wer die Verstärkung angefordert hat, kann weitere einteilen.');
    const checked = checkPeople(req.date, req.block, personIds, req.id, req.requestedBy);
    SSD.Store.commit('Verstärkung ergänzt', (draft) => {
      const target = (draft.reinforcements || []).find((r) => r.id === requestId);
      if (!target) return;
      assignInDraft(target, checked, auto);
      syncTeams(draft, target, false);
    });
  }

  /** „Kommt nicht“ — die anfordernde Person nimmt jemanden heraus. */
  function removePerson(requestId, personId) {
    const req = getById(requestId);
    if (!isOpen(req)) throw new Error('Diese Anfrage ist nicht mehr aktiv.');
    if (!canManage(req)) throw new Error('Nur wer die Verstärkung angefordert hat, kann Personen herausnehmen.');
    SSD.Store.commit('Verstärkung: Person herausgenommen', (draft) => {
      const target = findDraft(draft, requestId);
      const entry = target && activePeople(target).find((p) => p.personId === personId);
      if (!entry) return;
      entry.removedAt = new Date().toISOString();
      target.updatedAt = entry.removedAt;
      syncTeams(draft, target, false);
    });
  }

  /** Die ganze Anfrage zurücknehmen. */
  function cancel(requestId) {
    const req = getById(requestId);
    if (!isOpen(req)) return;
    if (!canManage(req)) throw new Error('Nur wer die Verstärkung angefordert hat, kann sie zurücknehmen.');
    SSD.Store.commit('Verstärkung zurückgenommen', (draft) => {
      const target = findDraft(draft, requestId);
      if (!target || target.cancelledAt) return;
      target.cancelledAt = new Date().toISOString();
      target.updatedAt = target.cancelledAt;
      syncTeams(draft, target, true);
    });
  }

  /** Die eingeteilte Person kann nicht kommen. */
  function decline(requestId, personId) {
    if (personId !== actor()) throw new Error('Absagen kann nur die eingeteilte Person selbst.');
    if (!getById(requestId)) throw new Error('Diese Anfrage gibt es nicht mehr.');
    SSD.Store.commit('Verstärkung abgesagt', (draft) => {
      const target = findDraft(draft, requestId);
      const entry = target && activePeople(target).find((p) => p.personId === personId);
      if (!entry || target.cancelledAt) return;
      entry.declinedAt = new Date().toISOString();
      target.updatedAt = entry.declinedAt;
      syncTeams(draft, target, false);
    }, { trackHistory: false });
  }

  /** „Verstanden“ — alle offenen Hinweise der Person als gesehen markieren. */
  function acknowledge(personId) {
    SSD.Store.commit('Verstärkung zur Kenntnis genommen', (draft) => {
      const at = new Date().toISOString();
      (draft.reinforcements || []).forEach((r) => {
        (r.people || []).forEach((p) => { if (p.personId === personId && !p.seenAt) p.seenAt = at; });
      });
    }, { trackHistory: false });
  }

  /* ---------------------------------------------------------------------
   * Abfragen für die Oberfläche
   * ------------------------------------------------------------------- */

  const bySlot = (a, b) => (a.date + a.block).localeCompare(b.date + b.block);

  /** Kommende Einsätze der Person als Verstärkung: [{request, entry}] */
  function upcomingFor(personId) {
    const today = todayIso();
    return all().filter((r) => isOpen(r) && r.date >= today)
      .map((r) => ({ request: r, entry: activePeople(r).find((p) => p.personId === personId) }))
      .filter((x) => x.entry)
      .sort((a, b) => bySlot(a.request, b.request));
  }

  /** Noch nicht bestätigte Einteilungen (Hinweis oben im Dashboard). */
  function unseenFor(personId) {
    return upcomingFor(personId).filter((x) => !x.entry.seenAt);
  }

  /** Eigene aktive Anfragen (ab heute). */
  function requestsBy(personId) {
    const today = todayIso();
    return all().filter((r) => isOpen(r) && r.date >= today && r.requestedBy === personId).sort(bySlot);
  }

  /** Aktive Anfragen für einen Block — für Plan und Wochentabelle. */
  function forSlot(dateIso, block) {
    return all().filter((r) => isOpen(r) && r.date === dateIso && r.block === block);
  }

  /** Eingeteilte Verstärkung eines Blocks (Personen-IDs, ohne Doppelte). */
  function peopleForSlot(dateIso, block) {
    return Array.from(new Set(forSlot(dateIso, block).flatMap((r) => activePeople(r).map((p) => p.personId))));
  }

  /** Wartet die Teams-Meldung noch (ändern fließt noch ein)? Sekunden bis zum Versand oder 0. */
  function teamsGraceLeft(req) {
    if (!req || !req.teams || !SSD.NotificationService.isActive('reinforcement')) return 0;
    const left = TEAMS_GRACE_MS - (Date.now() - new Date(req.teams.at).getTime());
    return left > 0 ? Math.ceil(left / 1000) : 0;
  }

  /** Aufräumen, wenn eine Person gelöscht wird (innerhalb eines Commits). */
  function removePersonFromDraft(draft, id) {
    (draft.reinforcements || []).forEach((r) => {
      r.people = (r.people || []).filter((p) => p.personId !== id);
      if (r.requestedBy === id) r.requestedBy = null;
    });
  }

  return {
    MAX_NOTE, TEAMS_GRACE_MS,
    all, getById, isOpen, activePeople, whenLabel, checkSlot, candidates, canManage,
    create, addPeople, removePerson, cancel, decline, acknowledge,
    upcomingFor, unseenFor, requestsBy, forSlot, peopleForSlot, teamsGraceLeft,
    removePersonFromDraft, teamsText,
  };
})();
