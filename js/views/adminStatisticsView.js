/**
 * ============================================================================
 * SSD.Views.AdminStatistics — Kennzahlen & Diagramme
 * ============================================================================
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminStatistics = (function () {
  'use strict';

  const U = SSD.Utils;
  let layoutHandle = null;
  let unsubscribe = null;

  function statTile(icon, value, label) {
    return U.el('div', { class: 'stat-tile' }, [
      U.el('div', { class: 'stat-tile__top' }, [U.el('div', { class: 'stat-tile__icon', html: SSD.Icons.svg(icon, { size: 19 }) })]),
      U.el('div', { class: 'stat-tile__value' }, [String(value)]),
      U.el('div', { class: 'stat-tile__label' }, [label]),
    ]);
  }

  function buildHeader() {
    const exportBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('print', { size: 16 }) }, ['Drucken / PDF']);
    exportBtn.addEventListener('click', () => SSD.ImportExport.triggerPrint());
    return U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [U.el('h1', {}, ['Statistik']), U.el('p', {}, ['Fairness, Auslastung und Verteilung des Dienstplans.'])]),
      U.el('div', { class: 'page-header__actions' }, [exportBtn]),
    ]);
  }

  function buildContent() {
    const overview = SSD.StatisticsService.computeOverview();
    const capacity = SSD.StatisticsService.computeCapacityWarning();
    const frag = U.el('div', { class: 'stack gap-6' });

    frag.appendChild(U.el('div', { class: 'print-only print-header' }, [
      U.el('img', { class: 'print-logo', src: 'assets/logo.png', alt: '' }),
      U.el('div', {}, [
        U.el('div', { class: 'print-title' }, [`Statistik — ${SSD.SettingsService.getSchool().name}`]),
        U.el('div', { class: 'print-subtitle' }, [U.formatDateLong(U.today())]),
      ]),
    ]));

    if (!capacity.sufficient) {
      frag.appendChild(U.el('div', { class: 'notice-box' }, [
        U.el('span', { html: SSD.Icons.svg('warning', { size: 20 }) }),
        U.el('div', {}, [U.el('strong', {}, ['Kapazitätswarnung']), U.el('p', {}, [`Benötigt: ${capacity.neededPerWeek} Plätze/Woche · Verfügbar: max. ${capacity.totalWeeklyCapacity} Plätze/Woche.`])]),
      ]));
    }

    frag.appendChild(U.el('div', { class: 'grid grid-cols-4 stagger' }, [
      statTile('trophy', `${overview.fairnessScore}%`, 'Fairness-Score'),
      statTile('stats', overview.average, 'Ø Dienste pro Schüler:in'),
      statTile('zap', overview.stdDev, 'Standardabweichung'),
      statTile('warning', overview.emptySlots + overview.incompleteSlots, 'Freie / unbesetzbare Dienste'),
    ]));

    const row1 = U.el('div', { class: 'grid grid-cols-2' });

    const genderCard = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Geschlechterverteilung der Dienste'])]),
    ]);
    const genderBody = U.el('div', { class: 'card__body' });
    SSD.Charts.donutChart(genderBody, [
      { label: 'Mädchen + Junge', value: overview.genderDistribution.mixed, color: SSD.Charts.PALETTE.mixed },
      { label: 'Zwei Jungen', value: overview.genderDistribution.boys, color: SSD.Charts.PALETTE.boys },
      { label: 'Zwei Mädchen', value: overview.genderDistribution.girls, color: SSD.Charts.PALETTE.girls },
    ], { centerLabel: 'Besetzte Dienste' });
    genderCard.appendChild(genderBody);
    row1.appendChild(genderCard);

    const weekdayCard = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Verteilung über die Wochentage'])]),
    ]);
    const weekdayBody = U.el('div', { class: 'card__body' });
    SSD.Charts.columnChart(weekdayBody, U.WEEKDAY_KEYS.map((d) => ({ label: U.WEEKDAY_LABELS_SHORT[d], value: overview.weekdayCounts[d], color: SSD.Charts.PALETTE.primary })));
    weekdayCard.appendChild(weekdayBody);
    row1.appendChild(weekdayCard);

    frag.appendChild(row1);

    const row2 = U.el('div', { class: 'grid grid-cols-2' });

    const perStudentCard = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Dienste pro Schüler:in']), U.el('span', { class: 'badge' }, [`${overview.studentCount} aktiv`])]),
    ]);
    const perStudentBody = U.el('div', { class: 'card__body', style: 'max-height:420px; overflow-y:auto;' });
    SSD.Charts.horizontalBarList(perStudentBody, overview.perStudentList.map((p) => ({
      label: SSD.StudentService.fullName(p.student),
      value: p.count,
      color: p.count < overview.average - 1 ? SSD.Charts.PALETTE.warning || '#d97706' : SSD.Charts.PALETTE.primary,
      sublabel: p.student.schoolClass || undefined,
    })));
    perStudentCard.appendChild(perStudentBody);
    row2.appendChild(perStudentCard);

    const pairsCard = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Häufigste Partner-Paarungen'])]),
    ]);
    const pairsBody = U.el('div', { class: 'card__body' });
    if (!overview.topPairs.length) {
      pairsBody.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('span', { html: SSD.Icons.svg('swap', { size: 36 }) }),
        U.el('p', {}, ['Noch keine wiederholten Paarungen vorhanden — gute Durchmischung!']),
      ]));
    } else {
      overview.topPairs.forEach((pair) => {
        pairsBody.appendChild(U.el('div', { class: 'cluster', style: 'justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-subtle);' }, [
          U.el('span', { html: SSD.Icons.svg('swap', { size: 15 }), style: 'color:var(--text-tertiary); display:flex;' }),
          U.el('span', { style: 'flex:1; font-weight:600; font-size:var(--font-size-sm);' }, [pair.names.join(' & ')]),
          U.el('span', { class: 'badge badge--primary' }, [`${pair.count}×`]),
        ]));
      });
    }
    pairsCard.appendChild(pairsBody);
    row2.appendChild(pairsCard);

    frag.appendChild(row2);

    const genderRosterCard = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Team-Zusammensetzung'])]),
      U.el('div', { class: 'card__body' }, [
        U.el('div', { class: 'grid grid-cols-4' }, [
          statTile('female', overview.genderRoster.w || 0, 'Mädchen'),
          statTile('male', overview.genderRoster.m || 0, 'Jungen'),
          statTile('user', overview.genderRoster.d || 0, 'Divers'),
          statTile('user', overview.genderRoster.n || 0, 'Keine Angabe'),
        ]),
      ]),
    ]);
    frag.appendChild(genderRosterCard);

    if (overview.azubi.azubiCount > 0) {
      const azubiCard = U.el('div', { class: 'card' }, [
        U.el('div', { class: 'card__header' }, [
          U.el('div', {}, [U.el('div', { class: 'card__title' }, ['Azubis — dritter Dienstplatz']), U.el('div', { class: 'card__subtitle' }, ['Unabhängig von der Schüler-Fairness ausgewertet'])]),
          U.el('span', { class: 'badge badge--primary' }, [`${overview.azubi.azubiCount} aktiv`]),
        ]),
      ]);
      const azubiBody = U.el('div', { class: 'card__body stack gap-5' }, [
        U.el('div', { class: 'grid grid-cols-3' }, [
          statTile('trophy', `${overview.azubi.fairnessScore}%`, 'Fairness-Score (Azubis)'),
          statTile('stats', overview.azubi.average, 'Ø Dienste pro Azubi'),
          statTile('checkCircle', overview.azubi.filledSlots, 'Besetzte Azubi-Plätze'),
        ]),
      ]);
      const azubiList = U.el('div');
      SSD.Charts.horizontalBarList(azubiList, overview.azubi.perAzubiList.map((p) => ({ label: SSD.StudentService.fullName(p.student), value: p.count, color: SSD.Charts.PALETTE.accent })));
      azubiBody.appendChild(azubiList);
      azubiCard.appendChild(azubiBody);
      frag.appendChild(azubiCard);
    }

    return frag;
  }

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    layoutHandle.contentEl.appendChild(buildHeader());
    layoutHandle.contentEl.appendChild(buildContent());
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'statistics');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
