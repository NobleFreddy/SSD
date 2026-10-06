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
 *     zulässige Änderungen ausprobiert: offene Plätze nachbesetzen, einen
 *     Dienst von einer stark auf eine weniger belastete Person umverteilen,
 *     zwei Personen zwischen Diensten tauschen. Nur das Umverteilen ändert
 *     die Dienstanzahl einzelner Personen — ohne diesen Zug bliebe eine
 *     Schieflage aus Phase 1 dauerhaft bestehen. Verbesserungen werden
 *     übernommen, Verschlechterungen nur mit sinkender Wahrscheinlichkeit.
 *     Läuft in kleinen Zeitscheiben (chunked async/await), damit die
 *     Ladeanimation flüssig bleibt.
 *
 * Harte Bedingungen (werden nie verletzt):
 *   - nur verfügbare, aktive Schüler:innen werden eingeteilt
 *   - gesperrte/nicht verfügbare Zeiten werden nie verwendet
 *   - deaktivierte Tage (Ferien etc.) und deaktivierte Blöcke werden ignoriert
 *   - niemand wird doppelt im selben Dienst eingeteilt
 *   - wöchentliche/gesamte Höchstgrenzen pro Schüler werden eingehalten
 *   - Admin-Paarregeln "nie zusammen" werden eingehalten
 *
 * Weiche Bedingungen (Kostenfunktion, Basis siehe WEIGHTS, Stärke vom
 * Administrator je Kriterium einstellbar — siehe `resolveWeights`):
 *   - gleichmäßige Dienstanzahl pro Woche und über das Schuljahr
 *   - nach Möglichkeit gemischte Paare (ein Mädchen + ein Junge)
 *   - Partner:innen wechseln möglichst häufig (außer bei Wunschpartner:innen)
 *   - Wunschpartner:innen der Sanis, Admin-Paarregeln "bevorzugt"
 *   - Abijahrgangs-Regeln (mischen / gleiche Jahrgänge / einzelne Kombinationen)
 *   - kein Wiederholen desselben Slots (Wochentag+Block) wie in der Vorwoche
 *   - möglichst gleichmäßige Verteilung der Dienste einer Person über die Wochentage
 */
window.SSD = window.SSD || {};

