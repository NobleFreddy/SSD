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

    const accountBtn = U.el('button', { class: 'btn btn--icon btn--ghost', 'data-tooltip': 'Mein Konto: Passwort, meine Daten, mein Engagement', 'aria-label': 'Mein Konto', html: SSD.Icons.svg('user') });
    accountBtn.addEventListener('click', () => SSD.AccountDialog.open());

    const saveIndicatorHandle = SSD.Views.AdminLayout.buildSaveIndicator();
    const topbar = U.el('header', { class: 'topbar' }, [
      U.el('div', { class: 'sidebar__brand-icon topbar__brand-icon' }, [U.el('img', { src: 'assets/logo.png', alt: 'Vereinslogo' })]),
      U.el('div', { class: 'topbar__title' }, [`Hallo, ${student.firstName}!`]),
      saveIndicatorHandle.el,
      accountBtn,
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
              const hadReminder = SSD.StudentService.needsAvailabilityReminder(SSD.Auth.getCurrentStudent());
              SSD.StudentService.setAvailabilityCell(student.id, day, blockIdx, opt.key);
              SSD.Toast.show({ type: 'success', title: 'Gespeichert', message: `${U.WEEKDAY_LABELS[day]}, ${block.label}: ${opt.label}`, duration: 1800 });
              refreshCellVisuals(cell, opt.key);
              if (hadReminder) refreshChrome(SSD.Auth.getCurrentStudent()); // Erinnerungs-Hinweis ist damit erledigt
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
        }, [requested ? 'Anfrage zurückziehen' : 'Vertretung anfordern']);
        actionBtn.addEventListener('click', () => {
          if (requested) withdrawSubstitutionFor(student, duty);
          else requestSubstitutionFor(student, duty);
        });

        list.appendChild(U.el('div', { class: 'cluster gap-3', style: 'padding:10px 4px; border-bottom:1px solid var(--border-subtle); justify-content:space-between;' }, [
          U.el('div', { class: 'cluster gap-3' }, [
            U.el('span', { html: SSD.Icons.svg('clock', { size: 16 }), style: 'color:var(--color-primary); display:flex;' }),
            U.el('strong', {}, [U.formatDateLong(U.parseIsoDate(duty.date))]),
            U.el('span', { class: 'badge badge--primary' }, [U.blockLabel(duty.block)]),
            urgencyBadge(duty.date),
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
  let offRemoteChanges = null;
  let activeTab = 'availability'; // 'availability' | 'schedule' | 'openDuties' | 'tasks' | 'events' | 'meetings' | 'materials' | 'teamLead'
  let teamLeadSection = 'overview'; // Unterreiter der Team-Verwaltung: 'overview' | 'members' | 'engagement'
  let scheduleViewedMonday = U.getMondayOfWeek(U.today());
  let tabBody = null;
  let tabSwitcherEl = null;
  let topAreaEl = null;

  /**
   * Zeichnet Hinweise/Pinnwand, die Tab-Leiste (Zähler) und den aktiven Tab neu —
   * immer mit dem aktuellen Datenstand der angemeldeten Person (nach einem
   * Realtime-Update ist das zuvor gemerkte Personen-Objekt veraltet).
   */
  function refreshAll() {
    const student = SSD.Auth.getCurrentStudent();
    if (!student) return;
    refreshChrome(student);
    renderTabBody(student);
  }

  /** Nur Hinweise, Pinnwand und Tab-Leiste — der gerade bearbeitete Tab-Inhalt bleibt stehen. */
  function refreshChrome(student) {
    if (topAreaEl) {
      const freshTop = buildTopArea(student);
      topAreaEl.replaceWith(freshTop);
      topAreaEl = freshTop;
    }
    if (tabSwitcherEl) {
      const freshTabs = buildTabSwitcher(student);
      tabSwitcherEl.replaceWith(freshTabs);
      tabSwitcherEl = freshTabs;
    }
  }

  /** Erinnerung der Team-Leitung, die Verfügbarkeit einzutragen bzw. zu prüfen (siehe SSD.TeamMembersPanel). */
  function buildAvailabilityReminder(student) {
    const hasAny = SSD.StatisticsService.hasAnyAvailability(student);
    const goBtn = U.el('button', { class: 'btn btn--primary btn--sm' }, ['Zur Verfügbarkeit']);
    goBtn.addEventListener('click', () => { activeTab = 'availability'; refreshAll(); });
    const confirmBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('check', { size: 14 }) }, [hasAny ? 'Ist aktuell' : 'Ich habe keine freien Zeiten']);
    confirmBtn.addEventListener('click', () => {
      SSD.StudentService.confirmAvailability(student.id);
      SSD.Toast.success('Danke!', 'Die Team-Leitung sieht, dass Ihre Verfügbarkeit aktuell ist.');
      refreshAll();
    });
    return U.el('div', { class: 'notice-box', role: 'status' }, [
      U.el('span', { html: SSD.Icons.svg('bell', { size: 20 }) }),
      U.el('div', { class: 'stack gap-3' }, [
        U.el('div', {}, [
          U.el('strong', {}, [hasAny ? 'Bitte prüfen Sie Ihre Verfügbarkeit' : 'Bitte tragen Sie Ihre Verfügbarkeit ein']),
          U.el('p', {}, [hasAny
            ? 'Die Team-Leitung bittet Sie, Ihren Verfügbarkeits-Stundenplan zu prüfen. Stimmt er noch, bestätigen Sie ihn einfach.'
            : 'Die Team-Leitung bittet Sie, Ihre freien Zeiten einzutragen — nur dann kann der Dienstplan Sie berücksichtigen.']),
        ]),
        U.el('div', { class: 'cluster gap-2' }, [goBtn, confirmBtn]),
      ]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Schnell-Meldung "Ich falle aus" (z. B. morgens krank): direkt oben im
   * Dashboard, ohne erst durch die Reiter zu suchen.
   * ------------------------------------------------------------------- */

  const QUICK_DUTY_COUNT = 3;

  const relativeDayLabel = U.relativeDayLabel; // "Heute" / "Morgen" / null

  function personName(id) {
    const person = id && SSD.StudentService.getById(id);
    return person ? SSD.StudentService.fullName(person) : '(gelöscht)';
  }

  function urgencyBadge(dateIso) {
    const label = relativeDayLabel(dateIso);
    return label ? U.el('span', { class: `badge ${label === 'Heute' ? 'badge--danger' : 'badge--warning'}` }, [label]) : null;
  }

  function dutyWhen(entry) {
    return `${U.WEEKDAY_LABELS_SHORT[entry.weekday]}, ${U.formatDateShort(U.parseIsoDate(entry.date))} · ${U.blockLabel(entry.block)}`;
  }

  /** Mit wem die Person den Dienst macht (andere Sanis und ggf. Azubi). */
  function partnerNames(entry, personId) {
    const ids = entry.studentIds.filter((id) => id !== personId);
    if (entry.azubiId && entry.azubiId !== personId) ids.push(entry.azubiId);
    return ids.map((id) => SSD.StudentService.getById(id)).filter(Boolean).map((p) => SSD.StudentService.fullName(p));
  }

  /** Was nach "Vertretung anfordern" passiert — abhängig von der Einstellung "automatisch einteilen". */
  function substitutionExplanation() {
    return SSD.SelfServiceService.isAutoSubstitutionEnabled()
      ? 'Die App teilt sofort eine verfügbare Vertretung ein (nach denselben Regeln wie der Dienstplan). Ist gerade niemand verfügbar, bleibt der Dienst als „Vertretung gesucht“ offen und Sie bleiben eingeteilt, bis jemand übernimmt.'
      : 'Sie bleiben eingeteilt, bis jemand den Dienst übernimmt. Der Dienst erscheint sofort bei den anderen unter „Offene Dienste“.';
  }

  /** Ergebnis-Meldung nach einer (automatischen) Vertretungsanfrage. */
  function showSubstitutionResult(result) {
    if (!result.requested) {
      SSD.Toast.info('Keine Änderung', 'Für diese Dienste besteht bereits eine Anfrage.');
      return;
    }
    const replaced = result.replaced.map((r) => personName(r.replacementId));
    const openCount = result.open.length;
    if (replaced.length && !openCount) {
      SSD.Toast.show({
        type: 'success', duration: 9000, title: 'Vertretung eingeteilt',
        message: replaced.length === 1
          ? `${replaced[0]} übernimmt Ihren Dienst und sieht beim Anmelden einen Hinweis. Danke für die Meldung!`
          : `${replaced.length} Dienste sind vertreten (${Array.from(new Set(replaced)).join(', ')}). Danke für die Meldung!`,
      });
    } else if (replaced.length) {
      SSD.Toast.show({
        type: 'warning', duration: 10000, title: 'Teilweise vertreten',
        message: `${replaced.length} Dienst(e) sind vertreten (${Array.from(new Set(replaced)).join(', ')}). Für ${openCount} ist gerade niemand verfügbar — dort wird weiter eine Vertretung gesucht, Sie bleiben eingeteilt.`,
      });
    } else if (SSD.SelfServiceService.isAutoSubstitutionEnabled()) {
      SSD.Toast.show({
        type: 'warning', duration: 10000, title: 'Vertretung gesucht',
        message: 'Gerade ist niemand verfügbar. Der Dienst ist jetzt für andere als offen sichtbar; die Team-Leitung sieht Ihre Anfrage. Sie bleiben eingeteilt, bis jemand übernimmt.',
      });
    } else {
      SSD.Toast.success('Vertretung angefordert', openCount === 1
        ? 'Danke für die Meldung — der Dienst ist jetzt für andere als offen sichtbar.'
        : `Danke für die Meldung — ${openCount} Dienste sind jetzt für andere als offen sichtbar.`);
    }
  }

  async function requestSubstitutionFor(student, duty) {
    const day = relativeDayLabel(duty.date);
    const auto = SSD.SelfServiceService.isAutoSubstitutionEnabled();
    const ok = await SSD.Dialog.confirm({
      title: 'Vertretung anfordern',
      message: `Für ${day ? `${day.toLowerCase()}, ` : ''}${dutyWhen(duty)} ${auto ? 'eine Vertretung einteilen lassen' : 'eine Vertretung anfordern'}? ${substitutionExplanation()}`,
      confirmLabel: 'Vertretung anfordern',
    });
    if (!ok) return;
    showSubstitutionResult(SSD.SelfServiceService.requestSubstitutions(student.id, [duty.id]));
    refreshAll();
  }

  function withdrawSubstitutionFor(student, duty) {
    SSD.SelfServiceService.cancelSubstitutionRequest(student.id, duty);
    SSD.Toast.info('Zurückgezogen', 'Ihre Vertretungsanfrage wurde zurückgezogen.');
    refreshAll();
  }

  /** Dialog "Ich falle aus": Zeitraum wählen, alle betroffenen Dienste sind vorausgewählt. */
  function openAbsenceQuickDialog(student) {
    const S = SSD.SelfServiceService;
    const today = U.today();
    const todayIso = U.toIsoDate(today);
    const friday = U.addDays(U.getMondayOfWeek(today), 4);
    const presets = [
      { label: 'Nur heute', iso: todayIso },
      { label: 'Bis morgen', iso: U.toIsoDate(U.addDays(today, 1)) },
      { label: 'Bis Ende der Woche', iso: U.toIsoDate(friday < today ? U.addDays(friday, 7) : friday) },
    ].filter((p, i, all) => all.findIndex((q) => q.iso === p.iso) === i);

    const untilInput = U.el('input', { class: 'input', type: 'date', min: todayIso, value: todayIso, style: 'width:auto;' });
    const presetBtns = presets.map((preset) => {
      const btn = U.el('button', { class: 'btn btn--secondary btn--sm', type: 'button' }, [preset.label]);
      btn.addEventListener('click', () => { untilInput.value = preset.iso; renderList(); });
      return { btn, preset };
    });
    const listWrap = U.el('div', { class: 'attendance-list' });
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });
    let boxes = [];
    let submitBtn = null;

    function updateSubmit() {
      const count = boxes.filter((b) => b.input.checked).length;
      if (!submitBtn) return;
      submitBtn.disabled = !count;
      submitBtn.textContent = count ? `Vertretung anfordern (${count})` : 'Vertretung anfordern';
    }

    function renderList() {
      if (!untilInput.value || untilInput.value < todayIso) untilInput.value = todayIso;
      const until = untilInput.value;
      presetBtns.forEach(({ btn, preset }) => btn.classList.toggle('btn--primary', preset.iso === until));
      presetBtns.forEach(({ btn, preset }) => btn.classList.toggle('btn--secondary', preset.iso !== until));
      const duties = S.getUpcomingDutiesOf(student.id).filter((d) => d.date <= until);
      listWrap.innerHTML = '';
      boxes = [];
      if (!duties.length) {
        listWrap.appendChild(U.el('p', { class: 'text-tertiary', style: 'margin:6px 0;' }, ['In diesem Zeitraum haben Sie keine Dienste — es ist nichts weiter zu tun.']));
      }
      duties.forEach((duty) => {
        const already = S.hasOpenRequest(student.id, duty);
        const input = U.el('input', { type: 'checkbox', checked: true, disabled: already });
        input.addEventListener('change', updateSubmit);
        if (!already) boxes.push({ input, id: duty.id });
        const partners = partnerNames(duty, student.id);
        listWrap.appendChild(U.el('label', { class: 'checkbox-row' }, [
          input,
          U.el('span', {}, [dutyWhen(duty)]),
          urgencyBadge(duty.date),
          already ? U.el('span', { class: 'badge badge--warning' }, ['bereits angefragt']) : null,
          partners.length ? U.el('span', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [`mit ${partners.join(' & ')}`]) : null,
        ]));
      });
      updateSubmit();
    }
    untilInput.addEventListener('change', renderList);

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      U.el('div', { class: 'field' }, [
        U.el('span', { class: 'field__label' }, ['Ich falle voraussichtlich aus bis einschließlich']),
        U.el('div', { class: 'cluster gap-2' }, [untilInput, ...presetBtns.map((p) => p.btn)]),
      ]),
      U.el('div', { class: 'field' }, [U.el('span', { class: 'field__label' }, ['Für diese Dienste wird eine Vertretung gesucht']), listWrap]),
      U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, [
        `${substitutionExplanation()} Sanisprecher:innen und Administration sehen Ihre Abmeldung. Die Krankmeldung bei der Schule ersetzt das nicht.`,
      ]),
    ]);

    const handle = SSD.Dialog.open({
      title: 'Ich falle aus',
      body,
      wide: true,
      footerButtons: [
        { label: 'Abbrechen', variant: 'secondary' },
        {
          label: 'Vertretung anfordern', variant: 'primary', closeOnClick: false,
          onClick: () => {
            const ids = boxes.filter((b) => b.input.checked).map((b) => b.id);
            if (!ids.length) { errorBox.textContent = 'Bitte mindestens einen Dienst auswählen.'; errorBox.style.display = 'flex'; return; }
            showSubstitutionResult(S.requestSubstitutions(student.id, ids));
            handle.close();
            refreshAll();
          },
        },
      ],
    });
    submitBtn = handle.el.querySelector('.modal__footer .btn--primary');
    renderList();
  }

  /**
   * Hinweis für Personen, die die App automatisch als Vertretung eingeteilt
   * hat — bleibt sichtbar, bis sie "Verstanden" tippen (Team-Leitung und
   * Administrator sehen, ob der Hinweis bestätigt wurde).
   */
  function buildAutoSubstitutionNotice(student) {
    const unseen = SSD.SelfServiceService.getUnseenAutoSubstitutions(student.id);
    if (!unseen.length) return null;
    const okBtn = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('check', { size: 14 }) }, ['Verstanden']);
    okBtn.addEventListener('click', () => {
      SSD.SelfServiceService.acknowledgeAutoSubstitutions(student.id);
      SSD.Toast.success('Danke!', 'Die Dienste stehen unter „Meine nächsten Dienste“.');
      refreshAll();
    });
    const lines = unseen.map(({ entry, originalId }) => {
      const day = relativeDayLabel(entry.date);
      const partners = partnerNames(entry, student.id);
      return U.el('li', {}, [
        U.el('strong', {}, [`${day ? `${day}, ` : ''}${dutyWhen(entry)}`]),
        ` — für ${personName(originalId)}${partners.length ? ` (mit ${partners.join(' & ')})` : ''}`,
      ]);
    });
    return U.el('div', { class: 'notice-box notice-box--info', role: 'alert' }, [
      U.el('span', { html: SSD.Icons.svg('handRaised', { size: 20 }) }),
      U.el('div', { class: 'stack gap-3' }, [
        U.el('div', {}, [
          U.el('strong', {}, [unseen.length === 1 ? 'Sie wurden als Vertretung eingeteilt' : `Sie wurden für ${unseen.length} Dienste als Vertretung eingeteilt`]),
          U.el('ul', { class: 'notice-list' }, lines),
          U.el('p', {}, ['Die App hat Sie automatisch eingeteilt, weil Sie zu dieser Zeit als verfügbar eingetragen sind. Können Sie doch nicht? Dann beim Dienst auf „Vertretung anfordern“ tippen — die App sucht sofort die nächste Person.']),
        ]),
        U.el('div', { class: 'cluster gap-2' }, [okBtn]),
      ]),
    ]);
  }

  /** Karte "Meine nächsten Dienste" — mit Vertretungsanfrage je Dienst und "Ich falle aus …". */
  function buildQuickDutiesCard(student) {
    const S = SSD.SelfServiceService;
    const duties = S.getUpcomingDutiesOf(student.id);
    const covered = S.getCoveredDutiesOf(student.id);
    if (!duties.length && !covered.length) return null;

    const absenceBtn = duties.length ? U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('userAbsent', { size: 14 }) }, ['Ich falle aus …']) : null;
    if (absenceBtn) absenceBtn.addEventListener('click', () => openAbsenceQuickDialog(student));

    const rows = duties.slice(0, QUICK_DUTY_COUNT).map((duty) => {
      const requested = S.hasOpenRequest(student.id, duty);
      const viaLog = S.latestLogFor(duty, student.id);
      const autoFor = viaLog && viaLog.auto ? viaLog.originalStudentId : null;
      let action;
      if (requested) {
        action = U.el('button', { class: 'btn btn--ghost btn--sm', html: SSD.Icons.svg('x', { size: 13 }) }, ['Zurückziehen']);
        action.addEventListener('click', () => withdrawSubstitutionFor(student, duty));
      } else {
        action = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('handRaised', { size: 14 }) }, ['Vertretung anfordern']);
        action.addEventListener('click', () => requestSubstitutionFor(student, duty));
      }
      const partners = partnerNames(duty, student.id);
      return U.el('div', { class: 'quick-duty' }, [
        U.el('div', { class: 'quick-duty__main' }, [
          U.el('div', { class: 'cluster gap-2' }, [
            urgencyBadge(duty.date),
            U.el('strong', {}, [dutyWhen(duty)]),
            requested ? U.el('span', { class: 'badge badge--warning' }, ['Vertretung gesucht']) : null,
            autoFor ? U.el('span', { class: 'badge badge--primary' }, [`Vertretung für ${personName(autoFor)}`]) : null,
          ]),
          partners.length ? U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [`mit ${partners.join(' & ')}`]) : null,
        ]),
        action,
      ]);
    });

    // Abgegebene Dienste: Wer macht sie jetzt? (Beruhigung für die abgemeldete Person)
    const coveredRows = covered.slice(0, QUICK_DUTY_COUNT).map(({ entry, replacementId }) => U.el('div', { class: 'quick-duty quick-duty--covered' }, [
      U.el('div', { class: 'quick-duty__main' }, [
        U.el('div', { class: 'cluster gap-2' }, [
          urgencyBadge(entry.date),
          U.el('span', { style: 'text-decoration:line-through; color:var(--text-tertiary);' }, [dutyWhen(entry)]),
          U.el('span', { class: 'badge badge--success', html: SSD.Icons.svg('check', { size: 11 }) }, [replacementId ? `${personName(replacementId)} übernimmt` : 'abgegeben']),
        ]),
      ]),
    ]));

    const auto = S.isAutoSubstitutionEnabled();
    const more = duties.length - QUICK_DUTY_COUNT;
    return U.el('section', { class: 'card', 'aria-label': 'Meine nächsten Dienste' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Meine nächsten Dienste']),
          U.el('div', { class: 'card__subtitle' }, [auto
            ? 'Krank oder verhindert? Hier abmelden — die App teilt sofort eine verfügbare Vertretung ein.'
            : 'Krank oder verhindert? Hier direkt eine Vertretung anfordern.']),
        ]),
        absenceBtn,
      ]),
      U.el('div', { class: 'card__body' }, [
        ...rows,
        !duties.length ? U.el('p', { class: 'text-tertiary', style: 'margin:0 0 4px;' }, ['Aktuell keine weiteren Dienste.']) : null,
        more > 0 ? U.el('p', { class: 'text-tertiary', style: 'margin:8px 0 0; font-size:var(--font-size-xs);' }, [`… und ${more} weitere unter „Meine Verfügbarkeit“.`]) : null,
        coveredRows.length ? U.el('div', { class: 'section-label', style: 'margin-top:14px;' }, ['Abgegeben']) : null,
        ...coveredRows,
      ]),
    ]);
  }

  /** Bereich über den Tabs: Vertretungs-Hinweis, nächste Dienste, Erinnerung (falls vorhanden) und Pinnwand. */
  function buildTopArea(student) {
    const area = U.el('div', { class: 'stack gap-4' });
    const autoNotice = buildAutoSubstitutionNotice(student);
    if (autoNotice) area.appendChild(autoNotice);
    const quickDuties = buildQuickDutiesCard(student);
    if (quickDuties) area.appendChild(quickDuties);
    if (SSD.StudentService.needsAvailabilityReminder(student)) area.appendChild(buildAvailabilityReminder(student));
    const board = SSD.AnnouncementBoard.render({ onChange: refreshAll });
    if (board) area.appendChild(board);
    if (!area.children.length) area.style.display = 'none';
    return area;
  }

  function buildTabSwitcher(student) {
    const openSeatCount = SSD.SelfServiceService.getOpenSeatsForPerson(student).length;
    const tabDefs = [
      { key: 'availability', label: 'Meine Verfügbarkeit' },
      { key: 'schedule', label: 'Dienstplan (alle)' },
      { key: 'openDuties', label: 'Offene Dienste', badge: openSeatCount || null },
      { key: 'tasks', label: 'Aufgaben', badge: SSD.TasksService.getOpen().length || null },
      { key: 'events', label: 'Veranstaltungen' },
      { key: 'meetings', label: 'Teamtreffen', badge: SSD.MeetingsService.countUnanswered(student.id) || null },
      { key: 'materials', label: 'Material' },
    ];
    if (SSD.StudentService.isTeamLead(student)) {
      const pendingRequests = SSD.SelfServiceService.getOpenSeats().filter((s) => s.reason === 'requested').length;
      const pendingRegistrations = SSD.StudentService.getPendingApprovalCount();
      tabDefs.push({ key: 'teamLead', label: 'Team-Verwaltung', badge: (pendingRequests + pendingRegistrations) || null });
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
    // Bei einer Vertretungsanfrage ersetzt man die anfragende Person — sie gehört nicht zu "Mit …".
    const otherOccupants = seat.seatType === 'student'
      ? entry.studentIds.filter((id) => id !== seat.requestedBy).map((id) => SSD.StudentService.getById(id)).filter(Boolean)
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
          urgencyBadge(entry.date),
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
      refreshAll();
    });

    // Team-Leitung: selbst angelegte Aufgaben bearbeiten/löschen (siehe SSD.TasksService.canManage).
    const manageButtons = [];
    if (SSD.TasksService.canManage(task)) {
      const editBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Bearbeiten', 'aria-label': 'Bearbeiten', html: SSD.Icons.svg('edit', { size: 14 }) });
      editBtn.addEventListener('click', () => SSD.TaskEditor.open(task, { onSaved: refreshAll }));
      const deleteBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Löschen', 'aria-label': 'Löschen', html: SSD.Icons.svg('trash', { size: 14 }) });
      deleteBtn.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({ title: 'Aufgabe löschen', danger: true, message: `"${task.title}" wirklich löschen?` });
        if (!ok) return;
        try {
          SSD.TasksService.remove(task.id);
          SSD.Toast.success('Gelöscht', 'Aufgabe entfernt.');
        } catch (err) {
          SSD.Toast.error('Nicht möglich', String(err.message || err));
        }
        refreshAll();
      });
      manageButtons.push(editBtn, deleteBtn);
    }

    return U.el('div', { class: 'card animate-rise-in' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, [task.title]),
          task.dueDate ? U.el('div', { class: 'card__subtitle' }, [`${overdue ? 'Überfällig: ' : 'Fällig: '}${U.formatDateLong(U.parseIsoDate(task.dueDate))}`]) : null,
        ]),
        U.el('div', { class: 'cluster gap-1' }, [
          overdue ? U.el('span', { class: 'badge badge--danger' }, ['Überfällig']) : null,
          ...manageButtons,
        ]),
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        task.description ? U.el('p', { style: 'margin:0;' }, [task.description]) : null,
        U.el('div', { class: 'cluster gap-3', style: 'justify-content:space-between;' }, [
          U.el('span', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [`Von ${SSD.TaskEditor.creatorLabel(task)}`]),
          doneBtn,
        ]),
      ]),
    ]);
  }

  function buildTasksTab(student) {
    const tasks = SSD.TasksService.getOpen();
    const parts = [];
    if (SSD.Auth.canCoordinate()) {
      const addBtn = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('plus', { size: 14 }) }, ['Neue Aufgabe']);
      addBtn.addEventListener('click', () => SSD.TaskEditor.open(null, { onSaved: refreshAll }));
      parts.push(U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card__header' }, [
          U.el('div', {}, [
            U.el('div', { class: 'card__title' }, ['Aufgaben fürs Team']),
            U.el('div', { class: 'card__subtitle' }, ['Als Team-Leitung können Sie Aufgaben für alle anlegen und Ihre eigenen bearbeiten oder löschen.']),
          ]),
          addBtn,
        ]),
      ]));
    }
    if (!tasks.length) {
      parts.push(U.el('div', { class: 'card animate-rise-in' }, [
        U.el('div', { class: 'empty-state' }, [
          U.el('span', { html: SSD.Icons.svg('check', { size: 40 }) }),
          U.el('h3', {}, ['Aktuell keine offenen Aufgaben']),
          U.el('p', {}, ['Sobald die Administration oder die Sanisprecher:innen eine Aufgabe anlegen, erscheint sie hier.']),
        ]),
      ]));
    } else {
      tasks.forEach((task) => parts.push(buildTaskCard(student, task)));
    }
    return U.el('div', { class: 'stack gap-4' }, parts);
  }

  /* ---------------------------------------------------------------------
   * "Material": gemeinsame Materialliste (siehe SSD.MaterialService)
   * ------------------------------------------------------------------- */

  function openMaterialRequestModal(student, existing) {
    const isEdit = !!existing;
    const nameInput = U.el('input', { class: 'input', value: existing?.name || '', placeholder: 'z. B. Einmalhandschuhe Größe M' });
    const quantityInput = U.el('input', { class: 'input', value: existing?.quantity || '', placeholder: 'z. B. 2 Packungen' });
    const noteInput = U.el('textarea', { class: 'input', rows: '2', placeholder: U.FREE_TEXT_HINT }, [existing?.note || '']);
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
          urgencyBadge(entry.date),
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
   * Nutzt bewusst dieselben Bausteine wie der Administrator-Bereich
   * (SSD.SubstitutionFlow, SSD.GapFillFlow, SSD.TeamMembersPanel,
   * SSD.EngagementPanel) — dieselbe geprüfte Logik, aber ohne Zugriff auf
   * Einstellungen, Kontenverwaltung oder die volle Neuberechnung. Pinnwand,
   * Aufgaben und Teamtreffen bearbeitet die Team-Leitung direkt dort, wo
   * alle sie sehen (oben bzw. in den Reitern "Aufgaben" und "Teamtreffen").
   */
  function buildTeamLeadTab(student) {
    const pendingRequests = SSD.SelfServiceService.getOpenSeats().filter((s) => s.reason === 'requested').length;
    const pendingRegistrations = SSD.StudentService.getPendingApprovalCount();
    const showEngagement = SSD.SettingsService.get().leadsSeeEngagement !== false;
    const sections = [
      { key: 'overview', label: 'Überblick & Vertretungen', badge: pendingRequests },
      { key: 'members', label: 'Mitglieder', badge: pendingRegistrations },
      showEngagement ? { key: 'engagement', label: 'Engagement' } : null,
    ].filter(Boolean);
    if (!sections.some((section) => section.key === teamLeadSection)) teamLeadSection = 'overview';
    const nav = U.el('div', { class: 'tabs tabs--sub', role: 'tablist', 'aria-label': 'Team-Verwaltung' }, sections.map((section) => {
      const btn = U.el('button', { class: `tab${teamLeadSection === section.key ? ' is-active' : ''}`, role: 'tab', 'aria-selected': teamLeadSection === section.key ? 'true' : 'false' }, [
        section.label,
        section.badge ? U.el('span', { class: 'badge badge--warning', style: 'margin-left:6px;' }, [String(section.badge)]) : null,
      ]);
      btn.addEventListener('click', () => { teamLeadSection = section.key; renderTabBody(student); });
      return btn;
    }));

    let content;
    if (teamLeadSection === 'members') content = SSD.TeamMembersPanel.render({ onChange: refreshAll });
    else if (teamLeadSection === 'engagement') content = SSD.EngagementPanel.render({ onChange: refreshAll });
    else content = buildTeamLeadOverview(student);
    return U.el('div', { class: 'stack gap-5' }, [nav, content]);
  }

  function buildTeamLeadOverview(student) {
    const overview = SSD.StatisticsService.computeOverview();
    const openRequests = SSD.SelfServiceService.getOpenSeats().filter((s) => s.reason === 'requested');
    const roleLabel = SSD.Models.LEADERSHIP_ROLES.find((r) => r.key === student.leadershipRole)?.label || '';

    const statsCard = U.el('div', { class: 'card animate-rise-in' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Team-Überblick']),
          U.el('div', { class: 'card__subtitle' }, [`Erweiterte Ansicht für ${roleLabel} — Koordination des Teams, keine Einstellungen oder Neuberechnung des Dienstplans.`]),
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
      SSD.SubstitutionFlow.openAbsenceDialog({ options: { onApplied: refreshAll } });
    });
    const actionsCard = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__body' }, [
        U.el('p', { style: 'margin-top:0;' }, ['Meldet jemand aus dem Team, einen Dienst nicht wahrnehmen zu können, berechnen Sie hier — wie der Administrator — passende Ersatzpersonen und tragen sie direkt ein.']),
        absenceBtn,
      ]),
    ]);

    const gapCount = SSD.GapFillFlow.findGaps(U.getMondayOfWeek(U.today()), 4).length;
    const gapBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('puzzle', { size: 16 }) }, ['Lücken auffüllen …']);
    gapBtn.addEventListener('click', () => SSD.GapFillFlow.openModal({ onDone: refreshAll }));
    const gapCard = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Lücken im Dienstplan']),
          U.el('div', { class: 'card__subtitle' }, [gapCount
            ? `In dieser und den nächsten drei Wochen ${gapCount === 1 ? 'ist 1 Dienst' : `sind ${gapCount} Dienste`} ab heute unbesetzt oder unvollständig.`
            : 'In dieser und den nächsten drei Wochen sind ab heute alle Dienste vollständig besetzt.']),
        ]),
      ]),
      U.el('div', { class: 'card__body' }, [
        U.el('p', { style: 'margin-top:0;' }, ['Der Algorithmus besetzt offene Plätze nachträglich — wie beim Administrator, ohne den übrigen Dienstplan zu verändern. Als "Gesperrt" markierte Zeiten bleiben tabu.']),
        gapBtn,
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

    return U.el('div', { class: 'stack gap-5' }, [statsCard, actionsCard, requestsCard, SSD.AutoSubstitutionList.render(), gapCard]);
  }

  function renderTabBody(student) {
    tabBody.innerHTML = '';
    if (activeTab === 'teamLead' && !SSD.StudentService.isTeamLead(student)) activeTab = 'availability';
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
    if (activeTab === 'meetings') {
      tabBody.appendChild(SSD.MeetingsPanel.render({ viewer: student, onChange: refreshAll }));
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
    teamLeadSection = 'overview';

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

    topAreaEl = buildTopArea(student);
    inner.appendChild(topAreaEl);
    tabSwitcherEl = buildTabSwitcher(student);
    inner.appendChild(tabSwitcherEl);
    tabBody = U.el('div', { style: 'margin-top:20px;' });
    inner.appendChild(tabBody);
    renderTabBody(student);

    viewContainer.appendChild(inner);
    container.appendChild(viewContainer);

    // Änderungen von anderen Geräten (z. B. neuer Pinnwand-Beitrag): Hinweise, Pinnwand und
    // Zähler sofort aktualisieren — den gerade geöffneten Tab-Inhalt aber nicht unter den
    // Händen der Person austauschen (der aktualisiert sich bei der nächsten Aktion).
    offRemoteChanges = SSD.EventBus.on('store:changed', (evt) => {
      if (!evt || !evt.remote) return;
      const fresh = SSD.Auth.getCurrentStudent();
      if (!fresh || !fresh.active) { SSD.Auth.logout(); return; }
      if (activeTab === 'teamLead' && !SSD.StudentService.isTeamLead(fresh)) renderTabBody(fresh);
      refreshChrome(fresh);
    });
  }

  function destroy() {
    if (topbarCleanup) topbarCleanup();
    if (offRemoteChanges) offRemoteChanges();
    offRemoteChanges = null;
    topAreaEl = null;
    tabSwitcherEl = null;
  }

  return { render, destroy };
})();
