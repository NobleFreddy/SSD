/**
 * ============================================================================
 * SSD.Scheduler — Dienstplan-Optimierungsalgorithmus
 * ============================================================================
 * Herzstück der Anwendung. Erzeugt für einen gewählten Zeitraum (eine oder
 * mehrere Wochen) eine Dienstplan-Zuteilung, die alle harten Bedingungen
 * strikt einhält und die weichen Bedingungen bestmöglich erfüllt.
 *
 * Algorithmus (zweiphasig, kein Zufalls-Generator):
 *
 *   Phase 1 — Konstruktion (Constraint Satisfaction, "Most Constrained First"):
 *     Es werden wiederholt die noch offenen Dienste mit den WENIGSTEN
 *     verfügbaren, zulässigen Kandidat:innen zuerst besetzt (Minimum-
 *     Remaining-Values-Heuristik, klassisch aus der CSP-Literatur). Dadurch
 *     werden knappe Ressourcen zuerst verplant, statt sich durch eine
 *     ungünstige Reihenfolge selbst in eine Sackgasse zu manövrieren.
 *     Innerhalb eines Dienstes wird das Paar gewählt, das die weichen
 *     Kriterien (Fairness, Geschlechtermischung, Partnerwechsel, ...) am
 *     besten erfüllt.
 *
 *   Phase 2 — Lokale Suche (Simulated Annealing):
 *     Ausgehend von der Konstruktionslösung werden zufällige, aber stets
 *     zulässige Änderungen ausprobiert (zwei Schüler:innen tauschen, offene
 *     Dienste nachbesetzen). Verbesserungen werden übernommen, Verschlechte-
 *     rungen nur mit sinkender Wahrscheinlichkeit akzeptiert — das erlaubt,
 *     lokale Sackgassen zu verlassen, ohne in eine schlechtere Lösung
 *     abzudriften. Diese Phase läuft in kleinen Zeitscheiben (chunked
 *     async/await), damit der Haupt-Thread nicht blockiert und die
 *     Ladeanimation currentText flüssig bleibt.
 *
 * Harte Bedingungen (werden nie verletzt):
 *   - nur verfügbare, aktive Schüler:innen werden eingeteilt
 *   - gesperrte/nicht verfügbare Zeiten werden nie verwendet
 *   - deaktivierte Tage (Ferien etc.) und deaktivierte Blöcke werden ignoriert
 *   - niemand wird doppelt im selben Dienst eingeteilt
 *   - wöchentliche/gesamte Höchstgrenzen pro Schüler werden eingehalten
 *
 * Weiche Bedingungen (Kostenfunktion, siehe WEIGHTS):
 *   - annähernd gleiche Gesamtzahl an Diensten pro Schüler:in (Fairness)
 *   - nach Möglichkeit gemischte Paare (ein Mädchen + ein Junge)
 *   - Partner:innen wechseln möglichst häufig
 *   - kein Wiederholen desselben Slots (Wochentag+Block) wie in der Vorwoche
 *   - möglichst gleichmäßige Verteilung der Dienste einer Person über die Wochentage
 */
window.SSD = window.SSD || {};

