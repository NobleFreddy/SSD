/**
 * ============================================================================
 * SSD.Views.AdminSchedule — Dienstplan-Ansicht, Generator & Nachbearbeitung
 * ============================================================================
 * Zeigt den Dienstplan als Wochentabelle, startet den Optimierungsalgorithmus
 * (SSD.Scheduler) inklusive Ladeanimation und erlaubt die manuelle
 * Nachbearbeitung einzelner Dienste mit sofortiger Konflikterkennung.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminSchedule = (function () {
  'use strict';

  const U = SSD.Utils;
  let layoutHandle = null;
  let unsubscribe = null;
  let viewedMonday = U.getMondayOfWeek(U.today());

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  const findEntry = SSD.ScheduleTable.findEntry;

  function weekEntries(monday) {
    const startIso = U.toIsoDate(monday);
    const endIso = U.toIsoDate(U.addDays(monday, 4));
    return SSD.Store.getState().schedule.entries.filter((e) => e.date >= startIso && e.date <= endIso);
  }

  /* ---------------------------------------------------------------------
   * Konflikterkennung
   * ------------------------------------------------------------------- */

  function getConflicts(studentId, dateIso, weekday, block) {
    const conflicts = [];
    const student = SSD.StudentService.getById(studentId);
    if (!student) return conflicts;
    if (!student.active) conflicts.push('Konto ist deaktiviert');

    const blockIdx = U.DUTY_BLOCK_KEYS.indexOf(block);
    const availState = student.availability[weekday][blockIdx];
    if (availState === 'blocked') conflicts.push('Für diesen Termin gesperrt (Klausur/Termin)');
    else if (availState === 'unavailable') conflicts.push('Als nicht verfügbar eingetragen');

    const state = SSD.Store.getState();
    const entryHasPerson = (e) => e.studentIds.includes(studentId) || e.azubiId === studentId;
    const sameDayOther = state.schedule.entries.some((e) => e.date === dateIso && e.block !== block && entryHasPerson(e));
    if (sameDayOther && !state.settings.allowSameDayDuties) conflicts.push('Bereits an diesem Tag eingeteilt');

    const weekMonday = U.toIsoDate(U.getMondayOfWeek(U.parseIsoDate(dateIso)));
    const weekEnd = U.toIsoDate(U.addDays(U.parseIsoDate(weekMonday), 6));
    const maxWeek = student.maxDutiesPerWeek || state.settings.maxDutiesPerWeek;
    const countThisWeek = state.schedule.entries.filter((e) => e.date >= weekMonday && e.date <= weekEnd && e.block !== block && entryHasPerson(e)).length;
    if (countThisWeek >= maxWeek) conflicts.push(`Wöchentliches Limit von ${maxWeek} Diensten bereits erreicht`);

    return conflicts;
  }

  function warningLine(text) {
    return U.el('div', { class: 'cluster gap-2', style: 'color:var(--color-danger-500); font-size:var(--font-size-xs); font-weight:600;' }, [
      U.el('span', { html: SSD.Icons.svg('warning', { size: 14 }) }),
      U.el('span', {}, [text]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Manuelles Bearbeiten eines Dienstes
   * ------------------------------------------------------------------- */

  function commitEntry(dateIso, weekday, block, studentIds, azubiId) {
    SSD.Store.commit('Dienstplan manuell bearbeitet', (draft) => {
      let entry = draft.schedule.entries.find((e) => e.date === dateIso && e.block === block);
      if (!entry) {
        entry = SSD.Models.createScheduleEntry({ date: dateIso, weekday, block });
        draft.schedule.entries.push(entry);
      }
      const before = { ids: entry.studentIds.slice(), azubiId: entry.azubiId || null };
      entry.studentIds = studentIds;
      if (azubiId !== undefined) entry.azubiId = azubiId || null;
      entry.isManual = true;
      notifyManualChange(draft, entry, before);
    });
    SSD.Toast.success('Gespeichert', 'Der Dienstplan wurde aktualisiert.');
  }

  /** Teams-Meldung für eine manuelle Änderung an einem kommenden Dienst (nur bei echter Änderung). */
  function notifyManualChange(draft, entry, before) {
    const N = SSD.NotificationService;
    if (!N.isUpcoming(entry.date)) return;
    const sameStudents = before.ids.length === entry.studentIds.length && before.ids.every((id) => entry.studentIds.includes(id));
    if (sameStudents && before.azubiId === (entry.azubiId || null)) return;
    const describe = (ids, azubi) => {
      if (!ids.length && !azubi) return 'unbesetzt';
      return `${ids.length ? N.names(ids) : 'niemand'}${azubi ? ` + Azubi ${N.personName(azubi)}` : ''}`;
    };
    const nowText = describe(entry.studentIds, entry.azubiId);
    const text = nowText === 'unbesetzt'
      ? `${N.dutyLabel(entry)}: Dienst geleert (vorher ${describe(before.ids, before.azubiId)}).`
      : `${N.dutyLabel(entry)}: jetzt ${nowText} (vorher ${describe(before.ids, before.azubiId)}).`;
    N.add(draft, 'schedule', text);
  }

  function openDutyEditModal(dateIso, weekday, block) {
    const entry = findEntry(dateIso, block);
    const settings = SSD.SettingsService.get();
    const students = SSD.StudentService.getAll().filter((s) => (s.role || 'student') === 'student').sort((a, b) => a.lastName.localeCompare(b.lastName));
    const azubis = SSD.StudentService.getAll().filter((s) => s.role === 'azubi').sort((a, b) => a.lastName.localeCompare(b.lastName));

    function buildSelect(list, selectedId, emptyLabel) {
      return U.el('select', { class: 'select' }, [
        U.el('option', { value: '' }, [emptyLabel || '— Keine Auswahl —']),
        ...list.map((s) => U.el('option', { value: s.id, selected: s.id === selectedId }, [`${SSD.StudentService.fullName(s)}${s.active ? '' : ' (inaktiv)'}`])),
      ]);
    }

    const select1 = buildSelect(students, entry?.studentIds[0]);
    const select2 = buildSelect(students, entry?.studentIds[1]);
    const azubiSelect = buildSelect(azubis, entry?.azubiId, '— Kein Azubi eingeteilt —');
    const warnBox = U.el('div', { class: 'stack gap-1' });
    const hasStaleOccupant = !!entry && entry.studentIds.some((id) => {
      const s = SSD.StudentService.getById(id);
      return !s || !s.active;
    });

    function refreshWarnings() {
      warnBox.innerHTML = '';
      if (hasStaleOccupant) {
        warnBox.appendChild(warningLine('Mindestens eine bereits eingeteilte Person ist inzwischen deaktiviert — bitte zunächst manuell bereinigen, bevor automatisch aufgefüllt werden kann.'));
      }
      const ids = [select1.value, select2.value].filter(Boolean);
      if (ids.length === 2 && ids[0] === ids[1]) {
        warnBox.appendChild(warningLine('Dieselbe Person kann nicht zweimal im selben Dienst eingeteilt werden.'));
      } else if (ids.length === 2 && SSD.DistributionService.isNeverPair(ids[0], ids[1])) {
        warnBox.appendChild(warningLine(`${ids.map((id) => SSD.StudentService.fullName(SSD.StudentService.getById(id))).join(' und ')} sollen laut Paar-Regel nie zusammen eingeteilt werden.`));
      }
      ids.forEach((id) => {
        const conflicts = getConflicts(id, dateIso, weekday, block);
        const student = SSD.StudentService.getById(id);
        conflicts.forEach((msg) => warnBox.appendChild(warningLine(`${SSD.StudentService.fullName(student)}: ${msg}`)));
      });
      if (azubiSelect.value) {
        const azubiConflicts = getConflicts(azubiSelect.value, dateIso, weekday, block);
        const azubi = SSD.StudentService.getById(azubiSelect.value);
        azubiConflicts.forEach((msg) => warnBox.appendChild(warningLine(`${SSD.StudentService.fullName(azubi)}: ${msg}`)));
      }
    }
    select1.addEventListener('change', refreshWarnings);
    select2.addEventListener('change', refreshWarnings);
    azubiSelect.addEventListener('change', refreshWarnings);
    refreshWarnings();

    function fieldWithAbsenceAction(labelText, selectEl, currentStudentId) {
      const wrap = field(labelText, selectEl);
      if (entry && currentStudentId) {
        const btn = U.el('button', {
          type: 'button', class: 'btn btn--ghost btn--sm', style: 'margin-top:4px; padding-left:2px;',
          html: SSD.Icons.svg('userSearch', { size: 14 }),
        }, ['Vertretung suchen']);
        btn.addEventListener('click', () => {
          handle.close();
          SSD.SubstitutionFlow.launchSubstitutionFlow([currentStudentId], dateIso, dateIso, 'Kurzfristige Abwesenheit', {
            onApplied: renderContent, onRegenerateWeek: (monday) => openGenerateModal(monday),
          });
        });
        wrap.appendChild(btn);
      }
      return wrap;
    }

    const body = U.el('div', { class: 'stack gap-4' }, [
      U.el('p', { class: 'text-secondary', style: 'margin:0;' }, [`${U.formatDateLong(U.parseIsoDate(dateIso))} · ${U.blockLabel(block)}`]),
      U.el('div', { class: 'grid grid-cols-2' }, [
        fieldWithAbsenceAction('Schüler:in 1', select1, entry?.studentIds[0]),
        fieldWithAbsenceAction('Schüler:in 2', select2, entry?.studentIds[1]),
      ]),
      U.el('hr', { class: 'divider' }),
      fieldWithAbsenceAction('Azubi (optional, dritte Person)', azubiSelect, entry?.azubiId),
      warnBox,
    ]);

    const understaffedCount = settings.studentsPerDuty - (entry ? entry.studentIds.length : 0);

    const footerButtons = [{ label: 'Abbrechen', variant: 'secondary' }];
    if (entry && (entry.studentIds.length || entry.azubiId)) {
      footerButtons.push({ label: 'Dienst leeren', variant: 'danger', onClick: () => commitEntry(dateIso, weekday, block, [], null) });
    }
    if (understaffedCount > 0 && !hasStaleOccupant) {
      footerButtons.push({
        label: 'Trotzdem automatisch besetzen', variant: 'secondary', closeOnClick: false,
        html: SSD.Icons.svg('puzzle', { size: 15 }),
        onClick: async () => {
          const baseEntry = entry || SSD.Models.createScheduleEntry({ date: dateIso, weekday, block });
          const result = await SSD.Scheduler.fillUnderstaffedSlots([baseEntry], {});
          if (!result.updatedEntries.length) {
            SSD.Toast.warning('Keine passende Person gefunden', 'Auch mit gelockerter Verfügbarkeit ist aktuell niemand zulässig (z. B. wegen Wochenlimit oder "Gesperrt"-Status).');
            return;
          }
          commitEntry(dateIso, weekday, block, result.updatedEntries[0].studentIds, entry ? entry.azubiId : undefined);
          handle.close();
        },
      });
    }
    footerButtons.push({
      label: 'Speichern', variant: 'primary', closeOnClick: false,
      onClick: async () => {
        const ids = [select1.value, select2.value].filter(Boolean);
        if (new Set(ids).size !== ids.length) {
          SSD.Toast.error('Ungültige Auswahl', 'Dieselbe Person wurde zweimal ausgewählt.');
          return;
        }
        if (warnBox.children.length > 0) {
          const ok = await SSD.Dialog.confirm({
            title: 'Konflikte vorhanden', danger: true, confirmLabel: 'Trotzdem speichern',
            message: 'Für diese Zuteilung bestehen Konflikte (siehe Hinweise im Formular). Möchten Sie trotzdem speichern?',
          });
          if (!ok) return;
        }
        commitEntry(dateIso, weekday, block, ids, azubiSelect.value || null);
        handle.close();
      },
    });

    const handle = SSD.Dialog.open({ title: 'Dienst bearbeiten', body, wide: true, footerButtons });
  }

  /* ---------------------------------------------------------------------
   * Dienstplan-Tabelle (gemeinsame Komponente, siehe js/ui/scheduleTable.js)
   * ------------------------------------------------------------------- */

  function buildScheduleTable(monday) {
    return SSD.ScheduleTable.render(monday, { onCellClick: openDutyEditModal });
  }

  const buildLegend = SSD.ScheduleTable.renderLegend;

  /* ---------------------------------------------------------------------
   * Generator (Solver-Overlay)
   * ------------------------------------------------------------------- */

  function buildSolverOverlay(opts) {
    const title = (opts && opts.title) || 'Dienstplan wird erstellt';
    const icon = (opts && opts.icon) || 'wand';
    const logEl = U.el('div', { class: 'solver-card__log' });
    const progressFill = U.el('div', { class: 'progress-bar__fill', style: 'width:4%' });
    const messageEl = U.el('p', {}, ['Initialisiere …']);
    const el = U.el('div', { class: 'solver-overlay' }, [
      U.el('div', { class: 'solver-card' }, [
        U.el('div', { class: 'solver-card__orbit' }, [
          U.el('div', { class: 'spinner spinner--lg' }),
          U.el('span', { html: SSD.Icons.svg(icon, { size: 30 }) }),
        ]),
        U.el('h3', {}, [title]),
        messageEl,
        U.el('div', { class: 'solver-card__progress' }, [U.el('div', { class: 'progress-bar' }, [progressFill])]),
        logEl,
      ]),
    ]);

    function update(info) {
      progressFill.style.width = `${info.percent}%`;
      messageEl.textContent = info.message;
      logEl.appendChild(U.el('div', {}, [`${info.percent}% — ${info.message}`]));
      logEl.scrollTop = logEl.scrollHeight;
      while (logEl.children.length > 6) logEl.removeChild(logEl.firstChild);
    }
    return { el, update, close: () => el.remove() };
  }

  async function runGeneration(monday, weeks) {
    const overlay = buildSolverOverlay();
    document.body.appendChild(overlay.el);
    const minDurationPromise = new Promise((resolve) => setTimeout(resolve, 900)); // spürbare, aber kurze Ladeanimation

    try {
      const result = await SSD.Scheduler.generateSchedule({ startMonday: monday, weekCount: weeks }, overlay.update);
      await minDurationPromise;

      SSD.Store.commit(`Dienstplan erstellt (${U.formatDateMedium(monday)}, ${weeks} Woche(n))`, (draft) => {
        const startIso = U.toIsoDate(monday);
        const endIso = U.toIsoDate(U.addDays(monday, weeks * 7 - 1));
        draft.schedule.entries = draft.schedule.entries.filter((e) => e.date < startIso || e.date > endIso);
        draft.schedule.entries.push(...result.entries);
        if (result.stats.totalSlots > 0) {
          SSD.NotificationService.add(draft, 'schedule',
            `Neuer Dienstplan für ${U.formatDateShort(monday)}–${U.formatDateShort(U.addDays(monday, weeks * 7 - 3))}: ` +
            `${result.stats.filledSlots} von ${result.stats.totalSlots} Diensten vollständig besetzt — bitte die eigenen Dienste in der App prüfen.`);
        }
      });

      viewedMonday = monday;
      renderContent();

      const stats = result.stats;
      const perWeek = stats.perPersonWeekMax
        ? ` · Dienste pro Person und Woche: ${stats.perPersonWeekMin === stats.perPersonWeekMax ? stats.perPersonWeekMax : `${stats.perPersonWeekMin}–${stats.perPersonWeekMax}`} (Ø ${String(stats.perPersonWeekAvg).replace('.', ',')})`
        : '';
      if (stats.totalSlots === 0) {
        SSD.Toast.warning('Keine Dienste geplant', stats.message || 'Im gewählten Zeitraum sind alle Tage gesperrt oder keine Dienstblöcke aktiv.');
      } else if (stats.unfilledSlots > 0) {
        SSD.Toast.show({ type: 'warning', title: 'Dienstplan erstellt — mit Lücken', message: `${stats.filledSlots}/${stats.totalSlots} Dienste vollständig besetzt${perWeek}.`, duration: 8000 });
      } else {
        SSD.Toast.show({ type: 'success', title: 'Dienstplan erfolgreich erstellt!', message: `Alle ${stats.totalSlots} Dienste besetzt${perWeek}.`, duration: 8000 });
      }
    } catch (err) {
      console.error(err);
      SSD.Toast.error('Fehler bei der Erstellung', String(err.message || err));
    } finally {
      overlay.close();
    }
  }

  function openGenerateModal(defaultMonday) {
    const startInput = U.el('input', { class: 'input', type: 'date', value: U.toIsoDate(defaultMonday || viewedMonday) });
    const weekCountInput = U.el('input', { class: 'input', type: 'number', min: '1', max: '8', value: '1' });
    const previewText = U.el('p', { class: 'text-secondary' });
    const warnBox = U.el('div');

    function refresh() {
      const raw = U.parseIsoDate(startInput.value || U.toIsoDate(viewedMonday));
      const monday = U.getMondayOfWeek(raw);
      startInput.value = U.toIsoDate(monday);
      const weeks = U.clamp(Number(weekCountInput.value) || 1, 1, 8);
      weekCountInput.value = String(weeks);

      const slotCount = SSD.Scheduler.countPlannableSlots(monday, weeks);
      const existing = SSD.Scheduler.getExistingEntriesInRange(monday, weeks).filter((e) => e.studentIds.length);
      previewText.textContent = `${slotCount} Dienste werden im Zeitraum ${U.formatDateMedium(monday)} – ${U.formatDateMedium(U.addDays(monday, weeks * 7 - 1))} geplant.`;
      warnBox.innerHTML = '';
      if (existing.length) {
        warnBox.appendChild(U.el('div', { class: 'notice-box' }, [
          U.el('span', { html: SSD.Icons.svg('warning', { size: 18 }) }),
          U.el('div', {}, [U.el('strong', {}, ['Bestehende Einträge werden überschrieben']), U.el('p', {}, [`${existing.length} bereits besetzte Dienste liegen in diesem Zeitraum und werden neu berechnet.`])]),
        ]));
      }
    }
    startInput.addEventListener('change', refresh);
    weekCountInput.addEventListener('change', refresh);
    refresh();

    const body = U.el('div', { class: 'stack gap-4' }, [
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Startwoche (Montag)', startInput),
        field('Anzahl Wochen', weekCountInput),
      ]),
      previewText,
      warnBox,
      U.el('p', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, ['Der Algorithmus berücksichtigt Verfügbarkeiten, Sperrzeiten und eine gleichmäßige Verteilung sowie die Regeln und Prioritäten unter „Verteilung“ (Wunschpartner:innen, Abijahrgänge, Paar-Regeln, …).']),
    ]);

    SSD.Dialog.open({
      title: 'Dienstplan erstellen', body,
      footerButtons: [
        { label: 'Abbrechen', variant: 'secondary' },
        {
          label: 'Erstellen', variant: 'primary', html: SSD.Icons.svg('wand', { size: 15 }),
          onClick: () => runGeneration(U.parseIsoDate(startInput.value), Number(weekCountInput.value)),
        },
      ],
    });
  }

  /* ---------------------------------------------------------------------
   * Lücken auffüllen (trotz fehlender Verfügbarkeit)
   * ------------------------------------------------------------------- */

  async function runFillGaps(monday, weeks) {
    const targets = SSD.Scheduler.getUnderstaffedEntriesInRange(monday, weeks);
    if (!targets.length) {
      SSD.Toast.info('Keine Lücken gefunden', 'Im gewählten Zeitraum sind alle Dienste bereits vollständig besetzt (oder eine bestehende Besetzung ist inzwischen deaktiviert und muss erst manuell bereinigt werden).');
      return;
    }

    const overlay = buildSolverOverlay({ title: 'Lücken werden aufgefüllt', icon: 'puzzle' });
    document.body.appendChild(overlay.el);
    const minDurationPromise = new Promise((resolve) => setTimeout(resolve, 600));

    try {
      const result = await SSD.Scheduler.fillUnderstaffedSlots(targets, {}, overlay.update);
      await minDurationPromise;

      if (!result.updatedEntries.length) {
        SSD.Toast.warning('Keine Änderung möglich', 'Für die gefundenen Lücken ist aktuell niemand zulässig — auch nicht mit gelockerter Verfügbarkeit (z. B. wegen Wochenlimit oder "Gesperrt"-Status).');
        return;
      }

      SSD.Store.commit(`Lücken aufgefüllt (${U.formatDateMedium(monday)}, ${weeks} Woche(n))`, (draft) => {
        const N = SSD.NotificationService;
        const lines = [];
        result.updatedEntries.forEach((u) => {
          const target = draft.schedule.entries.find((e) => e.id === u.id);
          if (!target) return;
          const added = u.studentIds.filter((id) => !target.studentIds.includes(id));
          target.studentIds = u.studentIds;
          target.isManual = true;
          if (added.length && N.isUpcoming(target.date)) lines.push(`${N.dutyLabel(target)}: neu ${N.names(added)}`);
        });
        if (lines.length) {
          N.add(draft, 'schedule', N.withDetails(
            `Lücken aufgefüllt (${U.formatDateShort(monday)}–${U.formatDateShort(U.addDays(monday, weeks * 7 - 3))}) — auch mit Personen, die dort „Nicht verfügbar“ eingetragen hatten:`,
            lines));
        }
      });

      renderContent();
      if (result.stillUnderstaffedCount > 0) {
        SSD.Toast.warning('Teilweise aufgefüllt', `${result.filledSeatCount} Platz/Plätze besetzt · ${result.stillUnderstaffedCount} Dienst(e) bleiben trotzdem unbesetzt (keine zulässige Person gefunden).`);
      } else {
        SSD.Toast.success('Lücken aufgefüllt', `${result.filledSeatCount} Platz/Plätze wurden besetzt.`);
      }
    } catch (err) {
      console.error(err);
      SSD.Toast.error('Fehler beim Auffüllen', String(err.message || err));
    } finally {
      overlay.close();
    }
  }

  function openFillGapsModal() {
    const startInput = U.el('input', { class: 'input', type: 'date', value: U.toIsoDate(viewedMonday) });
    const weekCountInput = U.el('input', { class: 'input', type: 'number', min: '1', max: '8', value: '1' });
    const previewText = U.el('p', { class: 'text-secondary' });

    function refresh() {
      const raw = U.parseIsoDate(startInput.value || U.toIsoDate(viewedMonday));
      const monday = U.getMondayOfWeek(raw);
      startInput.value = U.toIsoDate(monday);
      const weeks = U.clamp(Number(weekCountInput.value) || 1, 1, 8);
      weekCountInput.value = String(weeks);

      const gaps = SSD.Scheduler.getUnderstaffedEntriesInRange(monday, weeks);
      const rangeLabel = `${U.formatDateMedium(monday)} – ${U.formatDateMedium(U.addDays(monday, weeks * 7 - 1))}`;
      previewText.textContent = gaps.length
        ? `${gaps.length} unbesetzte(r)/unvollständige(r) Dienst(e) im Zeitraum ${rangeLabel} gefunden.`
        : `Im Zeitraum ${rangeLabel} sind aktuell keine Lücken vorhanden.`;
    }
    startInput.addEventListener('change', refresh);
    weekCountInput.addEventListener('change', refresh);
    refresh();

    const body = U.el('div', { class: 'stack gap-4' }, [
      U.el('p', {}, ['Besetzt unbesetzte oder unvollständige Dienste im gewählten Zeitraum trotzdem: "Nicht verfügbar" zählt hierbei ausnahmsweise als besetzbar. Als "Gesperrt" markierte Zeiten (Klausur, Termin, …) werden weiterhin nie verwendet, ebenso alle anderen Regeln (Wochenlimit, Pausen, keine Doppelbelegung).']),
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Startwoche (Montag)', startInput),
        field('Anzahl Wochen', weekCountInput),
      ]),
      previewText,
    ]);

    SSD.Dialog.open({
      title: 'Lücken auffüllen', body,
      footerButtons: [
        { label: 'Abbrechen', variant: 'secondary' },
        {
          label: 'Auffüllen', variant: 'primary', html: SSD.Icons.svg('puzzle', { size: 15 }),
          onClick: () => runFillGaps(U.getMondayOfWeek(U.parseIsoDate(startInput.value)), Number(weekCountInput.value)),
        },
      ],
    });
  }

  /* ---------------------------------------------------------------------
   * Wochenübertragung ("wiederkehrender Dienstplan")
   * ------------------------------------------------------------------- */

  function runWeekTransfer(templateMonday, weekCount) {
    const result = SSD.Scheduler.transferWeekToUpcoming(templateMonday, weekCount);
    if (!result.entries.length) {
      SSD.Toast.warning('Nichts übertragen', 'Die gewählte Vorlagen-Woche enthält keine besetzten Dienste.');
      return;
    }
    SSD.Store.commit(`Woche übertragen (${U.formatDateMedium(templateMonday)} → ${result.weeksProcessed} Folgewoche(n))`, (draft) => {
      const startIso = U.toIsoDate(U.addDays(templateMonday, 7));
      const endIso = U.toIsoDate(U.addDays(templateMonday, result.weeksProcessed * 7 + 6));
      draft.schedule.entries = draft.schedule.entries.filter((e) => e.date < startIso || e.date > endIso);
      draft.schedule.entries.push(...result.entries);
      SSD.NotificationService.add(draft, 'schedule',
        `Dienstplan übertragen: Die Einteilung der Woche ab ${U.formatDateShort(templateMonday)} gilt jetzt auch für ` +
        `${result.weeksProcessed === 1 ? 'die Folgewoche' : `${result.weeksProcessed} Folgewochen`} (bis ${U.formatDateShort(U.addDays(templateMonday, result.weeksProcessed * 7 + 4))}).`);
    });
    renderContent();
    SSD.Toast.success(
      'Dienstplan übertragen',
      `${result.entries.length} Dienste auf ${result.weeksProcessed} Folgewochen übertragen.` +
      (result.skippedCount ? ` ${result.skippedCount} Zuteilung(en) übersprungen (Person inzwischen inaktiv).` : '')
    );
  }

  function openTransferModal() {
    const templateInput = U.el('input', { class: 'input', type: 'date', value: U.toIsoDate(viewedMonday) });
    const weekCountInput = U.el('input', { class: 'input', type: 'number', min: '1', max: '52', value: '12' });
    const previewText = U.el('p', { class: 'text-secondary' });
    const warnBox = U.el('div');

    function refresh() {
      const monday = U.getMondayOfWeek(U.parseIsoDate(templateInput.value || U.toIsoDate(viewedMonday)));
      templateInput.value = U.toIsoDate(monday);
      const weeks = U.clamp(Number(weekCountInput.value) || 1, 1, 52);
      weekCountInput.value = String(weeks);

      const templateEntries = SSD.Scheduler.getExistingEntriesInRange(monday, 1).filter((e) => e.studentIds.length || e.azubiId);
      const untilDate = U.addDays(monday, weeks * 7 + 6);
      warnBox.innerHTML = '';
      if (!templateEntries.length) {
        previewText.textContent = '';
        warnBox.appendChild(U.el('div', { class: 'notice-box' }, [
          U.el('span', { html: SSD.Icons.svg('warning', { size: 18 }) }),
          U.el('div', {}, [U.el('strong', {}, ['Keine Vorlage gefunden']), U.el('p', {}, ['Für die gewählte Woche existiert noch kein besetzter Dienstplan. Bitte zunächst eine Woche erstellen oder eine andere Vorlagen-Woche wählen.'])]),
        ]));
      } else {
        previewText.textContent = `${templateEntries.length} Dienste aus der Woche ${U.formatDateMedium(monday)} werden auf ${weeks} Folgewochen übertragen (bis einschließlich ${U.formatDateMedium(untilDate)}).`;
        const existing = SSD.Scheduler.getExistingEntriesInRange(U.addDays(monday, 7), weeks).filter((e) => e.studentIds.length || e.azubiId);
        if (existing.length) {
          warnBox.appendChild(U.el('div', { class: 'notice-box' }, [
            U.el('span', { html: SSD.Icons.svg('warning', { size: 18 }) }),
            U.el('div', {}, [U.el('strong', {}, ['Bestehende Einträge werden überschrieben']), U.el('p', {}, [`${existing.length} bereits besetzte Dienste liegen im Zielzeitraum und werden ersetzt.`])]),
          ]));
        }
      }
    }
    templateInput.addEventListener('change', refresh);
    weekCountInput.addEventListener('change', refresh);
    refresh();

    const body = U.el('div', { class: 'stack gap-4' }, [
      U.el('p', {}, ['Überträgt das Muster (Wochentag/Block → Person) einer bereits fertigen Woche auf die folgenden Wochen, damit der Dienstplan nicht jede Woche neu erstellt werden muss. Sondertage und deaktivierte Blöcke werden in jeder Zielwoche automatisch weiterhin berücksichtigt.']),
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Vorlagen-Woche (Montag)', templateInput),
        field('Anzahl Folgewochen', weekCountInput),
      ]),
      previewText,
      warnBox,
    ]);

    SSD.Dialog.open({
      title: 'Auf kommende Wochen übertragen', body, wide: true,
      footerButtons: [
        { label: 'Abbrechen', variant: 'secondary' },
        {
          label: 'Übertragen', variant: 'primary', html: SSD.Icons.svg('arrowRight', { size: 15 }),
          onClick: () => runWeekTransfer(U.getMondayOfWeek(U.parseIsoDate(templateInput.value)), Number(weekCountInput.value)),
        },
      ],
    });
  }

  /* ---------------------------------------------------------------------
   * Kopfzeile & Rendering
   * ------------------------------------------------------------------- */

  function buildHeader() {
    const prevBtn = U.el('button', { class: 'btn btn--icon btn--secondary', 'data-tooltip': 'Vorherige Woche', html: SSD.Icons.svg('chevronLeft', { size: 16 }) });
    prevBtn.addEventListener('click', () => { viewedMonday = U.addDays(viewedMonday, -7); renderContent(); });
    const nextBtn = U.el('button', { class: 'btn btn--icon btn--secondary', 'data-tooltip': 'Nächste Woche', html: SSD.Icons.svg('chevronRight', { size: 16 }) });
    nextBtn.addEventListener('click', () => { viewedMonday = U.addDays(viewedMonday, 7); renderContent(); });
    const todayBtn = U.el('button', { class: 'btn btn--secondary btn--sm' }, ['Aktuelle Woche']);
    todayBtn.addEventListener('click', () => { viewedMonday = U.getMondayOfWeek(U.today()); renderContent(); });

    const exportBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('download', { size: 16 }) }, ['Exportieren']);
    exportBtn.addEventListener('click', () => {
      const entries = weekEntries(viewedMonday);
      SSD.Menu.open(exportBtn, [
        { label: 'Als CSV', icon: 'fileCsv', onClick: () => SSD.ImportExport.exportScheduleCsv(entries) },
        { label: 'Als Excel', icon: 'fileExcel', onClick: () => SSD.ImportExport.exportScheduleExcel(entries) },
        { label: 'Drucken / Als PDF speichern', icon: 'print', onClick: () => SSD.ImportExport.triggerPrint() },
      ]);
    });

    const absenceBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('userAbsent', { size: 16 }) }, ['Abwesenheit melden']);
    absenceBtn.addEventListener('click', () => SSD.SubstitutionFlow.openAbsenceDialog({
      options: { onApplied: renderContent, onRegenerateWeek: (monday) => openGenerateModal(monday) },
    }));

    const transferBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('refresh', { size: 16 }), 'data-tooltip': 'Angezeigte Woche als Vorlage auf kommende Wochen übertragen' }, ['Auf Folgewochen übertragen']);
    transferBtn.addEventListener('click', () => openTransferModal());

    const fillGapsBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('puzzle', { size: 16 }), 'data-tooltip': 'Unbesetzte Dienste trotz fehlender Verfügbarkeit befüllen' }, ['Lücken auffüllen']);
    fillGapsBtn.addEventListener('click', () => openFillGapsModal());

    const generateBtn = U.el('button', { class: 'btn btn--primary', html: SSD.Icons.svg('wand', { size: 16 }) }, ['Dienstplan erstellen']);
    generateBtn.addEventListener('click', () => openGenerateModal());

    return U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [
        U.el('h1', {}, ['Dienstplan']),
        U.el('div', { class: 'cluster gap-2 no-print', style: 'margin-top:8px;' }, [
          prevBtn,
          U.el('strong', {}, [`${U.formatDateMedium(viewedMonday)} – ${U.formatDateMedium(U.addDays(viewedMonday, 4))}`]),
          nextBtn, todayBtn,
        ]),
      ]),
      U.el('div', { class: 'page-header__actions' }, [absenceBtn, transferBtn, fillGapsBtn, exportBtn, generateBtn]),
    ]);
  }

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    layoutHandle.contentEl.appendChild(buildHeader());

    const card = U.el('div', { class: 'card printable-section' });
    const body = U.el('div', { class: 'card__body' }, [
      U.el('div', { class: 'print-only print-header' }, [
        U.el('img', { class: 'print-logo', src: 'assets/logo.png', alt: '' }),
        U.el('div', {}, [
          U.el('div', { class: 'print-title' }, [`Dienstplan — ${SSD.SettingsService.getSchool().name}`]),
          U.el('div', { class: 'print-subtitle' }, [`${U.formatDateMedium(viewedMonday)} – ${U.formatDateMedium(U.addDays(viewedMonday, 4))}`]),
        ]),
      ]),
      buildScheduleTable(viewedMonday),
      U.el('div', { style: 'margin-top:20px;' }, [buildLegend()]),
    ]);
    card.appendChild(body);
    layoutHandle.contentEl.appendChild(card);
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'schedule');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