SSD.Scheduler = (function () {
  'use strict';

  const U = SSD.Utils;

  /**
   * Basisgewichte der Kostenfunktion (niedriger = besser) bei Stufe "Mittel".
   * Wochen-Fairness: Summe quadrierter Abweichungen vom Wochenschnitt (ein
   * Dienst von 2 über auf 2 unter dem Schnitt verschoben spart 6 × Gewicht).
   * Schuljahres-Fairness: Huber-Abweichung der Gesamtzahl — quadratisch bis
   * TOTAL_FAIRNESS_DELTA Dienste Abstand vom Schnitt (die unvermeidlichen
   * Extra-Dienste einer Woche rotieren so fair), darüber nur linear, damit ein
   * großer Rückstand (z. B. neu im Team) nicht zu überladenen Wochen führt:
   * Bei "Mittel" holt eine Person höchstens ~1 Dienst pro Woche auf.
   */
  const WEIGHTS = {
    UNFILLED: 50,             // je unbesetztem Platz (nahezu hart)
    WEEKLY_FAIRNESS: 6,       // Streuung der Dienste je Person innerhalb einer Woche
    PERIOD_FAIRNESS: 3,       // Streuung über den ganzen geplanten Zeitraum (Extra-Dienste rotieren)
    TOTAL_FAIRNESS: 5,        // Abweichung der Gesamtdienste (inkl. Historie)
    GENDER_MIX: 3,            // gleichgeschlechtliches Paar
    PARTNER_ROTATION: 4,      // Wiederholung derselben Paarung (quadratisch)
    PARTNER_WISH: 6,          // Bonus für gegenseitigen Wunsch (einseitig: halb)
    YEAR_GROUP: 6,            // Abijahrgangs-Modus/-Regeln
    PAIR_PREFER: 12,          // Admin-Paarregel "bevorzugt zusammen" (Bonus)
    CONSECUTIVE_WEEK: 3,      // gleicher Wochentag/Block wie in der Vorwoche
    WEEKDAY_SPREAD: 1,        // Verteilung der eigenen Dienste über die Wochentage
  };

  /** Faktor je Stufe 0–3 (Aus/Niedrig/Mittel/Hoch). */
  const LEVEL_FACTORS = [0, 0.5, 1, 2];
  const TOTAL_FAIRNESS_DELTA = 2;

  /** Huber-Funktion: quadratisch nahe 0, linear ab `TOTAL_FAIRNESS_DELTA`. */
  function huber(d) {
    const a = Math.abs(d);
    return a <= TOTAL_FAIRNESS_DELTA ? 0.5 * d * d : TOTAL_FAIRNESS_DELTA * (a - TOTAL_FAIRNESS_DELTA / 2);
  }

  /** Übersetzt die Admin-Einstellungen in konkrete Gewichte für diesen Lauf. */
  function resolveWeights(settings) {
    const levels = Object.assign(SSD.Models.createDefaultWeights(), settings.weights || {});
    const f = (key) => LEVEL_FACTORS[U.clamp(Number(levels[key]), 0, 3)] ?? 1;
    return {
      unfilled: WEIGHTS.UNFILLED,
      weeklyFairness: WEIGHTS.WEEKLY_FAIRNESS * f('weeklyFairness'),
      periodFairness: WEIGHTS.PERIOD_FAIRNESS * f('weeklyFairness'),
      totalFairness: WEIGHTS.TOTAL_FAIRNESS * f('totalFairness'),
      genderMix: WEIGHTS.GENDER_MIX * f('genderMix'),
      partnerRotation: WEIGHTS.PARTNER_ROTATION * f('partnerRotation'),
      partnerWish: WEIGHTS.PARTNER_WISH * f('partnerWishes'),
      yearGroup: WEIGHTS.YEAR_GROUP * f('yearGroups'),
      pairPrefer: WEIGHTS.PAIR_PREFER,
      consecutiveWeek: WEIGHTS.CONSECUTIVE_WEEK * f('consecutiveWeek'),
      weekdaySpread: WEIGHTS.WEEKDAY_SPREAD * f('weekdaySpread'),
    };
  }

  function slotKey(dateIso, block) { return `${dateIso}|${block}`; }
  function pairKey(ids) { return ids.slice().sort().join('_'); }
  function yearKey(a, b) { return a <= b ? `${a}|${b}` : `${b}|${a}`; }

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
      this.w = resolveWeights(settings);
      this.slotMeta = new Map(targetSlots.map((s) => [s.key, s]));
      this.targetKeys = new Set(targetSlots.map((s) => s.key));
      this.targetWeeks = Array.from(new Set(targetSlots.map((s) => s.weekMonday)));

      // Wunschpartner:innen (nur Personen dieses Rosters zählen).
      this.wishes = new Map();
      students.forEach((s) => {
        const ids = (s.preferredPartnerIds || []).filter((id) => id !== s.id && this.studentsById.has(id));
        if (ids.length) this.wishes.set(s.id, new Set(ids));
      });

      // Admin-Paarregeln: "prefer" als Bonus, "never" als harte Regel.
      this.pairRules = new Map();
      this.neverPartners = new Map();
      (settings.pairRules || []).forEach((rule) => {
        if (!rule || !rule.a || !rule.b || rule.a === rule.b) return;
        this.pairRules.set(pairKey([rule.a, rule.b]), rule.type);
        if (rule.type !== 'never') return;
        [[rule.a, rule.b], [rule.b, rule.a]].forEach(([x, y]) => {
          if (!this.neverPartners.has(x)) this.neverPartners.set(x, new Set());
          this.neverPartners.get(x).add(y);
        });
      });

      // Geordnete Paare [p, q] für den gezielten Partner-Zug (beide Richtungen).
      const preferred = new Map();
      const addPreferred = (a, b) => {
        if (a === b || !this.studentsById.has(a) || !this.studentsById.has(b)) return;
        preferred.set(`${a}>${b}`, [a, b]);
        preferred.set(`${b}>${a}`, [b, a]);
      };
      if (this.w.partnerWish) this.wishes.forEach((set, a) => set.forEach((b) => addPreferred(a, b)));
      (settings.pairRules || []).forEach((r) => { if (r && r.type === 'prefer') addPreferred(r.a, r.b); });
      this.preferredPairs = Array.from(preferred.values());

      this.yearGroupMode = settings.yearGroupMode || 'none';
      this.yearRules = new Map();
      (settings.yearGroupRules || []).forEach((rule) => {
        if (rule && rule.a && rule.b) this.yearRules.set(yearKey(Number(rule.a), Number(rule.b)), rule.type);
      });

      // Fairness wird nur über Personen gerechnet, die laut Verfügbarkeit für
      // mindestens einen Ziel-Dienst infrage kommen — wer nie kann, würde den
      // Durchschnitt sonst dauerhaft verzerren.
      this.participantIds = students
        .filter((s) => s.active && targetSlots.some((slot) => this.availabilityAllows(s, slot)))
        .map((s) => s.id);

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

      // Dienste außerhalb des aktuellen Laufs — Differenz zu totalCount ergibt
      // die Anzahl im geplanten Zeitraum (siehe periodCount).
      this.historyCount = new Map(this.totalCount);
    }

    /** Dienste einer Person im gerade geplanten Zeitraum (ohne Historie). */
    periodCount(studentId) {
      return this.totalCount.get(studentId) - (this.historyCount.get(studentId) || 0);
    }

    periodMean() {
      if (!this.participantIds.length) return 0;
      let sum = 0;
      this.participantIds.forEach((id) => { sum += this.periodCount(id); });
      return sum / this.participantIds.length;
    }

    getAssignmentAt(dateIso, block) {
      const key = slotKey(dateIso, block);
      if (this.assignments.has(key)) return this.assignments.get(key);
      if (this.externalSlot.has(key)) return this.externalSlot.get(key);
      return [];
    }

    /**
     * "Gesperrt" (Klausur/Termin) bleibt immer hart ausgeschlossen. "Nicht
     * verfügbar" ist normalerweise ebenfalls hart, wird aber bei der
     * Lücken-Füllung (siehe `relaxedSettingsFrom`) bewusst zugelassen.
     */
    availabilityAllows(student, slot) {
      const blockIdx = U.DUTY_BLOCK_KEYS.indexOf(slot.block);
      const availState = student.availability[slot.weekday][blockIdx];
      if (availState === 'blocked') return false;
      return availState === 'available' || !!this.settings.relaxedAvailability;
    }

    isNeverPair(a, b) {
      const set = this.neverPartners.get(a);
      return !!(set && set.has(b));
    }

    /** ID einer Person in diesem Dienst, mit der eine "nie zusammen"-Regel besteht (oder null). */
    neverPartnerIn(studentId, slot) {
      if (!this.neverPartners.has(studentId)) return null;
      return this.getAssignmentAt(slot.date, slot.block).find((id) => id !== studentId && this.isNeverPair(studentId, id)) || null;
    }

    yearOf(studentId) {
      const s = this.studentsById.get(studentId);
      const y = s && Number(s.yearGroup);
      return y > 0 ? y : null;
    }

    weekMean(weekMonday) {
      if (!this.participantIds.length) return 0;
      let sum = 0;
      this.participantIds.forEach((id) => { sum += this.weekCount.get(`${id}|${weekMonday}`) || 0; });
      return sum / this.participantIds.length;
    }

    totalMean() {
      if (!this.participantIds.length) return 0;
      let sum = 0;
      this.participantIds.forEach((id) => { sum += this.totalCount.get(id); });
      return sum / this.participantIds.length;
    }

    /** Prüft alle harten Bedingungen für "würde Schüler:in X in diesen Slot passen?". */
    isEligible(studentId, slot) {
      const student = this.studentsById.get(studentId);
      if (!student || !student.active) return false;
      if (!this.availabilityAllows(student, slot)) return false;

      const maxTotal = this.settings.maxDutiesTotal;
      if (maxTotal && this.totalCount.get(studentId) >= maxTotal) return false;

      const maxWeek = student.maxDutiesPerWeek || this.settings.maxDutiesPerWeek;
      const wkey = `${studentId}|${slot.weekMonday}`;
      if ((this.weekCount.get(wkey) || 0) >= maxWeek) return false;

      const dayMap = this.dayBlocks.get(studentId);
      const blocksToday = dayMap.get(slot.date);
      if (blocksToday && blocksToday.size > 0) {
        if (!this.settings.allowSameDayDuties) return false;
        const candidateOrder = U.DUTY_BLOCKS.find((b) => b.key === slot.block).order;
        for (const existingBlock of blocksToday) {
          const existingOrder = U.DUTY_BLOCKS.find((b) => b.key === existingBlock).order;
          if (Math.abs(existingOrder - candidateOrder) <= this.settings.minBreakBlocks) return false;
        }
      }
      if (this.neverPartnerIn(studentId, slot)) return false;
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

  /** 'mutual' | 'one-sided' | null — Wunschpartner-Beziehung zweier Personen. */
  function wishRelation(context, a, b) {
    const aWantsB = !!(context.wishes.get(a) && context.wishes.get(a).has(b));
    const bWantsA = !!(context.wishes.get(b) && context.wishes.get(b).has(a));
    if (aWantsB && bWantsA) return 'mutual';
    return aWantsB || bWantsA ? 'one-sided' : null;
  }

  function yearGroupCost(context, a, b) {
    const w = context.w.yearGroup;
    if (!w) return 0;
    const ya = context.yearOf(a);
    const yb = context.yearOf(b);
    if (!ya || !yb) return 0;
    let cost = 0;
    if (context.yearGroupMode === 'mixed' && ya === yb) cost += w;
    if (context.yearGroupMode === 'same' && ya !== yb) cost += w;
    const rule = context.yearRules.get(yearKey(ya, yb));
    if (rule === 'prefer') cost -= w;
    else if (rule === 'avoid') cost += 2 * w;
    return cost;
  }

  /**
   * Bewertung einer Personengruppe innerhalb eines Dienstes — gemeinsam
   * genutzt von der Erstbelegung und der lokalen Suche, damit jede Regel
   * überall gleich wirkt. Geschlechtermix und Partnerwechsel gelten (wie
   * bisher) nur für Zweier-Teams; Wünsche, Paar- und Jahrgangsregeln für
   * jedes Personenpaar im Dienst. `alreadyAssigned`: zählt `pairCount` die
   * zu bewertende Paarung bereits mit (true in der lokalen Suche)?
   */
  function groupCost(context, ids, alreadyAssigned) {
    const w = context.w;
    let cost = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const relation = wishRelation(context, ids[i], ids[j]);
        if (relation === 'mutual') cost -= w.partnerWish;
        else if (relation === 'one-sided') cost -= w.partnerWish / 2;
        if (context.pairRules.get(pairKey([ids[i], ids[j]])) === 'prefer') cost -= w.pairPrefer;
        cost += yearGroupCost(context, ids[i], ids[j]);
      }
    }
    if (ids.length === 2) {
      const [a, b] = ids.map((id) => context.studentsById.get(id));
      if (a && b && w.genderMix && a.gender === b.gender) cost += w.genderMix;

      // Partnerwechsel gilt nicht für ausdrücklich gewünschte Paare (sonst
      // würde die quadratische Wiederholungsstrafe jeden Wunsch nach ein,
      // zwei gemeinsamen Diensten wieder aufheben).
      const prior = (context.pairCount.get(pairKey(ids)) || 0) - (alreadyAssigned ? 1 : 0);
      if (prior > 0 && w.partnerRotation) {
        const relation = wishRelation(context, ids[0], ids[1]);
        const adminPrefer = context.pairRules.get(pairKey(ids)) === 'prefer';
        const factor = adminPrefer || relation === 'mutual' ? 0 : relation === 'one-sided' ? 0.5 : 1;
        cost += w.partnerRotation * prior * prior * factor;
      }
    }
    return cost;
  }

  function consecutiveWeekPenalty(context, slot, ids) {
    if (!context.w.consecutiveWeek) return 0;
    const prevDateIso = U.toIsoDate(U.addDays(U.parseIsoDate(slot.date), -7));
    const prevIds = context.getAssignmentAt(prevDateIso, slot.block);
    if (!prevIds.length) return 0;
    const overlap = ids.filter((id) => prevIds.includes(id)).length;
    return overlap * context.w.consecutiveWeek;
  }

  function weekdaySpreadPenalty(context, slot, ids) {
    if (!context.w.weekdaySpread) return 0;
    let penalty = 0;
    ids.forEach((id) => {
      const counts = context.weekdayCount.get(id);
      const values = Object.values(counts);
      const avg = U.mean(values);
      const onThisDay = counts[slot.weekday];
      if (onThisDay > avg + 0.5) penalty += context.w.weekdaySpread * (onThisDay - avg);
    });
    return penalty;
  }

  function unfilledPenalty(context, ids) {
    const needed = context.settings.studentsPerDuty;
    return Math.max(0, needed - ids.length) * context.w.unfilled;
  }

  /** Kosten eines einzelnen Slots (alle Anteile außer der Fairness). */
  function slotCost(context, slot) {
    const ids = context.assignments.get(slot.key) || [];
    return (
      unfilledPenalty(context, ids) +
      groupCost(context, ids, true) +
      consecutiveWeekPenalty(context, slot, ids) +
      weekdaySpreadPenalty(context, slot, ids)
    );
  }

  /** Summe der quadrierten Abweichungen vom Mittelwert. */
  function spread(values) {
    if (!values.length) return 0;
    let sum = 0;
    let sumSq = 0;
    values.forEach((v) => { sum += v; sumSq += v * v; });
    return sumSq - (sum * sum) / values.length;
  }

  /**
   * Fairness-Kosten: Streuung der Dienstanzahl je Woche (nur die übergebenen
   * Wochen — bei einem Zug reichen die betroffenen) plus Huber-Abweichung der
   * Gesamtzahl über das Schuljahr, jeweils nur über die Teilnehmenden.
   */
  function fairnessCost(context, weekMondays) {
    const ids = context.participantIds;
    if (!ids.length) return 0;
    let cost = 0;
    if (context.w.weeklyFairness) {
      (weekMondays || context.targetWeeks).forEach((wk) => {
        cost += context.w.weeklyFairness * spread(ids.map((id) => context.weekCount.get(`${id}|${wk}`) || 0));
      });
    }
    if (context.w.periodFairness) {
      cost += context.w.periodFairness * spread(ids.map((id) => context.periodCount(id)));
    }
    if (context.w.totalFairness) {
      const totals = ids.map((id) => context.totalCount.get(id));
      const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
      cost += context.w.totalFairness * totals.reduce((sum, t) => sum + huber(t - mean), 0);
    }
    return cost;
  }

  /** Grenzkosten (erste Näherung), wenn eine Person in diesem Slot einen weiteren Dienst bekommt. */
  function marginalLoadCost(context, id, slot, means) {
    const wk = context.weekCount.get(`${id}|${slot.weekMonday}`) || 0;
    const total = context.totalCount.get(id) || 0;
    return 2 * context.w.weeklyFairness * (wk - means.week)
      + 2 * context.w.periodFairness * (context.periodCount(id) - means.period)
      + context.w.totalFairness * U.clamp(total - means.total, -TOTAL_FAIRNESS_DELTA, TOTAL_FAIRNESS_DELTA);
  }

  function slotMeans(context, slot) {
    return { week: context.weekMean(slot.weekMonday), period: context.periodMean(), total: context.totalMean() };
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
    if (!candidates.length) return [];
    const means = slotMeans(context, slot);
    const load = new Map(candidates.map((s) => [s.id, marginalLoadCost(context, s.id, slot, means)]));

    if (needed === 2 && candidates.length >= 2) {
      // Für den Standardfall (2 Personen) werden alle Paare bewertet — bei
      // realistischen Teamgrößen (< 200 Aktive) ist das trivial schnell.
      let best = null;
      let bestCost = Infinity;
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const ids = [candidates[i].id, candidates[j].id];
          if (context.isNeverPair(ids[0], ids[1])) continue;
          const cost = load.get(ids[0]) + load.get(ids[1]) + groupCost(context, ids, false) + rng() * 0.01;
          if (cost < bestCost) { bestCost = cost; best = ids; }
        }
      }
      if (best) return best;
    }

    // Allgemeiner Fall (andere Teamgröße, Azubi-Einzelplatz oder nur
    // "nie zusammen"-Paare verfügbar): der Reihe nach die am wenigsten
    // belasteten Personen, ohne verbotene Paarungen.
    const sorted = candidates.slice().sort((a, b) => load.get(a.id) - load.get(b.id));
    const chosen = [];
    for (const s of sorted) {
      if (chosen.length >= needed) break;
      if (chosen.some((id) => context.isNeverPair(id, s.id))) continue;
      chosen.push(s.id);
    }
    return chosen;
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

  /** Die am wenigsten belasteten ~40 % der Kandidat:innen (mind. eine Person) — Zufallswahl daraus. */
  function pickLowLoad(context, slot, candidates, rng) {
    const means = slotMeans(context, slot);
    const sorted = candidates
      .map((s) => ({ s, load: marginalLoadCost(context, s.id, slot, means) }))
      .sort((a, b) => a.load - b.load);
    const pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.4)));
    return randomChoice(pool, rng).s;
  }

  function attemptFillMove(context, slots, rng) {
    const understaffed = slots.filter((s) => (context.assignments.get(s.key) || []).length < context.settings.studentsPerDuty);
    if (!understaffed.length) return false;
    const slot = randomChoice(understaffed, rng);
    const currentIds = context.assignments.get(slot.key) || [];
    const eligible = context.students.filter((s) => !currentIds.includes(s.id) && context.isEligible(s.id, slot));
    if (!eligible.length) return false;
    const chosen = pickLowLoad(context, slot, eligible, rng);

    const weeks = [slot.weekMonday];
    const before = slotCost(context, slot) + fairnessCost(context, weeks);
    context.assign(slot, chosen.id);
    const after = slotCost(context, slot) + fairnessCost(context, weeks);
    if (after <= before) return true;
    context.unassign(slot, chosen.id);
    return false;
  }

  /**
   * Umverteilen: nimmt einer (eher stark belasteten) Person einen Dienst ab
   * und gibt ihn einer zulässigen, weniger belasteten Person. Der einzige
   * Zug, der die Dienstanzahl einzelner Personen verändert, ohne Plätze zu
   * leeren — und damit der Kern der gleichmäßigen Verteilung.
   */
  function attemptReassignMove(context, slots, temperature, rng) {
    const occupied = slots.filter((s) => (context.assignments.get(s.key) || []).length > 0);
    if (!occupied.length) return false;
    const slot = randomChoice(occupied, rng);
    const ids = context.assignments.get(slot.key);

    let outgoing;
    if (rng() < 0.7) {
      const means = slotMeans(context, slot);
      outgoing = ids.slice().sort((a, b) => marginalLoadCost(context, b, slot, means) - marginalLoadCost(context, a, slot, means))[0];
    } else {
      outgoing = randomChoice(ids, rng);
    }

    const weeks = [slot.weekMonday];
    const before = slotCost(context, slot) + fairnessCost(context, weeks);
    context.unassign(slot, outgoing);
    const remaining = context.assignments.get(slot.key) || [];
    const candidates = context.students.filter((s) => s.id !== outgoing && !remaining.includes(s.id) && context.isEligible(s.id, slot));
    if (!candidates.length) {
      context.assign(slot, outgoing);
      return false;
    }
    const incoming = pickLowLoad(context, slot, candidates, rng);
    context.assign(slot, incoming.id);
    const after = slotCost(context, slot) + fairnessCost(context, weeks);

    const delta = after - before;
    if (delta <= 0 || rng() < Math.exp(-delta / temperature)) return true;
    context.unassign(slot, incoming.id);
    context.assign(slot, outgoing);
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
    return trySwap(context, slotA, studentA, slotB, studentB, temperature, rng);
  }

  /**
   * Gezielter Partner-Zug: setzt q neben p (Wunsch-/bevorzugte Partner:in).
   * q verlässt dafür einen anderen eigenen Dienst Z derselben Woche, die
   * bisherige Begleitperson d von p verlässt X, und Z wird mit der
   * passendsten zulässigen Person nachbesetzt (oft d selbst — dann ist es ein
   * reiner Tausch). Zufällige Züge treffen solche Dreier-Verschiebungen bei
   * knapper Verfügbarkeit praktisch nie.
   */
  function attemptPartnerMove(context, slots, temperature, rng) {
    if (!context.preferredPairs.length) return false;
    const [p, q] = randomChoice(context.preferredPairs, rng);
    const studentQ = context.studentsById.get(q);
    const withP = slots.filter((s) => {
      const ids = context.assignments.get(s.key) || [];
      return ids.includes(p) && !ids.includes(q) && ids.length > 1 && context.availabilityAllows(studentQ, s);
    });
    if (!withP.length) return false;
    const slotX = randomChoice(withP, rng);
    const displaced = randomChoice((context.assignments.get(slotX.key) || []).filter((id) => id !== p), rng);
    const withQ = slots.filter((s) => s.weekMonday === slotX.weekMonday && s.key !== slotX.key && (context.assignments.get(s.key) || []).includes(q));
    if (!withQ.length) return false;
    const slotZ = randomChoice(withQ, rng);

    const weeks = [slotX.weekMonday];
    const before = slotCost(context, slotX) + slotCost(context, slotZ) + fairnessCost(context, weeks);
    context.unassign(slotX, displaced);
    context.unassign(slotZ, q);
    if (!context.isEligible(q, slotX)) {
      context.assign(slotZ, q);
      context.assign(slotX, displaced);
      return false;
    }
    context.assign(slotX, q);

    // Ein Wunsch darf nie Abdeckung kosten: ohne Nachbesetzung für Z kein Zug.
    const inZ = context.assignments.get(slotZ.key) || [];
    const candidates = context.students.filter((s) => s.id !== q && !inZ.includes(s.id) && context.isEligible(s.id, slotZ));
    if (!candidates.length) {
      context.unassign(slotX, q);
      context.assign(slotZ, q);
      context.assign(slotX, displaced);
      return false;
    }
    const replacement = candidates.some((s) => s.id === displaced) && rng() < 0.5 ? displaced : pickLowLoad(context, slotZ, candidates, rng).id;
    context.assign(slotZ, replacement);
    const after = slotCost(context, slotX) + slotCost(context, slotZ) + fairnessCost(context, weeks);

    const delta = after - before;
    if (delta <= 0 || rng() < Math.exp(-delta / temperature)) return true;
    context.unassign(slotZ, replacement);
    context.unassign(slotX, q);
    context.assign(slotZ, q);
    context.assign(slotX, displaced);
    return false;
  }

  /** Tauscht studentA (in slotA) mit studentB (in slotB), falls zulässig und nach SA-Regel akzeptiert. */
  function trySwap(context, slotA, studentA, slotB, studentB, temperature, rng) {
    if (studentA === studentB) return false;
    if ((context.assignments.get(slotA.key) || []).includes(studentB)) return false;
    if ((context.assignments.get(slotB.key) || []).includes(studentA)) return false;
    const weeks = slotA.weekMonday === slotB.weekMonday ? [slotA.weekMonday] : [slotA.weekMonday, slotB.weekMonday];
    const beforeCost = slotCost(context, slotA) + slotCost(context, slotB) + fairnessCost(context, weeks);

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
    const afterCost = slotCost(context, slotA) + slotCost(context, slotB) + fairnessCost(context, weeks);

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

  const START_TEMPERATURE = 6;
  const END_TEMPERATURE = 0.05;

  /**
   * @param {{ fillOnly?: boolean }} [options] - fillOnly: nur Plätze ergänzen,
   *   bestehende Besetzungen nie verschieben (für die Lücken-Füllung, bei der
   *   bereits eingeteilte Personen ihren Dienst behalten sollen).
   */
  async function localSearch(context, slots, onProgress, rng, percentRange, options = {}) {
    const range = percentRange || { start: 40, end: 95 };
    const iterations = U.clamp(slots.length * 120, 1200, 20000);
    let temperature = START_TEMPERATURE;
    const coolingRate = Math.pow(END_TEMPERATURE / START_TEMPERATURE, 1 / iterations);
    const chunkSize = 200;

    for (let i = 0; i < iterations; i++) {
      const hasGaps = slots.some((s) => (context.assignments.get(s.key) || []).length < context.settings.studentsPerDuty);
      const r = rng();
      if (options.fillOnly) {
        if (!hasGaps) break;
        attemptFillMove(context, slots, rng);
      } else if (hasGaps && r < 0.4) {
        attemptFillMove(context, slots, rng);
      } else if (r < (hasGaps ? 0.75 : 0.55)) {
        attemptReassignMove(context, slots, temperature, rng);
      } else if (context.preferredPairs.length && r < (hasGaps ? 0.85 : 0.75)) {
        attemptPartnerMove(context, slots, temperature, rng);
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
    const weekValues = [];
    context.targetWeeks.forEach((wk) => {
      context.participantIds.forEach((id) => weekValues.push(context.weekCount.get(`${id}|${wk}`) || 0));
    });
    const stats = {
      totalSlots: slots.length,
      filledSlots,
      unfilledSlots: slots.length - filledSlots,
      averageLoad: U.round(U.mean(loads), 2),
      loadStdDev: U.round(U.standardDeviation(loads), 2),
      fairnessScore: U.fairnessScoreFromStdDev(U.standardDeviation(loads)),
      finalCost: U.round(totalCost(context, slots), 1),
      perPersonWeekMin: weekValues.length ? Math.min(...weekValues) : 0,
      perPersonWeekMax: weekValues.length ? Math.max(...weekValues) : 0,
      perPersonWeekAvg: U.round(U.mean(weekValues), 1),
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
   * in den Kontext vorbelegt, danach läuft nur die lokale Suche im Modus
   * `fillOnly` — `attemptFillMove` fügt unterbesetzten Diensten die fairste
   * zulässige Person hinzu, bereits eingeteilte Personen bleiben unangetastet.
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

    await localSearch(context, slots, onProgress, rng, { start: 10, end: 95 }, { fillOnly: true });

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
