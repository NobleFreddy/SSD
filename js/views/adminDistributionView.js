/**
 * ============================================================================
 * SSD.Views.AdminDistribution — Verteilungsregeln
 * ============================================================================
 * Alles, womit der Administrator die automatische Dienstplan-Erstellung
 * steuert: Grundregeln (Limits, Teamgröße), Prioritäten der weichen
 * Kriterien, Abijahrgangs-Regeln, Paar-Regeln für einzelne Personen und eine
 * Übersicht der Partnerwünsche. Änderungen wirken bei der nächsten
 * Erstellung — bestehende Pläne bleiben unverändert.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminDistribution = (function () {
  'use strict';

  const U = SSD.Utils;
  const D = () => SSD.DistributionService;
  let layoutHandle = null;
  let unsubscribe = null;

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  function settingRow(labelText, hint, control) {
    return U.el('div', { class: 'switch-row' }, [
      U.el('div', { class: 'switch-row__text' }, [U.el('strong', {}, [labelText]), U.el('span', {}, [hint])]),
      control,
    ]);
  }

  function cardWithHeader(title, subtitle, bodyChildren, headerAction) {
    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [U.el('div', { class: 'card__title' }, [title]), subtitle ? U.el('div', { class: 'card__subtitle' }, [subtitle]) : null]),
        headerAction || null,
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, bodyChildren),
    ]);
  }

  function select(options, value, onChange, style) {
    const el = U.el('select', { class: 'select', style: style || '' }, options.map((o) => U.el('option', { value: o.value, selected: String(o.value) === String(value) }, [o.label])));
    if (onChange) el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  function saved(message) {
    SSD.Toast.show({ type: 'success', title: 'Gespeichert', message: message || 'Wirkt bei der nächsten Dienstplan-Erstellung.', duration: 2200 });
  }

  function personOptions() {
    return SSD.StudentService.getActiveByRole('student')
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
      .map((s) => ({ value: s.id, label: SSD.StudentService.fullName(s) }));
  }

  function personName(id) {
    const s = SSD.StudentService.getById(id);
    return s ? SSD.StudentService.fullName(s) : '(gelöscht)';
  }

  /* ---------------------------------------------------------------------
   * Grundregeln (harte Grenzen)
   * ------------------------------------------------------------------- */

  function buildBasicRulesCard() {
    const s = SSD.SettingsService.get();
    const maxWeekInput = U.el('input', { class: 'input', type: 'number', min: '1', value: s.maxDutiesPerWeek });
    const maxTotalInput = U.el('input', { class: 'input', type: 'number', min: '0', value: s.maxDutiesTotal ?? '', placeholder: 'Kein Limit' });
    const perDutyInput = U.el('input', { class: 'input', type: 'number', min: '1', max: '4', value: s.studentsPerDuty });
    const minBreakInput = U.el('input', { class: 'input', type: 'number', min: '0', value: s.minBreakBlocks });

    function commit(patch) { SSD.SettingsService.update(patch); saved(); }
    maxWeekInput.addEventListener('change', () => commit({ maxDutiesPerWeek: Math.max(1, Number(maxWeekInput.value) || 1) }));
    maxTotalInput.addEventListener('change', () => commit({ maxDutiesTotal: maxTotalInput.value ? Math.max(0, Number(maxTotalInput.value)) : null }));
    perDutyInput.addEventListener('change', () => commit({ studentsPerDuty: U.clamp(Number(perDutyInput.value) || 2, 1, 4) }));
    minBreakInput.addEventListener('change', () => commit({ minBreakBlocks: Math.max(0, Number(minBreakInput.value) || 0) }));

    const sameDayBox = U.el('input', { type: 'checkbox' });
    sameDayBox.checked = s.allowSameDayDuties;
    sameDayBox.addEventListener('change', () => commit({ allowSameDayDuties: sameDayBox.checked }));

    return cardWithHeader('Grundregeln', 'Harte Grenzen — werden bei der Erstellung nie überschritten.', [
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Max. Dienste pro Person und Woche', maxWeekInput, 'Kann pro Person in der Schülerverwaltung abweichend gesetzt werden.'),
        field('Max. Dienste insgesamt', maxTotalInput, 'Optionales Limit über das ganze Schuljahr.'),
      ]),
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Personen pro Dienst', perDutyInput, 'Standard: 2 (Azubis kommen als dritte Person dazu).'),
        field('Mindestpause zwischen zwei Diensten (Blöcke)', minBreakInput, 'Nur relevant, wenn mehrere Dienste am selben Tag erlaubt sind.'),
      ]),
      settingRow('Mehrere Dienste am selben Tag erlauben', 'Standardmäßig aus, um Einzelne nicht zu überlasten.',
        U.el('label', { class: 'switch' }, [sameDayBox, U.el('span', { class: 'switch__track' })])),
      U.el('div', { class: 'notice-box' }, [
        U.el('span', { html: SSD.Icons.svg('info', { size: 18 }) }),
        U.el('div', {}, [
          U.el('strong', {}, ['Lieber offen lassen als überlasten?']),
          U.el('p', {}, ['Der Algorithmus besetzt zuerst so viele Dienste wie möglich und verteilt sie dabei gleichmäßig. Soll niemand mehr als z. B. 3 Dienste pro Woche machen — auch wenn dann Dienste offen bleiben —, die Grenze "Max. Dienste pro Person und Woche" entsprechend setzen.']),
        ]),
      ]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Prioritäten (weiche Kriterien)
   * ------------------------------------------------------------------- */

  function buildPrioritiesCard() {
    const weights = D().getWeights();
    const levelOptions = SSD.Models.WEIGHT_LEVELS.map((l) => ({ value: l.value, label: l.label }));
    const rows = D().CRITERIA.map((c) => settingRow(c.label, c.hint,
      select(levelOptions, weights[c.key], (val) => { D().setWeight(c.key, val); saved(); }, 'width:auto; min-width:130px;')));

    const resetBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('undo', { size: 14 }), disabled: D().isDefaultWeights() }, ['Standard']);
    resetBtn.addEventListener('click', () => { D().resetWeights(); saved('Prioritäten auf Standard zurückgesetzt.'); });

    return cardWithHeader('Prioritäten', 'Wie stark der Algorithmus die einzelnen Wünsche gegeneinander abwägt. Die Grundregeln und die Verfügbarkeiten gehen immer vor.', [
      U.el('div', {}, rows),
    ], resetBtn);
  }

  /* ---------------------------------------------------------------------
   * Abijahrgänge
   * ------------------------------------------------------------------- */

  function buildYearGroupsCard() {
    const overview = D().getYearGroupOverview();
    const firstAbi = U.schoolYearEnd();
    const yearSet = new Set(overview.years.map((y) => y.year));
    for (let y = firstAbi; y <= firstAbi + 9; y++) yearSet.add(y);
    const countFor = new Map(overview.years.map((y) => [y.year, y.count]));
    const yearOptions = Array.from(yearSet).sort((a, b) => a - b)
      .map((y) => ({ value: y, label: countFor.has(y) ? `${y} (${countFor.get(y)})` : String(y) }));

    const chips = overview.years.map((y) => U.el('span', { class: 'badge' }, [`Abi ${y.year}: ${y.count}`]));
    if (overview.missing) chips.push(U.el('span', { class: 'badge badge--warning' }, [`ohne Angabe: ${overview.missing}`]));
    const pastYears = overview.years.filter((y) => y.year < firstAbi);

    const modeSelect = select(D().YEAR_GROUP_MODES.map((m) => ({ value: m.key, label: m.label })), D().getYearGroupMode(),
      (val) => { D().setYearGroupMode(val); saved(); }, 'width:auto; max-width:100%;');

    const rules = D().getYearGroupRules();
    const ruleList = rules.length
      ? U.el('div', { class: 'stack gap-2' }, rules.map((r) => {
        const del = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Regel löschen', html: SSD.Icons.svg('trash', { size: 14 }) });
        del.addEventListener('click', () => { D().removeYearGroupRule(r.id); saved('Regel gelöscht.'); });
        const typeLabel = D().YEAR_RULE_TYPES.find((t) => t.key === r.type)?.label || r.type;
        return U.el('div', { class: 'cluster gap-2', style: 'justify-content:space-between; padding:6px 10px; border:1px solid var(--border-subtle); border-radius:var(--radius-md);' }, [
          U.el('span', {}, [U.el('strong', {}, [`Abi ${r.a} + Abi ${r.b}`]), ` — ${typeLabel}`]),
          del,
        ]);
      }))
      : U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-sm);' }, ['Noch keine Einzelregeln.']);

    const aSelect = select(yearOptions, firstAbi, null, 'width:auto;');
    const bSelect = select(yearOptions, firstAbi + 2, null, 'width:auto;');
    const typeSelect = select(D().YEAR_RULE_TYPES.map((t) => ({ value: t.key, label: t.label })), 'prefer', null, 'width:auto;');
    const addBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('plus', { size: 15 }) }, ['Regel hinzufügen']);
    addBtn.addEventListener('click', () => { D().addYearGroupRule(aSelect.value, bSelect.value, typeSelect.value); saved('Regel gespeichert.'); });

    return cardWithHeader('Abijahrgänge', 'Welche Jahrgänge bevorzugt zusammen Dienst machen. Personen ohne Abijahrgang werden dabei nicht berücksichtigt.', [
      U.el('div', { class: 'cluster gap-2' }, chips.length ? chips : [U.el('span', { class: 'text-tertiary' }, ['Noch keine aktiven Sanis.'])]),
      overview.missing || pastYears.length
        ? U.el('div', { class: 'notice-box' }, [
          U.el('span', { html: SSD.Icons.svg('warning', { size: 18 }) }),
          U.el('div', {}, [
            U.el('strong', {}, ['Angaben prüfen']),
            U.el('p', {}, [[
              overview.missing ? `${overview.missing} Sani${overview.missing === 1 ? ' hat' : 's haben'} keinen Abijahrgang eingetragen.` : '',
              pastYears.length ? `Abijahrgang ${pastYears.map((y) => y.year).join(', ')} hat das Abitur bereits hinter sich — vermutlich ein alter Standardwert (früher wurde das aktuelle Jahr vorbelegt).` : '',
              'Korrigieren lässt sich das in der Schülerverwaltung.',
            ].filter(Boolean).join(' ')]),
          ]),
        ])
        : null,
      field('Grundregel', modeSelect),
      U.el('div', { class: 'field__label', style: 'margin-top:4px;' }, ['Einzelne Kombinationen']),
      ruleList,
      U.el('div', { class: 'cluster gap-2' }, [aSelect, U.el('span', {}, ['+']), bSelect, typeSelect, addBtn]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Paar-Regeln (einzelne Personen)
   * ------------------------------------------------------------------- */

  function buildPairRulesCard() {
    const options = personOptions();
    const rules = D().getPairRules();
    const ruleList = rules.length
      ? U.el('div', { class: 'stack gap-2' }, rules.map((r) => {
        const del = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Regel löschen', html: SSD.Icons.svg('trash', { size: 14 }) });
        del.addEventListener('click', () => { D().removePairRule(r.id); saved('Regel gelöscht.'); });
        return U.el('div', { class: 'cluster gap-2', style: 'justify-content:space-between; padding:6px 10px; border:1px solid var(--border-subtle); border-radius:var(--radius-md);' }, [
          U.el('span', { class: 'cluster gap-2' }, [
            U.el('strong', {}, [`${personName(r.a)} + ${personName(r.b)}`]),
            r.type === 'never'
              ? U.el('span', { class: 'badge badge--danger' }, ['nie zusammen'])
              : U.el('span', { class: 'badge badge--success' }, ['bevorzugt zusammen']),
          ]),
          del,
        ]);
      }))
      : U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-sm);' }, ['Noch keine Paar-Regeln.']);

    if (options.length < 2) {
      return cardWithHeader('Paar-Regeln', 'Für zwei bestimmte Personen festlegen, ob sie bevorzugt oder nie zusammen eingeteilt werden.', [
        ruleList,
        U.el('p', { class: 'text-tertiary', style: 'margin:0;' }, ['Dafür werden mindestens zwei aktive Sanis benötigt.']),
      ]);
    }

    const aSelect = select(options, options[0].value, null, 'width:auto; min-width:160px;');
    const bSelect = select(options, options[1].value, null, 'width:auto; min-width:160px;');
    const typeSelect = select(D().PAIR_RULE_TYPES.map((t) => ({ value: t.key, label: t.label })), 'never', null, 'width:auto;');
    const addBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('plus', { size: 15 }) }, ['Regel hinzufügen']);
    addBtn.addEventListener('click', () => {
      try {
        D().addPairRule(aSelect.value, bSelect.value, typeSelect.value);
        saved('Regel gespeichert.');
      } catch (err) {
        SSD.Toast.error('Nicht möglich', String(err.message || err));
      }
    });

    return cardWithHeader('Paar-Regeln', '„Nie zusammen“ wird immer eingehalten (auch bei Vertretungen und beim Selbst-Übernehmen), „bevorzugt“ so oft es die Verfügbarkeit erlaubt.', [
      ruleList,
      U.el('div', { class: 'cluster gap-2' }, [aSelect, U.el('span', {}, ['+']), bSelect, typeSelect, addBtn]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Partnerwünsche der Sanis (nur Übersicht)
   * ------------------------------------------------------------------- */

  function buildWishesCard() {
    const { rows, mutualPairCount } = D().getWishOverview();
    const subtitle = rows.length
      ? `${rows.length} Sani${rows.length === 1 ? ' hat' : 's haben'} Wünsche angegeben · ${mutualPairCount} gegenseitige${mutualPairCount === 1 ? 's Paar' : ' Paare'}`
      : 'Die Sanis wählen ihre Wunschpartner:innen selbst in ihrem Bereich (Tab „Meine Verfügbarkeit“).';
    const list = rows.length
      ? U.el('div', { class: 'stack gap-2' }, rows.map((row) => U.el('div', { class: 'cluster gap-2', style: 'padding:6px 0; border-bottom:1px solid var(--border-subtle);' }, [
        U.el('strong', { style: 'min-width:170px;' }, [SSD.StudentService.fullName(row.student)]),
        U.el('span', { class: 'text-tertiary' }, ['wünscht sich']),
        ...row.partners.map((p) => U.el('span', { class: `badge ${p.mutual ? 'badge--success' : ''}`, 'data-tooltip': p.mutual ? 'Gegenseitiger Wunsch' : 'Einseitiger Wunsch' }, [
          `${SSD.StudentService.fullName(p.partner)}${p.mutual ? ' ↔' : ''}`,
        ])),
      ])))
      : U.el('div', { class: 'empty-state' }, [
        U.el('span', { html: SSD.Icons.svg('heart', { size: 36 }) }),
        U.el('h3', {}, ['Noch keine Partnerwünsche']),
      ]);
    return cardWithHeader('Partnerwünsche der Sanis', subtitle, [list]);
  }

  /* ---------------------------------------------------------------------
   * Lifecycle
   * ------------------------------------------------------------------- */

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    layoutHandle.contentEl.appendChild(U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [
        U.el('h1', {}, ['Verteilung']),
        U.el('p', {}, ['Regeln für die automatische Dienstplan-Erstellung. Änderungen wirken bei der nächsten Erstellung — bestehende Pläne bleiben unverändert.']),
      ]),
    ]));
    layoutHandle.contentEl.appendChild(buildBasicRulesCard());
    layoutHandle.contentEl.appendChild(buildPrioritiesCard());
    layoutHandle.contentEl.appendChild(buildYearGroupsCard());
    layoutHandle.contentEl.appendChild(buildPairRulesCard());
    layoutHandle.contentEl.appendChild(buildWishesCard());
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'distribution');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