SSD.Scheduler = (function () {
  'use strict';

  const U = SSD.Utils;

  /** Gewichtung der weichen Kriterien in der Kostenfunktion (niedriger = besser). */
  const WEIGHTS = {
    UNFILLED: 50,             // unbesetzte Plätze in einem Dienst vermeiden (nahezu hart)
    FAIRNESS: 6,              // Streuung der Gesamtdienste zwischen Schüler:innen
    GENDER_MIX: 3,            // gemischtes Paar bevorzugen
    PARTNER_REPEAT: 4,        // Wiederholung derselben Paarung bestrafen (quadratisch)
    CONSECUTIVE_WEEK: 3,      // gleicher Wochentag/Block wie in der Vorwoche
    WEEKDAY_SPREAD: 1,        // Verteilung der eigenen Dienste über die Wochentage
  };

  function slotKey(dateIso, block) { return `${dateIso}|${block}`; }
  function pairKey(ids) { return ids.slice().sort().join('_'); }

  /** Baut die interne Slot-Repräsentation aus einem bereits bestehenden Dienstplan-Eintrag (für den Vertretungsmodus). */
  function slotFromEntry(entry) {
    const weekMonday = U.toIsoDate(U.getMondayOfWeek(U.parseIsoDate(entry.date)));
    return { date: entry.date, weekday: entry.weekday, block: entry.block, weekMonday, key: slotKey(entry.date, entry.block) };
  }

  /* ---------------------------------------------------------------------
   * Slot-Erzeugung
   * ------------------------------------------------------------------- */

  /** Erzeugt alle zu verplanenden Dienst-Slots für eine Liste von Wochen (Montags-Daten). */
  function buildSlotsForWeeks(weekMondays) {
    const slots = [];
    weekMondays.forEach((monday) => {
      const weekMondayIso = U.toIsoDate(monday);
      U.getWeekDates(monday).forEach((date, i) => {
        const weekday = U.WEEKDAY_KEYS[i];
        const dateIso = U.toIsoDate(date);
        if (!SSD.CalendarService.isDayUsable(dateIso)) return;
        SSD.CalendarService.getEnabledBlocksForWeekday(weekday).forEach((block) => {
          slots.push({ date: dateIso, weekday, block, weekMonday: weekMondayIso, key: slotKey(dateIso, block) });
        });
      });
    });
    return slots;
  }

  /* ---------------------------------------------------------------------
   * Optimierungskontext — hält den gesamten veränderlichen Zustand während
   * der Konstruktion und der lokalen Suche.
   * ------------------------------------------------------------------- */

  class SchedulingContext {
    constructor(students, existingEntries, targetSlots, settings) {
      this.students = students;
      this.studentsById = new Map(students.map((s) => [s.id, s]));
      this.settings = settings;
      this.slotMeta = new Map(targetSlots.map((s) => [s.key, s]));
      this.targetKeys = new Set(targetSlots.map((s) => s.key));

      this.assignments = new Map();      // slotKey -> string[]
      this.externalSlot = new Map();     // slotKey (außerhalb des Zielzeitraums) -> string[]
      this.totalCount = new Map();       // studentId -> Gesamtzahl Dienste (Historie + laufender Durchlauf)
      this.weekCount = new Map();        // `${id}|${weekMonday}` -> Anzahl in dieser Woche
      this.dayBlocks = new Map();        // studentId -> Map<dateIso, Set<blockKey>>
      this.pairCount = new Map();        // pairKey -> Anzahl gemeinsamer Dienste
      this.weekdayCount = new Map();     // studentId -> { mon:n, tue:n, ... }

      students.forEach((s) => {
        this.totalCount.set(s.id, 0);
        this.dayBlocks.set(s.id, new Map());
        this.weekdayCount.set(s.id, { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 });
      });

      existingEntries.forEach((entry) => {
        const key = slotKey(entry.date, entry.block);
        if (this.targetKeys.has(key)) return; // wird in diesem Lauf neu vergeben
        this.externalSlot.set(key, entry.studentIds.slice());
        const weekMonday = U.toIsoDate(U.getMondayOfWeek(U.parseIsoDate(entry.date)));
        entry.studentIds.forEach((id) => {
          if (!this.totalCount.has(id)) return; // Schüler:in existiert nicht mehr
          this.totalCount.set(id, this.totalCount.get(id) + 1);
          const wkey = `${id}|${weekMonday}`;
          this.weekCount.set(wkey, (this.weekCount.get(wkey) || 0) + 1);
          if (!this.dayBlocks.get(id).has(entry.date)) this.dayBlocks.get(id).set(entry.date, new Set());
          this.dayBlocks.get(id).get(entry.date).add(entry.block);
          this.weekdayCount.get(id)[entry.weekday] += 1;
        });
        if (entry.studentIds.length === 2) {
          const pk = pairKey(entry.studentIds);
          this.pairCount.set(pk, (this.pairCount.get(pk) || 0) + 1);
        }
      });
    }

    getAssignmentAt(dateIso, block) {
      const key = slotKey(dateIso, block);
      if (this.assignments.has(key)) return this.assignments.get(key);
      if (this.externalSlot.has(key)) return this.externalSlot.get(key);
      return [];
    }

    /** Prüft alle harten Bedingungen für "würde Schüler:in X in diesen Slot passen?". */
    isEligible(studentId, slot) {
      const student = this.studentsById.get(studentId);
      if (!student || !student.active) return false;

      const blockIdx = U.DUTY_BLOCK_KEYS.indexOf(slot.block);
      const availState = student.availability[slot.weekday][blockIdx];
      // "Gesperrt" (Klausur/Termin) bleibt immer hart ausgeschlossen. "Nicht
      // verfügbar" ist normalerweise ebenfalls hart, wird aber bei der
      // Lücken-Füllung (siehe `relaxedSettingsFrom`) bewusst zugelassen.
      if (availState === 'blocked') return false;
      if (availState !== 'available' && !this.settings.relaxedAvailability) return false;

      const maxTotal = this.settings.maxDutiesTotal;
      if (maxTotal && this.totalCount.get(studentId) >= maxTotal) return false;

      const maxWeek = student.maxDutiesPerWeek || this.settings.maxDutiesPerWeek;
      const wkey = `${studentId}|${slot.weekMonday}`;
      if ((this.weekCount.get(wkey) || 0) >= maxWeek) return false;

      const dayMap = this.dayBlocks.get(studentId);
      const blocksToday = dayMap.get(slot.date);
      if (blocksToday && blocksToday.size > 0) {
        if (!this.settings.allowSameDayDuties) return false;
        const candidateOrder = U.DUTY_BLOCKS[blockIdx].order;
        for (const existingBlock of blocksToday) {
          const existingOrder = U.DUTY_BLOCKS.find((b) => b.key === existingBlock).order;
          if (Math.abs(existingOrder - candidateOrder) <= this.settings.minBreakBlocks) return false;
        }
      }
      return true;
    }

    assign(slot, studentId) {
      if (!this.assignments.has(slot.key)) this.assignments.set(slot.key, []);
      this.assignments.get(slot.key).push(studentId);
      this.totalCount.set(studentId, this.totalCount.get(studentId) + 1);
      const wkey = `${studentId}|${slot.weekMonday}`;
      this.weekCount.set(wkey, (this.weekCount.get(wkey) || 0) + 1);
      const dayMap = this.dayBlocks.get(studentId);
      if (!dayMap.has(slot.date)) dayMap.set(slot.date, new Set());
      dayMap.get(slot.date).add(slot.block);
      this.weekdayCount.get(studentId)[slot.weekday] += 1;

      const list = this.assignments.get(slot.key);
      if (list.length === 2) {
        const pk = pairKey(list);
        this.pairCount.set(pk, (this.pairCount.get(pk) || 0) + 1);
      }
    }

    unassign(slot, studentId) {
      const list = this.assignments.get(slot.key) || [];
      if (list.length === 2) {
        const pk = pairKey(list);
        this.pairCount.set(pk, (this.pairCount.get(pk) || 0) - 1);
      }
      const idx = list.indexOf(studentId);
      if (idx >= 0) list.splice(idx, 1);
      this.totalCount.set(studentId, this.totalCount.get(studentId) - 1);
      const wkey = `${studentId}|${slot.weekMonday}`;
      this.weekCount.set(wkey, (this.weekCount.get(wkey) || 0) - 1);
      const dayMap = this.dayBlocks.get(studentId);
      const blocksToday = dayMap.get(slot.date);
      if (blocksToday) {
        blocksToday.delete(slot.block);
        if (blocksToday.size === 0) dayMap.delete(slot.date);
      }
      this.weekdayCount.get(studentId)[slot.weekday] -= 1;
    }

    /** Referenzwert für Fairness: wie viele Dienste sollte im Schnitt jede Person aktuell haben. */
    averageLoad() {
      const counts = this.students.map((s) => this.totalCount.get(s.id));
      return U.mean(counts);
    }
  }

  /* ---------------------------------------------------------------------
   * Kostenfunktion
   * ------------------------------------------------------------------- */

  function genderMixPenalty(context, ids) {
    if (ids.length !== 2 || !context.settings.preferMixedGender) return 0;
    const [a, b] = ids.map((id) => context.studentsById.get(id));
    if (!a || !b) return 0;
    return a.gender === b.gender ? WEIGHTS.GENDER_MIX : 0;
  }

  function partnerRepeatPenalty(context, ids) {
    if (ids.length !== 2) return 0;
    const priorCount = (context.pairCount.get(pairKey(ids)) || 0) - 1; // aktuelle Zuweisung selbst nicht mitzählen
    return priorCount > 0 ? WEIGHTS.PARTNER_REPEAT * priorCount * priorCount : 0;
  }

  function consecutiveWeekPenalty(context, slot, ids) {
    const prevDateIso = U.toIsoDate(U.addDays(U.parseIsoDate(slot.date), -7));
    const prevIds = context.getAssignmentAt(prevDateIso, slot.block);
    if (!prevIds.length) return 0;
    const overlap = ids.filter((id) => prevIds.includes(id)).length;
    return overlap * WEIGHTS.CONSECUTIVE_WEEK;
  }

  function weekdaySpreadPenalty(context, slot, ids) {
    let penalty = 0;
    ids.forEach((id) => {
      const counts = context.weekdayCount.get(id);
      const values = Object.values(counts);
      const avg = U.mean(values);
      const onThisDay = counts[slot.weekday];
      if (onThisDay > avg + 0.5) penalty += WEIGHTS.WEEKDAY_SPREAD * (onThisDay - avg);
    });
    return penalty;
  }

  function unfilledPenalty(context, ids) {
    const needed = context.settings.studentsPerDuty;
    return Math.max(0, needed - ids.length) * WEIGHTS.UNFILLED;
  }

  /** Kosten eines einzelnen Slots (alle Anteile außer der globalen Fairness). */
  function slotCost(context, slot) {
    const ids = context.assignments.get(slot.key) || [];
    return (
      unfilledPenalty(context, ids) +
      genderMixPenalty(context, ids) +
      partnerRepeatPenalty(context, ids) +
      consecutiveWeekPenalty(context, slot, ids) +
      weekdaySpreadPenalty(context, slot, ids)
    );
  }

  /** Globale Fairness-Kosten: quadratische Abweichung vom Mittelwert über alle Schüler:innen. */
  function fairnessCost(context) {
    const avg = context.averageLoad();
    let sum = 0;
    context.students.forEach((s) => {
      const diff = context.totalCount.get(s.id) - avg;
      sum += diff * diff;
    });
    return sum * WEIGHTS.FAIRNESS;
  }

  function totalCost(context, slots) {
    let sum = fairnessCost(context);
    slots.forEach((slot) => { sum += slotCost(context, slot); });
    return sum;
  }

  /* ---------------------------------------------------------------------
   * Phase 1 — Konstruktion (Most-Constrained-First)
   * ------------------------------------------------------------------- */

  function pickBestGroupForSlot(context, slot, candidates, rng) {
    const needed = context.settings.studentsPerDuty;
    if (candidates.length <= needed) return candidates.map((s) => s.id);

    if (needed === 2) {
      // Für den Standardfall (2 Personen) werden alle Paare bewertet — bei
      // realistischen Teamgrößen (< 200 Aktive) ist das trivial schnell.
      let best = null;
      let bestCost = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const ids = [candidates[i].id, candidates[j].id];
          const fairnessProxy = context.totalCount.get(ids[0]) + context.totalCount.get(ids[1]);
          const genderPenalty = genderMixPenalty(context, ids);
          const partnerPenalty = ((context.pairCount.get(pairKey(ids)) || 0)) ** 2 * WEIGHTS.PARTNER_REPEAT;
          const cost = fairnessProxy * WEIGHTS.FAIRNESS + genderPenalty + partnerPenalty + rng() * 0.01;
          if (cost < bestCost) { bestCost = cost; best = ids; }
        }
      }
      return best;
    }

    // Allgemeiner Fall (falls "Schüler:innen pro Dienst" abweichend konfiguriert ist):
    // greedy sequentielle Auswahl nach aktueller Belastung.
    const sorted = candidates.slice().sort((a, b) => context.totalCount.get(a.id) - context.totalCount.get(b.id));
    return sorted.slice(0, needed).map((s) => s.id);
  }

  function constructGreedy(context, slots, rng) {
    const remaining = slots.slice();
    while (remaining.length) {
      let bestIndex = 0;
      let bestCandidates = null;
      for (let i = 0; i < remaining.length; i++) {
        const slot = remaining[i];
        const candidates = context.students.filter((s) => context.isEligible(s.id, slot));
        if (bestCandidates === null || candidates.length < bestCandidates.length) {
          bestCandidates = candidates;
          bestIndex = i;
          if (candidates.length === 0) break; // kann nicht schlechter werden
        }
      }
      const slot = remaining.splice(bestIndex, 1)[0];
      const chosenIds = pickBestGroupForSlot(context, slot, bestCandidates, rng);
      chosenIds.forEach((id) => context.assign(slot, id));
    }
  }

  /* ---------------------------------------------------------------------
   * Phase 2 — Lokale Suche (Simulated Annealing)
   * ------------------------------------------------------------------- */

  function randomChoice(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

  function attemptFillMove(context, slots, rng) {
    const understaffed = slots.filter((s) => (context.assignments.get(s.key) || []).length < context.settings.studentsPerDuty);
    if (!understaffed.length) return false;
    const slot = randomChoice(understaffed, rng);
    const currentIds = context.assignments.get(slot.key) || [];
    const eligible = context.students.filter((s) => !currentIds.includes(s.id) && context.isEligible(s.id, slot));
    if (!eligible.length) return false;
    const sorted = eligible.slice().sort((a, b) => context.totalCount.get(a.id) - context.totalCount.get(b.id));
    const pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.4)));
    const chosen = randomChoice(pool, rng);

    const before = slotCost(context, slot) + fairnessCost(context);
    context.assign(slot, chosen.id);
    const after = slotCost(context, slot) + fairnessCost(context);
    if (after <= before) return true;
    context.unassign(slot, chosen.id);
    return false;
  }

  function attemptSwapMove(context, slots, temperature, rng) {
    const occupied = slots.filter((s) => (context.assignments.get(s.key) || []).length > 0);
    if (occupied.length < 2) return false;
    const slotA = randomChoice(occupied, rng);
    const slotB = randomChoice(occupied, rng);
    if (slotA.key === slotB.key) return false;

    const idsA = context.assignments.get(slotA.key) || [];
    const idsB = context.assignments.get(slotB.key) || [];
    const studentA = randomChoice(idsA, rng);
    const studentB = randomChoice(idsB, rng);
    if (studentA === studentB) return false;

    const beforeCost = slotCost(context, slotA) + slotCost(context, slotB) + fairnessCost(context);

    context.unassign(slotA, studentA);
    context.unassign(slotB, studentB);

    const canAtoB = context.isEligible(studentA, slotB);
    const canBtoA = context.isEligible(studentB, slotA);

    if (!canAtoB || !canBtoA) {
      context.assign(slotA, studentA);
      context.assign(slotB, studentB);
      return false;
    }

    context.assign(slotA, studentB);
    context.assign(slotB, studentA);
    const afterCost = slotCost(context, slotA) + slotCost(context, slotB) + fairnessCost(context);

    const delta = afterCost - beforeCost;
    if (delta <= 0 || rng() < Math.exp(-delta / temperature)) {
      return true; // Zug wird übernommen
    }

    // Zug rückgängig machen (Verschlechterung nicht akzeptiert)
    context.unassign(slotA, studentB);
    context.unassign(slotB, studentA);
    context.assign(slotA, studentA);
    context.assign(slotB, studentB);
    return false;
  }

  async function localSearch(context, slots, onProgress, rng, percentRange) {
    const range = percentRange || { start: 40, end: 95 };
    const iterations = U.clamp(slots.length * 70, 700, 6000);
    let temperature = 4;
    const coolingRate = 0.9985;
    const chunkSize = 120;

    for (let i = 0; i < iterations; i++) {
      const hasGaps = slots.some((s) => (context.assignments.get(s.key) || []).length < context.settings.studentsPerDuty);
      if (hasGaps && rng() < 0.65) {
        attemptFillMove(context, slots, rng);
      } else {
        attemptSwapMove(context, slots, temperature, rng);
      }
      temperature *= coolingRate;

      if (i % chunkSize === 0) {
        if (onProgress) {
          onProgress({
            phase: 'optimize',
            percent: range.start + Math.round((i / iterations) * (range.end - range.start)),
            message: `Optimiere Fairness & Verteilung … (${i}/${iterations})`,
          });
        }
        await U.nextTick();
      }
    }
  }

  /* ---------------------------------------------------------------------
   * Azubi-Zuteilung (dritte, einzelne Person je Dienst)
   * ------------------------------------------------------------------- */

  /**
   * Ordnet Azubis den bereits fertigen Diensten als dritte, einzelne Person
   * zu. Läuft bewusst unabhängig von der regulären Zweier-Zuteilung: Azubis
   * werden nicht miteinander gepaart (keine Partner-/Geschlechterlogik),
   * sondern jeweils einzeln einem Dienst hinzugefügt — Ziel ist allein eine
   * faire Verteilung der Azubi-Einsätze auf alle Azubis.
   *
   * Technisch wird dafür derselbe `SchedulingContext` wiederverwendet, nur
   * mit `studentsPerDuty: 1` und der (nach Rolle gefilterten) Azubi-Liste
   * statt der Schüler-Liste — dadurch gelten automatisch dieselben Regeln
   * für Verfügbarkeit, Sperrzeiten, Wochen-/Gesamtlimits wie bei der
   * regulären Planung, ohne zweite Implementierung dieser Regeln.
   *
   * @param {object[]} entries - bereits erzeugte ScheduleEntry-Objekte (werden mit `azubiId` ergänzt)
   */
  /**
   * Bildet die Azubi-Einsätze bestehender Diensteinträge (`entry.azubiId`) als
   * schlanke, zu `SchedulingContext` kompatible Einträge nach (Form wie ein
   * regulärer Schüler-Eintrag mit genau einer Person in `studentIds`).
   * Wiederverwendet sowohl bei der Dienstplan-Erstellung als auch im
   * Vertretungsmodus, damit Azubi-Fairness/-Wochenlimits an beiden Stellen
   * exakt gleich berechnet werden.
   * @param {Set<string>} excludeKeys - Slot-Keys, die aus der Historie ausgeklammert werden (weil sie gerade neu vergeben werden)
   */
  function buildAzubiHistoryEntries(excludeKeys) {
    return SSD.Store.getState().schedule.entries
      .filter((e) => !excludeKeys.has(slotKey(e.date, e.block)))
      .map((e) => ({ date: e.date, weekday: e.weekday, block: e.block, studentIds: e.azubiId ? [e.azubiId] : [] }));
  }

  /** Einstellungsobjekt für die (solo) Azubi-Zuteilung: exakt eine Person pro Dienst. */
  function azubiSettingsFrom(settings) {
    return Object.assign({}, settings, { studentsPerDuty: 1 });
  }

  /**
   * Einstellungsobjekt für die Lücken-Füllung bei fehlender Verfügbarkeit:
   * "Nicht verfügbar" wird als besetzbar behandelt — "Gesperrt" bleibt in
   * `SchedulingContext.isEligible` unabhängig davon immer hart ausgeschlossen.
   */
  function relaxedSettingsFrom(settings) {
    return Object.assign({}, settings, { relaxedAvailability: true });
  }

  async function assignAzubis(entries, azubis, settings, rng, onProgress) {
    if (!azubis.length || !entries.length) return;

    const slots = entries.map((e) => Object.assign(slotFromEntry(e), {}));
    const targetKeys = new Set(slots.map((s) => s.key));
    const azubiHistory = buildAzubiHistoryEntries(targetKeys);
    const azubiSettings = azubiSettingsFrom(settings);
    const context = new SchedulingContext(azubis, azubiHistory, slots, azubiSettings);

    constructGreedy(context, slots, rng);
    await localSearch(context, slots, onProgress, rng, { start: 96, end: 99 });

    entries.forEach((entry, i) => {
      const ids = context.assignments.get(slots[i].key) || [];
      entry.azubiId = ids[0] || null;
    });
  }

  /* ---------------------------------------------------------------------
   * Öffentliche API
   * ------------------------------------------------------------------- */

  /**
   * Erstellt einen optimierten Dienstplan für den angegebenen Zeitraum.
   * @param {{startMonday: Date, weekCount: number, seed?: number}} options
   * @param {(info: {phase:string, percent:number, message:string}) => void} [onProgress]
   * @returns {Promise<{entries: object[], stats: object}>}
   */
  async function generateSchedule(options, onProgress) {
    const state = SSD.Store.getState();
    const settings = state.settings;
    const students = SSD.StudentService.getActiveByRole('student');
    const azubis = SSD.StudentService.getActiveByRole('azubi');
    const rng = U.createSeededRandom(options.seed || Date.now() % 1e9);

    onProgress && onProgress({ phase: 'prepare', percent: 5, message: 'Lese Verfügbarkeiten und Kalender ein …' });
    await U.nextTick();

    const weekMondays = Array.from({ length: options.weekCount }, (_, i) => U.addDays(options.startMonday, i * 7));
    const slots = buildSlotsForWeeks(weekMondays);

    if (!slots.length) {
      return { entries: [], stats: { totalSlots: 0, filledSlots: 0, unfilledSlots: 0, fairnessScore: 100, message: 'Keine Dienste im gewählten Zeitraum (alle Tage gesperrt oder Blöcke deaktiviert).' } };
    }

    const context = new SchedulingContext(students, state.schedule.entries, slots, settings);

    onProgress && onProgress({ phase: 'construct', percent: 15, message: 'Erstelle Erstbelegung (härteste Dienste zuerst) …' });
    await U.nextTick();
    constructGreedy(context, slots, rng);

    onProgress && onProgress({ phase: 'optimize', percent: 40, message: 'Starte lokale Suche zur Fairness-Optimierung …' });
    await localSearch(context, slots, onProgress, rng, { start: 40, end: 90 });

    const entries = slots.map((slot) => SSD.Models.createScheduleEntry({
      date: slot.date, weekday: slot.weekday, block: slot.block,
      studentIds: (context.assignments.get(slot.key) || []).slice(),
    }));

    if (azubis.length) {
      onProgress && onProgress({ phase: 'azubi', percent: 92, message: 'Ordne Azubis als dritte Person zu …' });
      await assignAzubis(entries, azubis, settings, rng, onProgress);
    }

    onProgress && onProgress({ phase: 'finish', percent: 98, message: 'Schließe Optimierung ab …' });
    await U.nextTick();

    const filledSlots = entries.filter((e) => e.studentIds.length >= settings.studentsPerDuty).length;
    const loads = students.map((s) => context.totalCount.get(s.id));
    const stats = {
      totalSlots: slots.length,
      filledSlots,
      unfilledSlots: slots.length - filledSlots,
      averageLoad: U.round(U.mean(loads), 2),
      loadStdDev: U.round(U.standardDeviation(loads), 2),
      fairnessScore: U.fairnessScoreFromStdDev(U.standardDeviation(loads)),
      finalCost: U.round(totalCost(context, slots), 1),
      azubiCount: azubis.length,
      azubiFilledSlots: azubis.length ? entries.filter((e) => e.azubiId).length : 0,
    };

    onProgress && onProgress({ phase: 'done', percent: 100, message: 'Fertig!' });
    return { entries, stats };
  }

  /** Bestehende Einträge, die im gewählten Zeitraum liegen (für Überschreib-Warnung in der UI). */
  function getExistingEntriesInRange(startMonday, weekCount) {
    const endDate = U.addDays(startMonday, weekCount * 7 - 1);
    const startIso = U.toIsoDate(startMonday);
    const endIso = U.toIsoDate(endDate);
    return SSD.Store.getState().schedule.entries.filter((e) => e.date >= startIso && e.date <= endIso);
  }

  function countPlannableSlots(startMonday, weekCount) {
    const weekMondays = Array.from({ length: weekCount }, (_, i) => U.addDays(startMonday, i * 7));
    return buildSlotsForWeeks(weekMondays).length;
  }

  /* ---------------------------------------------------------------------
   * Lücken-Füllung bei fehlender Verfügbarkeit (Admin-Aktion)
   * ------------------------------------------------------------------- */

  /**
   * Unterbesetzte Dienste im gewählten Zeitraum, die für die Lücken-Füllung
   * infrage kommen. Ein Dienst mit einer bereits eingeteilten, aber
   * inzwischen deaktivierten Person wird ausgeschlossen — diese ID ist kein
   * Teil des aktiven Rosters, mit dem der `SchedulingContext` arbeitet, eine
   * manuelle Bereinigung im "Dienst bearbeiten"-Dialog ist hier der
   * richtige erste Schritt statt der automatischen Füllung.
   */
  function getUnderstaffedEntriesInRange(startMonday, weekCount) {
    const settings = SSD.Store.getState().settings;
    const activeIds = new Set(SSD.StudentService.getActiveByRole('student').map((s) => s.id));
    return getExistingEntriesInRange(startMonday, weekCount).filter((e) =>
      e.studentIds.length < settings.studentsPerDuty && e.studentIds.every((id) => activeIds.has(id))
    );
  }

  /**
   * Befüllt eine Liste bereits bestehender, unterbesetzter Diensteinträge
   * unter gelockerter Verfügbarkeitsregel ("Nicht verfügbar" wird
   * akzeptiert, "Gesperrt" bleibt immer tabu). Wird sowohl von der
   * Sammel-Aktion (mehrere Einträge) als auch von der Einzelaktion im
   * "Dienst bearbeiten"-Dialog (genau ein Eintrag) verwendet.
   *
   * Bewusst OHNE `constructGreedy`: die bestehende Besetzung wird zunächst
   * in den Kontext vorbelegt, danach läuft nur die lokale Suche
   * (`localSearch`) — `attemptFillMove` fügt unterbesetzten Diensten bereits
   * genau die fairste zulässige Person hinzu, ganz ohne zweite Auswahllogik.
   * `constructGreedy` würde dagegen von leeren Slots ausgehen und ein
   * komplett neues Paar erzeugen, statt die bestehende Besetzung zu ergänzen.
   *
   * Committet nichts selbst — gibt nur die geänderten Einträge zurück, die
   * aufrufende View entscheidet über den `SSD.Store.commit(...)`-Aufruf
   * (gleiche Aufteilung der Zuständigkeiten wie bei `generateSchedule`).
   *
   * @returns {Promise<{updatedEntries: Array<{id:string, studentIds:string[]}>, filledSeatCount: number, stillUnderstaffedCount: number}>}
   */
  async function fillUnderstaffedSlots(targetEntries, options, onProgress) {
    const state = SSD.Store.getState();
    const relaxedSettings = relaxedSettingsFrom(state.settings);
    const students = SSD.StudentService.getActiveByRole('student');
    const activeIds = new Set(students.map((s) => s.id));
    const rng = U.createSeededRandom((options && options.seed) || Date.now() % 1e9);

    const usable = targetEntries.filter((e) =>
      e.studentIds.length < state.settings.studentsPerDuty && e.studentIds.every((id) => activeIds.has(id))
    );
    if (!usable.length) return { updatedEntries: [], filledSeatCount: 0, stillUnderstaffedCount: 0 };

    const slots = usable.map((e) => slotFromEntry(e));
    const targetKeys = new Set(slots.map((s) => s.key));
    const history = state.schedule.entries.filter((e) => !targetKeys.has(slotKey(e.date, e.block)));
    const context = new SchedulingContext(students, history, slots, relaxedSettings);

    usable.forEach((entry, i) => {
      entry.studentIds.forEach((id) => context.assign(slots[i], id));
    });

    await localSearch(context, slots, onProgress, rng, { start: 10, end: 95 });

    const updatedEntries = [];
    let filledSeatCount = 0;
    let stillUnderstaffedCount = 0;
    usable.forEach((entry, i) => {
      const ids = context.assignments.get(slots[i].key) || [];
      const changed = ids.length !== entry.studentIds.length || ids.some((id) => !entry.studentIds.includes(id));
      if (changed) {
        updatedEntries.push({ id: entry.id, studentIds: ids.slice() });
        filledSeatCount += Math.max(0, ids.length - entry.studentIds.length);
      }
      if (ids.length < state.settings.studentsPerDuty) stillUnderstaffedCount += 1;
    });

    onProgress && onProgress({ phase: 'done', percent: 100, message: 'Fertig!' });
    return { updatedEntries, filledSeatCount, stillUnderstaffedCount };
  }

  /**
   * Überträgt die Zuteilung einer bereits fertigen Vorlagen-Woche auf eine
   * Reihe kommender Wochen ("wiederkehrender Dienstplan"), damit nicht jede
   * Woche einzeln neu erstellt werden muss. Für jede Zielwoche wird pro
   * Wochentag/Block individuell geprüft, ob der Tag dort nutzbar und der
   * Block aktiviert ist — ein Sondertag in einer späteren Woche überschreibt
   * also niemals die harte Regel "deaktivierte Tage werden ignoriert", auch
   * wenn die Vorlagen-Woche an dieser Stelle noch einen Dienst hatte.
   * Personen, die inzwischen deaktiviert wurden, werden beim Übertragen
   * ausgelassen (nicht einfach stillschweigend weiter eingeteilt).
   *
   * @param {Date} templateMonday - Montag der als Vorlage dienenden Woche
   * @param {number} weekCount - Anzahl der Folgewochen, auf die übertragen wird
   * @returns {{ entries: object[], skippedCount: number, weeksProcessed: number, templateSlotCount: number }}
   */
  function transferWeekToUpcoming(templateMonday, weekCount) {
    const templateEntries = getExistingEntriesInRange(templateMonday, 1);
    if (!templateEntries.length) {
      return { entries: [], skippedCount: 0, weeksProcessed: 0, templateSlotCount: 0 };
    }

    const pattern = new Map(); // `${weekday}|${block}` -> { studentIds, azubiId }
    templateEntries.forEach((e) => {
      pattern.set(`${e.weekday}|${e.block}`, { studentIds: e.studentIds.slice(), azubiId: e.azubiId || null });
    });

    const isPersonUsable = (id) => {
      const s = SSD.StudentService.getById(id);
      return !!(s && s.active);
    };

    const entries = [];
    let skippedCount = 0;

    for (let w = 1; w <= weekCount; w++) {
      const monday = U.addDays(templateMonday, w * 7);
      U.getWeekDates(monday).forEach((date, i) => {
        const weekday = U.WEEKDAY_KEYS[i];
        const dateIso = U.toIsoDate(date);
        if (!SSD.CalendarService.isDayUsable(dateIso)) return;
        SSD.CalendarService.getEnabledBlocksForWeekday(weekday).forEach((block) => {
          const tmpl = pattern.get(`${weekday}|${block}`);
          if (!tmpl) return; // Vorlage hatte an dieser Stelle keinen Dienst (z. B. dort Sondertag/deaktiviert)

          const studentIds = tmpl.studentIds.filter((id) => {
            const usable = isPersonUsable(id);
            if (!usable) skippedCount += 1;
            return usable;
          });
          const azubiId = tmpl.azubiId && isPersonUsable(tmpl.azubiId) ? tmpl.azubiId : null;
          if (tmpl.azubiId && !azubiId) skippedCount += 1;

          entries.push(SSD.Models.createScheduleEntry({ date: dateIso, weekday, block, studentIds, azubiId }));
        });
      });
    }

    return { entries, skippedCount, weeksProcessed: weekCount, templateSlotCount: templateEntries.length };
  }

  /** Klassifiziert einen besetzten Dienst für die Farbkodierung der Tabelle. */
  function classifyDuty(studentIds, requiredCount) {
    if (!studentIds || studentIds.length < requiredCount) {
      return studentIds && studentIds.length > 0 ? 'conflict' : 'empty';
    }
    const state = SSD.Store.getState();
    const genders = studentIds.map((id) => {
      const s = state.students.find((st) => st.id === id);
      return s ? s.gender : 'd';
    });
    if (requiredCount === 2) {
      const [a, b] = genders;
      if (a === 'm' && b === 'm') return 'boys';
      if (a === 'w' && b === 'w') return 'girls';
      return 'mixed';
    }
    return 'mixed';
  }

  return {
    WEIGHTS,
    buildSlotsForWeeks,
    generateSchedule,
    getExistingEntriesInRange,
    countPlannableSlots,
    transferWeekToUpcoming,
    classifyDuty,
    slotKey, pairKey, slotFromEntry,
    buildAzubiHistoryEntries, azubiSettingsFrom,
    relaxedSettingsFrom, getUnderstaffedEntriesInRange, fillUnderstaffedSlots,
    // Für den Vertretungsmodus (SSD.SubstitutionService) wiederverwendet, damit
    // Eignungsprüfung/Zähler-Logik nicht ein zweites Mal implementiert werden muss.
    SchedulingContext,
  };
})();
