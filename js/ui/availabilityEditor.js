/**
 * ============================================================================
 * SSD.AvailabilityEditor / SSD.ExamsPanel — Verfügbarkeit & Klausuren
 * ============================================================================
 * Gemeinsamer Baustein für den Schülerbereich (eigene Angaben, mit
 * Änderungsfrist) und die Schülerverwaltung des Administrators (alle
 * Personen, ohne Frist). Die Regeln stehen in SSD.AvailabilityService.
 *
 * AvailabilityEditor: Reiter "Standardwoche" plus die kommenden Wochen. Eine
 * Woche ohne eigenen Eintrag zeigt die Standardwoche; die erste Änderung legt
 * einen eigenen Eintrag für genau diese Woche an.
 */
window.SSD = window.SSD || {};

SSD.AvailabilityEditor = (function () {
  'use strict';

  const U = SSD.Utils;
  const OPTIONS = [
    { key: 'available', label: 'Verfügbar' },
    { key: 'unavailable', label: 'Nicht verfügbar' },
    { key: 'blocked', label: 'Gesperrt' },
  ];
  const selectedScope = new Map(); // studentId -> 'template' | Montag (bleibt bei Neuaufbau erhalten)

  function blockedHint() {
    return SSD.WeeklyUpdateService.settings().enabled
      ? 'z. B. Arzttermin oder anderer fester Termin — bereits eingeteilte Dienste werden am Sonntag um 12 Uhr neu besetzt'
      : 'z. B. Arzttermin oder anderer fester Termin — für bereits eingeteilte Dienste bitte eine Vertretung anfordern';
  }

  /**
   * @param {{studentId: string, admin?: boolean, onChange?: Function}} opts
   * @returns {HTMLElement}
   */
  function render(opts) {
    const admin = !!opts.admin;
    const root = U.el('div', { class: 'stack gap-4' });

    function draw() {
      const student = SSD.StudentService.getById(opts.studentId);
      root.innerHTML = '';
      if (!student) return;
      const AV = SSD.AvailabilityService;
      const weeks = AV.upcomingWeeks({ includeCurrent: admin });
      let scope = selectedScope.get(student.id) || 'template';
      if (scope !== 'template' && !weeks.some((w) => w.monday === scope)) scope = 'template';
      const week = weeks.find((w) => w.monday === scope) || null;
      const templateWindow = SSD.StudentService.getAvailabilityWindow();
      const editable = admin || (scope === 'template' ? templateWindow.isOpen : week.editable);
      const { grid, isOverride } = AV.weekGrid(student, scope === 'template' ? null : scope);

      // Reiter: Standardwoche + kommende Wochen
      const tabs = U.el('div', { class: 'tabs tabs--sub', role: 'tablist', 'aria-label': 'Woche wählen' }, [
        { key: 'template', label: 'Standardwoche' },
        ...weeks.map((w) => ({ key: w.monday, label: w.isCurrent ? `${w.short} (läuft)` : w.short, own: !!(student.availabilityWeeks || {})[w.monday] })),
      ].map((t) => {
        const btn = U.el('button', { type: 'button', class: `tab${t.key === scope ? ' is-active' : ''}`, role: 'tab', 'aria-selected': t.key === scope ? 'true' : 'false' }, [
          t.label,
          t.own ? U.el('span', { class: 'tab__dot', 'aria-label': 'eigener Eintrag', title: 'Eigener Eintrag für diese Woche' }) : null,
        ]);
        btn.addEventListener('click', () => { selectedScope.set(student.id, t.key); draw(); });
        return btn;
      }));
      root.appendChild(tabs);

      // Hinweiszeile
      let info;
      if (scope === 'template') {
        info = 'Gilt für jede Woche, für die kein eigener Eintrag besteht.';
      } else if (isOverride) {
        info = `${week.label}: eigener Eintrag für diese Woche.`;
      } else {
        info = `${week.label}: richtet sich nach der Standardwoche. Eine Änderung legt einen eigenen Eintrag nur für diese Woche an.`;
      }
      const lockText = admin ? null
        : editable
          ? `Änderbar bis ${U.formatDateMedium(U.addDays(scope === 'template' ? templateWindow.lockDate : week.lockDate, -1))}`
          : 'Änderungsfrist abgelaufen';
      const resetBtn = scope !== 'template' && isOverride && editable
        ? U.el('button', { type: 'button', class: 'btn btn--ghost btn--sm', html: SSD.Icons.svg('undo', { size: 14 }) }, ['Wie Standardwoche'])
        : null;
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          try { AV.resetWeek(student.id, scope); } catch (err) { SSD.Toast.error('Nicht möglich', String(err.message || err)); return; }
          SSD.Toast.success('Zurückgesetzt', 'Die Woche richtet sich wieder nach der Standardwoche.');
          draw();
          if (opts.onChange) opts.onChange();
        });
      }
      root.appendChild(U.el('div', { class: 'cluster gap-3', style: 'justify-content:space-between;' }, [
        U.el('span', { class: 'text-secondary', style: 'font-size:var(--font-size-sm);' }, [info]),
        U.el('div', { class: 'cluster gap-2' }, [
          lockText ? U.el('span', { class: `deadline-pill${editable ? '' : ' deadline-pill--locked'}`, html: SSD.Icons.svg(editable ? 'unlock' : 'lock', { size: 15 }) }, [` ${lockText}`]) : null,
          resetBtn,
        ]),
      ]));

      // Raster
      const gridEl = U.el('div', { class: 'week-grid' });
      gridEl.appendChild(U.el('div', { class: 'week-grid__corner' }));
      const monday = scope === 'template' ? null : U.parseIsoDate(scope);
      U.WEEKDAY_KEYS.forEach((day, i) => {
        gridEl.appendChild(U.el('div', { class: 'week-grid__day-head' }, [
          U.WEEKDAY_LABELS[day],
          monday ? U.el('span', { class: 'date' }, [U.formatDateShort(U.addDays(monday, i))]) : null,
        ]));
      });
      U.DUTY_BLOCKS.forEach((block, blockIdx) => {
        gridEl.appendChild(U.el('div', { class: 'week-grid__block-label' }, [block.short, U.el('span', {}, [block.label])]));
        U.WEEKDAY_KEYS.forEach((day, i) => {
          const cell = U.el('div', { class: 'avail-cell' });
          if (!SSD.CalendarService.isBlockEnabled(day, block.key)) {
            cell.appendChild(U.el('div', { class: 'avail-option', style: 'color:var(--text-tertiary); cursor:default;' }, ['Kein Dienst']));
            gridEl.appendChild(cell);
            return;
          }
          const exam = monday ? AV.examAt(student, U.toIsoDate(U.addDays(monday, i)), block.key) : null;
          if (exam) {
            cell.classList.add('avail-cell--exam');
            cell.appendChild(U.el('div', { class: 'avail-exam', title: AV.describeExam(exam) }, [exam.title ? `Klausur: ${exam.title}` : 'Klausur/Termin']));
          }
          OPTIONS.forEach((opt) => {
            const btn = U.el('button', {
              type: 'button',
              class: `avail-option${grid[day][blockIdx] === opt.key ? ` is-selected--${opt.key}` : ''}`,
              disabled: !editable,
              'data-tooltip': opt.key === 'blocked' ? blockedHint() : undefined,
            }, [opt.label]);
            btn.addEventListener('click', () => {
              try {
                AV.setCell(student.id, scope, day, blockIdx, opt.key);
              } catch (err) {
                SSD.Toast.error('Nicht gespeichert', String(err.message || err));
                return;
              }
              SSD.Toast.show({ type: 'success', title: 'Gespeichert', message: `${scope === 'template' ? 'Standardwoche' : week.short}, ${U.WEEKDAY_LABELS[day]}, ${block.label}: ${opt.label}`, duration: 1800 });
              draw();
              if (opts.onChange) opts.onChange();
            });
            cell.appendChild(btn);
          });
          gridEl.appendChild(cell);
        });
      });
      root.appendChild(U.el('div', { class: 'week-grid-wrap' }, [gridEl]));

      root.appendChild(U.el('div', { class: 'legend' }, [
        U.el('div', { class: 'legend__item' }, [U.el('span', { class: 'legend__swatch', style: 'background:var(--color-success-500)' }), 'Verfügbar']),
        U.el('div', { class: 'legend__item' }, [U.el('span', { class: 'legend__swatch', style: 'background:var(--color-gray-400)' }), 'Nicht verfügbar']),
        U.el('div', { class: 'legend__item' }, [U.el('span', { class: 'legend__swatch', style: 'background:var(--color-danger-500)' }), 'Gesperrt (fester Termin)']),
        U.el('div', { class: 'legend__item' }, [U.el('span', { class: 'tab__dot', style: 'margin:0 6px 0 0;' }), 'Woche mit eigenem Eintrag']),
      ]));
    }

    draw();
    return root;
  }

  return { render };
})();

