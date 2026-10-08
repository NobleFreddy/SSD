/**
 * ============================================================================
 * SSD.NotificationService — Meldungen für Microsoft Teams
 * ============================================================================
 * Meldenswerte Änderungen (Dienstplan, Vertretungen, Teamtreffen,
 * Veranstaltungen, Aufgaben, Material) werden als lesbarer Text in `state.teamsOutbox`
 * abgelegt — immer innerhalb des Speichervorgangs der eigentlichen Änderung
 * (`add(draft, …)` im Commit-Mutator), damit kein zusätzlicher Save entsteht
 * und ein Rückgängig-Machen die Meldung automatisch wieder entfernt.
 *
 * Versendet wird serverseitig: Ein pg_cron-Job in Supabase sammelt neue
 * Einträge und schickt sie gebündelt an den Teams-Workflow, dessen geheime
 * Adresse nur im Supabase Vault liegt (siehe README, "Teams-Benachrichtigungen").
 */
window.SSD = window.SSD || {};

SSD.NotificationService = (function () {
  'use strict';

  const U = SSD.Utils;
  const MAX_OUTBOX = 100;

  const CATEGORIES = [
    { key: 'schedule', label: 'Dienstplan', hint: 'Neu erstellt oder übertragen, Lücken aufgefüllt, manuelle Änderungen an kommenden Diensten.' },
    { key: 'substitution', label: 'Vertretungen', hint: 'Vertretungen eingetragen, „Vertretung gesucht“, offene Dienste selbst übernommen.' },
    { key: 'meeting', label: 'Teamtreffen', hint: 'Neue Treffen sowie Verlegungen und Absagen kommender Treffen (einzelne Zu-/Absagen nicht).' },
    { key: 'event', label: 'Veranstaltungen', hint: 'Neu angelegt, geändert, gelöscht oder automatisch aufgefüllt (einzelne An-/Abmeldungen nicht).' },
    { key: 'task', label: 'Aufgaben', hint: 'Neue Aufgaben, erledigt, wieder geöffnet.' },
    { key: 'material', label: 'Material', hint: 'Neue Materialanfragen und Statusänderungen.' },
  ];

  /**
   * Name in Teams-Meldungen — standardmäßig datensparsam "Lena C." (Einstellung
   * "Namen in den Nachrichten"), auf Wunsch der volle Name.
   */
  function personName(id) {
    const s = id && SSD.StudentService.getById(id);
    if (!s) return '(gelöscht)';
    const teams = (SSD.Store.getState().settings || {}).teams || {};
    if (teams.nameStyle === 'full') return SSD.StudentService.fullName(s);
    const initial = String(s.lastName || '').trim().charAt(0);
    return initial ? `${s.firstName} ${initial}.` : s.firstName;
  }

  function names(ids) {
    const list = (ids || []).filter(Boolean).map(personName);
    return list.length ? list.join(' & ') : 'niemand';
  }

  function actorName() {
    const session = SSD.Auth.getSession();
    if (!session) return '';
    if (session.role === 'admin') return SSD.Store.getState().admin?.username || 'Administrator';
    return personName(session.studentId);
  }

  /** „Mo, 05.10., 3./4. Stunde“ */
  function dutyLabel(entry) {
    return `${U.WEEKDAY_LABELS_SHORT[entry.weekday]}, ${U.formatDateShort(U.parseIsoDate(entry.date))}, ${U.blockLabel(entry.block)}`;
  }

  function isUpcoming(dateIso) {
    return dateIso >= U.toIsoDate(U.today());
  }

  /** Überschrift + Detailzeilen (max. `max`, Rest als „… und N weitere“) als mehrzeiliger Meldungstext. */
  function withDetails(headline, details, max = 8) {
    const shown = details.slice(0, max);
    if (details.length > max) shown.push(`… und ${details.length - max} weitere`);
    return [headline, ...shown].join('\n');
  }

  /**
   * Legt eine Meldung ab — nur innerhalb eines `SSD.Store.commit`-Mutators
   * aufrufen. Ohne aktive Teams-Anbindung oder bei abgeschalteter Kategorie
   * passiert nichts.
   */
  function add(draft, category, text) {
    const teams = draft.settings && draft.settings.teams;
    if (!teams || !teams.enabled) return;
    if (category !== 'test' && teams.categories && teams.categories[category] === false) return;
    if (!Array.isArray(draft.teamsOutbox)) draft.teamsOutbox = [];
    draft.teamsOutbox.push({ id: U.generateId('ntf'), at: new Date().toISOString(), category, text, by: actorName() });
    if (draft.teamsOutbox.length > MAX_OUTBOX) draft.teamsOutbox.splice(0, draft.teamsOutbox.length - MAX_OUTBOX);
  }

  /** Wird eine Meldung dieser Kategorie derzeit an Teams gemeldet? (für Hinweise in der Oberfläche) */
  function isActive(category) {
    const teams = SSD.Store.getState().settings.teams;
    return !!(teams && teams.enabled && !(teams.categories && teams.categories[category] === false));
  }

  /** Testmeldung — wird serverseitig ohne Sammel-Wartezeit verschickt. */
  function sendTest() {
    SSD.Store.commit('Teams-Testnachricht', (draft) => {
      add(draft, 'test', 'Testnachricht aus dem Dienstplan — die Teams-Anbindung funktioniert.');
    }, { trackHistory: false });
  }

  return { CATEGORIES, add, isActive, sendTest, dutyLabel, names, personName, isUpcoming, withDetails };
})();
