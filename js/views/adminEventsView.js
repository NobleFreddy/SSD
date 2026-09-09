/**
 * ============================================================================
 * SSD.Views.AdminEvents — außerschulische Veranstaltungen
 * ============================================================================
 * Verwaltung freiwilliger Veranstaltungen (Schulfest, Sporttag, externe
 * Einsätze, …), für die sich Schüler:innen/Azubis im eigenen Bereich selbst
 * eintragen. Bewusst getrennt von der regulären Dienstplan-Ansicht.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminEvents = (function () {
  'use strict';

  const U = SSD.Utils;
  let layoutHandle = null;
  let unsubscribe = null;

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  function formatTimeRange(event) {
    if (event.startTime && event.endTime) return `${event.startTime} – ${event.endTime} Uhr`;
    if (event.startTime) return `ab ${event.startTime} Uhr`;
    return 'Ganztägig';
  }

  /* ---------------------------------------------------------------------
   * Anlegen / Bearbeiten
   * ------------------------------------------------------------------- */

  function openEventModal(existing) {
    const isEdit = !!existing;
    const titleInput = U.el('input', { class: 'input', value: existing?.title || '', placeholder: 'z. B. Schulfest — Sanitätsdienst' });
    const descInput = U.el('textarea', { class: 'input', rows: '3', placeholder: 'Kurze Beschreibung, Treffpunkt, Ausrüstung, …' }, [existing?.description || '']);
    const dateInput = U.el('input', { class: 'input', type: 'date', value: existing?.date || U.toIsoDate(U.today()) });
    const startInput = U.el('input', { class: 'input', type: 'time', value: existing?.startTime || '' });
    const endInput = U.el('input', { class: 'input', type: 'time', value: existing?.endTime || '' });
    const locationInput = U.el('input', { class: 'input', value: existing?.location || '', placeholder: 'z. B. Aula / Sportplatz' });
    const capacityInput = U.el('input', { class: 'input', type: 'number', min: '1', value: existing?.capacity != null ? String(existing.capacity) : '' });
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      field('Titel', titleInput),
      field('Beschreibung (optional)', descInput),
      U.el('div', { class: 'grid grid-cols-3' }, [
        field('Datum', dateInput),
        field('Beginn (optional)', startInput),
        field('Ende (optional)', endInput),
      ]),
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Ort (optional)', locationInput),
        field('Max. Teilnehmerzahl', capacityInput, 'Leer lassen für unbegrenzte Anmeldungen.'),
      ]),
    ]);

    const footerButtons = [{ label: 'Abbrechen', variant: 'secondary' }];
    if (isEdit) {
      footerButtons.push({
        label: 'Löschen', variant: 'danger',
        onClick: async () => {
          const ok = await SSD.Dialog.confirm({ title: 'Veranstaltung löschen', danger: true, message: `"${existing.title}" inkl. aller Anmeldungen wirklich löschen?` });
          if (ok) { SSD.EventsService.remove(existing.id); SSD.Toast.success('Gelöscht', 'Veranstaltung entfernt.'); }
        },
      });
    }
    footerButtons.push({
      label: isEdit ? 'Speichern' : 'Anlegen', variant: 'primary', closeOnClick: false,
      onClick: () => {
        errorBox.style.display = 'none';
        if (!titleInput.value.trim()) { errorBox.textContent = 'Bitte einen Titel angeben.'; errorBox.style.display = 'flex'; return; }
        if (!dateInput.value) { errorBox.textContent = 'Bitte ein Datum angeben.'; errorBox.style.display = 'flex'; return; }
        if (startInput.value && endInput.value && endInput.value <= startInput.value) {
          errorBox.textContent = 'Die Endzeit muss nach der Beginnzeit liegen.'; errorBox.style.display = 'flex'; return;
        }
        const data = {
          title: titleInput.value.trim(),
          description: descInput.value.trim(),
          date: dateInput.value,
          startTime: startInput.value,
          endTime: endInput.value,
          location: locationInput.value.trim(),
          capacity: capacityInput.value ? U.clamp(Number(capacityInput.value), 1, 9999) : null,
        };
        if (isEdit) SSD.EventsService.update(existing.id, data);
        else SSD.EventsService.create(data);
        SSD.Toast.success('Gespeichert', 'Veranstaltung aktualisiert.');
        handle.close();
      },
    });

    const handle = SSD.Dialog.open({ title: isEdit ? 'Veranstaltung bearbeiten' : 'Veranstaltung anlegen', body, wide: true, footerButtons });
  }

  /* ---------------------------------------------------------------------
   * Teilnehmerliste
   * ------------------------------------------------------------------- */

  function openParticipantsModal(event) {
    function renderBody() {
      const fresh = SSD.EventsService.getById(event.id);
      if (!fresh) { SSD.Dialog.close(); return; }
      const participants = SSD.EventsService.getParticipants(fresh);
      const fillText = fresh.capacity != null ? `${participants.length}/${fresh.capacity} Plätze belegt` : `${participants.length} Anmeldung${participants.length === 1 ? '' : 'en'}`;

      const list = U.el('div', { class: 'stack gap-2' });
      if (!participants.length) {
        list.appendChild(U.el('div', { class: 'empty-state' }, [
          U.el('span', { html: SSD.Icons.svg('flag', { size: 36 }) }),
          U.el('h3', {}, ['Noch keine Anmeldungen']),
        ]));
      } else {
        participants.forEach((p) => {
          const removeBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', html: SSD.Icons.svg('x', { size: 14 }), 'data-tooltip': 'Anmeldung entfernen' });
          removeBtn.addEventListener('click', async () => {
            const ok = await SSD.Dialog.confirm({ title: 'Anmeldung entfernen', message: `${SSD.StudentService.fullName(p)} von "${fresh.title}" abmelden?` });
            if (ok) { SSD.EventsService.removeParticipant(fresh.id, p.id); renderBody(); }
          });
          list.appendChild(U.el('div', { class: 'student-picker__item', style: 'border-radius:var(--radius-md); border:1px solid var(--border-subtle);' }, [
            U.el('div', { class: 'avatar avatar--sm', style: `background:${U.colorFromString(p.id)}` }, [U.initials(p.firstName, p.lastName)]),
            U.el('div', { style: 'flex:1;' }, [
              U.el('div', { style: 'font-weight:600; font-size:var(--font-size-sm);' }, [SSD.StudentService.fullName(p), p.role === 'azubi' ? U.el('span', { class: 'badge badge--primary', style: 'margin-left:6px;' }, ['Azubi']) : null]),
              U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [p.schoolClass || '']),
            ]),
            removeBtn,
          ]));
        });
      }

      body.innerHTML = '';
      body.appendChild(U.el('p', { class: 'text-secondary', style: 'margin:0 0 12px;' }, [fillText]));
      body.appendChild(list);
    }

    const body = U.el('div');
    renderBody();
    SSD.Dialog.open({ title: `Teilnehmer:innen — ${event.title}`, body, wide: true, footerButtons: [{ label: 'Schließen', variant: 'secondary' }] });
  }

  /* ---------------------------------------------------------------------
   * Darstellung
   * ------------------------------------------------------------------- */

  function buildEventCard(event, isPast) {
    const participantCount = event.participantIds.length;
    const full = SSD.EventsService.isFull(event);
    const fillBadge = event.capacity != null
      ? U.el('span', { class: `badge ${full ? 'badge--warning' : 'badge--success'}` }, [`${participantCount}/${event.capacity} angemeldet`])
      : U.el('span', { class: 'badge badge--success' }, [`${participantCount} angemeldet`]);

    const editBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', html: SSD.Icons.svg('edit', { size: 15 }), 'data-tooltip': 'Bearbeiten' });
    editBtn.addEventListener('click', () => openEventModal(event));
    const participantsBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('students', { size: 14 }) }, ['Teilnehmer:innen']);
    participantsBtn.addEventListener('click', () => openParticipantsModal(event));

    return U.el('div', { class: `card animate-rise-in${isPast ? '' : ' card--interactive'}`, style: isPast ? 'opacity:0.65;' : '' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'cluster gap-2' }, [
            U.el('div', { class: 'card__title' }, [event.title]),
            isPast ? U.el('span', { class: 'badge' }, ['Vergangen']) : null,
          ]),
          U.el('div', { class: 'card__subtitle' }, [`${U.formatDateLong(U.parseIsoDate(event.date))} · ${formatTimeRange(event)}${event.location ? ` · ${event.location}` : ''}`]),
        ]),
        editBtn,
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        event.description ? U.el('p', { style: 'margin:0;' }, [event.description]) : null,
        U.el('div', { class: 'cluster gap-3', style: 'justify-content:space-between;' }, [fillBadge, participantsBtn]),
      ]),
    ]);
  }

  function buildContent() {
    const events = SSD.EventsService.getAll();
    const todayIso = U.toIsoDate(U.today());
    const upcoming = events.filter((e) => e.date >= todayIso);
    const past = events.filter((e) => e.date < todayIso);

    const frag = U.el('div', { class: 'stack gap-5' });

    if (!upcoming.length) {
      frag.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'empty-state' }, [
          U.el('span', { html: SSD.Icons.svg('flag', { size: 40 }) }),
          U.el('h3', {}, ['Noch keine Veranstaltungen geplant']),
          U.el('p', {}, ['Legen Sie z. B. das nächste Schulfest an, damit sich Schüler:innen und Azubis freiwillig dafür eintragen können.']),
        ]),
      ]));
    } else {
      frag.appendChild(U.el('div', { class: 'stack gap-4' }, upcoming.map((e) => buildEventCard(e, false))));
    }

    if (past.length) {
      frag.appendChild(U.el('h3', { style: 'margin-top:8px;' }, ['Vergangene Veranstaltungen']));
      frag.appendChild(U.el('div', { class: 'stack gap-4' }, past.slice().reverse().map((e) => buildEventCard(e, true))));
    }

    return frag;
  }

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    const addBtn = U.el('button', { class: 'btn btn--primary', html: SSD.Icons.svg('plus', { size: 16 }) }, ['Veranstaltung anlegen']);
    addBtn.addEventListener('click', () => openEventModal(null));

    layoutHandle.contentEl.appendChild(U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [
        U.el('h1', {}, ['Veranstaltungen']),
        U.el('p', {}, ['Außerschulische Veranstaltungen, für die sich Schüler:innen und Azubis freiwillig eintragen können.']),
      ]),
      U.el('div', { class: 'page-header__actions' }, [addBtn]),
    ]));
    layoutHandle.contentEl.appendChild(buildContent());
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'events');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
