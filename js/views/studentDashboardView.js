/**
 * ============================================================================
 * SSD.Views.StudentDashboard — Schülerbereich
 * ============================================================================
 * Zeigt ausschließlich die eigenen Daten: persönlicher Verfügbarkeits-
 * Stundenplan, bisherige/zukünftige Dienste, Änderungsfrist und persönliche
 * Hinweise des Administrators. Änderungen werden sofort automatisch
 * gespeichert (kein separater "Speichern"-Button nötig).
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.StudentDashboard = (function () {
  'use strict';

  const U = SSD.Utils;
  const OPTION_DEFS = [
    { key: 'available', label: 'Verfügbar' },
    { key: 'unavailable', label: 'Nicht verfügbar' },
    { key: 'blocked', label: 'Gesperrt' },
  ];

  function applyStoredTheme() {
    let theme = 'light';
    try { theme = localStorage.getItem('ssd_theme_pref') || 'light'; } catch (err) { /* ignore */ }
    document.documentElement.setAttribute('data-theme', theme);
    return theme;
  }

  function buildTopbar(student) {
    const theme = applyStoredTheme();
    const themeToggle = U.el('button', {
      class: 'btn btn--icon btn--ghost', 'data-tooltip': 'Dark Mode umschalten',
      html: SSD.Icons.svg(theme === 'dark' ? 'sun' : 'moon'),
      onClick: () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('ssd_theme_pref', next); } catch (err) { /* ignore */ }
        themeToggle.innerHTML = SSD.Icons.svg(next === 'dark' ? 'sun' : 'moon');
      },
    });
    const logoutBtn = U.el('button', { class: 'btn btn--secondary topbar__logout-btn', html: SSD.Icons.svg('logout', { size: 16 }) }, [
      U.el('span', { class: 'btn__label' }, ['Abmelden']),
    ]);
    logoutBtn.addEventListener('click', async () => {
      const ok = await SSD.Dialog.confirm({ title: 'Abmelden', message: 'Möchten Sie sich wirklich abmelden?', confirmLabel: 'Abmelden' });
      if (ok) SSD.Auth.logout();
    });

    const saveIndicatorHandle = SSD.Views.AdminLayout.buildSaveIndicator();
    const topbar = U.el('header', { class: 'topbar' }, [
      U.el('div', { class: 'sidebar__brand-icon topbar__brand-icon' }, [U.el('img', { src: 'assets/logo.png', alt: 'Vereinslogo' })]),
      U.el('div', { class: 'topbar__title' }, [`Hallo, ${student.firstName}!`]),
      saveIndicatorHandle.el,
      themeToggle,
      logoutBtn,
    ]);
    return { el: topbar, cleanup: saveIndicatorHandle.cleanup };
  }

  function buildAvailabilityGrid(student, windowInfo) {
    const card = U.el('div', { class: 'card animate-rise-in' });
    card.appendChild(U.el('div', { class: 'card__header' }, [
      U.el('div', {}, [
        U.el('div', { class: 'card__title' }, ['Mein Verfügbarkeits-Stundenplan']),
        U.el('div', { class: 'card__subtitle' }, ['Für jeden Block: Verfügbar, Nicht verfügbar oder Dienst gesperrt.']),
      ]),
      windowInfo.isOpen
        ? U.el('span', { class: 'deadline-pill', html: SSD.Icons.svg('unlock', { size: 15 }) }, [` Änderbar bis ${U.formatDateMedium(windowInfo.lockDate)}`])
        : U.el('span', { class: 'deadline-pill deadline-pill--locked', html: SSD.Icons.svg('lock', { size: 15 }) }, [` Gesperrt bis ${U.formatDateMedium(windowInfo.nextMonday)}`]),
    ]));

    const body = U.el('div', { class: 'card__body' });
    const gridWrap = U.el('div', { class: 'week-grid-wrap' });
    const grid = U.el('div', { class: 'week-grid' });

    grid.appendChild(U.el('div', { class: 'week-grid__corner' }));
    const monday = U.getMondayOfWeek(U.today());
    U.WEEKDAY_KEYS.forEach((day, i) => {
      const date = U.addDays(monday, i);
      grid.appendChild(U.el('div', { class: 'week-grid__day-head' }, [
        U.WEEKDAY_LABELS[day],
        U.el('span', { class: 'date' }, [U.formatDateShort(date)]),
      ]));
    });

    U.DUTY_BLOCKS.forEach((block, blockIdx) => {
      grid.appendChild(U.el('div', { class: 'week-grid__block-label' }, [
        block.short,
        U.el('span', {}, [block.label]),
      ]));

      U.WEEKDAY_KEYS.forEach((day) => {
        const blockEnabled = SSD.CalendarService.isBlockEnabled(day, block.key);
        const currentState = student.availability[day][blockIdx];
        const cell = U.el('div', { class: 'avail-cell' });

        if (!blockEnabled) {
          cell.appendChild(U.el('div', { class: 'avail-option', style: 'color:var(--text-tertiary); cursor:default;' }, ['Kein Dienst']));
        } else {
          OPTION_DEFS.forEach((opt) => {
            const isSelected = currentState === opt.key;
            const btn = U.el('button', {
              type: 'button',
              class: `avail-option${isSelected ? ` is-selected--${opt.key}` : ''}`,
              disabled: !windowInfo.isOpen,
              'data-tooltip': opt.key === 'blocked' ? 'z. B. Klausur, Arzttermin, wichtiger Termin' : undefined,
            }, [opt.label]);
            btn.addEventListener('click', () => {
              SSD.StudentService.setAvailabilityCell(student.id, day, blockIdx, opt.key);
              SSD.Toast.show({ type: 'success', title: 'Gespeichert', message: `${U.WEEKDAY_LABELS[day]}, ${block.label}: ${opt.label}`, duration: 1800 });
              refreshCellVisuals(cell, opt.key);
            });
            cell.appendChild(btn);
          });
        }
        grid.appendChild(cell);
      });
    });

    function refreshCellVisuals(cell, selectedKey) {
      U.qsa('.avail-option', cell).forEach((btn) => {
        OPTION_DEFS.forEach((opt) => btn.classList.remove(`is-selected--${opt.key}`));
      });
      const idx = OPTION_DEFS.findIndex((o) => o.key === selectedKey);
      if (idx >= 0) cell.children[idx].classList.add(`is-selected--${selectedKey}`);
    }

    gridWrap.appendChild(grid);
    body.appendChild(gridWrap);

    body.appendChild(U.el('div', { class: 'legend', style: 'margin-top:20px;' }, [
      U.el('div', { class: 'legend__item' }, [U.el('span', { class: 'legend__swatch', style: 'background:var(--color-success-500)' }), 'Verfügbar']),
      U.el('div', { class: 'legend__item' }, [U.el('span', { class: 'legend__swatch', style: 'background:var(--color-gray-400)' }), 'Nicht verfügbar']),
      U.el('div', { class: 'legend__item' }, [U.el('span', { class: 'legend__swatch', style: 'background:var(--color-danger-500)' }), 'Gesperrt (Klausur, Termin, …)']),
    ]));

    card.appendChild(body);
    return card;
  }

  function buildDutiesCard(student, summary) {
    const card = U.el('div', { class: 'card animate-rise-in' });
    card.appendChild(U.el('div', { class: 'card__header' }, [
      U.el('div', { class: 'card__title' }, ['Meine kommenden Dienste']),
    ]));
    const body = U.el('div', { class: 'card__body' });
    if (!summary.upcoming.length) {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('span', { html: SSD.Icons.svg('calendar', { size: 40 }) }),
        U.el('h3', {}, ['Aktuell keine anstehenden Dienste']),
        U.el('p', {}, ['Sobald der Administrator den nächsten Dienstplan erstellt, erscheinen Ihre Termine hier.']),
      ]));
    } else {
      const list = U.el('div', { class: 'stack gap-1' });
      summary.upcoming.slice(0, 8).forEach((duty) => {
        const requested = SSD.SelfServiceService.hasOpenRequest(student.id, duty);
        const actionBtn = U.el('button', {
          class: `btn btn--sm ${requested ? 'btn--secondary' : 'btn--ghost'}`,
          html: SSD.Icons.svg(requested ? 'x' : 'handRaised', { size: 13 }),
        }, [requested ? 'Anfrage zurückziehen' : 'Vertretung anfragen']);
        actionBtn.addEventListener('click', async () => {
          if (requested) {
            SSD.SelfServiceService.cancelSubstitutionRequest(student.id, duty);
            SSD.Toast.info('Zurückgezogen', 'Ihre Vertretungsanfrage wurde zurückgezogen.');
          } else {
            const ok = await SSD.Dialog.confirm({
              title: 'Vertretung anfragen',
              message: `Für ${U.formatDateLong(U.parseIsoDate(duty.date))}, ${U.blockLabel(duty.block)} eine Vertretung suchen? Sie bleiben regulär eingeteilt, bis jemand anderes den Platz übernimmt.`,
              confirmLabel: 'Vertretung anfragen',
            });
            if (!ok) return;
            SSD.SelfServiceService.requestSubstitution(student.id, duty);
            SSD.Toast.success('Angefragt', 'Der Dienst erscheint jetzt für andere Berechtigte als offen übernehmbar.');
          }
          refreshAll(student);
        });

        list.appendChild(U.el('div', { class: 'cluster gap-3', style: 'padding:10px 4px; border-bottom:1px solid var(--border-subtle); justify-content:space-between;' }, [
          U.el('div', { class: 'cluster gap-3' }, [
            U.el('span', { html: SSD.Icons.svg('clock', { size: 16 }), style: 'color:var(--color-primary); display:flex;' }),
            U.el('strong', {}, [U.formatDateLong(U.parseIsoDate(duty.date))]),
            U.el('span', { class: 'badge badge--primary' }, [U.blockLabel(duty.block)]),
            requested ? U.el('span', { class: 'badge badge--warning' }, ['Vertretung gesucht']) : null,
          ]),
          actionBtn,
        ]));
      });
      body.appendChild(list);
    }
    card.appendChild(body);
    return card;
  }

  function buildSideColumn(student, summary) {
    const col = U.el('div', { class: 'stack gap-5' });

    col.appendChild(U.el('div', { class: 'stat-tile' }, [
      U.el('div', { class: 'stat-tile__top' }, [
        U.el('div', { class: 'stat-tile__icon', html: SSD.Icons.svg('trophy', { size: 19 }) }),
      ]),
      U.el('div', { class: 'stat-tile__value' }, [String(summary.total)]),
      U.el('div', { class: 'stat-tile__label' }, ['Dienste insgesamt geleistet/geplant']),
    ]));
    col.appendChild(U.el('div', { class: 'stat-tile' }, [
      U.el('div', { class: 'stat-tile__top' }, [
        U.el('div', { class: 'stat-tile__icon', html: SSD.Icons.svg('checkCircle', { size: 19 }) }),
      ]),
      U.el('div', { class: 'stat-tile__value' }, [String(summary.past.length)]),
      U.el('div', { class: 'stat-tile__label' }, ['Bereits absolvierte Dienste']),
    ]));

    if ((student.role || 'student') === 'student') col.appendChild(buildWishCard(student));

    if (student.adminMessage) {
      col.appendChild(U.el('div', { class: 'notice-box' }, [
        U.el('span', { html: SSD.Icons.svg('bell', { size: 20 }) }),
        U.el('div', {}, [
          U.el('strong', {}, ['Hinweis vom Administrator']),
          U.el('p', {}, [student.adminMessage]),
        ]),
      ]));
    }

    if (student.notes) {
      col.appendChild(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card__body' }, [
          U.el('div', { class: 'card__subtitle' }, ['Hinterlegte Bemerkung']),
          U.el('p', { style: 'margin-top:6px;' }, [student.notes]),
        ]),
      ]));
    }

    col.appendChild(U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__body stack gap-2' }, [
        U.el('div', { class: 'cluster gap-2' }, [U.el('span', { html: SSD.Icons.svg('info', { size: 15 }), style: 'color:var(--text-tertiary);display:flex;' }), U.el('strong', { style: 'font-size:var(--font-size-sm);' }, ['Meine Daten'])]),
        infoRow('Klasse', student.schoolClass || '—'),
        infoRow('Abijahrgang', String(student.yearGroup || '—')),
        infoRow('Max. Dienste/Woche', String(student.maxDutiesPerWeek || SSD.SettingsService.get().maxDutiesPerWeek)),
      ]),
    ]));

    return col;
  }

  /** Wunschpartner:innen: bis zu drei andere Sanis, mit denen man bevorzugt Dienst macht. */
  function buildWishCard(student) {
    const others = SSD.StudentService.getActiveByRole('student')
      .filter((s) => s.id !== student.id)
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
    const current = SSD.StudentService.getPreferredPartners(student).map((s) => s.id);

    const selects = Array.from({ length: SSD.StudentService.MAX_PREFERRED_PARTNERS }, (_, i) => U.el('select', { class: 'select' }, [
      U.el('option', { value: '' }, ['— keine Auswahl —']),
      ...others.map((o) => U.el('option', { value: o.id, selected: current[i] === o.id }, [SSD.StudentService.fullName(o)])),
    ]));
    selects.forEach((sel) => {
      sel.addEventListener('change', () => {
        if (sel.value && selects.some((other) => other !== sel && other.value === sel.value)) {
          sel.value = '';
          SSD.Toast.warning('Bereits ausgewählt', 'Jede Person kann nur einmal ausgewählt werden.');
          return;
        }
        const saved = SSD.StudentService.setPreferredPartners(student.id, selects.map((s) => s.value).filter(Boolean));
        const names = saved.map((id) => SSD.StudentService.fullName(SSD.StudentService.getById(id)));
        SSD.Toast.show({ type: 'success', title: 'Gespeichert', message: names.length ? `Wunschpartner:innen: ${names.join(', ')}` : 'Keine Wunschpartner:innen ausgewählt.', duration: 2200 });
      });
    });

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__body stack gap-2' }, [
        U.el('div', { class: 'cluster gap-2' }, [
          U.el('span', { html: SSD.Icons.svg('heart', { size: 15 }), style: 'color:var(--color-primary);display:flex;' }),
          U.el('strong', { style: 'font-size:var(--font-size-sm);' }, ['Meine Wunschpartner:innen']),
        ]),
        others.length
          ? U.el('div', { class: 'stack gap-2' }, selects)
          : U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-sm);' }, ['Noch keine weiteren Sanis im Team.']),
        U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, [
          'Der Dienstplan versucht, Sie öfter mit diesen Personen einzuteilen — ohne Garantie, Verfügbarkeit und gleichmäßige Verteilung gehen vor. Gegenseitige Wünsche zählen stärker. Ihre Auswahl sehen nur Sie und die Administration.',
        ]),
      ]),
    ]);
  }

  function infoRow(label, value) {
    return U.el('div', { class: 'cluster', style: 'justify-content:space-between; font-size:var(--font-size-sm);' }, [
      U.el('span', { class: 'text-tertiary' }, [label]),
      U.el('strong', {}, [value]),
    ]);
  }

  let topbarCleanup = null;
  let activeTab = 'availability'; // 'availability' | 'schedule' | 'openDuties' | 'events'
  let scheduleViewedMonday = U.getMondayOfWeek(U.today());
  let tabBody = null;
  let tabSwitcherEl = null;

  /** Baut die Tab-Leiste neu (aktualisiert z. B. den Zähler "Offene Dienste") und rendert den aktiven Tab-Inhalt neu. */
  function refreshAll(student) {
    if (tabSwitcherEl) {
      const fresh = buildTabSwitcher(student);
      tabSwitcherEl.replaceWith(fresh);
      tabSwitcherEl = fresh;
    }
    renderTabBody(student);
  }

  function buildTabSwitcher(student) {
    const openSeatCount = SSD.SelfServiceService.getOpenSeatsForPerson(student).length;
    const tabDefs = [
      { key: 'availability', label: 'Meine Verfügbarkeit' },
      { key: 'schedule', label: 'Dienstplan (alle)' },
      { key: 'openDuties', label: 'Offene Dienste', badge: openSeatCount || null },
      { key: 'tasks', label: 'Aufgaben', badge: SSD.TasksService.getOpen().length || null },
      { key: 'events', label: 'Veranstaltungen' },
      { key: 'materials', label: 'Material' },
    ];
    if (SSD.StudentService.isTeamLead(student)) {
      const pendingRequests = SSD.SelfServiceService.getOpenSeats().filter((s) => s.reason === 'requested').length;
      tabDefs.push({ key: 'teamLead', label: 'Team-Verwaltung', badge: pendingRequests || null });
    }
    const buttons = tabDefs.map((def) => {
      const children = [def.label];
      if (def.badge) children.push(U.el('span', { class: 'badge badge--warning', style: 'margin-left:6px;' }, [String(def.badge)]));
      return U.el('button', { class: `tab${activeTab === def.key ? ' is-active' : ''}` }, children);
    });
    buttons.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        activeTab = tabDefs[i].key;
        buttons.forEach((b, j) => b.classList.toggle('is-active', tabDefs[j].key === activeTab));
        renderTabBody(student);
      });
    });
    return U.el('div', { class: 'tabs' }, buttons);
  }

  /** "Offene Dienste": unbesetzte Plätze oder Vertretungsanfragen, die eigenständig übernommen werden können. */
  function buildOpenDutiesTab(student) {
    const seats = SSD.SelfServiceService.getOpenSeatsForPerson(student);
    const card = U.el('div', { class: 'card animate-rise-in' });
    card.appendChild(U.el('div', { class: 'card__header' }, [
      U.el('div', {}, [
        U.el('div', { class: 'card__title' }, ['Offene Dienste']),
        U.el('div', { class: 'card__subtitle' }, ['Unbesetzte Plätze oder Vertretungsanfragen — eigenständig übernehmbar, sofern Sie verfügbar sind.']),
      ]),
    ]));
    const body = U.el('div', { class: 'card__body' });

    if (!seats.length) {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('span', { html: SSD.Icons.svg('handRaised', { size: 40 }) }),
        U.el('h3', {}, ['Aktuell keine offenen Dienste']),
        U.el('p', {}, ['Sobald ein Dienst unbesetzt ist oder jemand um Vertretung bittet, erscheint er hier.']),
      ]));
    } else {
      body.appendChild(U.el('div', { class: 'stack gap-3' }, seats.map((seat) => buildOpenSeatRow(student, seat))));
    }
    card.appendChild(body);
    return card;
  }

  function buildOpenSeatRow(student, seat) {
    const entry = seat.entry;
    const check = SSD.SelfServiceService.canClaim(student.id, entry, seat.seatType, seat.requestedBy);
    const otherOccupants = seat.seatType === 'student'
      ? entry.studentIds.map((id) => SSD.StudentService.getById(id)).filter(Boolean)
      : [];

    const claimBtn = U.el('button', {
      class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('checkCircle', { size: 14 }), disabled: !check.ok,
    }, ['Übernehmen']);
    claimBtn.addEventListener('click', async () => {
      const ok = await SSD.Dialog.confirm({
        title: 'Dienst übernehmen',
        message: `${U.formatDateLong(U.parseIsoDate(entry.date))}, ${U.blockLabel(entry.block)} eigenständig übernehmen?` +
          (seat.reason === 'requested' ? ` Sie ersetzen damit ${SSD.SubstitutionService.studentName(seat.requestedBy)}.` : ''),
        confirmLabel: 'Übernehmen',
      });
      if (!ok) return;
      try {
        SSD.SelfServiceService.claimSeat(student.id, entry, seat.seatType, seat.requestedBy);
        SSD.Toast.success('Dienst übernommen', 'Der Dienstplan wurde aktualisiert.');
      } catch (err) {
        SSD.Toast.error('Nicht möglich', String(err.message || err));
      }
      refreshAll(student);
    });

    return U.el('div', { class: 'substitution-row' }, [
      U.el('div', { class: 'substitution-row__date' }, [
        `${U.WEEKDAY_LABELS_SHORT[entry.weekday]}, ${U.formatDateShort(U.parseIsoDate(entry.date))}`,
        U.el('span', {}, [U.blockLabel(entry.block)]),
      ]),
      U.el('div', { class: 'substitution-row__body' }, [
        U.el('div', { class: 'cluster gap-2' }, [
          seat.reason === 'requested'
            ? U.el('span', { class: 'badge badge--warning' }, ['Vertretung gesucht'])
            : U.el('span', { class: 'badge badge--danger' }, ['Unbesetzt']),
          seat.seatType === 'azubi' ? U.el('span', { class: 'badge badge--primary' }, ['Azubi-Platz']) : null,
        ]),
        otherOccupants.length ? U.el('div', { class: 'substitution-row__reasons' }, [`Mit ${otherOccupants.map((o) => SSD.StudentService.fullName(o)).join(' & ')}`]) : null,
        !check.ok ? U.el('div', { class: 'substitution-row__warning' }, [U.el('span', { html: SSD.Icons.svg('warning', { size: 13 }) }), check.reason]) : null,
      ]),
      U.el('div', { class: 'substitution-row__actions' }, [claimBtn]),
    ]);
  }

  function formatEventTimeRange(event) {
    if (event.startTime && event.endTime) return `${event.startTime} – ${event.endTime} Uhr`;
    if (event.startTime) return `ab ${event.startTime} Uhr`;
    return 'Ganztägig';
  }

  function buildEventCard(student, event) {
    const signedUp = SSD.EventsService.isSignedUp(event, student.id);
    const full = SSD.EventsService.isFull(event);
    const fillBadge = event.capacity != null
      ? U.el('span', { class: `badge ${full ? 'badge--warning' : 'badge--success'}` }, [`${event.participantIds.length}/${event.capacity} angemeldet`])
      : U.el('span', { class: 'badge badge--success' }, [`${event.participantIds.length} angemeldet`]);

    const actionBtn = U.el('button', {
      class: `btn btn--sm ${signedUp ? 'btn--secondary' : 'btn--primary'}`,
      html: SSD.Icons.svg(signedUp ? 'x' : 'plus', { size: 14 }),
      disabled: !signedUp && full,
    }, [signedUp ? 'Abmelden' : (full ? 'Ausgebucht' : 'Anmelden')]);
    actionBtn.addEventListener('click', () => {
      try {
        if (signedUp) SSD.EventsService.withdraw(event.id, student.id);
        else SSD.EventsService.signUp(event.id, student.id);
      } catch (err) {
        SSD.Toast.error('Nicht möglich', String(err.message || err));
      }
      refreshAll(student);
    });

    return U.el('div', { class: 'card animate-rise-in' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, [event.title]),
          U.el('div', { class: 'card__subtitle' }, [`${U.formatDateLong(U.parseIsoDate(event.date))} · ${formatEventTimeRange(event)}${event.location ? ` · ${event.location}` : ''}`]),
        ]),
        signedUp ? U.el('span', { class: 'badge badge--primary' }, ['Angemeldet']) : null,
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        event.description ? U.el('p', { style: 'margin:0;' }, [event.description]) : null,
        U.el('div', { class: 'cluster gap-3', style: 'justify-content:space-between;' }, [fillBadge, actionBtn]),
      ]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * "Aufgaben": offener Pool sonstiger Aufgaben (siehe SSD.TasksService)
   * ------------------------------------------------------------------- */

  function buildTaskCard(student, task) {
    const overdue = task.dueDate && task.dueDate < U.toIsoDate(U.today());
    const doneBtn = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('checkCircle', { size: 14 }) }, ['Erledigt']);
    doneBtn.addEventListener('click', () => {
      SSD.TasksService.markDone(task.id, student.id);
      SSD.Toast.success('Danke!', `"${task.title}" wurde als erledigt markiert.`);
      refreshAll(student);
    });
    return U.el('div', { class: 'card animate-rise-in' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, [task.title]),
          task.dueDate ? U.el('div', { class: 'card__subtitle' }, [`${overdue ? 'Überfällig: ' : 'Fällig: '}${U.formatDateLong(U.parseIsoDate(task.dueDate))}`]) : null,
        ]),
        overdue ? U.el('span', { class: 'badge badge--danger' }, ['Überfällig']) : null,
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        task.description ? U.el('p', { style: 'margin:0;' }, [task.description]) : null,
        U.el('div', { style: 'text-align:right;' }, [doneBtn]),
      ]),
    ]);
  }

  function buildTasksTab(student) {
    const tasks = SSD.TasksService.getOpen();
    if (!tasks.length) {
      return U.el('div', { class: 'card animate-rise-in' }, [
        U.el('div', { class: 'empty-state' }, [
          U.el('span', { html: SSD.Icons.svg('check', { size: 40 }) }),
          U.el('h3', {}, ['Aktuell keine offenen Aufgaben']),
          U.el('p', {}, ['Sobald der Administrator eine Aufgabe anlegt, erscheint sie hier.']),
        ]),
      ]);
    }
    return U.el('div', { class: 'stack gap-4' }, tasks.map((task) => buildTaskCard(student, task)));
  }

  /* ---------------------------------------------------------------------
   * "Material": gemeinsame Materialliste (siehe SSD.MaterialService)
   * ------------------------------------------------------------------- */

  function openMaterialRequestModal(student, existing) {
    const isEdit = !!existing;
    const nameInput = U.el('input', { class: 'input', value: existing?.name || '', placeholder: 'z. B. Einmalhandschuhe Größe M' });
    const quantityInput = U.el('input', { class: 'input', value: existing?.quantity || '', placeholder: 'z. B. 2 Packungen' });
    const noteInput = U.el('textarea', { class: 'input', rows: '2' }, [existing?.note || '']);
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, ['Bezeichnung']), nameInput]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, ['Menge (optional)']), quantityInput]),
      U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, ['Notiz (optional)']), noteInput]),
    ]);

    const footerButtons = [
      { label: 'Abbrechen', variant: 'secondary' },
      {
        label: isEdit ? 'Speichern' : 'Anfragen', variant: 'primary', closeOnClick: false,
        onClick: () => {
          errorBox.style.display = 'none';
          if (!nameInput.value.trim()) { errorBox.textContent = 'Bitte eine Bezeichnung angeben.'; errorBox.style.display = 'flex'; return; }
          const data = { name: nameInput.value.trim(), quantity: quantityInput.value.trim(), note: noteInput.value.trim() };
          try {
            if (isEdit) SSD.MaterialService.update(existing.id, data, { actingPersonId: student.id });
            else SSD.MaterialService.create(Object.assign({ requestedBy: student.id }, data));
            SSD.Toast.success('Gespeichert', 'Materialliste aktualisiert.');
            handle.close();
            refreshAll(student);
          } catch (err) {
            errorBox.textContent = String(err.message || err);
            errorBox.style.display = 'flex';
          }
        },
      },
    ];
    const handle = SSD.Dialog.open({ title: isEdit ? 'Material-Eintrag bearbeiten' : 'Material anfragen', body, wide: true, footerButtons });
  }

  function buildMaterialRow(student, item) {
    const canEditItem = SSD.MaterialService.canEdit(student.id, item);
    const requester = item.requestedBy ? SSD.StudentService.getById(item.requestedBy) : null;
    const requesterLabel = item.requestedBy === student.id ? 'Von Ihnen' : (item.requestedBy ? (requester ? SSD.StudentService.fullName(requester) : '(gelöscht)') : 'Administrator');
    const statusBadgeClass = { offen: 'badge--warning', bestellt: 'badge--primary', erledigt: 'badge--success' }[item.status] || '';
    const statusLabel = { offen: 'Offen', bestellt: 'Bestellt', erledigt: 'Erledigt' }[item.status] || item.status;

    const actions = [];
    if (canEditItem) {
      const editBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Bearbeiten', html: SSD.Icons.svg('edit', { size: 14 }) });
      editBtn.addEventListener('click', () => openMaterialRequestModal(student, item));
      const deleteBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Löschen', html: SSD.Icons.svg('trash', { size: 14 }) });
      deleteBtn.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({ title: 'Löschen', danger: true, message: `"${item.name}" wirklich löschen?` });
        if (!ok) return;
        try {
          SSD.MaterialService.remove(item.id, { actingPersonId: student.id });
          SSD.Toast.success('Gelöscht', 'Eintrag entfernt.');
        } catch (err) {
          SSD.Toast.error('Nicht möglich', String(err.message || err));
        }
        refreshAll(student);
      });
      actions.push(editBtn, deleteBtn);
    }

    return U.el('div', { class: 'cluster gap-3', style: 'padding:10px 4px; border-bottom:1px solid var(--border-subtle); justify-content:space-between;' }, [
      U.el('div', {}, [
        U.el('div', { class: 'cluster gap-2' }, [
          U.el('strong', {}, [item.name]),
          item.quantity ? U.el('span', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [item.quantity]) : null,
          U.el('span', { class: `badge ${statusBadgeClass}` }, [statusLabel]),
        ]),
        item.note ? U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs); margin-top:2px;' }, [item.note]) : null,
        U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs); margin-top:2px;' }, [requesterLabel]),
      ]),
      actions.length ? U.el('div', { class: 'cluster gap-1' }, actions) : null,
    ]);
  }

  function buildMaterialsTab(student) {
    const items = SSD.MaterialService.getAll();
    const addBtn = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('plus', { size: 14 }) }, ['Material anfragen']);
    addBtn.addEventListener('click', () => openMaterialRequestModal(student, null));

    const card = U.el('div', { class: 'card animate-rise-in' });
    card.appendChild(U.el('div', { class: 'card__header' }, [
      U.el('div', {}, [
        U.el('div', { class: 'card__title' }, ['Materialliste']),
        U.el('div', { class: 'card__subtitle' }, ['Zu bestellendes Material für den Administrator dokumentieren.']),
      ]),
      addBtn,
    ]));
    const body = U.el('div', { class: 'card__body' });
    if (!items.length) {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('span', { html: SSD.Icons.svg('box', { size: 40 }) }),
        U.el('h3', {}, ['Noch keine Material-Anfragen']),
      ]));
    } else {
      body.appendChild(U.el('div', {}, items.map((item) => buildMaterialRow(student, item))));
    }
    card.appendChild(body);
    return card;
  }

  /** "Veranstaltungen": freiwillige Anmeldung zu außerschulischen Veranstaltungen. */
  function buildEventsTab(student) {
    const events = SSD.EventsService.getUpcoming();
    if (!events.length) {
      return U.el('div', { class: 'card animate-rise-in' }, [
        U.el('div', { class: 'empty-state' }, [
          U.el('span', { html: SSD.Icons.svg('flag', { size: 40 }) }),
          U.el('h3', {}, ['Aktuell keine Veranstaltungen geplant']),
          U.el('p', {}, ['Sobald der Administrator eine Veranstaltung anlegt, können Sie sich hier freiwillig eintragen.']),
        ]),
      ]);
    }
    return U.el('div', { class: 'stack gap-4' }, events.map((event) => buildEventCard(student, event)));
  }

  function buildFullScheduleTab(student) {
    const prevBtn = U.el('button', { class: 'btn btn--icon btn--secondary', 'data-tooltip': 'Vorherige Woche', html: SSD.Icons.svg('chevronLeft', { size: 16 }) });
    prevBtn.addEventListener('click', () => { scheduleViewedMonday = U.addDays(scheduleViewedMonday, -7); renderTabBody(student); });
    const nextBtn = U.el('button', { class: 'btn btn--icon btn--secondary', 'data-tooltip': 'Nächste Woche', html: SSD.Icons.svg('chevronRight', { size: 16 }) });
    nextBtn.addEventListener('click', () => { scheduleViewedMonday = U.addDays(scheduleViewedMonday, 7); renderTabBody(student); });
    const todayBtn = U.el('button', { class: 'btn btn--secondary btn--sm' }, ['Aktuelle Woche']);
    todayBtn.addEventListener('click', () => { scheduleViewedMonday = U.getMondayOfWeek(U.today()); renderTabBody(student); });

    const card = U.el('div', { class: 'card animate-rise-in' });
    card.appendChild(U.el('div', { class: 'card__header' }, [
      U.el('div', {}, [
        U.el('div', { class: 'card__title' }, ['Vollständiger Dienstplan']),
        U.el('div', { class: 'card__subtitle' }, ['Alle eingeteilten Personen — Ihre eigenen Dienste sind hervorgehoben.']),
      ]),
      U.el('div', { class: 'cluster gap-2' }, [prevBtn, U.el('strong', { style: 'font-size:var(--font-size-sm);' }, [`${U.formatDateMedium(scheduleViewedMonday)} – ${U.formatDateMedium(U.addDays(scheduleViewedMonday, 4))}`]), nextBtn, todayBtn]),
    ]));
    const body = U.el('div', { class: 'card__body' }, [
      SSD.ScheduleTable.render(scheduleViewedMonday, { highlightPersonId: student.id }),
      U.el('div', { style: 'margin-top:20px;' }, [SSD.ScheduleTable.renderLegend()]),
    ]);
    card.appendChild(body);
    return card;
  }

  function miniStat(icon, value, label) {
    return U.el('div', { class: 'stat-tile', style: 'box-shadow:none; border-color:var(--border-subtle);' }, [
      U.el('div', { class: 'stat-tile__icon', html: SSD.Icons.svg(icon, { size: 17 }) }),
      U.el('div', { class: 'stat-tile__value' }, [value]),
      U.el('div', { class: 'stat-tile__label' }, [label]),
    ]);
  }

  function buildTeamRequestRow(student, seat) {
    const entry = seat.entry;
    const personName = SSD.SubstitutionService.studentName(seat.requestedBy);
    const resolveBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('userSearch', { size: 14 }) }, ['Vertretung berechnen']);
    resolveBtn.addEventListener('click', () => {
      SSD.SubstitutionFlow.launchSubstitutionFlow([seat.requestedBy], entry.date, entry.date, 'Vertretung (über Team-Verwaltung)', {
        onApplied: () => refreshAll(student),
      });
    });
    return U.el('div', { class: 'substitution-row' }, [
      U.el('div', { class: 'substitution-row__date' }, [
        `${U.WEEKDAY_LABELS_SHORT[entry.weekday]}, ${U.formatDateShort(U.parseIsoDate(entry.date))}`,
        U.el('span', {}, [U.blockLabel(entry.block)]),
      ]),
      U.el('div', { class: 'substitution-row__body' }, [
        U.el('div', { class: 'cluster gap-2' }, [
          U.el('span', { class: 'badge badge--warning' }, ['Vertretung gesucht']),
          seat.seatType === 'azubi' ? U.el('span', { class: 'badge badge--primary' }, ['Azubi-Platz']) : null,
        ]),
        U.el('div', { class: 'substitution-row__reasons' }, [personName]),
      ]),
      U.el('div', { class: 'substitution-row__actions' }, [resolveBtn]),
    ]);
  }

  /**
   * "Team-Verwaltung": nur für Sanisprecher:in / Stellv. Sanisprecher:in sichtbar.
   * Nutzt bewusst denselben `SSD.SubstitutionFlow` wie der Administrator-Bereich
   * (siehe js/ui/substitutionFlow.js) — dieselbe geprüfte Logik, aber ohne
   * Zugriff auf Konten-/System-Einstellungen oder die volle Neuberechnung.
   */
  function buildTeamLeadTab(student) {
    const overview = SSD.StatisticsService.computeOverview();
    const openRequests = SSD.SelfServiceService.getOpenSeats().filter((s) => s.reason === 'requested');
    const roleLabel = SSD.Models.LEADERSHIP_ROLES.find((r) => r.key === student.leadershipRole)?.label || '';

    const statsCard = U.el('div', { class: 'card animate-rise-in' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Team-Überblick']),
          U.el('div', { class: 'card__subtitle' }, [`Erweiterte Ansicht für ${roleLabel} — dient der Koordination, keine Bearbeitung von Konten/Einstellungen.`]),
        ]),
      ]),
      U.el('div', { class: 'card__body' }, [
        U.el('div', { class: 'grid grid-cols-3' }, [
          miniStat('trophy', `${overview.fairnessScore}%`, 'Fairness-Score'),
          miniStat('stats', String(overview.average), 'Ø Dienste/Person'),
          miniStat('warning', String(overview.emptySlots + overview.incompleteSlots), 'Unbesetzt/unvollständig'),
        ]),
      ]),
    ]);

    const absenceBtn = U.el('button', { class: 'btn btn--primary', html: SSD.Icons.svg('userSearch', { size: 16 }) }, ['Abwesenheit für Mitschüler:in melden']);
    absenceBtn.addEventListener('click', () => {
      SSD.SubstitutionFlow.openAbsenceDialog({ options: { onApplied: () => refreshAll(student) } });
    });
    const actionsCard = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__body' }, [
        U.el('p', { style: 'margin-top:0;' }, ['Meldet jemand aus dem Team, einen Dienst nicht wahrnehmen zu können, berechnen Sie hier — wie der Administrator — passende Ersatzpersonen und tragen sie direkt ein.']),
        absenceBtn,
      ]),
    ]);

    const requestsCard = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Offene Vertretungsanfragen im Team']),
          U.el('div', { class: 'card__subtitle' }, ['Von Mitschüler:innen selbst über "Vertretung anfragen" gemeldet — noch nicht übernommen.']),
        ]),
      ]),
      U.el('div', { class: 'card__body' }, [
        openRequests.length
          ? U.el('div', { class: 'stack gap-2' }, openRequests.map((seat) => buildTeamRequestRow(student, seat)))
          : U.el('div', { class: 'empty-state' }, [
            U.el('span', { html: SSD.Icons.svg('checkCircle', { size: 36 }) }),
            U.el('h3', {}, ['Aktuell keine offenen Anfragen']),
          ]),
      ]),
    ]);

    return U.el('div', { class: 'stack gap-5' }, [statsCard, actionsCard, requestsCard]);
  }

  function renderTabBody(student) {
    tabBody.innerHTML = '';
    if (activeTab === 'schedule') {
      tabBody.appendChild(buildFullScheduleTab(student));
      return;
    }
    if (activeTab === 'openDuties') {
      tabBody.appendChild(buildOpenDutiesTab(student));
      return;
    }
    if (activeTab === 'tasks') {
      tabBody.appendChild(buildTasksTab(student));
      return;
    }
    if (activeTab === 'events') {
      tabBody.appendChild(buildEventsTab(student));
      return;
    }
    if (activeTab === 'materials') {
      tabBody.appendChild(buildMaterialsTab(student));
      return;
    }
    if (activeTab === 'teamLead') {
      tabBody.appendChild(buildTeamLeadTab(student));
      return;
    }
    const windowInfo = SSD.StudentService.getAvailabilityWindow();
    const summary = SSD.StudentService.getDutySummary(student.id);
    const layout = U.el('div', { class: 'two-col-layout' });
    layout.appendChild(U.el('div', { class: 'stack gap-5' }, [
      buildAvailabilityGrid(student, windowInfo),
      buildDutiesCard(student, summary),
    ]));
    layout.appendChild(buildSideColumn(student, summary));
    tabBody.appendChild(layout);
  }

  function render(container) {
    const student = SSD.Auth.getCurrentStudent();
    if (!student) { SSD.Auth.logout(); return; }
    activeTab = 'availability';

    const topbarHandle = buildTopbar(student);
    topbarCleanup = topbarHandle.cleanup;
    container.appendChild(topbarHandle.el);

    const viewContainer = U.el('div', { class: 'view-container' });
    const inner = U.el('div', { class: 'view-container__inner' });

    const teamLabel = student.role === 'azubi' ? 'Azubi-Team' : 'Schulsanitätsdienst-Team';
    const leadershipLabel = SSD.Models.LEADERSHIP_ROLES.find((r) => r.key === student.leadershipRole)?.label;
    inner.appendChild(U.el('div', { class: 'welcome-banner' }, [
      U.el('div', {}, [
        U.el('div', { class: 'cluster gap-2' }, [
          U.el('h2', { style: 'margin:0;' }, [`Willkommen zurück, ${student.firstName}!`]),
          leadershipLabel ? U.el('span', { class: 'badge', style: 'background:rgba(255,255,255,0.22); color:#fff;', html: SSD.Icons.svg('star', { size: 11 }) }, [leadershipLabel]) : null,
        ]),
        U.el('p', {}, [`${student.schoolClass ? `Klasse ${student.schoolClass} · ` : ''}${teamLabel}`]),
      ]),
      U.el('div', { class: 'welcome-banner__icon', html: SSD.Icons.svg('heart', { size: 46 }) }),
    ]));

    tabSwitcherEl = buildTabSwitcher(student);
    inner.appendChild(tabSwitcherEl);
    tabBody = U.el('div', { style: 'margin-top:20px;' });
    inner.appendChild(tabBody);
    renderTabBody(student);

    viewContainer.appendChild(inner);
    container.appendChild(viewContainer);
  }

  function destroy() {
    if (topbarCleanup) topbarCleanup();
  }

  return { render, destroy };
})();
