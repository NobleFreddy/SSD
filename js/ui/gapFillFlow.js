/**
 * ============================================================================
 * SSD.GapFillFlow — "Lücken auffüllen" (Administrator + Team-Verwaltung)
 * ============================================================================
 * Besetzt unbesetzte oder unvollständige Dienste eines Zeitraums per
 * Algorithmus (`SSD.Scheduler.fillUnderstaffedSlots`), ohne den übrigen
 * Dienstplan neu zu berechnen. "Nicht verfügbar" zählt dabei ausnahmsweise
 * als besetzbar, "Gesperrt" nie. Dieselbe Oberfläche nutzen der
 * Administrator (Dienstplan-Ansicht) und die Sanisprecher:innen
 * (Team-Verwaltung) — eine geprüfte Logik statt zwei Varianten.
 *
 * Vergangene Dienste werden nie nachträglich besetzt: Sonst stünden Personen
 * im Verlauf und in der Engagement-Übersicht, die den Dienst nie gemacht haben.
 */
window.SSD = window.SSD || {};

SSD.GapFillFlow = (function () {
  'use strict';

  const U = SSD.Utils;

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  /** Unterbesetzte Dienste ab heute im Zeitraum. */
  function findGaps(monday, weeks) {
    const todayIso = U.toIsoDate(U.today());
    return SSD.Scheduler.getUnderstaffedEntriesInRange(monday, weeks).filter((e) => e.date >= todayIso);
  }

  async function run(monday, weeks, onDone) {
    const targets = findGaps(monday, weeks);
    if (!targets.length) {
      SSD.Toast.info('Keine Lücken gefunden', 'Ab heute sind im gewählten Zeitraum alle Dienste vollständig besetzt (oder eine bestehende Besetzung ist inzwischen deaktiviert und muss erst manuell bereinigt werden).');
      return;
    }

    const overlay = SSD.SolverOverlay.open({ title: 'Lücken werden aufgefüllt', icon: 'puzzle' });
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

      if (onDone) onDone();
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

  /**
   * @param {{ defaultMonday?: Date, onDone?: Function }} [opts]
   */
  function openModal(opts) {
    const cfg = opts || {};
    const fallbackMonday = cfg.defaultMonday || U.getMondayOfWeek(U.today());
    const startInput = U.el('input', { class: 'input', type: 'date', value: U.toIsoDate(fallbackMonday) });
    const weekCountInput = U.el('input', { class: 'input', type: 'number', min: '1', max: '8', value: '1' });
    const previewText = U.el('p', { class: 'text-secondary' });

    function refresh() {
      const raw = U.parseIsoDate(startInput.value || U.toIsoDate(fallbackMonday));
      const monday = U.getMondayOfWeek(raw);
      startInput.value = U.toIsoDate(monday);
      const weeks = U.clamp(Number(weekCountInput.value) || 1, 1, 8);
      weekCountInput.value = String(weeks);

      const gaps = findGaps(monday, weeks);
      const rangeLabel = `${U.formatDateMedium(monday)} – ${U.formatDateMedium(U.addDays(monday, weeks * 7 - 1))}`;
      previewText.textContent = gaps.length
        ? `${gaps.length} unbesetzte(r)/unvollständige(r) Dienst(e) ab heute im Zeitraum ${rangeLabel} gefunden.`
        : `Im Zeitraum ${rangeLabel} sind ab heute keine Lücken vorhanden.`;
    }
    startInput.addEventListener('change', refresh);
    weekCountInput.addEventListener('change', refresh);
    refresh();

    const body = U.el('div', { class: 'stack gap-4' }, [
      U.el('p', {}, ['Besetzt unbesetzte oder unvollständige Dienste im gewählten Zeitraum trotzdem: "Nicht verfügbar" zählt hierbei ausnahmsweise als besetzbar. Als "Gesperrt" markierte Zeiten (Klausur, Termin, …) werden weiterhin nie verwendet, ebenso alle anderen Regeln (Wochenlimit, Pausen, keine Doppelbelegung). Bereits eingeteilte Personen bleiben unverändert, vergangene Dienste werden nicht nachträglich besetzt.']),
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
          onClick: () => run(U.getMondayOfWeek(U.parseIsoDate(startInput.value)), Number(weekCountInput.value), cfg.onDone),
        },
      ],
    });
  }

  return { findGaps, run, openModal };
})();
