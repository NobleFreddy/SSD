/**
 * ============================================================================
 * SSD.Views.AdminDashboard — Admin-Übersicht
 * ============================================================================
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminDashboard = (function () {
  'use strict';

  const U = SSD.Utils;
  let layoutHandle = null;
  let unsubscribe = null;

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  /**
   * Vergabe der Zusatzbezeichnungen "Sanisprecher:in" / "Stellv. Sanisprecher:in".
   * Genau eine Person je Bezeichnung — die Auswahl greift direkt auf
   * `SSD.StudentService.setLeadershipRole` zurück, das eine evtl. bisherige
   * Inhaberin automatisch ablöst (siehe dortige Dokumentation).
   */
  function buildLeadershipCard() {
    const activeStudents = SSD.StudentService.getActiveByRole('student').slice().sort((a, b) => a.lastName.localeCompare(b.lastName));

    function buildSelect(key) {
      const current = SSD.StudentService.getLeadershipHolder(key);
      const otherKey = key === 'sanisprecher' ? 'vize_sanisprecher' : 'sanisprecher';
      const otherLabel = SSD.Models.LEADERSHIP_ROLES.find((r) => r.key === otherKey).label;
      const select = U.el('select', { class: 'select' }, [
        U.el('option', { value: '' }, ['— Keine —']),
        ...activeStudents.map((s) => U.el('option', { value: s.id, selected: s.id === current?.id }, [
          `${SSD.StudentService.fullName(s)}${s.leadershipRole === otherKey ? ` (bisher ${otherLabel})` : ''}`,
        ])),
      ]);
      select.addEventListener('change', () => {
        if (select.value) SSD.StudentService.setLeadershipRole(select.value, key);
        else if (current) SSD.StudentService.clearLeadershipRole(current.id);
      });
      return select;
    }

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Team-Leitung']),
          U.el('div', { class: 'card__subtitle' }, ['Team-Verwaltung im Dashboard: Vertretungen melden, Lücken auffüllen, Aufgaben anlegen, Pinnwand, Teamtreffen, Registrierungen freischalten, an Verfügbarkeit erinnern, Engagement-Übersicht. Kein Zugriff auf Einstellungen, Kontenverwaltung oder die Neuberechnung des Dienstplans.']),
        ]),
      ]),
      U.el('div', { class: 'card__body grid grid-cols-2' }, [
        field('Sanisprecher:in', buildSelect('sanisprecher')),
        field('Stellv. Sanisprecher:in', buildSelect('vize_sanisprecher')),
      ]),
    ]);
  }

  function statTile(icon, value, label, trend) {
    return U.el('div', { class: 'stat-tile' }, [
      U.el('div', { class: 'stat-tile__top' }, [
        U.el('div', { class: 'stat-tile__icon', html: SSD.Icons.svg(icon, { size: 19 }) }),
        trend ? U.el('span', { class: `stat-tile__trend stat-tile__trend--${trend.dir}` }, [trend.text]) : null,
      ]),
      U.el('div', { class: 'stat-tile__value' }, [String(value)]),
      U.el('div', { class: 'stat-tile__label' }, [label]),
    ]);
  }

  function buildContent() {
    const state = SSD.Store.getState();
    const students = SSD.StudentService.getAll();
    const activeStudents = students.filter((s) => s.active);
    const overview = SSD.StatisticsService.computeOverview();
    const capacity = SSD.StatisticsService.computeCapacityWarning();

    const todayIso = U.toIsoDate(U.today());
    const weekEntries = state.schedule.entries.filter((e) => e.date >= todayIso);

    const frag = U.el('div', { class: 'stack gap-6' });

    frag.appendChild(U.el('div', { class: 'welcome-banner' }, [
      U.el('div', {}, [
        U.el('h2', {}, [`Willkommen zurück, ${state.admin.username}!`]),
        U.el('p', {}, [`${state.school.name} · ${activeStudents.length} aktive Schüler:innen im Team`]),
      ]),
      U.el('div', { class: 'welcome-banner__icon', html: SSD.Icons.svg('sparkles', { size: 46 }) }),
    ]));

    const pendingCount = SSD.StudentService.getPendingApprovalCount();
    if (pendingCount > 0) {
      const pendingNotice = U.el('div', { class: 'notice-box', style: 'cursor:pointer;' }, [
        U.el('span', { html: SSD.Icons.svg('userAbsent', { size: 20 }) }),
        U.el('div', {}, [
          U.el('strong', {}, [`${pendingCount} neue Selbstregistrierung${pendingCount === 1 ? '' : 'en'} wartet auf Freischaltung`]),
          U.el('p', {}, ['Klicken, um sie unter Team → Mitglieder freizuschalten oder abzulehnen (auch die Sanisprecher:innen können das).']),
        ]),
      ]);
      pendingNotice.addEventListener('click', () => SSD.Router.navigate('/admin/team/members'));
      frag.appendChild(pendingNotice);
    }

    const missingAvailability = SSD.StudentService.getAvailabilityGaps(null).missing.length;
    if (missingAvailability > 0) {
      const availabilityNotice = U.el('div', { class: 'notice-box', style: 'cursor:pointer;' }, [
        U.el('span', { html: SSD.Icons.svg('calendar', { size: 20 }) }),
        U.el('div', {}, [
          U.el('strong', {}, [`${missingAvailability} aktive${missingAvailability === 1 ? ' Person hat' : ' Personen haben'} noch keine Verfügbarkeit eingetragen`]),
          U.el('p', {}, ['Ohne Verfügbarkeit kann der Algorithmus sie nicht einteilen. Klicken, um unter Team → Mitglieder an die Eintragung zu erinnern.']),
        ]),
      ]);
      availabilityNotice.addEventListener('click', () => SSD.Router.navigate('/admin/team/members'));
      frag.appendChild(availabilityNotice);
    }

    const openRequestCount = SSD.SelfServiceService.getOpenRequestCount();
    if (openRequestCount > 0) {
      const todayRequestCount = SSD.SelfServiceService.getOpenRequestCount(todayIso);
      const requestNotice = U.el('div', { class: 'notice-box', style: 'cursor:pointer;' }, [
        U.el('span', { html: SSD.Icons.svg('handRaised', { size: 20 }) }),
        U.el('div', {}, [
          U.el('strong', {}, [`${openRequestCount} Vertretungsanfrage${openRequestCount === 1 ? '' : 'n'} von Schüler:innen/Azubis${todayRequestCount ? ` — ${todayRequestCount} davon für heute` : ''}`]),
          U.el('p', {}, ['Diese Personen bleiben bis zur Übernahme eingeteilt. Klicken, um den Dienstplan zu öffnen (Hand-Symbol markiert die betroffenen Dienste).']),
        ]),
      ]);
      requestNotice.addEventListener('click', () => SSD.Router.navigate('/admin/schedule'));
      frag.appendChild(requestNotice);
    }

    if (!capacity.sufficient) {
      frag.appendChild(U.el('div', { class: 'notice-box' }, [
        U.el('span', { html: SSD.Icons.svg('warning', { size: 20 }) }),
        U.el('div', {}, [
          U.el('strong', {}, ['Kapazitätswarnung']),
          U.el('p', {}, [`Pro Woche werden ${capacity.neededPerWeek} Dienstplätze benötigt, das Team stellt aber nur maximal ${capacity.totalWeeklyCapacity} verfügbare Plätze. Erwägen Sie mehr aktive Schüler:innen oder höhere Wochenlimits.`]),
        ]),
      ]));
    }

    const autoSubstitutions = SSD.AutoSubstitutionList.render();
    if (autoSubstitutions) frag.appendChild(autoSubstitutions);

    const grid = U.el('div', { class: 'grid grid-cols-4 stagger' }, [
      statTile('students', activeStudents.length, 'Aktive Schüler:innen'),
      statTile('schedule', weekEntries.filter((e) => e.studentIds.length).length, 'Geplante künftige Dienste'),
      statTile('warning', overview.emptySlots + overview.incompleteSlots, 'Unbesetzte/unvollständige Dienste'),
      statTile('trophy', `${overview.fairnessScore}%`, 'Fairness-Score'),
    ]);
    frag.appendChild(grid);

    const quickLinks = U.el('div', { class: 'grid grid-cols-4 stagger' });
    const links = [
      { icon: 'wand', title: 'Dienstplan erstellen', text: 'Automatisch optimierten Plan generieren.', path: '/admin/schedule' },
      { icon: 'students', title: 'Schüler verwalten', text: 'Konten anlegen, bearbeiten, deaktivieren.', path: '/admin/students' },
      { icon: 'flag', title: 'Veranstaltungen', text: `${SSD.EventsService.getUpcoming().length} kommende Veranstaltung(en) verwalten.`, path: '/admin/events' },
      { icon: 'stats', title: 'Statistiken ansehen', text: 'Fairness, Auslastung & Diagramme.', path: '/admin/statistics' },
    ];
    links.forEach((link) => {
      const card = U.el('div', { class: 'card card--interactive', style: 'cursor:pointer;' }, [
        U.el('div', { class: 'card__body stack gap-2' }, [
          U.el('div', { class: 'stat-tile__icon', html: SSD.Icons.svg(link.icon, { size: 19 }) }),
          U.el('div', { class: 'card__title' }, [link.title]),
          U.el('p', {}, [link.text]),
        ]),
      ]);
      card.addEventListener('click', () => SSD.Router.navigate(link.path));
      quickLinks.appendChild(card);
    });
    frag.appendChild(quickLinks);
    frag.appendChild(buildLeadershipCard());

    if (overview.perStudentList.length) {
      const topCard = U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Dienstverteilung (Top 8)'])]),
      ]);
      const body = U.el('div', { class: 'card__body' });
      SSD.Charts.horizontalBarList(
        body,
        overview.perStudentList.slice(0, 8).map((p) => ({ label: SSD.StudentService.fullName(p.student), value: p.count })),
      );
      topCard.appendChild(body);
      frag.appendChild(topCard);
    }

    return frag;
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'dashboard');
    layoutHandle.contentEl.appendChild(buildContent());
    unsubscribe = SSD.EventBus.on('store:changed', () => {
      layoutHandle.contentEl.innerHTML = '';
      layoutHandle.contentEl.appendChild(buildContent());
    });
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
