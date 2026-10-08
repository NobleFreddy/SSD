/**
 * ============================================================================
 * SSD.MeetingsPanel — Teamtreffen (Anzeige, Zu-/Absagen, Anwesenheit)
 * ============================================================================
 * Eine Komponente für alle Rollen:
 *   - Sanis/Azubis (`viewer` gesetzt): kommende Treffen mit "Ich komme" /
 *     "Ich kann nicht", vergangene Treffen mit dem eigenen Anwesenheitsstatus.
 *   - Team-Koordination (Administrator, Sanisprecher:innen): zusätzlich
 *     anlegen/bearbeiten/löschen, Namen der Zu-/Absagen und Anwesenheit
 *     erfassen. Sanisprecher:innen sind selbst auch eingeladen und antworten
 *     wie alle anderen.
 */
window.SSD = window.SSD || {};

SSD.MeetingsPanel = (function () {
  'use strict';

  const U = SSD.Utils;
  const PAST_LIMIT = 8;

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  function showError(box, err) {
    box.textContent = String(err.message || err);
    box.style.display = 'flex';
  }

  function names(persons) {
    return persons.map((p) => SSD.StudentService.fullName(p)).join(', ');
  }

  /* ---------------------------------------------------------------------
   * Dialoge
   * ------------------------------------------------------------------- */

  function openEditor(existing, onChange) {
    const M = SSD.MeetingsService;
    const isEdit = !!existing;
    const titleInput = U.el('input', { class: 'input', value: existing?.title || '', placeholder: 'z. B. Teamtreffen zum Halbjahresbeginn' });
    const dateInput = U.el('input', { class: 'input', type: 'date', value: existing?.date || U.toIsoDate(U.today()) });
    const startInput = U.el('input', { class: 'input', type: 'time', value: existing?.startTime || '' });
    const endInput = U.el('input', { class: 'input', type: 'time', value: existing?.endTime || '' });
    const locationInput = U.el('input', { class: 'input', value: existing?.location || '', placeholder: 'z. B. Sanitätsraum' });
    const agendaInput = U.el('textarea', { class: 'input', rows: '4', placeholder: 'Themen, Mitbringen, …' }, [existing?.agenda || '']);
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });
    const teamsActive = SSD.NotificationService.isActive('meeting');

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      field('Titel', titleInput),
      U.el('div', { class: 'grid grid-cols-3' }, [
        field('Datum', dateInput),
        field('Beginn (optional)', startInput),
        field('Ende (optional)', endInput),
      ]),
      field('Ort (optional)', locationInput),
      field('Tagesordnung (optional)', agendaInput),
      U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, [
        'Eingeladen sind alle aktiven Sanis und Azubis. Sie sehen das Treffen im Reiter „Teamtreffen“ und sagen dort zu oder ab.',
        teamsActive ? (isEdit
          ? ' Ändern sich bei einem kommenden Treffen Datum, Uhrzeit oder Ort, wird das im Teams-Kanal gemeldet.'
          : ' Kommende Treffen werden außerdem im Teams-Kanal angekündigt.') : '',
      ]),
    ]);

    const footerButtons = [{ label: 'Abbrechen', variant: 'secondary' }];
    if (isEdit) {
      footerButtons.push({
        label: 'Löschen', variant: 'danger', closeOnClick: false,
        onClick: async () => {
          const announced = teamsActive && existing.date >= U.toIsoDate(U.today());
          const ok = await SSD.Dialog.confirm({
            title: 'Teamtreffen löschen', danger: true,
            message: `"${existing.title}" inkl. aller Zu-/Absagen und der Anwesenheit wirklich löschen?${announced ? ' Die Absage wird im Teams-Kanal gemeldet.' : ''}`,
          });
          if (!ok) return;
          try {
            M.remove(existing.id);
            SSD.Toast.success('Gelöscht', 'Das Teamtreffen wurde entfernt.');
            handle.close();
            if (onChange) onChange();
          } catch (err) {
            showError(errorBox, err);
          }
        },
      });
    }
    footerButtons.push({
      label: isEdit ? 'Speichern' : 'Anlegen', variant: 'primary', closeOnClick: false,
      onClick: () => {
        errorBox.style.display = 'none';
        const data = {
          title: titleInput.value, date: dateInput.value, startTime: startInput.value, endTime: endInput.value,
          location: locationInput.value, agenda: agendaInput.value,
        };
        try {
          if (isEdit) M.update(existing.id, data);
          else M.create(data);
        } catch (err) {
          showError(errorBox, err);
          return;
        }
        SSD.Toast.success('Gespeichert', isEdit ? 'Das Teamtreffen wurde aktualisiert.' : 'Alle Sanis und Azubis sehen das Treffen jetzt in ihrem Dashboard.');
        handle.close();
        if (onChange) onChange();
      },
    });

    const handle = SSD.Dialog.open({ title: isEdit ? 'Teamtreffen bearbeiten' : 'Neues Teamtreffen', body, wide: true, footerButtons });
  }

  function openAttendance(meeting, onChange) {
    const M = SSD.MeetingsService;
    const invitees = M.getInvitees();
    const inviteeIds = new Set(invitees.map((p) => p.id));
    // Inzwischen inaktive Personen bleiben sichtbar, wenn sie als anwesend erfasst waren.
    const former = (meeting.attendeeIds || [])
      .filter((id) => !inviteeIds.has(id))
      .map((id) => SSD.StudentService.getById(id))
      .filter(Boolean);
    const people = invitees.concat(former);
    const summary = M.summarize(meeting);
    const preset = meeting.attendanceTaken ? new Set(meeting.attendeeIds) : new Set(summary.yes.map((p) => p.id));

    const counter = U.el('strong', {});
    const boxes = people.map((person) => {
      const input = U.el('input', { type: 'checkbox', checked: preset.has(person.id), 'data-id': person.id });
      input.addEventListener('change', updateCounter);
      const status = M.getResponse(meeting, person.id);
      const hint = status === 'yes' ? 'hat zugesagt' : (status === 'no' ? 'hat abgesagt' : '');
      return {
        input,
        el: U.el('label', { class: 'checkbox-row' }, [
          input,
          U.el('span', {}, [SSD.StudentService.fullName(person)]),
          hint ? U.el('span', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [`· ${hint}`]) : null,
          person.active ? null : U.el('span', { class: 'badge' }, ['inaktiv']),
        ]),
      };
    });
    function updateCounter() {
      counter.textContent = `${boxes.filter((b) => b.input.checked).length} von ${people.length} anwesend`;
    }
    function setAll(predicate) {
      boxes.forEach((b) => { b.input.checked = predicate(b.input.getAttribute('data-id')); });
      updateCounter();
    }
    updateCounter();

    const allBtn = U.el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, ['Alle']);
    allBtn.addEventListener('click', () => setAll(() => true));
    const noneBtn = U.el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, ['Keine']);
    noneBtn.addEventListener('click', () => setAll(() => false));
    const yesIds = new Set(summary.yes.map((p) => p.id));
    const yesBtn = U.el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, ['Nur Zusagen']);
    yesBtn.addEventListener('click', () => setAll((id) => yesIds.has(id)));
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const body = U.el('div', { class: 'stack gap-3' }, [
      errorBox,
      U.el('p', { style: 'margin:0;' }, [`${meeting.title} — ${M.whenText(meeting)}`]),
      U.el('div', { class: 'cluster gap-2', style: 'justify-content:space-between;' }, [counter, U.el('div', { class: 'cluster gap-1' }, [allBtn, noneBtn, yesBtn])]),
      people.length
        ? U.el('div', { class: 'attendance-list' }, boxes.map((b) => b.el))
        : U.el('p', { class: 'text-tertiary' }, ['Noch keine aktiven Mitglieder im Team.']),
      meeting.attendanceTaken ? null : U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, ['Vorausgewählt sind alle, die zugesagt haben.']),
    ]);

    const handle = SSD.Dialog.open({
      title: 'Anwesenheit erfassen', body, wide: true,
      footerButtons: [
        { label: 'Abbrechen', variant: 'secondary' },
        {
          label: 'Speichern', variant: 'primary', closeOnClick: false,
          onClick: () => {
            try {
              const count = M.setAttendance(meeting.id, boxes.filter((b) => b.input.checked).map((b) => b.input.getAttribute('data-id')));
              SSD.Toast.success('Anwesenheit gespeichert', `${count} Person(en) als anwesend erfasst.`);
              handle.close();
              if (onChange) onChange();
            } catch (err) {
              showError(errorBox, err);
            }
          },
        },
      ],
    });
  }

  /* ---------------------------------------------------------------------
   * Karten
   * ------------------------------------------------------------------- */

  function responseButtons(meeting, viewer, onChange) {
    const M = SSD.MeetingsService;
    const current = M.getResponse(meeting, viewer.id);
    function makeBtn(status, label, icon, activeVariant) {
      const isActive = current === status;
      const btn = U.el('button', {
        class: `btn btn--sm ${isActive ? activeVariant : 'btn--secondary'}`,
        'aria-pressed': isActive ? 'true' : 'false',
        html: SSD.Icons.svg(icon, { size: 14 }),
      }, [label]);
      btn.addEventListener('click', () => {
        if (isActive) return;
        try {
          M.respond(meeting.id, viewer.id, status);
          SSD.Toast.show({ type: 'success', title: 'Gespeichert', message: status === 'yes' ? 'Sie haben zugesagt.' : 'Sie haben abgesagt.', duration: 2000 });
        } catch (err) {
          SSD.Toast.error('Nicht möglich', String(err.message || err));
        }
        if (onChange) onChange();
      });
      return btn;
    }
    return U.el('div', { class: 'cluster gap-2' }, [
      makeBtn('yes', 'Ich komme', 'check', 'btn--success'),
      makeBtn('no', 'Ich kann nicht', 'x', 'btn--danger'),
    ]);
  }

  function coordinatorActions(meeting, ctx, isPast) {
    const M = SSD.MeetingsService;
    const actions = [];
    if (meeting.date <= U.toIsoDate(U.today())) {
      const attendanceBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('checkCircle', { size: 14 }) }, [
        meeting.attendanceTaken ? 'Anwesenheit bearbeiten' : 'Anwesenheit erfassen',
      ]);
      attendanceBtn.addEventListener('click', () => openAttendance(meeting, ctx.onChange));
      actions.push(attendanceBtn);
    }
    if (M.canManage(meeting)) {
      const editBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Bearbeiten', 'aria-label': 'Bearbeiten', html: SSD.Icons.svg('edit', { size: 14 }) });
      editBtn.addEventListener('click', () => openEditor(meeting, ctx.onChange));
      actions.push(editBtn);
      if (isPast) {
        const deleteBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Löschen', 'aria-label': 'Löschen', html: SSD.Icons.svg('trash', { size: 14 }) });
        deleteBtn.addEventListener('click', async () => {
          const ok = await SSD.Dialog.confirm({ title: 'Teamtreffen löschen', danger: true, message: `"${meeting.title}" inkl. Anwesenheit wirklich löschen? Es zählt dann auch nicht mehr in der Engagement-Übersicht.` });
          if (!ok) return;
          try {
            M.remove(meeting.id);
            SSD.Toast.success('Gelöscht', 'Das Teamtreffen wurde entfernt.');
          } catch (err) {
            SSD.Toast.error('Nicht möglich', String(err.message || err));
          }
          if (ctx.onChange) ctx.onChange();
        });
        actions.push(deleteBtn);
      }
    }
    return actions;
  }

  function upcomingCard(meeting, ctx) {
    const M = SSD.MeetingsService;
    const isToday = meeting.date === U.toIsoDate(U.today());
    const summary = M.summarize(meeting);
    const myStatus = ctx.viewer ? M.getResponse(meeting, ctx.viewer.id) : null;

    let statusBadge = null;
    if (ctx.viewer) {
      statusBadge = myStatus === 'yes'
        ? U.el('span', { class: 'badge badge--success' }, ['Zugesagt'])
        : (myStatus === 'no' ? U.el('span', { class: 'badge' }, ['Abgesagt']) : U.el('span', { class: 'badge badge--warning' }, ['Antwort fehlt']));
    }

    const body = U.el('div', { class: 'card__body stack gap-3' }, [
      meeting.agenda ? U.el('p', { class: 'pre-wrap', style: 'margin:0; color:var(--text-primary);' }, [meeting.agenda]) : null,
      U.el('div', { class: 'cluster gap-2' }, [
        U.el('span', { class: 'badge badge--success' }, [`${summary.yes.length} Zusage${summary.yes.length === 1 ? '' : 'n'}`]),
        U.el('span', { class: 'badge' }, [`${summary.no.length} Absage${summary.no.length === 1 ? '' : 'n'}`]),
        U.el('span', { class: 'badge badge--warning' }, [`${summary.open.length} ohne Antwort`]),
      ]),
    ]);

    if (ctx.coordinator) {
      const lines = [
        ['Zusagen', summary.yes], ['Absagen', summary.no], ['Ohne Antwort', summary.open],
      ].filter(([, list]) => list.length).map(([label, list]) => U.el('p', { style: 'margin:4px 0 0; font-size:var(--font-size-sm);' }, [
        U.el('strong', {}, [`${label}: `]), names(list),
      ]));
      if (lines.length) {
        body.appendChild(U.el('details', { class: 'collapsible' }, [U.el('summary', {}, ['Namen anzeigen']), U.el('div', {}, lines)]));
      }
    }

    const footerLeft = ctx.viewer ? responseButtons(meeting, ctx.viewer, ctx.onChange) : U.el('span');
    const footerRight = ctx.coordinator ? coordinatorActions(meeting, ctx, false) : [];
    body.appendChild(U.el('div', { class: 'cluster gap-2', style: 'justify-content:space-between;' }, [
      footerLeft,
      footerRight.length ? U.el('div', { class: 'cluster gap-1' }, footerRight) : null,
    ]));

    return U.el('div', { class: 'card animate-rise-in' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, [meeting.title]),
          U.el('div', { class: 'card__subtitle' }, [M.whenText(meeting)]),
          ctx.coordinator ? U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs); margin-top:2px;' }, [`Angelegt von ${M.creatorLabel(meeting)}`]) : null,
        ]),
        U.el('div', { class: 'cluster gap-2' }, [
          isToday ? U.el('span', { class: 'badge badge--primary' }, ['Heute']) : null,
          statusBadge,
        ]),
      ]),
      body,
    ]);
  }

  function pastRow(meeting, ctx) {
    const M = SSD.MeetingsService;
    const right = [];
    if (ctx.viewer && !ctx.coordinator) {
      const own = M.attendanceOf(meeting, ctx.viewer.id);
      right.push(own === 'present'
        ? U.el('span', { class: 'badge badge--success' }, ['Anwesend'])
        : (own === 'absent' ? U.el('span', { class: 'badge' }, ['Nicht anwesend']) : U.el('span', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, ['Anwesenheit nicht erfasst'])));
    }
    if (ctx.coordinator) {
      right.push(meeting.attendanceTaken
        ? U.el('span', { class: 'badge badge--success' }, [`${(meeting.attendeeIds || []).length} anwesend`])
        : U.el('span', { class: 'badge badge--warning' }, ['Anwesenheit fehlt']));
      right.push(...coordinatorActions(meeting, ctx, true));
    }
    return U.el('div', { class: 'member-row' }, [
      U.el('div', {}, [
        U.el('strong', {}, [meeting.title]),
        U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [M.whenText(meeting)]),
      ]),
      U.el('div', { class: 'cluster gap-2' }, right),
    ]);
  }

  /**
   * @param {{ viewer?: object|null, onChange?: Function }} [opts]
   *   viewer: angemeldete Schüler:in/Azubi (für Zu-/Absagen) — `null` beim Administrator.
   */
  function render(opts) {
    const cfg = opts || {};
    const M = SSD.MeetingsService;
    const ctx = { viewer: cfg.viewer || null, coordinator: SSD.Auth.canCoordinate(), onChange: cfg.onChange };
    const upcoming = M.getUpcoming();
    const past = M.getPast();
    const wrap = U.el('div', { class: 'stack gap-4' });

    if (ctx.coordinator) {
      const addBtn = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('plus', { size: 14 }) }, ['Neues Teamtreffen']);
      addBtn.addEventListener('click', () => openEditor(null, cfg.onChange));
      wrap.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card__header' }, [
          U.el('div', {}, [
            U.el('div', { class: 'card__title' }, ['Teamtreffen']),
            U.el('div', { class: 'card__subtitle' }, ['Eingeladen sind alle aktiven Sanis und Azubis. Nach dem Treffen die Anwesenheit erfassen — sie zählt in der Engagement-Übersicht.']),
          ]),
          addBtn,
        ]),
      ]));
    }

    if (!upcoming.length) {
      wrap.appendChild(U.el('div', { class: 'card animate-rise-in' }, [
        U.el('div', { class: 'empty-state' }, [
          U.el('span', { html: SSD.Icons.svg('calendarCheck', { size: 40 }) }),
          U.el('h3', {}, ['Aktuell keine Teamtreffen geplant']),
          ctx.coordinator ? null : U.el('p', {}, ['Sobald ein Treffen angesetzt ist, können Sie hier zu- oder absagen.']),
        ]),
      ]));
    } else {
      upcoming.forEach((meeting) => wrap.appendChild(upcomingCard(meeting, ctx)));
    }

    const pastShown = past.slice(0, PAST_LIMIT);
    if (pastShown.length) {
      wrap.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card__header' }, [
          U.el('div', {}, [
            U.el('div', { class: 'card__title' }, ['Vergangene Treffen']),
            past.length > PAST_LIMIT ? U.el('div', { class: 'card__subtitle' }, [`Die letzten ${PAST_LIMIT} von ${past.length}`]) : null,
          ]),
        ]),
        U.el('div', { class: 'card__body' }, pastShown.map((meeting) => pastRow(meeting, ctx))),
      ]));
    }
    return wrap;
  }

  return { render, openEditor, openAttendance };
})();
