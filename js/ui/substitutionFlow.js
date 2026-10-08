/**
 * ============================================================================
 * SSD.SubstitutionFlow — wiederverwendbarer Vertretungs-Workflow (UI)
 * ============================================================================
 * Bündelt die komplette UI für "Abwesenheit melden → Vorschläge prüfen →
 * übernehmen" (Multi-Personen-Auswahl, Vertretungsassistent, Prüfliste). Wird
 * sowohl vom Administrator-Bereich (`adminScheduleView.js`, volle Rechte) als
 * auch von Sanisprecher:innen/Stellv. Sanisprecher:innen im Schülerbereich
 * genutzt (eingeschränkt: keine vollständige Neuberechnung der Woche) — daher
 * die optionale `onRegenerateWeek`-Rückruffunktion: wird sie nicht übergeben,
 * entfällt die entsprechende Schaltfläche automatisch, ohne zwei getrennte
 * Implementierungen pflegen zu müssen.
 */
window.SSD = window.SSD || {};

SSD.SubstitutionFlow = (function () {
  'use strict';

  const U = SSD.Utils;

  function field(labelText, inputEl) {
    return U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
  }

  function scoreBadgeClass(score) {
    if (score >= 75) return 'score-pill--high';
    if (score >= 45) return 'score-pill--medium';
    return 'score-pill--low';
  }

  /** Durchsuchbare Mehrfachauswahl aktiver Schüler:innen/Azubis (für "Abwesenheit melden"). */
  function buildStudentMultiSelect(initialIds) {
    const students = SSD.StudentService.getActive().slice().sort((a, b) => a.lastName.localeCompare(b.lastName));
    const selected = new Set(initialIds || []);
    const chipsWrap = U.el('div', { class: 'cluster gap-2', style: 'margin-bottom:8px; min-height:30px;' });
    const searchInput = U.el('input', { class: 'input', placeholder: 'Schüler:in suchen …' });
    const list = U.el('div', { class: 'student-picker' });

    function renderChips() {
      chipsWrap.innerHTML = '';
      if (!selected.size) {
        chipsWrap.appendChild(U.el('span', { class: 'text-tertiary', style: 'font-size:var(--font-size-sm);' }, ['Noch niemand ausgewählt.']));
        return;
      }
      Array.from(selected).forEach((id) => {
        const s = SSD.StudentService.getById(id);
        if (!s) return;
        const removeBtn = U.el('button', { class: 'chip__remove', html: SSD.Icons.svg('x', { size: 12 }) });
        const chip = U.el('div', { class: 'chip' }, [
          U.el('span', { class: 'chip__avatar', style: `background:${U.colorFromString(id)}` }, [U.initials(s.firstName, s.lastName)]),
          U.el('span', {}, [SSD.StudentService.fullName(s)]),
          removeBtn,
        ]);
        removeBtn.addEventListener('click', () => { selected.delete(id); renderChips(); renderList(searchInput.value); });
        chipsWrap.appendChild(chip);
      });
    }

    function renderList(filterText) {
      list.innerHTML = '';
      const q = U.normalizeForSearch(filterText || '');
      const filtered = students.filter((s) => !q || U.normalizeForSearch(`${SSD.StudentService.fullName(s)} ${s.schoolClass}`).includes(q));
      if (!filtered.length) { list.appendChild(U.el('div', { style: 'padding:12px; text-align:center;', class: 'text-tertiary' }, ['Keine Treffer.'])); return; }
      filtered.forEach((s) => {
        const checkbox = U.el('input', { type: 'checkbox' });
        checkbox.checked = selected.has(s.id);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selected.add(s.id); else selected.delete(s.id);
          renderChips();
        });
        list.appendChild(U.el('label', { class: 'student-picker__item' }, [
          checkbox,
          U.el('div', { class: 'avatar avatar--sm', style: `background:${U.colorFromString(s.id)}` }, [U.initials(s.firstName, s.lastName)]),
          U.el('div', {}, [
            U.el('div', { style: 'font-weight:600; font-size:var(--font-size-sm);' }, [SSD.StudentService.fullName(s)]),
            U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [s.schoolClass || '']),
          ]),
        ]));
      });
    }
    searchInput.addEventListener('input', U.debounce(() => renderList(searchInput.value), 150));
    renderChips();
    renderList();

    const wrap = U.el('div', {}, [
      chipsWrap,
      U.el('div', { class: 'search-box', style: 'margin-bottom:8px;' }, [U.el('span', { html: SSD.Icons.svg('search', { size: 16 }) }), searchInput]),
      list,
    ]);
    return { el: wrap, getSelectedIds: () => Array.from(selected) };
  }

  /** "Vertretungsassistent": nach Eignung sortierte Ersatzpersonen für eine einzelne Vakanz. */
  function openCandidateAssistant(proposal, onResolved) {
    const dateLabel = `${U.formatDateLong(U.parseIsoDate(proposal.slot.date))} · ${U.blockLabel(proposal.slot.block)}`;
    const list = U.el('div', { class: 'stack gap-2', style: 'max-height:380px; overflow-y:auto;' });

    const emptyRow = U.el('button', { type: 'button', class: 'candidate-row candidate-row--empty' }, [
      U.el('span', { html: SSD.Icons.svg('x', { size: 16 }) }),
      U.el('div', { class: 'candidate-row__body' }, [
        U.el('div', { class: 'candidate-row__name' }, ['Unbesetzt lassen']),
        U.el('div', { class: 'candidate-row__reasons' }, ['Dienst bleibt bewusst mit nur einer Person besetzt.']),
      ]),
    ]);
    emptyRow.addEventListener('click', () => { proposal.overridden = true; proposal.chosenOverrideId = null; handle.close(); });
    list.appendChild(emptyRow);

    if (!proposal.ranked.length) {
      list.appendChild(U.el('div', { class: 'empty-state' }, [U.el('p', {}, ['Keine weiteren zulässigen Kandidat:innen verfügbar.'])]));
    }
    proposal.ranked.forEach((cand) => {
      const row = U.el('button', { type: 'button', class: 'candidate-row' }, [
        U.el('div', { class: 'avatar avatar--sm', style: `background:${U.colorFromString(cand.studentId)}` }, [U.initials(cand.student.firstName, cand.student.lastName)]),
        U.el('div', { class: 'candidate-row__body' }, [
          U.el('div', { class: 'candidate-row__name' }, [SSD.StudentService.fullName(cand.student)]),
          cand.reasons.length ? U.el('div', { class: 'candidate-row__reasons' }, [cand.reasons.join(' · ')]) : null,
        ]),
        U.el('span', { class: `score-pill ${scoreBadgeClass(cand.score)}` }, [String(cand.score)]),
      ]);
      row.addEventListener('click', () => { proposal.overridden = true; proposal.chosenOverrideId = cand.studentId; handle.close(); });
      list.appendChild(row);
    });

    const body = U.el('div', { class: 'stack gap-3' }, [
      U.el('p', { class: 'text-secondary', style: 'margin:0;' }, [`Ersatz für ${SSD.SubstitutionService.studentName(proposal.absentStudentId)} — ${dateLabel}`]),
      list,
    ]);

    // `onClose` deckt jeden Ausstiegsweg ab (Auswahl, "Schließen", X, Escape,
    // Klick auf den Hintergrund) und stellt so zuverlässig die Übersicht
    // wieder her — unabhängig davon, wie der Assistent verlassen wurde.
    const handle = SSD.Dialog.open({
      title: 'Vertretungsassistent', body, wide: true,
      onClose: () => onResolved(),
      footerButtons: [{ label: 'Schließen', variant: 'secondary' }],
    });
  }

  /** Prüf-/Bestätigungsansicht aller berechneten Vertretungsvorschläge vor der Übernahme. */
  function openSubstitutionReview(data, options) {
    const opts = options || {};

    function buildRow(p) {
      const dateObj = U.parseIsoDate(p.slot.date);
      const effectiveId = SSD.SubstitutionService.effectiveChoiceId(p);
      const absentName = SSD.SubstitutionService.studentName(p.absentStudentId);
      let bodyContent;

      if (p.conflict) {
        bodyContent = U.el('div', {}, [
          U.el('div', {}, [U.el('strong', {}, [absentName]), U.el('span', { style: 'color:var(--text-tertiary);' }, [' → ']), U.el('span', { style: 'color:var(--color-danger-500); font-weight:700;' }, [effectiveId ? SSD.SubstitutionService.studentName(effectiveId) : 'Unbesetzt'])]),
          U.el('div', { class: 'substitution-row__warning' }, [U.el('span', { html: SSD.Icons.svg('warning', { size: 13 }) }), p.conflict]),
        ]);
      } else if (!p.chosen && !p.overridden) {
        bodyContent = U.el('div', {}, [
          U.el('div', {}, [U.el('strong', {}, [absentName]), U.el('span', { style: 'color:var(--text-tertiary);' }, [' → ']), U.el('span', { class: 'text-danger', style: 'font-weight:700;' }, ['Kein Ersatz gefunden'])]),
          U.el('div', { class: 'substitution-row__reasons' }, [p.noCandidateReason]),
        ]);
      } else if (effectiveId) {
        const reasons = p.overridden ? ['Manuell ausgewählt'] : p.chosen.reasons;
        bodyContent = U.el('div', {}, [
          U.el('div', { class: 'cluster gap-2' }, [
            U.el('strong', {}, [absentName]),
            U.el('span', { html: SSD.Icons.svg('arrowRight', { size: 13 }), style: 'color:var(--text-tertiary); display:flex;' }),
            U.el('strong', {}, [SSD.SubstitutionService.studentName(effectiveId)]),
            p.overridden
              ? U.el('span', { class: 'badge badge--primary' }, ['Manuell'])
              : U.el('span', { class: `score-pill ${scoreBadgeClass(p.chosen.score)}` }, [String(p.chosen.score)]),
          ]),
          U.el('div', { class: 'substitution-row__reasons' }, [reasons.join(' · ')]),
        ]);
      } else {
        bodyContent = U.el('div', {}, [
          U.el('strong', {}, [absentName]), U.el('span', { style: 'color:var(--text-tertiary);' }, [' → ']),
          U.el('span', { class: 'text-secondary', style: 'font-weight:700;' }, ['Bewusst unbesetzt gelassen']),
        ]);
      }

      const rowClass = p.conflict ? 'substitution-row substitution-row--conflict' : (!effectiveId ? 'substitution-row substitution-row--empty' : 'substitution-row');
      const row = U.el('div', { class: rowClass }, [
        U.el('div', { class: 'substitution-row__date' }, [`${U.WEEKDAY_LABELS_SHORT[p.slot.weekday]}, ${U.formatDateShort(dateObj)}`, U.el('span', {}, [U.blockLabel(p.slot.block)])]),
        U.el('div', { class: 'substitution-row__body' }, [bodyContent]),
      ]);

      const actions = U.el('div', { class: 'substitution-row__actions' });
      const changeBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('userSearch', { size: 14 }) }, ['Ändern']);
      changeBtn.addEventListener('click', () => openCandidateAssistant(p, () => render()));
      actions.appendChild(changeBtn);

      if (!p.chosen && !p.overridden && typeof opts.onRegenerateWeek === 'function') {
        const regenBtn = U.el('button', {
          class: 'btn btn--ghost btn--icon btn--sm', html: SSD.Icons.svg('wand', { size: 14 }),
          'data-tooltip': 'Stattdessen die ganze Woche neu berechnen lassen',
        });
        regenBtn.addEventListener('click', () => { SSD.Dialog.close(); opts.onRegenerateWeek(U.getMondayOfWeek(dateObj)); });
        actions.appendChild(regenBtn);
      }

      const removeBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Diesen Dienst unverändert lassen', html: SSD.Icons.svg('x', { size: 14 }) });
      removeBtn.addEventListener('click', () => {
        data.proposals = data.proposals.filter((x) => x !== p);
        if (!data.proposals.length) { SSD.Dialog.close(); SSD.Toast.info('Abgebrochen', 'Keine Vertretungen mehr in dieser Anfrage.'); return; }
        render();
      });
      actions.appendChild(removeBtn);
      row.appendChild(actions);
      return row;
    }

    function render() {
      const validated = SSD.SubstitutionService.validateBatch(data.proposals);
      data.proposals = validated.proposals;
      const applyCount = data.proposals.filter((p) => !p.conflict).length;
      const missingCount = data.proposals.filter((p) => !p.chosen && !p.overridden).length;

      const summary = U.el('div', { class: 'notice-box', style: 'background:var(--bg-surface-alt); border-color:var(--border-default);' }, [
        U.el('span', { html: SSD.Icons.svg('sparkles', { size: 18 }), style: 'color:var(--color-primary); display:flex;' }),
        U.el('div', {}, [
          U.el('strong', {}, [`${data.proposals.length} betroffene(r) Dienst(e) · Fairness-Score ${data.fairnessBefore}% → ${validated.fairnessAfter}%`]),
          U.el('p', {}, [missingCount ? `${missingCount} Dienst(e) ohne automatischen Vorschlag — bitte prüfen${typeof opts.onRegenerateWeek === 'function' ? ' oder Woche neu berechnen' : ''}.` : 'Für alle betroffenen Dienste wurde eine geeignete Vertretung gefunden.']),
        ]),
      ]);

      const rows = U.el('div', { class: 'stack gap-2' }, data.proposals.map(buildRow));
      const body = U.el('div', { class: 'stack gap-4' }, [summary, rows]);

      SSD.Dialog.open({
        title: 'Vertretungsvorschlag', body, wide: true,
        footerButtons: [
          { label: 'Abbrechen', variant: 'secondary' },
          {
            label: `${applyCount} Vertretung(en) übernehmen`, variant: 'primary', html: SSD.Icons.svg('checkCircle', { size: 15 }), closeOnClick: false,
            onClick: () => {
              const conflicted = data.proposals.filter((p) => p.conflict);
              if (conflicted.length) { SSD.Toast.error('Konflikte vorhanden', 'Bitte lösen Sie zuerst alle rot markierten Konflikte auf.'); return; }
              const choices = data.proposals.map((p) => ({
                entryId: p.entryId, absentStudentId: p.absentStudentId, isAzubiSeat: p.isAzubiSeat,
                replacementStudentId: SSD.SubstitutionService.effectiveChoiceId(p),
                reasonText: p.overridden ? 'Manuell ausgewählt' : (p.chosen ? p.chosen.reasons.join(', ') : 'Kein geeigneter Ersatz gefunden'),
              }));
              const count = SSD.SubstitutionService.applySubstitutions(choices);
              SSD.Toast.success('Vertretung eingetragen', `${count} Dienst(e) aktualisiert.`);
              SSD.Dialog.close();
              if (typeof opts.onApplied === 'function') opts.onApplied();
            },
          },
        ],
      });
    }
    render();
  }

  /**
   * @param {string[]} absentStudentIds @param {string} startIso @param {string} endIso
   * @param {?string} _unusedReason - früher der Abwesenheitsgrund; wird nicht mehr erfasst
   * @param {{onApplied?:Function, onRegenerateWeek?:Function}} [options]
   */
  function launchSubstitutionFlow(absentStudentIds, startIso, endIso, _unusedReason, options) {
    const result = SSD.SubstitutionService.proposeSubstitutions(absentStudentIds, startIso, endIso);
    if (result.noAffectedEntries) {
      SSD.Toast.info('Keine betroffenen Dienste', 'Im gewählten Zeitraum sind die ausgewählte(n) Person(en) in keinem Dienst eingeteilt.');
      return;
    }
    openSubstitutionReview({ proposals: result.proposals, fairnessBefore: result.fairnessBefore }, options);
  }

  /**
   * Hauptdialog "Abwesenheit melden": eine oder mehrere Personen, ein Zeitraum.
   * @param {{prefillIds?: string[], prefillDateIso?: string, options?: {onApplied?:Function, onRegenerateWeek?:Function}}} [config]
   */
  function openAbsenceDialog(config) {
    const cfg = config || {};
    const picker = buildStudentMultiSelect(cfg.prefillIds || []);
    const startInput = U.el('input', { class: 'input', type: 'date', value: cfg.prefillDateIso || U.toIsoDate(U.today()) });
    const endInput = U.el('input', { class: 'input', type: 'date', value: cfg.prefillDateIso || U.toIsoDate(U.today()) });
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      field('Abwesende Schüler:innen', picker.el),
      U.el('div', { class: 'grid grid-cols-2' }, [field('Von', startInput), field('Bis', endInput)]),
      U.el('p', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, ['Es werden ausschließlich bereits eingeteilte Dienste dieser Person(en) im gewählten Zeitraum angepasst — der übrige Dienstplan bleibt unverändert. Einen Grund für die Abwesenheit fragt die App bewusst nicht ab.']),
    ]);

    SSD.Dialog.open({
      title: 'Abwesenheit melden', body, wide: true,
      footerButtons: [
        { label: 'Abbrechen', variant: 'secondary' },
        {
          label: 'Vertretungen berechnen', variant: 'primary', html: SSD.Icons.svg('userSearch', { size: 15 }), closeOnClick: false,
          onClick: () => {
            errorBox.style.display = 'none';
            const ids = picker.getSelectedIds();
            if (!ids.length) { errorBox.textContent = 'Bitte mindestens eine Person auswählen.'; errorBox.style.display = 'flex'; return; }
            // Ohne Startdatum würden auch alle vergangenen Dienste "vertreten".
            if (!startInput.value || !endInput.value) { errorBox.textContent = 'Bitte einen Zeitraum (von/bis) angeben.'; errorBox.style.display = 'flex'; return; }
            if (endInput.value < startInput.value) { errorBox.textContent = 'Das Enddatum darf nicht vor dem Startdatum liegen.'; errorBox.style.display = 'flex'; return; }
            launchSubstitutionFlow(ids, startInput.value, endInput.value, null, cfg.options);
          },
        },
      ],
    });
  }

  return { openAbsenceDialog, launchSubstitutionFlow };
})();
