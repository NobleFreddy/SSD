/**
 * ============================================================================
 * SSD.AnnouncementBoard — Pinnwand (Anzeige + Bearbeitung)
 * ============================================================================
 * Eine Komponente für alle: Sanis/Azubis sehen die aktuellen Beiträge oben in
 * ihrem Dashboard, die Team-Koordination (Administrator, Sanisprecher:innen)
 * sieht zusätzlich "Neuer Beitrag", Bearbeiten/Löschen (eigene bzw. als
 * Administrator alle) und die abgelaufenen Beiträge.
 */
window.SSD = window.SSD || {};

SSD.AnnouncementBoard = (function () {
  'use strict';

  const U = SSD.Utils;
  const COLLAPSED_COUNT = 3;
  let expanded = false; // "Alle anzeigen" — gilt bis zum Neuladen der Seite

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  function showError(box, err) {
    box.textContent = String(err.message || err);
    box.style.display = 'flex';
  }

  /**
   * Dialog "Beitrag verfassen/bearbeiten".
   * @param {object|null} existing
   * @param {Function} [onChange] - nach dem Speichern/Löschen (z. B. Dashboard neu zeichnen)
   */
  function openEditor(existing, onChange) {
    const S = SSD.AnnouncementsService;
    const isEdit = !!existing;
    const titleInput = U.el('input', { class: 'input', value: existing?.title || '', maxlength: String(S.MAX_TITLE_LENGTH), placeholder: 'z. B. Teamtreffen verschoben' });
    const textInput = U.el('textarea', { class: 'input', rows: '6', maxlength: String(S.MAX_TEXT_LENGTH), placeholder: 'Mitteilung an alle Sanis und Azubis …' }, [existing?.text || '']);
    const untilInput = U.el('input', { class: 'input', type: 'date', min: U.toIsoDate(U.today()), value: existing?.visibleUntil || '' });
    const importantInput = U.el('input', { type: 'checkbox', checked: !!existing?.important });
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      field('Titel', titleInput),
      field('Text (optional)', textInput),
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Sichtbar bis (optional)', untilInput, 'Danach verschwindet der Beitrag für die Sanis automatisch.'),
        U.el('div', { class: 'field' }, [
          U.el('span', { class: 'field__label' }, ['Hervorheben']),
          U.el('label', { class: 'checkbox-row', style: 'margin-top:8px;' }, [importantInput, 'Wichtig — oben anheften']),
        ]),
      ]),
      U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, ['Der Beitrag erscheint nach dem Anmelden oben im Dashboard aller aktiven Sanis und Azubis.']),
    ]);

    const footerButtons = [{ label: 'Abbrechen', variant: 'secondary' }];
    if (isEdit) {
      footerButtons.push({
        label: 'Löschen', variant: 'danger', closeOnClick: false,
        onClick: async () => {
          const ok = await SSD.Dialog.confirm({ title: 'Beitrag löschen', danger: true, message: `"${existing.title}" wirklich von der Pinnwand löschen?` });
          if (!ok) return;
          try {
            S.remove(existing.id);
            SSD.Toast.success('Gelöscht', 'Der Beitrag wurde entfernt.');
            handle.close();
            if (onChange) onChange();
          } catch (err) {
            showError(errorBox, err);
          }
        },
      });
    }
    footerButtons.push({
      label: isEdit ? 'Speichern' : 'Veröffentlichen', variant: 'primary', closeOnClick: false,
      onClick: () => {
        errorBox.style.display = 'none';
        const data = { title: titleInput.value, text: textInput.value, visibleUntil: untilInput.value || null, important: importantInput.checked };
        try {
          if (isEdit) S.update(existing.id, data);
          else S.create(data);
        } catch (err) {
          showError(errorBox, err);
          return;
        }
        SSD.Toast.success(isEdit ? 'Gespeichert' : 'Veröffentlicht', isEdit ? 'Der Beitrag wurde aktualisiert.' : 'Der Beitrag ist jetzt auf der Pinnwand.');
        handle.close();
        if (onChange) onChange();
      },
    });

    const handle = SSD.Dialog.open({ title: isEdit ? 'Beitrag bearbeiten' : 'Neuer Pinnwand-Beitrag', body, wide: true, footerButtons });
  }

  function postEl(post, ctx) {
    const S = SSD.AnnouncementsService;
    const expired = !S.isVisible(post);
    const edited = post.updatedAt && post.createdAt && post.updatedAt.slice(0, 16) !== post.createdAt.slice(0, 16);
    const metaParts = [`${S.authorLabel(post)} · ${U.formatDateMedium(new Date(post.createdAt))}${edited ? ' (bearbeitet)' : ''}`];
    if (ctx.coordinator && post.visibleUntil) metaParts.push(`${expired ? 'sichtbar bis' : 'sichtbar bis einschl.'} ${U.formatDateMedium(U.parseIsoDate(post.visibleUntil))}`);

    const actions = [];
    if (S.canManage(post)) {
      const editBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Bearbeiten', 'aria-label': 'Bearbeiten', html: SSD.Icons.svg('edit', { size: 14 }) });
      editBtn.addEventListener('click', () => openEditor(post, ctx.onChange));
      const deleteBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Löschen', 'aria-label': 'Löschen', html: SSD.Icons.svg('trash', { size: 14 }) });
      deleteBtn.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({ title: 'Beitrag löschen', danger: true, message: `"${post.title}" wirklich von der Pinnwand löschen?` });
        if (!ok) return;
        try {
          S.remove(post.id);
          SSD.Toast.success('Gelöscht', 'Der Beitrag wurde entfernt.');
        } catch (err) {
          SSD.Toast.error('Nicht möglich', String(err.message || err));
        }
        if (ctx.onChange) ctx.onChange();
      });
      actions.push(editBtn, deleteBtn);
    }

    return U.el('article', { class: `board-post${post.important ? ' board-post--important' : ''}${expired ? ' board-post--expired' : ''}` }, [
      U.el('div', { class: 'board-post__head' }, [
        U.el('div', {}, [
          U.el('div', { class: 'board-post__title' }, [
            post.important ? U.el('span', { class: 'board-post__pin', html: SSD.Icons.svg('pin', { size: 15 }) }) : null,
            U.el('span', {}, [post.title]),
            expired ? U.el('span', { class: 'badge' }, ['Abgelaufen']) : null,
          ]),
          U.el('div', { class: 'board-post__meta' }, [metaParts.join(' · ')]),
        ]),
        actions.length ? U.el('div', { class: 'cluster gap-1' }, actions) : null,
      ]),
      post.text ? U.el('p', { class: 'board-post__text' }, [post.text]) : null,
    ]);
  }

  /**
   * @param {{ onChange?: Function, showAll?: boolean }} [opts]
   *   showAll: keine Kürzung auf die neuesten Beiträge (Administrator-Ansicht "Team").
   * @returns {HTMLElement|null} `null`, wenn es für Nicht-Koordinator:innen nichts anzuzeigen gibt.
   */
  function render(opts) {
    const cfg = opts || {};
    const S = SSD.AnnouncementsService;
    const coordinator = SSD.Auth.canCoordinate();
    const visible = S.getVisible();
    if (!visible.length && !coordinator) return null;

    const ctx = { coordinator, onChange: cfg.onChange };
    // Bewusst ohne Einblend-Animation: Das Dashboard zeichnet die Pinnwand nach jeder Aktion neu.
    const card = U.el('section', { class: 'card board', 'aria-label': 'Pinnwand' });

    let addBtn = null;
    if (coordinator) {
      addBtn = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('plus', { size: 14 }) }, ['Neuer Beitrag']);
      addBtn.addEventListener('click', () => openEditor(null, cfg.onChange));
    }
    card.appendChild(U.el('div', { class: 'card__header' }, [
      U.el('div', { class: 'board__heading' }, [
        U.el('span', { class: 'board__icon', html: SSD.Icons.svg('megaphone', { size: 18 }) }),
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Pinnwand']),
          coordinator ? U.el('div', { class: 'card__subtitle' }, ['Mitteilungen für alle Sanis und Azubis — erscheinen oben in deren Dashboard.']) : null,
        ]),
      ]),
      addBtn,
    ]));

    const body = U.el('div', { class: 'card__body' });
    if (!visible.length) {
      body.appendChild(U.el('p', { class: 'text-tertiary', style: 'margin:0;' }, ['Aktuell keine Beiträge. Neue Beiträge sehen alle Sanis und Azubis direkt nach dem Anmelden.']));
    } else {
      const showAll = cfg.showAll || expanded;
      const shown = showAll ? visible : visible.slice(0, COLLAPSED_COUNT);
      body.appendChild(U.el('div', {}, shown.map((post) => postEl(post, ctx))));
      if (!cfg.showAll && visible.length > COLLAPSED_COUNT) {
        const toggle = U.el('button', { class: 'btn btn--ghost btn--sm', style: 'margin-top:8px;' }, [
          expanded ? 'Weniger anzeigen' : `Alle ${visible.length} Beiträge anzeigen`,
        ]);
        toggle.addEventListener('click', () => {
          expanded = !expanded;
          card.replaceWith(render(cfg));
        });
        body.appendChild(toggle);
      }
    }

    if (coordinator) {
      const expired = S.getExpired();
      if (expired.length) {
        body.appendChild(U.el('details', { class: 'collapsible', style: 'margin-top:12px;' }, [
          U.el('summary', {}, [`Abgelaufene Beiträge (${expired.length})`]),
          U.el('div', { style: 'margin-top:8px;' }, expired.map((post) => postEl(post, ctx))),
        ]));
      }
    }
    card.appendChild(body);
    return card;
  }

  return { render, openEditor };
})();
