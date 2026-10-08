/**
 * ============================================================================
 * SSD.Views.AdminMaterials — Materialliste
 * ============================================================================
 * Verwaltung der von Sanis/Azubis dokumentierten, zu bestellenden Materials
 * (siehe SSD.MaterialService). Der Administrator kann jeden Eintrag
 * bearbeiten, den Status setzen und löschen.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminMaterials = (function () {
  'use strict';

  const U = SSD.Utils;
  let layoutHandle = null;
  let unsubscribe = null;

  const STATUS_OPTIONS = [
    { key: 'offen', label: 'Offen' },
    { key: 'bestellt', label: 'Bestellt' },
    { key: 'erledigt', label: 'Erledigt' },
  ];
  const STATUS_BADGE_CLASS = { offen: 'badge--warning', bestellt: 'badge--primary', erledigt: 'badge--success' };

  function field(labelText, inputEl) {
    return U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
  }

  /* ---------------------------------------------------------------------
   * Anlegen / Bearbeiten
   * ------------------------------------------------------------------- */

  function openMaterialModal(existing) {
    const isEdit = !!existing;
    const nameInput = U.el('input', { class: 'input', value: existing?.name || '', placeholder: 'z. B. Einmalhandschuhe Größe M' });
    const quantityInput = U.el('input', { class: 'input', value: existing?.quantity || '', placeholder: 'z. B. 2 Packungen' });
    const noteInput = U.el('textarea', { class: 'input', rows: '2', placeholder: U.FREE_TEXT_HINT }, [existing?.note || '']);
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      field('Bezeichnung', nameInput),
      field('Menge (optional)', quantityInput),
      field('Notiz (optional)', noteInput),
    ]);

    const footerButtons = [
      { label: 'Abbrechen', variant: 'secondary' },
      {
        label: isEdit ? 'Speichern' : 'Anlegen', variant: 'primary', closeOnClick: false,
        onClick: () => {
          errorBox.style.display = 'none';
          if (!nameInput.value.trim()) { errorBox.textContent = 'Bitte eine Bezeichnung angeben.'; errorBox.style.display = 'flex'; return; }
          const data = { name: nameInput.value.trim(), quantity: quantityInput.value.trim(), note: noteInput.value.trim() };
          if (isEdit) SSD.MaterialService.update(existing.id, data);
          else SSD.MaterialService.create(data);
          SSD.Toast.success('Gespeichert', 'Material-Eintrag aktualisiert.');
          handle.close();
        },
      },
    ];

    const handle = SSD.Dialog.open({ title: isEdit ? 'Material-Eintrag bearbeiten' : 'Material-Eintrag hinzufügen', body, wide: true, footerButtons });
  }

  /* ---------------------------------------------------------------------
   * Tabelle
   * ------------------------------------------------------------------- */

  function buildTable() {
    const items = SSD.MaterialService.getAll();
    if (!items.length) {
      return U.el('div', { class: 'empty-state' }, [
        U.el('span', { html: SSD.Icons.svg('box', { size: 40 }) }),
        U.el('h3', {}, ['Noch keine Material-Anfragen']),
        U.el('p', {}, ['Sobald Sanis oder Azubis Material anfragen, erscheint es hier.']),
      ]);
    }

    const rows = items.map((item) => {
      const requester = item.requestedBy ? SSD.StudentService.getById(item.requestedBy) : null;
      const requesterLabel = item.requestedBy ? (requester ? SSD.StudentService.fullName(requester) : '(gelöscht)') : 'Administrator';

      const statusSelect = U.el('select', { class: 'select' }, STATUS_OPTIONS.map((s) => U.el('option', { value: s.key, selected: item.status === s.key }, [s.label])));
      statusSelect.addEventListener('change', () => SSD.MaterialService.setStatus(item.id, statusSelect.value));

      const editBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Bearbeiten', html: SSD.Icons.svg('edit', { size: 15 }) });
      editBtn.addEventListener('click', () => openMaterialModal(item));
      const deleteBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Löschen', html: SSD.Icons.svg('trash', { size: 15 }) });
      deleteBtn.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({ title: 'Material-Eintrag löschen', danger: true, message: `"${item.name}" wirklich löschen?` });
        if (ok) { SSD.MaterialService.remove(item.id); SSD.Toast.success('Gelöscht', 'Eintrag entfernt.'); }
      });

      return U.el('tr', {}, [
        U.el('td', {}, [U.el('div', { style: 'font-weight:600;' }, [item.name]), item.note ? U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [item.note]) : null]),
        U.el('td', {}, [item.quantity || '—']),
        U.el('td', {}, [
          U.el('div', {}, [requesterLabel]),
          U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [U.formatDateMedium(new Date(item.requestedAt))]),
        ]),
        U.el('td', {}, [U.el('span', { class: `badge ${STATUS_BADGE_CLASS[item.status] || ''}`, style: 'margin-bottom:4px; display:inline-block;' }, [STATUS_OPTIONS.find((s) => s.key === item.status)?.label || item.status]), statusSelect]),
        U.el('td', {}, [U.el('div', { class: 'data-table__actions' }, [editBtn, deleteBtn])]),
      ]);
    });

    return U.el('div', { class: 'table-wrap' }, [
      U.el('table', { class: 'data-table' }, [
        U.el('thead', {}, [U.el('tr', {}, [
          U.el('th', {}, ['Material']), U.el('th', {}, ['Menge']), U.el('th', {}, ['Angefragt von']), U.el('th', {}, ['Status']), U.el('th', { style: 'text-align:right' }, ['Aktionen']),
        ])]),
        U.el('tbody', {}, rows),
      ]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------- */

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    const addBtn = U.el('button', { class: 'btn btn--primary', html: SSD.Icons.svg('plus', { size: 16 }) }, ['Eintrag hinzufügen']);
    addBtn.addEventListener('click', () => openMaterialModal(null));

    layoutHandle.contentEl.appendChild(U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [
        U.el('h1', {}, ['Materialliste']),
        U.el('p', {}, ['Von Sanis und Azubis dokumentiertes, zu bestellendes Material.']),
      ]),
      U.el('div', { class: 'page-header__actions' }, [addBtn]),
    ]));
    layoutHandle.contentEl.appendChild(U.el('div', { class: 'card' }, [U.el('div', { class: 'card__body' }, [buildTable()])]));
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'materials');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
