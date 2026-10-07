/**
 * ============================================================================
 * SSD.AutoSubstitutionList — Überblick automatisch eingeteilter Vertretungen
 * ============================================================================
 * Meldet sich jemand selbst ab ("Ich falle aus"), besetzt die App den Dienst
 * sofort neu (siehe `SSD.SelfServiceService.requestSubstitutions`). Diese
 * Karte zeigt Administrator und Team-Leitung, wer kommende Dienste so
 * übernommen hat und ob die eingeteilte Person den Hinweis schon gesehen hat
 * — bei einem Dienst noch heute kann man dann kurz Bescheid geben.
 */
window.SSD = window.SSD || {};

SSD.AutoSubstitutionList = (function () {
  'use strict';

  const U = SSD.Utils;
  const LIMIT = 10;

  function name(id) {
    const person = id && SSD.StudentService.getById(id);
    return person ? SSD.StudentService.fullName(person) : '(gelöscht)';
  }

  /** @returns {HTMLElement|null} `null`, wenn es keine kommenden automatischen Vertretungen gibt. */
  function render() {
    const items = SSD.SelfServiceService.getUpcomingAutoSubstitutions();
    if (!items.length) return null;
    const unseen = items.filter((item) => !item.log.acknowledgedAt).length;

    const rows = items.slice(0, LIMIT).map((item) => {
      const { entry, log } = item;
      const day = U.relativeDayLabel(entry.date);
      return U.el('div', { class: 'member-row' }, [
        U.el('div', { class: 'member-row__main' }, [
          U.el('div', {}, [
            U.el('div', { class: 'cluster gap-2' }, [
              day ? U.el('span', { class: `badge ${day === 'Heute' ? 'badge--danger' : 'badge--warning'}` }, [day]) : null,
              U.el('strong', {}, [`${U.WEEKDAY_LABELS_SHORT[entry.weekday]}, ${U.formatDateShort(U.parseIsoDate(entry.date))} · ${U.blockLabel(entry.block)}`]),
            ]),
            U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [`${name(item.replacementId)} für ${name(item.originalId)}`]),
          ]),
        ]),
        log.acknowledgedAt
          ? U.el('span', { class: 'badge badge--success', 'data-tooltip': `Bestätigt am ${U.formatDateTime(new Date(log.acknowledgedAt))}` }, ['gesehen'])
          : U.el('span', { class: 'badge badge--warning' }, ['noch nicht gesehen']),
      ]);
    });

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Automatisch eingeteilte Vertretungen']),
          U.el('div', { class: 'card__subtitle' }, ['Kommende Dienste, die die App nach einer Abmeldung selbst neu besetzt hat. „Noch nicht gesehen“: Die eingeteilte Person hat den Hinweis noch nicht bestätigt — bei Diensten heute ggf. kurz Bescheid geben.']),
        ]),
        unseen ? U.el('span', { class: 'badge badge--warning' }, [`${unseen} noch nicht gesehen`]) : null,
      ]),
      U.el('div', { class: 'card__body' }, [
        ...rows,
        items.length > LIMIT ? U.el('p', { class: 'text-tertiary', style: 'margin:8px 0 0; font-size:var(--font-size-xs);' }, [`… und ${items.length - LIMIT} weitere (siehe Dienstplan).`]) : null,
      ]),
    ]);
  }

  return { render };
})();
