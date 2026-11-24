/**
 * ============================================================================
 * SSD.EventReminderService — Teams-Erinnerungen an Veranstaltungen
 * ============================================================================
 * Erzeugt und verschickt werden die Erinnerungen vom Server (Datenbankfunktion
 * `ssd_private.event_reminder_items`, siehe
 * supabase/migrations/20261124_ssd_event_reminders.sql) — auch wenn gerade
 * niemand die App geöffnet hat. Am Datenstand ändert das nichts. Dieses Modul
 * kennt dieselben Regeln, damit die App zeigen kann, was wann gesendet wird;
 * bei Änderungen bitte beide Stellen anpassen.
 *
 * Zwei Arten von Erinnerungen, jeweils zur eingestellten Uhrzeit (Berliner Zeit):
 *  - „event“: kommt immer, nennt auch freie Plätze
 *  - „open“:  kommt zusätzlich, aber nur solange noch nicht alle Plätze belegt sind
 * Fallen beide auf denselben Tag, gibt es nur die erste.
 */
window.SSD = window.SSD || {};

SSD.EventReminderService = (function () {
  'use strict';

  const U = SSD.Utils;
  const TIME_ZONE = 'Europe/Berlin';
  const MAX_DAYS = 60;
  const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  const DAY_OPTIONS = [
    { days: 21, label: '3 Wochen vorher' },
    { days: 14, label: '2 Wochen vorher' },
    { days: 7, label: '1 Woche vorher' },
    { days: 5, label: '5 Tage vorher' },
    { days: 3, label: '3 Tage vorher' },
    { days: 2, label: '2 Tage vorher' },
    { days: 1, label: '1 Tag vorher' },
    { days: 0, label: 'am selben Tag' },
  ];

  /* ---------------------------------------------------------------------
   * Einstellungen
   * ------------------------------------------------------------------- */

  function cleanDays(list, fallback) {
    if (!Array.isArray(list)) return fallback.slice();
    const days = list.filter((d) => Number.isInteger(d) && d >= 0 && d <= MAX_DAYS);
    return Array.from(new Set(days)).sort((a, b) => b - a);
  }

  function config() {
    const defaults = SSD.Models.createDefaultEventReminderSettings();
    const stored = ((SSD.Store.getState().settings || {}).teams || {}).eventReminders || {};
    return {
      enabled: stored.enabled !== false,
      days: cleanDays(stored.days, defaults.days),
      openDays: cleanDays(stored.openDays, defaults.openDays),
      time: TIME_PATTERN.test(stored.time || '') ? stored.time : defaults.time,
    };
  }

  /** Auswählbare Uhrzeiten (halbstündlich, 6 bis 21 Uhr), eine abweichende eingestellte bleibt enthalten. */
  function timeOptions(current) {
    const list = [];
    for (let h = 6; h <= 21; h++) ['00', '30'].forEach((m) => { if (h < 21 || m === '00') list.push(`${String(h).padStart(2, '0')}:${m}`); });
    if (TIME_PATTERN.test(current || '') && !list.includes(current)) list.push(current);
    return list.sort();
  }

  /** Werden derzeit Erinnerungen an Teams gesendet? */
  function isActive() {
    const teams = (SSD.Store.getState().settings || {}).teams || {};
    const cfg = config();
    return !!teams.enabled && cfg.enabled && (cfg.days.length > 0 || cfg.openDays.length > 0);
  }

  /* ---------------------------------------------------------------------
   * Anmeldestand
   * ------------------------------------------------------------------- */

  /** Freie Plätze; `null`, wenn die Teilnehmerzahl nicht begrenzt ist. */
  function freePlaces(event) {
    return event.capacity == null ? null : Math.max(0, event.capacity - event.participantIds.length);
  }

  /** Noch nicht alle angemeldet: freie Plätze bzw. (ohne Begrenzung) noch nicht das ganze Team. */
  function isIncomplete(event) {
    const free = freePlaces(event);
    if (free != null) return free > 0;
    const team = SSD.Store.getState().students.filter((s) => s.active && !s.pendingApproval).length;
    return event.participantIds.length < team;
  }

  /* ---------------------------------------------------------------------
   * Termine der Erinnerungen — als „JJJJ-MM-TTTHH:MM“ in Berliner Zeit, damit
   * Vergleiche unabhängig von der Zeitzone des Geräts sind.
   * ------------------------------------------------------------------- */

  function berlinKey(date) {
    if (!date || isNaN(date.getTime())) return null;
    const parts = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }

  /** Alle Erinnerungen einer Veranstaltung (auch bereits vergangene), früheste zuerst. */
  function planFor(event) {
    const cfg = config();
    if (!cfg.enabled || !DATE_PATTERN.test(event.date || '')) return [];
    const startKey = `${event.date}T${TIME_PATTERN.test(event.startTime || '') ? event.startTime : '23:59'}`;
    const createdKey = event.createdAt ? berlinKey(new Date(event.createdAt)) : null;
    const always = new Set(cfg.days);
    return Array.from(new Set(cfg.days.concat(cfg.openDays)))
      .map((days) => {
        const dueDate = U.toIsoDate(U.addDays(U.parseIsoDate(event.date), -days));
        return { event, days, kind: always.has(days) ? 'event' : 'open', dueDate, time: cfg.time, dueKey: `${dueDate}T${cfg.time}` };
      })
      // Nicht nach Beginn und nicht für Zeitpunkte, zu denen es die Veranstaltung noch nicht gab.
      .filter((r) => r.dueKey < startKey && (!createdKey || createdKey <= r.dueKey))
      .sort((a, b) => a.dueKey.localeCompare(b.dueKey));
  }

  /** Nach jetzigem Anmeldestand noch anstehende Erinnerungen, nächste zuerst. */
  function upcoming(options) {
    const opts = options || {};
    const nowKey = berlinKey(opts.now || new Date());
    const events = opts.event ? [opts.event] : SSD.EventsService.getAll();
    const list = events
      .flatMap((event) => planFor(event))
      .filter((r) => r.dueKey > nowKey && (r.kind === 'event' || isIncomplete(r.event)))
      .sort((a, b) => a.dueKey.localeCompare(b.dueKey) || a.event.title.localeCompare(b.event.title));
    return opts.limit ? list.slice(0, opts.limit) : list;
  }

  function nextFor(event, now) {
    return upcoming({ event, now, limit: 1 })[0] || null;
  }

  /** „Do, 26.11., 16:00 Uhr“ */
  function whenLabel(reminder) {
    const day = U.parseIsoDate(reminder.dueDate);
    return `${day.toLocaleDateString('de-DE', { weekday: 'short' })}, ${U.formatDateShort(day)}, ${reminder.time} Uhr`;
  }

  return { DAY_OPTIONS, timeOptions, config, isActive, freePlaces, isIncomplete, planFor, upcoming, nextFor, whenLabel };
})();