SSD.ExamsPanel = (function () {
  'use strict';

  const U = SSD.Utils;

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  /** Dienste, um die sich die Sonntags-Aktualisierung nicht mehr kümmert (laufende Woche bzw. schon geprüfte Woche). */
  function dutiesNotCoveredByWeeklyUpdate(duties) {
    const W = SSD.WeeklyUpdateService;
    const cfg = W.settings();
    if (cfg.enabled === false) return duties;
    let firstHandled = W.upcomingMonday(W.berlinParts(new Date()).dateIso);
    if (cfg.lastRunWeek === firstHandled) firstHandled = U.toIsoDate(U.addDays(U.parseIsoDate(firstHandled), 7));
    return duties.filter((d) => d.date < firstHandled);
  }

  /** Formular zum Eintragen/Bearbeiten (eingebettet in die Liste). */
  function buildForm(studentId, existing, admin, onDone) {
    const AV = SSD.AvailabilityService;
    const todayIso = U.toIsoDate(U.today());
    const titleInput = U.el('input', { class: 'input', value: existing?.title || '', maxlength: '60', placeholder: 'z. B. Mathe-Klausur (optional)' });
    const startInput = U.el('input', { class: 'input', type: 'date', min: todayIso, value: existing?.startDate || todayIso });
    const endInput = U.el('input', { class: 'input', type: 'date', min: todayIso, value: existing?.endDate || existing?.startDate || todayIso });
    startInput.addEventListener('change', () => { if (!endInput.value || endInput.value < startInput.value) endInput.value = startInput.value; });
    const allDay = U.el('input', { type: 'checkbox' });
    allDay.checked = !existing || !existing.blocks || !existing.blocks.length;
    const blockBoxes = U.DUTY_BLOCKS.map((b) => {
      const box = U.el('input', { type: 'checkbox', value: b.key });
      box.checked = !!(existing && existing.blocks && existing.blocks.includes(b.key));
      return { b, box };
    });
    const blocksWrap = U.el('div', { class: 'cluster gap-3' }, blockBoxes.map(({ b, box }) => U.el('label', { class: 'checkbox-row', style: 'margin:0;' }, [box, U.el('span', {}, [b.label])])));
    const syncBlocks = () => { blocksWrap.style.display = allDay.checked ? 'none' : ''; };
    allDay.addEventListener('change', syncBlocks);
    syncBlocks();
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const saveBtn = U.el('button', { type: 'button', class: 'btn btn--primary btn--sm' }, ['Speichern']);
    const cancelBtn = U.el('button', { type: 'button', class: 'btn btn--secondary btn--sm' }, ['Abbrechen']);
    cancelBtn.addEventListener('click', () => onDone(null));
    saveBtn.addEventListener('click', () => {
      errorBox.style.display = 'none';
      const blocks = allDay.checked ? [] : blockBoxes.filter((x) => x.box.checked).map((x) => x.b.key);
      if (!allDay.checked && !blocks.length) { errorBox.textContent = 'Bitte mindestens eine Stunde wählen oder „Ganzer Tag“.'; errorBox.style.display = 'flex'; return; }
      let saved;
      try {
        saved = AV.saveExam(studentId, { id: existing && existing.id, title: titleInput.value, startDate: startInput.value, endDate: endInput.value || startInput.value, blocks });
      } catch (err) {
        errorBox.textContent = String(err.message || err);
        errorBox.style.display = 'flex';
        return;
      }
      SSD.Toast.success('Gespeichert', AV.describeExam(saved));
      onDone(saved);
      afterSave(studentId, saved, admin);
    });

    return U.el('div', { class: 'stack gap-3 exam-form' }, [
      U.el('strong', {}, [existing ? 'Klausur/Termin bearbeiten' : 'Klausur oder Termin eintragen']),
      errorBox,
      field('Titel', titleInput, 'Der Titel ist nur für Sie und die Administration sichtbar.'),
      U.el('div', { class: 'grid grid-cols-2' }, [field('Von', startInput), field('Bis', endInput)]),
      U.el('label', { class: 'checkbox-row', style: 'margin:0;' }, [allDay, U.el('span', {}, ['Ganzer Tag'])]),
      blocksWrap,
      U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, [SSD.WeeklyUpdateService.settings().enabled
        ? 'In dieser Zeit wird niemand für Dienste eingeplant. Bereits eingeteilte Dienste der kommenden Woche besetzt die App am Sonntag um 12 Uhr automatisch neu.'
        : 'In dieser Zeit wird niemand neu für Dienste eingeplant. Für Dienste, die schon feststehen, bietet die App nach dem Speichern an, eine Vertretung anzufordern.']),
      U.el('div', { class: 'cluster gap-2' }, [saveBtn, cancelBtn]),
    ]);
  }

  /** Liegen schon Dienste in der Klausurzeit, die die Sonntags-Aktualisierung nicht mehr erfasst? */
  function afterSave(studentId, exam, admin) {
    const duties = dutiesNotCoveredByWeeklyUpdate(SSD.AvailabilityService.dutiesDuringExam(studentId, exam));
    if (!duties.length) return;
    const lines = duties.map((d) => `${U.WEEKDAY_LABELS[d.weekday] || ''}, ${U.formatDateShort(U.parseIsoDate(d.date))}, ${U.blockLabel(d.block)}`);
    if (admin) {
      SSD.Toast.show({ type: 'warning', title: 'Dienst in dieser Zeit', message: `Bereits eingeteilt: ${lines.join('; ')}. Bitte über „Abwesenheit melden“ im Dienstplan Ersatz suchen.`, duration: 9000 });
      return;
    }
    SSD.Dialog.confirm({
      title: 'Sie sind schon eingeteilt',
      message: `In dieser Zeit haben Sie bereits Dienst: ${lines.join('; ')}. Soll die App dafür jetzt eine Vertretung suchen?`,
      confirmLabel: 'Vertretung anfordern', cancelLabel: 'Später',
    }).then((ok) => {
      if (!ok) return;
      const result = SSD.SelfServiceService.requestSubstitutions(studentId, duties.map((d) => d.id));
      SSD.Toast.success('Erledigt', result.replaced.length
        ? `${result.replaced.length} ${result.replaced.length === 1 ? 'Dienst wurde' : 'Dienste wurden'} automatisch neu besetzt.`
        : 'Die Dienste sind als „Vertretung gesucht“ markiert.');
    });
  }

  /**
   * @param {{studentId: string, admin?: boolean, onChange?: Function}} opts
   * @returns {HTMLElement}
   */
  function render(opts) {
    const AV = SSD.AvailabilityService;
    const root = U.el('div', { class: 'stack gap-3' });
    let editing = null; // null | 'new' | Klausur-ID

    const finishEditing = (saved) => {
      editing = null;
      draw();
      if (saved && opts.onChange) opts.onChange();
    };

    function draw() {
      root.innerHTML = '';
      const student = SSD.StudentService.getById(opts.studentId);
      if (!student) return;
      if (editing) {
        const existing = editing === 'new' ? null : AV.getExams(student).find((e) => e.id === editing) || null;
        root.appendChild(buildForm(student.id, existing, opts.admin, finishEditing));
        return;
      }
      const addBtn = U.el('button', { type: 'button', class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('plus', { size: 14 }) }, ['Klausur/Termin eintragen']);
      addBtn.addEventListener('click', () => { editing = 'new'; draw(); });
      const exams = AV.upcomingExams(student);
      root.appendChild(U.el('div', { class: 'cluster gap-3', style: 'justify-content:space-between;' }, [
        U.el('span', { class: 'text-secondary', style: 'font-size:var(--font-size-sm);' }, ['Klausuren und feste Termine sperren Sie für diese Zeit — auch über die Änderungsfrist hinaus.']),
        addBtn,
      ]));
      if (!exams.length) {
        root.appendChild(U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-sm);' }, ['Keine Klausuren oder Termine eingetragen.']));
        return;
      }
      root.appendChild(U.el('div', { class: 'stack gap-1' }, exams.map((exam) => {
        const editBtn = U.el('button', { type: 'button', class: 'btn btn--icon btn--sm btn--ghost', 'aria-label': 'Bearbeiten', 'data-tooltip': 'Bearbeiten', html: SSD.Icons.svg('edit', { size: 14 }) });
        editBtn.addEventListener('click', () => { editing = exam.id; draw(); });
        const deleteBtn = U.el('button', { type: 'button', class: 'btn btn--icon btn--sm btn--ghost', 'aria-label': 'Löschen', 'data-tooltip': 'Löschen', html: SSD.Icons.svg('trash', { size: 14 }) });
        deleteBtn.addEventListener('click', async () => {
          const ok = await SSD.Dialog.confirm({ title: 'Eintrag löschen', message: `${exam.title ? `„${exam.title}“ ` : ''}(${AV.describeExam(exam)}) löschen?`, confirmLabel: 'Löschen', danger: true });
          if (!ok) return;
          try { AV.removeExam(student.id, exam.id); } catch (err) { SSD.Toast.error('Nicht möglich', String(err.message || err)); return; }
          draw();
          if (opts.onChange) opts.onChange();
        });
        return U.el('div', { class: 'cluster gap-3 exam-row' }, [
          U.el('span', { class: 'exam-row__icon', html: SSD.Icons.svg('calendar', { size: 16 }) }),
          U.el('div', { style: 'flex:1; min-width:0;' }, [
            U.el('div', { style: 'font-weight:600;' }, [exam.title || 'Klausur/Termin']),
            U.el('div', { class: 'text-secondary', style: 'font-size:var(--font-size-sm);' }, [AV.describeExam(exam)]),
          ]),
          editBtn, deleteBtn,
        ]);
      })));
    }

    draw();
    return root;
  }

  return { render };
})();
