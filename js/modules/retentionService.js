/**
 * ============================================================================
 * SSD.RetentionService — Aufbewahrungsfristen (Speicherbegrenzung)
 * ============================================================================
 * Personenbezogene Daten werden nur so lange gespeichert, wie sie gebraucht
 * werden (Art. 5 Abs. 1 lit. e DSGVO):
 *   - Dienste, Dienstverlauf, Teamtreffen, Veranstaltungen, erledigte
 *     Aufgaben und Materialanfragen eines Schuljahres (1.8.–31.7.) werden
 *     `graceMonths` Monate nach Schuljahresende gelöscht — vorher lassen sich
 *     noch die Engagement-Nachweise drucken.
 *   - Abgelaufene Pinnwand-Beiträge nach 30 Tagen, Registrierungen, die nie
 *     freigeschaltet wurden, nach 30 Tagen, Teams-Meldungen nach 30 Tagen.
 * Läuft automatisch, sobald der Administrator die App öffnet (abschaltbar),
 * oder per Knopfdruck in den Einstellungen.
 */
window.SSD = window.SSD || {};

SSD.RetentionService = (function () {
  'use strict';

  const U = SSD.Utils;
  const SHORT_DAYS = 30;
  let checkedThisSession = false;

  SSD.EventBus.on('auth:changed', () => { checkedThisSession = false; });

  function settings() {
    return Object.assign(SSD.Models.createDefaultRetentionSettings(), SSD.Store.getState().settings.retention || {});
  }

  function graceMonths() {
    return U.clamp(Math.round(Number(settings().graceMonths)), 0, 12) || 0;
  }

  /** 1. August des Schuljahres, in dem `date` liegt. */
  function schoolYearStart(date) {
    return new Date(U.schoolYearEnd(date) - 1, 7, 1);
  }

  /**
   * Stichtag: Alles, was davor liegt, ist abgelaufen. Bis `graceMonths` nach
   * Beginn des neuen Schuljahres bleibt das vorherige Schuljahr erhalten.
   */
  function cutoffDate(ref) {
    const today = ref || U.today();
    const start = schoolYearStart(today);
    const deadline = new Date(start.getFullYear(), start.getMonth() + graceMonths(), 1);
    return today >= deadline ? start : new Date(start.getFullYear() - 1, 7, 1);
  }

  /** Wann die Daten des laufenden Schuljahres gelöscht werden (für Hinweise). */
  function nextDeletionDate(ref) {
    const today = ref || U.today();
    const start = schoolYearStart(today);
    const thisYearsDeadline = new Date(start.getFullYear(), start.getMonth() + graceMonths(), 1);
    if (today < thisYearsDeadline) return thisYearsDeadline; // das Vorjahr wird bald gelöscht
    return new Date(start.getFullYear() + 1, 7 + graceMonths(), 1);
  }

  function day(ts) {
    return ts ? String(ts).slice(0, 10) : '';
  }

  /** Was derzeit abgelaufen ist — für Vorschau und Löschung. */
  function findExpired(stateArg, ref) {
    const state = stateArg || SSD.Store.getState();
    const today = ref || U.today();
    const cutoff = U.toIsoDate(cutoffDate(today));
    const shortCutoff = U.toIsoDate(U.addDays(today, -SHORT_DAYS));
    const outboxCutoff = new Date(today.getTime() - SHORT_DAYS * 86400000).toISOString();

    const result = {
      cutoff,
      scheduleEntries: (state.schedule.entries || []).filter((e) => e.date && e.date < cutoff).map((e) => e.id),
      dutyLogEntries: state.students.reduce((n, s) => n + (s.dutyLog || []).filter((l) => l.date && l.date < cutoff).length, 0),
      meetings: (state.meetings || []).filter((m) => m.date && m.date < cutoff).map((m) => m.id),
      events: (state.events || []).filter((e) => e.date && e.date < cutoff).map((e) => e.id),
      tasks: (state.tasks || []).filter((t) => t.status === 'done' && day(t.completedAt || t.createdAt) < cutoff).map((t) => t.id),
      materials: (state.materials || []).filter((m) => m.status === 'erledigt' && day(m.updatedAt || m.requestedAt) < cutoff).map((m) => m.id),
      announcements: (state.announcements || []).filter((a) => (a.visibleUntil ? a.visibleUntil < shortCutoff : day(a.createdAt) < cutoff)).map((a) => a.id),
      pendingRegistrations: state.students.filter((s) => s.pendingApproval && day(s.createdAt) && day(s.createdAt) < shortCutoff).map((s) => s.id),
      teamsOutbox: (state.teamsOutbox || []).filter((n) => n.at && n.at < outboxCutoff).length,
    };
    result.total = result.scheduleEntries.length + result.dutyLogEntries + result.meetings.length + result.events.length
      + result.tasks.length + result.materials.length + result.announcements.length + result.pendingRegistrations.length + result.teamsOutbox;
    return result;
  }

  /** Löscht alles Abgelaufene. Gibt die Anzahl gelöschter Einträge zurück. */
  function apply() {
    if (!SSD.Auth.isAdminSession()) throw new Error('Nur der Administrator kann Daten bereinigen.');
    const expired = findExpired();
    if (!expired.total) return 0;
    const drop = (list, ids) => (list || []).filter((x) => !ids.includes(x.id));
    const outboxCutoff = new Date(U.today().getTime() - SHORT_DAYS * 86400000).toISOString();

    SSD.Store.commit(`Aufbewahrungsfrist: ${expired.total} alte Einträge gelöscht`, (draft) => {
      draft.schedule.entries = drop(draft.schedule.entries, expired.scheduleEntries);
      draft.students.forEach((s) => {
        s.dutyLog = (s.dutyLog || []).filter((l) => !(l.date && l.date < expired.cutoff));
      });
      draft.meetings = drop(draft.meetings, expired.meetings);
      draft.events = drop(draft.events, expired.events);
      draft.tasks = drop(draft.tasks, expired.tasks);
      draft.materials = drop(draft.materials, expired.materials);
      draft.announcements = drop(draft.announcements, expired.announcements);
      expired.pendingRegistrations.forEach((id) => SSD.StudentService.removeFromDraft(draft, id));
      draft.teamsOutbox = (draft.teamsOutbox || []).filter((n) => !(n.at && n.at < outboxCutoff));
      draft.settings.retention = Object.assign({}, draft.settings.retention, { lastRunAt: new Date().toISOString() });
    });
    return expired.total;
  }

  /** Beim Öffnen der Administration: einmal pro Sitzung automatisch bereinigen (falls eingeschaltet). */
  function autoApplyIfDue() {
    if (checkedThisSession || !SSD.Auth.isAdminSession() || !SSD.Store.isLoaded()) return 0;
    checkedThisSession = true;
    if (settings().auto === false) return 0;
    const count = apply();
    if (count) SSD.Toast.info('Alte Daten gelöscht', `${count} Einträge haben die Aufbewahrungsfrist überschritten und wurden gelöscht (Einstellungen → Aufbewahrung).`);
    return count;
  }

  return { settings, graceMonths, cutoffDate, nextDeletionDate, findExpired, apply, autoApplyIfDue };
})();
