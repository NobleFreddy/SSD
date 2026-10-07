/**
 * ============================================================================
 * SSD.Views.AdminCalendar — Sondertage & Dienstzeiten-Konfiguration
 * ============================================================================
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminCalendar = (function () {
  'use strict';

  const U = SSD.Utils;
  let layoutHandle = null;
  let unsubscribe = null;

  function openSpecialDayModal(existing) {
    const isEdit = !!existing;
    const typeSelect = U.el('select', { class: 'select' }, SSD.Models.SPECIAL_DAY_TYPES.map((t) => U.el('option', { value: t.key, selected: existing?.type === t.key }, [t.label])));
    const labelInput = U.el('input', { class: 'input', value: existing?.label || '', placeholder: 'z. B. Herbstferien' });
    const startInput = U.el('input', { class: 'input', type: 'date', value: existing?.startDate || U.toIsoDate(U.today()) });
    const endInput = U.el('input', { class: 'input', type: 'date', value: existing?.endDate || U.toIsoDate(U.today()) });
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, ['Art des Tages']), typeSelect]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, ['Bezeichnung (optional)']), labelInput]),
      U.el('div', { class: 'grid grid-cols-2' }, [
        U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, ['Von']), startInput]),
        U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, ['Bis']), endInput]),
      ]),
      U.el('p', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, ['An diesen Tagen werden automatisch keine Dienste eingeplant. Für einen einzelnen Tag "Von" und "Bis" gleich setzen.']),
    ]);

    const footerButtons = [{ label: 'Abbrechen', variant: 'secondary' }];
    if (isEdit) {
      footerButtons.push({
        label: 'Löschen', variant: 'danger',
        onClick: () => { SSD.CalendarService.remove(existing.id); SSD.Toast.success('Gelöscht', 'Sondertag entfernt.'); },
      });
    }
    footerButtons.push({
      label: isEdit ? 'Speichern' : 'Anlegen', variant: 'primary', closeOnClick: false,
      onClick: () => {
        errorBox.style.display = 'none';
        if (!startInput.value || !endInput.value) {
          // Ein leeres Startdatum würde sonst jeden Tag bis zum Enddatum sperren.
          errorBox.textContent = 'Bitte Start- und Enddatum angeben.';
          errorBox.style.display = 'flex';
          return;
        }
        if (endInput.value < startInput.value) {
          errorBox.textContent = 'Das Enddatum darf nicht vor dem Startdatum liegen.';
          errorBox.style.display = 'flex';
          return;
        }
        const data = { type: typeSelect.value, label: labelInput.value.trim(), startDate: startInput.value, endDate: endInput.value };
        if (isEdit) SSD.CalendarService.update(existing.id, data);
        else SSD.CalendarService.create(data);
        SSD.Toast.success('Gespeichert', 'Kalendereintrag aktualisiert.');
        handle.close();
      },
    });

    const handle = SSD.Dialog.open({ title: isEdit ? 'Sondertag bearbeiten' : 'Sondertag anlegen', body, footerButtons });
  }

  function buildSpecialDaysCard() {
    const days = SSD.CalendarService.getAll();
    const addBtn = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('plus', { size: 15 }) }, ['Sondertag hinzufügen']);
    addBtn.addEventListener('click', () => openSpecialDayModal(null));

    const card = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Sondertage']),
          U.el('div', { class: 'card__subtitle' }, ['Ferien, Feiertage, Projekt-/Wander-/Klausur-/Studientage']),
        ]),
        addBtn,
      ]),
    ]);
    const body = U.el('div', { class: 'card__body' });

    if (!days.length) {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('span', { html: SSD.Icons.svg('calendar', { size: 40 }) }),
        U.el('h3', {}, ['Noch keine Sondertage erfasst']),
        U.el('p', {}, ['Legen Sie z. B. die nächsten Ferien an, damit an diesen Tagen automatisch keine Dienste geplant werden.']),
      ]));
    } else {
      const table = U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'data-table' }, [
          U.el('thead', {}, [U.el('tr', {}, [U.el('th', {}, ['Art']), U.el('th', {}, ['Bezeichnung']), U.el('th', {}, ['Zeitraum']), U.el('th', { style: 'text-align:right' }, ['Aktionen'])])]),
          U.el('tbody', {}, days.map((day) => {
            const typeDef = SSD.Models.SPECIAL_DAY_TYPES.find((t) => t.key === day.type);
            const editBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', html: SSD.Icons.svg('edit', { size: 15 }) });
            editBtn.addEventListener('click', () => openSpecialDayModal(day));
            const deleteBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', html: SSD.Icons.svg('trash', { size: 15 }) });
            deleteBtn.addEventListener('click', async () => {
              const ok = await SSD.Dialog.confirm({ title: 'Löschen', danger: true, message: 'Diesen Sondertag wirklich löschen?' });
              if (ok) SSD.CalendarService.remove(day.id);
            });
            const range = day.startDate === day.endDate
              ? U.formatDateMedium(U.parseIsoDate(day.startDate))
              : `${U.formatDateMedium(U.parseIsoDate(day.startDate))} – ${U.formatDateMedium(U.parseIsoDate(day.endDate))}`;
            return U.el('tr', {}, [
              U.el('td', {}, [U.el('span', { class: 'day-type-pill', style: `background:${typeDef.color}22; color:${typeDef.color};` }, [typeDef.label])]),
              U.el('td', {}, [day.label || '—']),
              U.el('td', {}, [range]),
              U.el('td', {}, [U.el('div', { class: 'data-table__actions' }, [editBtn, deleteBtn])]),
            ]);
          })),
        ]),
      ]);
      body.appendChild(table);
    }
    card.appendChild(body);
    return card;
  }

  function buildDutyBlockCard() {
    const card = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Dienstzeiten']),
          U.el('div', { class: 'card__subtitle' }, ['Pro Wochentag einzeln aktivierbare Dienstblöcke']),
        ]),
      ]),
    ]);
    const body = U.el('div', { class: 'card__body' });
    const grid = U.el('div', { class: 'week-grid' });
    grid.appendChild(U.el('div', {}));
    U.WEEKDAY_KEYS.forEach((day) => grid.appendChild(U.el('div', { class: 'week-grid__day-head' }, [U.WEEKDAY_LABELS[day]])));

    U.DUTY_BLOCKS.forEach((block) => {
      grid.appendChild(U.el('div', { class: 'week-grid__block-label' }, [block.label]));
      U.WEEKDAY_KEYS.forEach((day) => {
        const cellWrap = U.el('div', { style: 'display:flex; align-items:center; justify-content:center; padding:10px;' });
        const checkbox = U.el('input', { type: 'checkbox' });
        checkbox.checked = SSD.CalendarService.isBlockEnabled(day, block.key);
        const switchLabel = U.el('label', { class: 'switch' }, [checkbox, U.el('span', { class: 'switch__track' })]);
        checkbox.addEventListener('change', () => SSD.CalendarService.setBlockEnabled(day, block.key, checkbox.checked));
        cellWrap.appendChild(switchLabel);
        grid.appendChild(cellWrap);
      });
    });
    body.appendChild(grid);
    card.appendChild(body);
    return card;
  }

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    layoutHandle.contentEl.appendChild(U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [U.el('h1', {}, ['Kalender']), U.el('p', {}, ['Sondertage und Dienstzeiten für die automatische Planung.'])]),
    ]));
    layoutHandle.contentEl.appendChild(buildDutyBlockCard());
    layoutHandle.contentEl.appendChild(buildSpecialDaysCard());
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'calendar');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
