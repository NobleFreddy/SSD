/**
 * ============================================================================
 * SSD.Views.StudentDashboard — Schülerbereich
 * ============================================================================
 * Vier Bereiche — am Handy als Leiste am unteren Rand, am PC als Reiter:
 *   - Dienstplan (Start): „Verstärkung anfordern“ und „Ich falle aus“, heute
 *     und die aktuelle Woche, die nächsten eigenen Dienste, die Pinnwand
 *   - Meine Dienste: alle kommenden Dienste und Verstärkungen mit
 *     Vertretungsanfrage, abgegebene Dienste, offene Dienste zum Übernehmen
 *   - Verfügbarkeit: Stundenplan, Klausuren, Wunschpartner:innen
 *   - Team: Teamtreffen, Veranstaltungen, Aufgaben, Material, Team-Verwaltung
 * Hinweise, die eine Reaktion brauchen (als Vertretung bzw. Verstärkung
 * eingeteilt), stehen in jedem Bereich oben. Änderungen werden sofort
 * automatisch gespeichert.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.StudentDashboard = (function () {
  'use strict';

  const U = SSD.Utils;

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
      const session = SSD.Auth.getSession();
      const message = session && session.remembered
        ? 'Möchten Sie sich wirklich abmelden? Sie bleiben dann auf diesem Gerät nicht mehr angemeldet und brauchen beim nächsten Mal wieder Ihr Passwort.'
        : 'Möchten Sie sich wirklich abmelden?';
      const ok = await SSD.Dialog.confirm({ title: 'Abmelden', message, confirmLabel: 'Abmelden' });
      if (ok) SSD.Auth.logout();
    });

    const accountBtn = U.el('button', { class: 'btn btn--icon btn--ghost', 'data-tooltip': 'Mein Konto: Passwort, meine Daten, mein Engagement', 'aria-label': 'Mein Konto', html: SSD.Icons.svg('user') });
    accountBtn.addEventListener('click', () => SSD.AccountDialog.open());

    const saveIndicatorHandle = SSD.Views.AdminLayout.buildSaveIndicator();
    const leadershipLabel = SSD.Models.LEADERSHIP_ROLES.find((r) => r.key === student.leadershipRole)?.label;
    const topbar = U.el('header', { class: 'topbar' }, [
      U.el('div', { class: 'sidebar__brand-icon topbar__brand-icon' }, [U.el('img', { src: 'assets/logo.png', alt: 'Vereinslogo' })]),
      U.el('div', { class: 'topbar__title' }, [
        `Hallo, ${student.firstName}!`,
        leadershipLabel ? U.el('span', { class: 'badge badge--primary topbar__role', html: SSD.Icons.svg('star', { size: 11 }) }, [leadershipLabel]) : null,
      ]),
      saveIndicatorHandle.el,
      accountBtn,
      themeToggle,
      logoutBtn,
    ]);
    return { el: topbar, cleanup: saveIndicatorHandle.cleanup };
  }

  /** Verfügbarkeit: Standardwoche und die kommenden Wochen (SSD.AvailabilityEditor). */
  function buildAvailabilityCard(student) {
    const hadReminder = SSD.StudentService.needsAvailabilityReminder(student);
    return U.el('div', { class: 'card animate-rise-in' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Meine Verfügbarkeit']),
          U.el('div', { class: 'card__subtitle' }, [`Standardwoche und, wenn eine Woche anders aussieht, bis zu ${SSD.AvailabilityService.WEEKS_AHEAD} Wochen im Voraus.`]),
        ]),
      ]),
      U.el('div', { class: 'card__body' }, [SSD.AvailabilityEditor.render({
        studentId: student.id,
        onChange: () => { if (hadReminder) refreshChrome(SSD.Auth.getCurrentStudent()); }, // Erinnerungs-Hinweis ist damit erledigt
      })]),
    ]);
  }

  function buildExamsCard(student) {
    return U.el('div', { class: 'card animate-rise-in' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Klausuren & feste Termine'])]),
      U.el('div', { class: 'card__body' }, [SSD.ExamsPanel.render({ studentId: student.id })]),
    ]);
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

  let topbarCleanup = null;
  let offRemoteChanges = null;
  let activeTab = 'start'; // 'start' | 'duties' | 'availability' | 'team'
  let teamSection = 'meetings'; // Unterreiter von „Team“: 'meetings' | 'events' | 'tasks' | 'materials' | 'teamLead'
  let teamLeadSection = 'overview'; // Unterreiter der Team-Verwaltung: 'overview' | 'members' | 'engagement'
  let plan = null; // Auswahl im Dienstplan: { monday: Date, dayIso: string, todayIso: string } (siehe resetPlan)
  let onVisible = null;
  let tabBody = null;
  let navEl = null;
  let topAreaEl = null;

  /**
   * Zeichnet Hinweise, die Tab-Leiste (Zähler) und den aktiven Tab neu —
   * immer mit dem aktuellen Datenstand der angemeldeten Person (nach einem
   * Realtime-Update ist das zuvor gemerkte Personen-Objekt veraltet).
   */
  function refreshAll() {
    const student = SSD.Auth.getCurrentStudent();
    if (!student) return;
    refreshChrome(student);
    renderTabBody(student);
  }

  /** Nur Hinweise und Navigation — der gerade bearbeitete Inhalt bleibt stehen. */
  function refreshChrome(student) {
    if (topAreaEl) {
      const freshTop = buildTopArea(student);
      topAreaEl.replaceWith(freshTop);
      topAreaEl = freshTop;
    }
    if (navEl) {
      const freshNav = buildNav(student);
      navEl.replaceWith(freshNav);
      navEl = freshNav;
    }
  }

  /** Erinnerung der Team-Leitung, die Verfügbarkeit einzutragen bzw. zu prüfen (siehe SSD.TeamMembersPanel). */
  function buildAvailabilityReminder(student) {
    const hasAny = SSD.StatisticsService.hasAnyAvailability(student);
    const goBtn = U.el('button', { class: 'btn btn--primary btn--sm' }, ['Zur Verfügbarkeit']);
    goBtn.addEventListener('click', () => switchSection('availability'));
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
   * Schnell-Meldung "Ich falle aus" (z. B. morgens krank): direkt auf der
   * Startseite, ohne erst durch die Bereiche zu suchen.
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
      SSD.Toast.success('Danke!', 'Die Dienste stehen unter „Meine Dienste“.');
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

  /** „Fr, 27.11. · 3./4. Stunde“ */
  function slotWhen(dateIso, block) {
    const date = U.parseIsoDate(dateIso);
    return `${U.WEEKDAY_LABELS_SHORT[U.weekdayKeyFromDate(date)]}, ${U.formatDateShort(date)} · ${U.blockLabel(block)}`;
  }

  /** Kommende eigene Einsätze — Dienste und Verstärkungen, nach Zeit sortiert. */
  function upcomingItems(student) {
    const duties = SSD.SelfServiceService.getUpcomingDutiesOf(student.id).map((entry) => ({ type: 'duty', key: entry.date + entry.block, entry }));
    const extra = SSD.ReinforcementService.upcomingFor(student.id).map(({ request }) => ({ type: 'reinforcement', key: request.date + request.block, request }));
    return duties.concat(extra).sort((a, b) => a.key.localeCompare(b.key));
  }

  function dutyRow(student, duty, compact) {
    const S = SSD.SelfServiceService;
    const requested = S.hasOpenRequest(student.id, duty);
    const viaLog = S.latestLogFor(duty, student.id);
    const autoFor = viaLog && viaLog.auto ? viaLog.originalStudentId : null;
    let action = null;
    if (!compact && requested) {
      action = U.el('button', { class: 'btn btn--ghost btn--sm', html: SSD.Icons.svg('x', { size: 13 }) }, ['Zurückziehen']);
      action.addEventListener('click', () => withdrawSubstitutionFor(student, duty));
    } else if (!compact) {
      action = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('handRaised', { size: 14 }) }, ['Vertretung anfordern']);
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
  }

  function reinforcementRow(student, req, compact) {
    let action = null;
    if (!compact) {
      action = U.el('button', { class: 'btn btn--ghost btn--sm', html: SSD.Icons.svg('x', { size: 13 }) }, ['Kann nicht']);
      action.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({
          title: 'Kann nicht kommen', confirmLabel: 'Absagen',
          message: `${req.requestedBy ? personName(req.requestedBy) : 'Die anfordernde Person'} sieht das und kann jemand anderen einteilen.`,
        });
        if (!ok) return;
        try {
          SSD.ReinforcementService.decline(req.id, student.id);
          SSD.Toast.info('Abgesagt', 'Danke für die Rückmeldung.');
        } catch (err) {
          SSD.Toast.error('Nicht möglich', String(err.message || err));
        }
        refreshAll();
      });
    }
    return U.el('div', { class: 'quick-duty' }, [
      U.el('div', { class: 'quick-duty__main' }, [
        U.el('div', { class: 'cluster gap-2' }, [
          urgencyBadge(req.date),
          U.el('strong', {}, [slotWhen(req.date, req.block)]),
          U.el('span', { class: 'badge badge--primary', html: SSD.Icons.svg('team', { size: 11 }) }, ['Verstärkung']),
        ]),
        U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [
          [req.note, req.requestedBy ? `angefordert von ${personName(req.requestedBy)}` : null].filter(Boolean).join(' · '),
        ]),
      ]),
      action,
    ]);
  }

  /**
   * „Meine nächsten Dienste“ — kompakt auf der Startseite (die nächsten drei,
   * ohne Knöpfe), vollständig unter „Meine Dienste“ (je Dienst „Vertretung
   * anfordern“, „Ich falle aus …“, abgegebene Dienste).
   */
  function buildMyDutiesCard(student, compact) {
    const S = SSD.SelfServiceService;
    const items = upcomingItems(student);
    const covered = compact ? [] : S.getCoveredDutiesOf(student.id);
    if (compact && !items.length) return null;
    const shown = compact ? items.slice(0, QUICK_DUTY_COUNT) : items;
    const rows = shown.map((item) => (item.type === 'duty' ? dutyRow(student, item.entry, compact) : reinforcementRow(student, item.request, compact)));

    let headerAction = null;
    if (compact) {
      headerAction = U.el('button', { class: 'btn btn--ghost btn--sm', 'aria-label': 'Alle eigenen Dienste anzeigen' }, ['Alle']);
      headerAction.addEventListener('click', () => switchSection('duties'));
    } else if (S.getUpcomingDutiesOf(student.id).length) {
      headerAction = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('userAbsent', { size: 14 }) }, ['Ich falle aus …']);
      headerAction.addEventListener('click', () => openAbsenceQuickDialog(student));
    }

    const coveredRows = covered.map(({ entry, replacementId }) => U.el('div', { class: 'quick-duty quick-duty--covered' }, [
      U.el('div', { class: 'quick-duty__main' }, [
        U.el('div', { class: 'cluster gap-2' }, [
          urgencyBadge(entry.date),
          U.el('span', { style: 'text-decoration:line-through; color:var(--text-tertiary);' }, [dutyWhen(entry)]),
          U.el('span', { class: 'badge badge--success', html: SSD.Icons.svg('check', { size: 11 }) }, [replacementId ? `${personName(replacementId)} übernimmt` : 'abgegeben']),
        ]),
      ]),
    ]));

    const more = items.length - shown.length;
    const summary = SSD.StudentService.getDutySummary(student.id);
    return U.el('section', { class: 'card', 'aria-label': 'Meine nächsten Dienste' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Meine nächsten Dienste']),
          compact ? null : U.el('div', { class: 'card__subtitle' }, [S.isAutoSubstitutionEnabled()
            ? 'Krank oder verhindert? Beim Dienst abmelden — die App teilt sofort eine verfügbare Vertretung ein.'
            : 'Krank oder verhindert? Beim Dienst eine Vertretung anfordern.']),
        ]),
        headerAction,
      ]),
      U.el('div', { class: 'card__body' }, [
        ...rows,
        !items.length ? U.el('p', { class: 'text-tertiary', style: 'margin:0 0 4px;' }, ['Aktuell keine Dienste geplant.']) : null,
        more > 0 ? U.el('p', { class: 'text-tertiary', style: 'margin:8px 0 0; font-size:var(--font-size-xs);' }, [`… und ${more} weitere unter „Meine Dienste“.`]) : null,
        coveredRows.length ? U.el('div', { class: 'section-label', style: 'margin-top:14px;' }, ['Abgegeben']) : null,
        ...coveredRows,
        compact ? null : U.el('p', { class: 'text-tertiary', style: 'margin:14px 0 0; font-size:var(--font-size-xs);' }, [
          `Bisher ${summary.past.length === 1 ? '1 Dienst' : `${summary.past.length} Dienste`} geleistet, ${summary.upcoming.length} geplant.`,
        ]),
      ]),
    ]);
  }

  /** Hinweise, die eine Reaktion brauchen — in jedem Bereich oben: als Vertretung bzw. als Verstärkung eingeteilt. */
  function buildTopArea(student) {
    const area = U.el('div', { class: 'stack gap-4' });
    const reinforcementNotice = SSD.ReinforcementUI.buildAssignmentNotice(student, refreshAll);
    if (reinforcementNotice) area.appendChild(reinforcementNotice);
    const autoNotice = buildAutoSubstitutionNotice(student);
    if (autoNotice) area.appendChild(autoNotice);
    if (!area.children.length) area.style.display = 'none';
    return area;
  }

  /* ---------------------------------------------------------------------
   * Reiter „Dienstplan“ (Startseite)
   * ---------------------------------------------------------------------
   * Am PC: die Wochentabelle, darüber der heutige Tag. Am Handy: ein Tag als
   * Liste, die anderen Tage der Woche einen Tipp entfernt.
   * ------------------------------------------------------------------- */

  function hasDutyBlocks(dateIso) {
    const weekday = U.weekdayKeyFromDate(U.parseIsoDate(dateIso));
    return !!weekday && !SSD.CalendarService.getSpecialDayForDate(dateIso) && SSD.CalendarService.getEnabledBlocksForWeekday(weekday).length > 0;
  }

  /** Heute — oder, an freien Tagen, der nächste Tag mit Diensten (höchstens 60 Tage voraus). */
  function focusDayIso() {
    const today = U.today();
    for (let i = 0; i <= 60; i++) {
      const iso = U.toIsoDate(U.addDays(today, i));
      if (hasDutyBlocks(iso)) return iso;
    }
    return U.toIsoDate(U.isWeekend(today) ? U.addDays(U.getMondayOfWeek(today), 7) : today);
  }

  /** Zeigt wieder heute bzw. den nächsten Diensttag. */
  function resetPlan() {
    const dayIso = focusDayIso();
    plan = { monday: U.getMondayOfWeek(U.parseIsoDate(dayIso)), dayIso, todayIso: U.toIsoDate(U.today()) };
  }

  function showWeek(monday) {
    const focus = focusDayIso();
    const dates = U.getWeekDates(monday).map((d) => U.toIsoDate(d));
    plan.monday = monday;
    plan.dayIso = dates.includes(focus) ? focus : dates.find(hasDutyBlocks) || dates[0];
  }

  function isOwnDuty(entry, personId) {
    return !!entry && (entry.studentIds.includes(personId) || entry.azubiId === personId);
  }

  /** „Heute · Mittwoch, 25.11.“ */
  function planDayTitle(dayIso) {
    const date = U.parseIsoDate(dayIso);
    const label = relativeDayLabel(dayIso);
    const day = `${U.WEEKDAY_LABELS[U.weekdayKeyFromDate(date)]}, ${U.formatDateShort(date)}`;
    if (label) return `${label} · ${day}`;
    return dayIso === focusDayIso() ? `Nächster Diensttag · ${day}` : day;
  }

  /** Ein Tag als Liste: je Dienstblock, wer eingeteilt ist. */
  function buildPlanDay(student) {
    const dayIso = plan.dayIso;
    const weekday = U.weekdayKeyFromDate(U.parseIsoDate(dayIso));
    const perDuty = SSD.SettingsService.get().studentsPerDuty;
    const specialDay = SSD.CalendarService.getSpecialDayForDate(dayIso);
    const extraFor = (key) => SSD.ReinforcementService.peopleForSlot(dayIso, key);
    // Verstärkung kann auch außerhalb der regulären Dienstzeiten angefordert sein (z. B. Sportfest).
    const blocks = U.DUTY_BLOCKS.filter((b) => (!specialDay && SSD.CalendarService.isBlockEnabled(weekday, b.key)) || extraFor(b.key).length);

    const rows = blocks.map((block) => {
      const entry = SSD.ScheduleTable.findEntry(dayIso, block.key);
      const extra = extraFor(block.key);
      const mine = isOwnDuty(entry, student.id) || extra.includes(student.id);
      const requests = entry ? SSD.SelfServiceService.activeRequestsOf(entry).map((r) => r.studentId) : [];
      const person = (id, azubi) => U.el('span', { class: `plan-person${id === student.id ? ' plan-person--me' : ''}` }, [
        id === student.id ? 'Sie' : personName(id),
        azubi ? U.el('span', { class: 'badge badge--primary plan-person__tag' }, ['Azubi']) : null,
        requests.includes(id) ? U.el('span', { class: 'badge badge--warning plan-person__tag' }, ['Vertretung gesucht']) : null,
      ]);
      const ids = entry ? entry.studentIds : [];
      const free = Math.max(0, perDuty - ids.length);
      const people = ids.map((id) => person(id));
      if (entry && entry.azubiId) people.push(person(entry.azubiId, true));
      const regular = !specialDay && SSD.CalendarService.isBlockEnabled(weekday, block.key);
      if (regular && !ids.length) people.push(U.el('span', { class: 'plan-person plan-person--free' }, ['noch niemand eingeteilt']));
      else if (regular && free) people.push(U.el('span', { class: 'plan-person plan-person--free' }, [free === 1 ? '1 Platz frei' : `${free} Plätze frei`]));
      if (extra.length) {
        people.push(U.el('span', { class: 'plan-person plan-person--extra' }, [
          U.el('span', { class: 'badge badge--primary plan-person__tag', html: SSD.Icons.svg('team', { size: 10 }) }, ['Verstärkung']),
          extra.map((id) => (id === student.id ? 'Sie' : personName(id))).join(', '),
        ]));
      }
      return U.el('div', { class: `plan-row${mine ? ' plan-row--mine' : ''}` }, [
        U.el('div', { class: 'plan-row__block' }, [block.label]),
        U.el('div', { class: 'plan-row__people' }, people),
        mine ? U.el('span', { class: 'badge badge--primary plan-row__badge' }, ['Ihr Dienst']) : null,
      ]);
    });

    const todaySpecial = dayIso !== plan.todayIso && dayIso === focusDayIso() ? SSD.CalendarService.getSpecialDayForDate(plan.todayIso) : null;
    const specialLabel = (d) => [SSD.Models.SPECIAL_DAY_TYPES.find((t) => t.key === d.type).label, d.label].filter(Boolean).join(': ');
    return U.el('div', { class: `plan-day${dayIso === focusDayIso() ? ' is-focus' : ''}` }, [
      U.el('div', { class: 'plan-day__title' }, [planDayTitle(dayIso)]),
      todaySpecial ? U.el('p', { class: 'plan-day__note' }, [`Heute kein Dienst (${specialLabel(todaySpecial)}).`]) : null,
      specialDay && rows.length ? U.el('p', { class: 'plan-day__note' }, [`Kein regulärer Dienst (${specialLabel(specialDay)}).`]) : null,
      rows.length
        ? U.el('div', {}, rows)
        : U.el('p', { class: 'plan-day__note' }, [specialDay ? `Kein Dienst (${specialLabel(specialDay)}).` : 'Kein Dienst an diesem Tag.']),
    ]);
  }

  /** Mo–Fr zum Antippen (nur am Handy sichtbar); ein Punkt markiert Tage mit eigenem Dienst. */
  function buildPlanDayChips(student) {
    const buttons = U.getWeekDates(plan.monday).map((date, i) => {
      const iso = U.toIsoDate(date);
      const selected = iso === plan.dayIso;
      const own = SSD.Store.getState().schedule.entries.some((e) => e.date === iso && isOwnDuty(e, student.id))
        || SSD.ReinforcementService.upcomingFor(student.id).some((x) => x.request.date === iso);
      const btn = U.el('button', {
        type: 'button',
        'data-plan': `day${i}`,
        class: `plan-chip${selected ? ' is-active' : ''}${iso === plan.todayIso ? ' is-today' : ''}`,
        'aria-pressed': selected ? 'true' : 'false',
        'aria-label': `${U.WEEKDAY_LABELS[U.WEEKDAY_KEYS[i]]}, ${U.formatDateShort(date)}${own ? ', eigener Dienst' : ''}`,
      }, [
        U.el('span', { class: 'plan-chip__day' }, [U.WEEKDAY_LABELS_SHORT[U.WEEKDAY_KEYS[i]]]),
        U.el('span', { class: 'plan-chip__date' }, [U.formatDateShort(date)]),
        own ? U.el('span', { class: 'plan-chip__dot' }) : null,
      ]);
      btn.addEventListener('click', () => { plan.dayIso = iso; renderPlanCard(student); });
      return btn;
    });
    return U.el('div', { class: 'plan-chips' }, buttons);
  }

  let planCardEl = null;

  function buildPlanCard(student) {
    const step = (days) => { showWeek(U.addDays(plan.monday, days)); renderPlanCard(student); };
    const prevBtn = U.el('button', { class: 'btn btn--icon btn--secondary btn--sm', 'data-plan': 'prev', 'data-tooltip': 'Vorherige Woche', 'aria-label': 'Vorherige Woche', html: SSD.Icons.svg('chevronLeft', { size: 16 }) });
    prevBtn.addEventListener('click', () => step(-7));
    const nextBtn = U.el('button', { class: 'btn btn--icon btn--secondary btn--sm', 'data-plan': 'next', 'data-tooltip': 'Nächste Woche', 'aria-label': 'Nächste Woche', html: SSD.Icons.svg('chevronRight', { size: 16 }) });
    nextBtn.addEventListener('click', () => step(7));
    const focusMonday = U.getMondayOfWeek(U.parseIsoDate(focusDayIso()));
    const away = !U.isSameDay(plan.monday, focusMonday) || plan.dayIso !== focusDayIso();
    const backBtn = U.el('button', { class: `btn btn--ghost btn--sm plan-card__back${away ? '' : ' is-hidden'}` }, [focusDayIso() === plan.todayIso ? 'Heute' : 'Aktuell']);
    backBtn.addEventListener('click', () => { resetPlan(); renderPlanCard(student); });

    return U.el('section', { class: 'card plan-card', 'aria-label': 'Dienstplan' }, [
      U.el('div', { class: 'card__header plan-card__header' }, [
        U.el('div', { class: 'plan-card__heading' }, [
          U.el('div', { class: 'card__title' }, ['Dienstplan']),
          U.el('div', { class: 'card__subtitle' }, ['Alle eingeteilten Personen — Ihre eigenen Dienste sind hervorgehoben.']),
        ]),
        U.el('div', { class: 'plan-card__nav' }, [
          backBtn,
          prevBtn,
          U.el('strong', {}, [`KW ${U.getIsoWeekNumber(plan.monday)}`, U.el('span', { class: 'plan-card__range' }, [` · ${U.formatDateShort(plan.monday)}–${U.formatDateShort(U.addDays(plan.monday, 4))}`])]),
          nextBtn,
        ]),
      ]),
      U.el('div', { class: 'card__body' }, [
        buildPlanDayChips(student),
        buildPlanDay(student),
        U.el('div', { class: 'plan-week' }, [
          SSD.ScheduleTable.render(plan.monday, { highlightPersonId: student.id }),
          U.el('div', { style: 'margin-top:20px;' }, [SSD.ScheduleTable.renderLegend()]),
        ]),
      ]),
    ]);
  }

  /** Nur die Plan-Karte neu zeichnen (Tag/Woche gewechselt) — der Rest der Seite bleibt stehen. */
  function renderPlanCard(student) {
    if (!planCardEl) return;
    const focused = planCardEl.contains(document.activeElement) ? document.activeElement.getAttribute('data-plan') : null;
    const fresh = buildPlanCard(student);
    planCardEl.replaceWith(fresh);
    planCardEl = fresh;
    SSD.Tooltip.hide();
    const again = focused && fresh.querySelector(`[data-plan="${focused}"]:not(.is-hidden)`); // Tastaturbedienung
    if (again) again.focus({ preventScroll: true });
  }

  /** „Hinweis vom Administrator“ (persönlich, im Admin-Bereich bei der Person hinterlegt). */
  function buildAdminMessage(student) {
    if (!student.adminMessage) return null;
    return U.el('div', { class: 'notice-box' }, [
      U.el('span', { html: SSD.Icons.svg('bell', { size: 20 }) }),
      U.el('div', {}, [U.el('strong', {}, ['Hinweis vom Administrator']), U.el('p', { class: 'pre-wrap' }, [student.adminMessage])]),
    ]);
  }

  /** Startseite: schnelle Aktionen, Plan, nächste Dienste, Pinnwand. */
  function buildStartTab(student) {
    planCardEl = buildPlanCard(student);

    const helpBtn = U.el('button', { class: 'btn btn--primary start-action', html: SSD.Icons.svg('team', { size: 18 }) }, ['Verstärkung anfordern']);
    helpBtn.addEventListener('click', () => SSD.ReinforcementUI.openRequestDialog({ onDone: refreshAll }));
    const hasDuties = SSD.SelfServiceService.getUpcomingDutiesOf(student.id).length > 0;
    const absentBtn = hasDuties ? U.el('button', { class: 'btn btn--secondary start-action', html: SSD.Icons.svg('userAbsent', { size: 18 }) }, ['Ich falle aus']) : null;
    if (absentBtn) absentBtn.addEventListener('click', () => openAbsenceQuickDialog(student));
    const top = U.el('div', { class: 'start-top stack gap-4' }, [
      U.el('div', { class: `start-actions${absentBtn ? '' : ' start-actions--single'}` }, [helpBtn, absentBtn]),
      ...SSD.ReinforcementService.requestsBy(student.id).map((req) => SSD.ReinforcementUI.buildRequestCard(req, refreshAll)),
    ]);

    const side = U.el('div', { class: 'start-side stack gap-5' }, [
      buildAdminMessage(student),
      buildMyDutiesCard(student, true),
      SSD.StudentService.needsAvailabilityReminder(student) ? buildAvailabilityReminder(student) : null,
      SSD.AnnouncementBoard.render({ onChange: refreshAll }),
    ].filter(Boolean));
    return U.el('div', { class: 'start-layout' }, [top, planCardEl, side]);
  }

  /* ---------------------------------------------------------------------
   * Navigation: vier Bereiche (Handy: Leiste unten, PC: Reiter oben)
   * ------------------------------------------------------------------- */

  const SECTIONS = [
    { key: 'start', label: 'Dienstplan', short: 'Plan', icon: 'calendar' },
    { key: 'duties', label: 'Meine Dienste', short: 'Meine Dienste', icon: 'clock' },
    { key: 'availability', label: 'Verfügbarkeit', short: 'Verfügbar', icon: 'calendarCheck' },
    { key: 'team', label: 'Team', short: 'Team', icon: 'team' },
  ];

  function teamSections(student) {
    const list = [
      { key: 'meetings', label: 'Teamtreffen', badge: SSD.MeetingsService.countUnanswered(student.id) },
      { key: 'events', label: 'Veranstaltungen' },
      { key: 'tasks', label: 'Aufgaben', badge: SSD.TasksService.getOpen().length },
      { key: 'materials', label: 'Material' },
    ];
    if (SSD.StudentService.isTeamLead(student)) {
      const pendingRequests = SSD.SelfServiceService.getOpenSeats().filter((seat) => seat.reason === 'requested').length;
      list.push({ key: 'teamLead', label: 'Team-Verwaltung', badge: pendingRequests + SSD.StudentService.getPendingApprovalCount(), lead: true });
    }
    return list;
  }

  function switchSection(key) {
    activeTab = key;
    const student = SSD.Auth.getCurrentStudent();
    if (!student) return;
    refreshChrome(student);
    renderTabBody(student);
    window.scrollTo(0, 0);
  }

  function buildNav(student) {
    const team = teamSections(student);
    // Zahl am Bereich „Team“: was eine Antwort braucht (Teamtreffen, als Team-Leitung offene Anfragen)
    const teamBadge = team.filter((t) => t.key === 'meetings' || t.lead).reduce((n, t) => n + (t.badge || 0), 0);
    const marks = {
      availability: SSD.StudentService.needsAvailabilityReminder(student) ? '!' : null,
      team: teamBadge || null,
    };
    const items = SECTIONS.map((section) => {
      const active = activeTab === section.key;
      const btn = U.el('button', {
        type: 'button', class: `dash-nav__item${active ? ' is-active' : ''}`, 'aria-current': active ? 'page' : null,
      }, [
        U.el('span', { class: 'dash-nav__icon', html: SSD.Icons.svg(section.icon, { size: 20 }) }),
        U.el('span', { class: 'dash-nav__label dash-nav__label--long' }, [section.label]),
        U.el('span', { class: 'dash-nav__label dash-nav__label--short' }, [section.short]),
        marks[section.key] ? U.el('span', { class: 'dash-nav__badge' }, [String(marks[section.key])]) : null,
      ]);
      btn.addEventListener('click', () => switchSection(section.key));
      return btn;
    });
    return U.el('nav', { class: 'dash-nav', 'aria-label': 'Bereiche' }, items);
  }

  /* ---------------------------------------------------------------------
   * Bereiche „Meine Dienste“, „Verfügbarkeit“, „Team“
   * ------------------------------------------------------------------- */

  function buildDutiesSection(student) {
    return U.el('div', { class: 'two-col-layout two-col-layout--even' }, [
      buildMyDutiesCard(student, false),
      buildOpenDutiesTab(student),
    ]);
  }

  function buildAvailabilitySection(student) {
    const main = U.el('div', { class: 'stack gap-5' }, [buildAvailabilityCard(student), buildExamsCard(student)]);
    if ((student.role || 'student') !== 'student') return main;
    return U.el('div', { class: 'two-col-layout' }, [main, U.el('div', { class: 'stack gap-5' }, [buildWishCard(student)])]);
  }

  function buildTeamSection(student) {
    const sections = teamSections(student);
    if (!sections.some((t) => t.key === teamSection)) teamSection = 'meetings';
    const nav = U.el('div', { class: 'tabs tabs--sub tabs--wrap', role: 'tablist', 'aria-label': 'Team' }, sections.map((t) => {
      const btn = U.el('button', { class: `tab${teamSection === t.key ? ' is-active' : ''}`, role: 'tab', 'aria-selected': teamSection === t.key ? 'true' : 'false' }, [
        t.label,
        t.badge ? U.el('span', { class: 'badge badge--warning', style: 'margin-left:6px;' }, [String(t.badge)]) : null,
      ]);
      btn.addEventListener('click', () => { teamSection = t.key; renderTabBody(student); });
      return btn;
    }));
    let content;
    if (teamSection === 'events') content = buildEventsTab(student);
    else if (teamSection === 'tasks') content = buildTasksTab(student);
    else if (teamSection === 'materials') content = buildMaterialsTab(student);
    else if (teamSection === 'teamLead') content = buildTeamLeadTab(student);
    else content = SSD.MeetingsPanel.render({ viewer: student, onChange: refreshAll });
    return U.el('div', { class: 'stack gap-5' }, [nav, content]);
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
    planCardEl = null;
    if (activeTab === 'start') tabBody.appendChild(buildStartTab(student));
    else if (activeTab === 'duties') tabBody.appendChild(buildDutiesSection(student));
    else if (activeTab === 'team') tabBody.appendChild(buildTeamSection(student));
    else tabBody.appendChild(buildAvailabilitySection(student));
  }

  function render(container) {
    const student = SSD.Auth.getCurrentStudent();
    if (!student) { SSD.Auth.logout(); return; }
    // Wer noch gar nichts eingetragen hat und keinen Dienst hat, beginnt bei der Verfügbarkeit.
    const isNew = !SSD.StatisticsService.hasAnyAvailability(student) && !SSD.SelfServiceService.getUpcomingDutiesOf(student.id).length;
    activeTab = isNew ? 'availability' : 'start';
    teamSection = 'meetings';
    teamLeadSection = 'overview';
    resetPlan();

    const topbarHandle = buildTopbar(student);
    topbarCleanup = topbarHandle.cleanup;
    container.appendChild(topbarHandle.el);

    const viewContainer = U.el('div', { class: 'view-container' });
    const inner = U.el('div', { class: 'view-container__inner' });

    navEl = buildNav(student);
    inner.appendChild(navEl);
    document.body.classList.add('has-dash-nav');
    topAreaEl = buildTopArea(student);
    inner.appendChild(topAreaEl);
    tabBody = U.el('div');
    inner.appendChild(tabBody);
    renderTabBody(student);

    viewContainer.appendChild(inner);
    container.appendChild(viewContainer);

    // Änderungen von anderen Geräten (z. B. neue Vertretung, neuer Pinnwand-Beitrag): Hinweise,
    // Zähler und der Plan (nur Anzeige) sofort aktualisieren — andere Tab-Inhalte aber nicht unter
    // den Händen der Person austauschen (die aktualisieren sich bei der nächsten Aktion).
    offRemoteChanges = SSD.EventBus.on('store:changed', (evt) => {
      if (!evt || !evt.remote) return;
      const fresh = SSD.Auth.getCurrentStudent();
      if (!fresh || !fresh.active) { SSD.Auth.logout(); return; }
      // Startseite und „Meine Dienste“ enthalten keine Eingabefelder — sie dürfen sich sofort aktualisieren.
      if (activeTab === 'start' || activeTab === 'duties' || (activeTab === 'team' && teamSection === 'teamLead' && !SSD.StudentService.isTeamLead(fresh))) renderTabBody(fresh);
      refreshChrome(fresh);
    });

    // Die App blieb über Nacht offen (am Handy üblich): beim Zurückkehren wieder den heutigen Tag zeigen.
    onVisible = () => {
      if (document.hidden || !plan || plan.todayIso === U.toIsoDate(U.today())) return;
      const fresh = SSD.Auth.getCurrentStudent();
      if (!fresh) return;
      resetPlan();
      if (activeTab === 'start') renderTabBody(fresh);
      refreshChrome(fresh);
    };
    document.addEventListener('visibilitychange', onVisible);
  }

  function destroy() {
    if (topbarCleanup) topbarCleanup();
    if (offRemoteChanges) offRemoteChanges();
    offRemoteChanges = null;
    if (onVisible) document.removeEventListener('visibilitychange', onVisible);
    onVisible = null;
    planCardEl = null;
    topAreaEl = null;
    navEl = null;
    document.body.classList.remove('has-dash-nav');
  }

  return { render, destroy };
})();
