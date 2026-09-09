/**
 * ============================================================================
 * SSD.ScheduleTable — wiederverwendbare Dienstplan-Wochentabelle
 * ============================================================================
 * Rendert die Mo–Fr × Blöcke-Tabelle mit Farbkodierung, Azubi-Kennzeichnung
 * und Konflikt-/Vertretungs-Badges. Wird sowohl im Admin-Bereich (mit Klick-
 * zum-Bearbeiten) als auch im schreibgeschützten Schüler:innen-/Azubi-
 * Dienstplan verwendet — dieselbe Darstellung, damit beide Seiten exakt
 * dasselbe "Bild" vom Dienstplan haben.
 */
window.SSD = window.SSD || {};

SSD.ScheduleTable = (function () {
  'use strict';

  const U = SSD.Utils;

  function findEntry(dateIso, block) {
    return SSD.Store.getState().schedule.entries.find((e) => e.date === dateIso && e.block === block) || null;
  }

  /**
   * @param {Date} monday
   * @param {{
   *   onCellClick?: (dateIso:string, weekday:string, block:string) => void,
   *   highlightPersonId?: string,
   * }} [options]
   */
  function render(monday, options = {}) {
    const dates = U.getWeekDates(monday);
    const settings = SSD.SettingsService.get();
    const table = U.el('table', { class: 'schedule-table' });
    const interactive = typeof options.onCellClick === 'function';

    const headRow = U.el('tr', {}, [U.el('th', {})].concat(dates.map((d, i) => U.el('th', {}, [
      U.WEEKDAY_LABELS[U.WEEKDAY_KEYS[i]],
      U.el('span', { class: 'date' }, [U.formatDateMedium(d)]),
    ]))));
    table.appendChild(U.el('thead', {}, [headRow]));

    const tbody = U.el('tbody');
    U.DUTY_BLOCKS.forEach((block) => {
      const row = U.el('tr', {}, [U.el('td', { class: 'row-label' }, [block.short, U.el('span', {}, [block.label])])]);

      dates.forEach((date, i) => {
        const weekday = U.WEEKDAY_KEYS[i];
        const dateIso = U.toIsoDate(date);
        const td = U.el('td');
        const enabled = SSD.CalendarService.isBlockEnabled(weekday, block.key);
        const specialDay = SSD.CalendarService.getSpecialDayForDate(dateIso);

        if (!enabled || specialDay) {
          const label = specialDay ? SSD.Models.SPECIAL_DAY_TYPES.find((t) => t.key === specialDay.type).label : 'Kein Dienst';
          td.appendChild(U.el('div', { class: 'duty-cell duty-cell--disabled' }, [U.el('div', { class: 'duty-cell__empty-label' }, [label])]));
        } else {
          const entry = findEntry(dateIso, block.key);
          const ids = entry ? entry.studentIds : [];
          const azubiId = entry ? entry.azubiId : null;
          const cls = SSD.Scheduler.classifyDuty(ids, settings.studentsPerDuty);
          const isMine = options.highlightPersonId && (ids.includes(options.highlightPersonId) || azubiId === options.highlightPersonId);

          const cellAttrs = {
            class: `duty-cell duty-cell--${cls}${isMine ? ' duty-cell--mine' : ''}`,
          };
          if (interactive) {
            cellAttrs.tabindex = '0';
            cellAttrs.role = 'button';
            cellAttrs['aria-label'] = `Dienst bearbeiten: ${U.WEEKDAY_LABELS[weekday]} ${block.label}`;
            cellAttrs['data-tooltip'] = 'Klicken zum Bearbeiten';
          }
          const cell = U.el('div', cellAttrs);

          if (cls === 'conflict') cell.appendChild(U.el('div', { class: 'duty-cell__conflict-icon', html: SSD.Icons.svg('warning', { size: 14 }) }));
          if (entry?.substitutionLog?.length) {
            const lastSub = entry.substitutionLog[entry.substitutionLog.length - 1];
            cell.appendChild(U.el('div', {
              style: 'position:absolute; top:6px; left:6px; color:var(--color-primary); display:flex;',
              'data-tooltip': `Vertretung: ${SSD.SubstitutionService.studentName(lastSub.originalStudentId)} → ${lastSub.replacementStudentId ? SSD.SubstitutionService.studentName(lastSub.replacementStudentId) : 'unbesetzt'}`,
              html: SSD.Icons.svg('userSearch', { size: 12 }),
            }));
          }
          if (entry?.substitutionRequests?.length) {
            const names = entry.substitutionRequests.map((r) => SSD.SubstitutionService.studentName(r.studentId)).join(', ');
            cell.appendChild(U.el('div', {
              style: 'position:absolute; top:6px; left:22px; color:var(--color-warning-600); display:flex;',
              'data-tooltip': `Vertretung gesucht: ${names}`,
              html: SSD.Icons.svg('handRaised', { size: 12 }),
            }));
          }
          if (!ids.length) {
            cell.appendChild(U.el('div', { class: 'duty-cell__empty-label' }, ['Frei']));
          } else {
            ids.forEach((id) => {
              const s = SSD.StudentService.getById(id);
              cell.appendChild(U.el('div', { class: 'duty-cell__student' }, [
                U.el('span', { html: SSD.Icons.svg(s?.gender === 'w' ? 'female' : s?.gender === 'm' ? 'male' : 'user') }),
                U.el('span', {}, [s ? SSD.StudentService.fullName(s) : '(gelöscht)']),
              ]));
            });
            if (ids.length < settings.studentsPerDuty) {
              cell.appendChild(U.el('div', { class: 'duty-cell__empty-label' }, [`${settings.studentsPerDuty - ids.length} Platz frei`]));
            }
          }
          if (azubiId) {
            const azubi = SSD.StudentService.getById(azubiId);
            cell.appendChild(U.el('div', { class: 'duty-cell__student duty-cell__student--azubi' }, [
              U.el('span', { class: 'badge badge--primary', style: 'font-size:0.6rem; padding:1px 6px;' }, ['Azubi']),
              U.el('span', {}, [azubi ? SSD.StudentService.fullName(azubi) : '(gelöscht)']),
            ]));
          }

          if (interactive) {
            const openEditor = () => options.onCellClick(dateIso, weekday, block.key);
            cell.addEventListener('click', openEditor);
            cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor(); } });
          }
          td.appendChild(cell);
        }
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return U.el('div', { class: 'schedule-table-wrap' }, [table]);
  }

  function renderLegend() {
    const items = [
      ['var(--duty-mixed-border)', 'Mädchen + Junge'],
      ['var(--duty-boys-border)', 'Zwei Jungen'],
      ['var(--duty-girls-border)', 'Zwei Mädchen'],
      ['var(--duty-conflict-border)', 'Konflikt / unvollständig'],
      ['var(--duty-empty-border)', 'Frei / nicht geplant'],
    ];
    return U.el('div', { class: 'legend' }, items.map(([color, label]) => U.el('div', { class: 'legend__item' }, [
      U.el('span', { class: 'legend__swatch', style: `background:${color}` }), label,
    ])));
  }

  return { render, renderLegend, findEntry };
})();
