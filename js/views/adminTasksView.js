/**
 * ============================================================================
 * SSD.Views.AdminTasks — Sonstige Aufgaben
 * ============================================================================
 * Verwaltung von Aufgaben abseits des regulären Dienstplans, die als
 * offener Pool für alle Sanis/Azubis sichtbar sind (siehe SSD.TasksService).
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminTasks = (function () {
  'use strict';

  const U = SSD.Utils;
  let layoutHandle = null;
  let unsubscribe = null;

  /* ---------------------------------------------------------------------
   * Tabellen
   * ------------------------------------------------------------------- */

  function dueBadge(task) {
    if (!task.dueDate) return null;
    const todayIso = U.toIsoDate(U.today());
    const overdue = task.status === 'open' && task.dueDate < todayIso;
    return U.el('span', { class: `badge ${overdue ? 'badge--danger' : ''}` }, [
      `${overdue ? 'Überfällig: ' : 'Fällig: '}${U.formatDateMedium(U.parseIsoDate(task.dueDate))}`,
    ]);
  }

  function buildOpenTable(tasks) {
    if (!tasks.length) {
      return U.el('div', { class: 'empty-state' }, [
        U.el('span', { html: SSD.Icons.svg('check', { size: 40 }) }),
        U.el('h3', {}, ['Keine offenen Aufgaben']),
        U.el('p', {}, ['Legen Sie eine Aufgabe an, damit Sanis und Azubis sie in ihrem Dashboard sehen und erledigen können.']),
      ]);
    }
    const rows = tasks.map((task) => {
      const editBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Bearbeiten', html: SSD.Icons.svg('edit', { size: 15 }) });
      editBtn.addEventListener('click', () => SSD.TaskEditor.open(task));
      const deleteBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Löschen', html: SSD.Icons.svg('trash', { size: 15 }) });
      deleteBtn.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({ title: 'Aufgabe löschen', danger: true, message: `"${task.title}" wirklich löschen?` });
        if (ok) { SSD.TasksService.remove(task.id); SSD.Toast.success('Gelöscht', 'Aufgabe entfernt.'); }
      });
      return U.el('tr', {}, [
        U.el('td', {}, [
          U.el('div', { style: 'font-weight:600;' }, [task.title]),
          task.description ? U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [task.description]) : null,
          task.createdBy ? U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [`Angelegt von ${SSD.TaskEditor.creatorLabel(task)}`]) : null,
        ]),
        U.el('td', {}, [dueBadge(task) || '—']),
        U.el('td', {}, [U.el('div', { class: 'data-table__actions' }, [editBtn, deleteBtn])]),
      ]);
    });
    return U.el('div', { class: 'table-wrap' }, [
      U.el('table', { class: 'data-table' }, [
        U.el('thead', {}, [U.el('tr', {}, [U.el('th', {}, ['Aufgabe']), U.el('th', {}, ['Fälligkeit']), U.el('th', { style: 'text-align:right' }, ['Aktionen'])])]),
        U.el('tbody', {}, rows),
      ]),
    ]);
  }

  function buildDoneTable(tasks) {
    if (!tasks.length) return null;
    const rows = tasks.map((task) => {
      const person = task.completedBy ? SSD.StudentService.getById(task.completedBy) : null;
      const personLabel = task.completedBy ? (person ? SSD.StudentService.fullName(person) : '(gelöscht)') : '—';
      const reopenBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Wieder öffnen', html: SSD.Icons.svg('undo', { size: 15 }) });
      reopenBtn.addEventListener('click', () => { SSD.TasksService.reopen(task.id); SSD.Toast.info('Wieder geöffnet', `"${task.title}" ist wieder offen.`); });
      const deleteBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Löschen', html: SSD.Icons.svg('trash', { size: 15 }) });
      deleteBtn.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({ title: 'Aufgabe löschen', danger: true, message: `"${task.title}" wirklich löschen?` });
        if (ok) { SSD.TasksService.remove(task.id); SSD.Toast.success('Gelöscht', 'Aufgabe entfernt.'); }
      });
      return U.el('tr', {}, [
        U.el('td', {}, [task.title]),
        U.el('td', {}, [personLabel]),
        U.el('td', {}, [task.completedAt ? U.formatDateMedium(new Date(task.completedAt)) : '—']),
        U.el('td', {}, [U.el('div', { class: 'data-table__actions' }, [reopenBtn, deleteBtn])]),
      ]);
    });
    return U.el('div', { class: 'table-wrap' }, [
      U.el('table', { class: 'data-table' }, [
        U.el('thead', {}, [U.el('tr', {}, [U.el('th', {}, ['Aufgabe']), U.el('th', {}, ['Erledigt von']), U.el('th', {}, ['Erledigt am']), U.el('th', { style: 'text-align:right' }, ['Aktionen'])])]),
        U.el('tbody', {}, rows),
      ]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------- */

  function buildContent() {
    const all = SSD.TasksService.getAll();
    const open = all.filter((t) => t.status === 'open');
    const done = all.filter((t) => t.status === 'done');

    const frag = U.el('div', { class: 'stack gap-5' });
    frag.appendChild(U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Offene Aufgaben'])]),
      U.el('div', { class: 'card__body' }, [buildOpenTable(open)]),
    ]));
    const doneTable = buildDoneTable(done);
    if (doneTable) {
      frag.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Erledigte Aufgaben'])]),
        U.el('div', { class: 'card__body' }, [doneTable]),
      ]));
    }
    return frag;
  }

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    const addBtn = U.el('button', { class: 'btn btn--primary', html: SSD.Icons.svg('plus', { size: 16 }) }, ['Aufgabe anlegen']);
    addBtn.addEventListener('click', () => SSD.TaskEditor.open(null));

    layoutHandle.contentEl.appendChild(U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [
        U.el('h1', {}, ['Aufgaben']),
        U.el('p', {}, ['Sonstige Aufgaben für Sanis und Azubis — offener Pool, jede:r Berechtigte kann sie erledigen. Auch die Sanisprecher:innen können Aufgaben anlegen.']),
      ]),
      U.el('div', { class: 'page-header__actions' }, [addBtn]),
    ]));
    layoutHandle.contentEl.appendChild(buildContent());
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'tasks');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
