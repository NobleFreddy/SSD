/**
 * ============================================================================
 * SSD.SubstitutionService — Vertretungsmodus
 * ============================================================================
 * Findet für kurzfristig ausgefallene Schüler:innen (Krankheit, Klassenfahrt,
 * spontane Abwesenheit) automatisch geeignete Ersatzpersonen für ihre bereits
 * eingeteilten Dienste — ohne den übrigen Dienstplan neu zu berechnen.
 *
 * Wiederverwendung: Die eigentliche Eignungsprüfung (harte Bedingungen) und
 * die Zähler (Gesamtdienste, Wochenlast, Partnerhistorie, Wochentags-
 * verteilung) stammen unverändert aus `SSD.Scheduler.SchedulingContext` —
 * derselbe Baustein, den auch die vollständige Dienstplan-Erstellung nutzt.
 * Dadurch gelten für Vertretungen garantiert exakt dieselben harten Regeln
 * wie für die ursprüngliche Planung, ohne Code-Duplizierung.
 *
 * Vorgehen pro Anfrage (eine oder mehrere abwesende Personen, ein Zeitraum):
 *   1. Alle betroffenen Dienste ermitteln (jede Zeile = ein konkreter
 *      "Vakanz"-Fall: ein Dienst + eine darin fehlende Person).
 *   2. Einen gemeinsamen Planungskontext aufbauen, in dem die verbleibenden
 *      (nicht abwesenden) Partner:innen der betroffenen Dienste wieder
 *      eingetragen werden — alle anderen Dienste bleiben unverändert Teil
 *      der Historie (Fairness/Partnerzählung) und werden nicht angetastet.
 *   3. Vakanzen nach der "Most-Constrained-First"-Heuristik abarbeiten
 *      (zuerst die mit den wenigsten zulässigen Kandidat:innen), damit sich
 *      der Vorschlag nicht durch eine ungünstige Reihenfolge selbst in eine
 *      Sackgasse manövriert.
 *   4. Für jede Vakanz alle zulässigen Kandidat:innen mit einer 0–100-
 *      Eignungsbewertung versehen (Fairness, Geschlechtermischung, Partner-
 *      wechsel, Wochentagsverteilung, freie Kapazität in der Woche) und die
 *      beste Person automatisch vorschlagen — der Administrator kann jeden
 *      Vorschlag im "Vertretungsassistenten" manuell überschreiben.
 */
window.SSD = window.SSD || {};

SSD.SubstitutionService = (function () {
  'use strict';

  const U = SSD.Utils;

  /** Gewichtung der Eignungs-Bewertung (Summe der Maximalwerte = 100 Punkte). */
  const SCORE_WEIGHTS = {
    FAIRNESS: 30,
    GENDER: 15,
    PARTNER: 25,
    WEEKDAY: 15,
    HEADROOM: 15,
  };

  const ABSENCE_REASONS = [
    { key: 'krankheit', label: 'Krankheit' },
    { key: 'klassenfahrt', label: 'Klassenfahrt / Ausflug' },
    { key: 'kurzfristig', label: 'Kurzfristige Abwesenheit' },
    { key: 'sonstiges', label: 'Sonstiges' },
  ];

  function studentName(id) {
    const s = SSD.StudentService.getById(id);
    return s ? SSD.StudentService.fullName(s) : 'Unbekannt';
  }

  /**
   * Liefert die aktuell gültige Wahl für einen Vorschlag: eine manuelle
   * Überschreibung (auch explizit "unbesetzt lassen", also `null`) hat immer
   * Vorrang vor dem automatischen Vorschlag. `proposal.overridden` markiert,
   * ob überhaupt überschrieben wurde — nötig, weil `chosenOverrideId` selbst
   * legitim `null` sein kann (bewusst unbesetzt lassen).
   */
  function effectiveChoiceId(proposal) {
    if (proposal.overridden) return proposal.chosenOverrideId;
    return proposal.chosen ? proposal.chosen.studentId : null;
  }

  /** Alle Dienste im Zeitraum, an denen mindestens eine der genannten Personen beteiligt ist. */
  function getAffectedEntries(studentIds, startIso, endIso) {
    const absentSet = new Set(studentIds);
    return SSD.Store.getState().schedule.entries
      .filter((e) => e.date >= startIso && e.date <= endIso && (e.studentIds.some((id) => absentSet.has(id)) || absentSet.has(e.azubiId)))
      .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
  }

  /* ---------------------------------------------------------------------
   * Erklärung, warum eine Person NICHT infrage kommt (für "kein Ersatz
   * gefunden"-Meldungen). Prüft in derselben Reihenfolge wie
   * SchedulingContext.isEligible, damit der zuerst genannte Grund auch
   * tatsächlich der entscheidende ist.
   * ------------------------------------------------------------------- */
  function explainIneligibility(context, slot, student) {
    if (!student.active) return 'deaktiviert';
    if (!context.availabilityAllows(student, slot)) return 'für diesen Termin nicht verfügbar/gesperrt';
    const maxTotal = context.settings.maxDutiesTotal;
    if (maxTotal && context.totalCount.get(student.id) >= maxTotal) return 'hat das Gesamtlimit erreicht';
    const maxWeek = student.maxDutiesPerWeek || context.settings.maxDutiesPerWeek;
    const wkey = `${student.id}|${slot.weekMonday}`;
    if ((context.weekCount.get(wkey) || 0) >= maxWeek) return 'hat das Wochenlimit bereits erreicht';
    const dayBlocks = context.dayBlocks.get(student.id)?.get(slot.date);
    if (dayBlocks && dayBlocks.size > 0) {
      if (!context.settings.allowSameDayDuties) return 'ist an diesem Tag bereits eingeteilt';
      const order = (key) => U.DUTY_BLOCKS.find((b) => b.key === key).order;
      if (Array.from(dayBlocks).some((b) => Math.abs(order(b) - order(slot.block)) <= context.settings.minBreakBlocks)) {
        return 'erfüllt eine Mindestpausen-Regel nicht';
      }
    }
    const neverId = context.neverPartnerIn(student.id, slot);
    if (neverId) return `soll laut Paar-Regel nie mit ${studentName(neverId)} eingeteilt werden`;
    return 'erfüllt eine Regel nicht';
  }

  function buildNoCandidateExplanation(context, slot, excludeIds) {
    const tally = new Map();
    context.students.forEach((s) => {
      if (excludeIds.has(s.id)) return;
      const reason = explainIneligibility(context, slot, s);
      tally.set(reason, (tally.get(reason) || 0) + 1);
    });
    const parts = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${count} Person${count === 1 ? '' : 'en'} ${reason}`);
    if (!parts.length) return 'Es sind keine weiteren aktiven Schüler:innen im System vorhanden.';
    return `${parts.join(', ')}.`;
  }

  /* ---------------------------------------------------------------------
   * Eignungsbewertung (0–100 Punkte) für eine Kandidat:in in einem Slot
   * ------------------------------------------------------------------- */
  function scoreCandidate(context, slot, candidateId, currentPartnerIds) {
    const candidate = context.studentsById.get(candidateId);
    const reasons = [];

    // Fairness: liegt die Person bei/unter dem Team-Durchschnitt an Gesamtdiensten?
    const avg = context.averageLoad();
    const count = context.totalCount.get(candidateId) || 0;
    const fairnessPts = U.clamp(SCORE_WEIGHTS.FAIRNESS - Math.max(0, count - avg) * 15, 0, SCORE_WEIGHTS.FAIRNESS);
    if (count <= avg + 0.01) {
      reasons.push(count === 0 ? 'Bisher keine Dienste geleistet' : 'Unterdurchschnittliche bisherige Dienstanzahl');
    }

    // Geschlechtermischung mit den verbleibenden Partner:innen dieses Dienstes
    let genderPts = SCORE_WEIGHTS.GENDER;
    if (context.w.genderMix > 0 && currentPartnerIds.length === 1) {
      const partner = context.studentsById.get(currentPartnerIds[0]);
      if (partner && candidate.gender !== partner.gender) {
        reasons.push('Ergibt ein gemischtes Team (Mädchen + Junge)');
      } else if (partner) {
        genderPts = 0;
      }
    }

    // Partnerhistorie: wie oft schon mit dieser/diesen Person(en) zusammen im Dienst?
    let priorCount = 0;
    currentPartnerIds.forEach((pid) => { priorCount += context.pairCount.get(SSD.Scheduler.pairKey([candidateId, pid])) || 0; });
    const partnerPts = U.clamp(SCORE_WEIGHTS.PARTNER - priorCount * priorCount * 7, 0, SCORE_WEIGHTS.PARTNER);
    if (currentPartnerIds.length) {
      const names = currentPartnerIds.map(studentName).join(' & ');
      reasons.push(priorCount === 0 ? `Noch nie mit ${names} eingeteilt` : `Bereits ${priorCount}× mit ${names} eingeteilt`);
    }
    const wished = currentPartnerIds.find((pid) => (context.wishes.get(candidateId) && context.wishes.get(candidateId).has(pid))
      || (context.wishes.get(pid) && context.wishes.get(pid).has(candidateId)));
    if (wished) reasons.unshift(`Gewünschtes Team mit ${studentName(wished)}`);

    // Wochentagsverteilung: ist dieser Wochentag für die Person schon überdurchschnittlich oft belegt?
    const weekdayCounts = context.weekdayCount.get(candidateId);
    const weekdayAvg = U.mean(Object.values(weekdayCounts));
    const onThisDay = weekdayCounts[slot.weekday];
    const weekdayPts = U.clamp(SCORE_WEIGHTS.WEEKDAY - Math.max(0, onThisDay - weekdayAvg) * 8, 0, SCORE_WEIGHTS.WEEKDAY);
    if (onThisDay <= weekdayAvg) reasons.push('Passt zur gleichmäßigen Wochenverteilung');

    // Freie Kapazität in der betroffenen Woche
    const maxWeek = candidate.maxDutiesPerWeek || context.settings.maxDutiesPerWeek;
    const weekCount = context.weekCount.get(`${candidateId}|${slot.weekMonday}`) || 0;
    const headroom = maxWeek > 0 ? U.clamp((maxWeek - weekCount) / maxWeek, 0, 1) : 1;
    const headroomPts = headroom * SCORE_WEIGHTS.HEADROOM;
    if (weekCount === 0) reasons.push('Noch kein weiterer Dienst in dieser Woche eingeteilt');

    const score = Math.round(fairnessPts + genderPts + partnerPts + weekdayPts + headroomPts);
    return { studentId: candidateId, student: candidate, score: U.clamp(score, 0, 100), reasons: reasons.slice(0, 3) };
  }

  /* ---------------------------------------------------------------------
   * Kernfunktion: Vertretungsvorschläge für eine oder mehrere abwesende
   * Personen über einen Zeitraum berechnen.
   * ------------------------------------------------------------------- */

  /**
   * @param {string[]} absentStudentIds
   * @param {string} startIso
   * @param {string} endIso
   * @returns {{ proposals: object[], fairnessBefore: number, fairnessAfter: number, noAffectedEntries: boolean }}
   */
  function proposeSubstitutions(absentStudentIds, startIso, endIso) {
    const state = SSD.Store.getState();
    const settings = state.settings;
    const absentSet = new Set(absentStudentIds);

    const affectedEntries = getAffectedEntries(absentStudentIds, startIso, endIso);
    const fairnessBefore = SSD.StatisticsService.computeOverview().fairnessScore;

    if (!affectedEntries.length) {
      return { proposals: [], fairnessBefore, fairnessAfter: fairnessBefore, noAffectedEntries: true };
    }

    const { vacancies, studentContext, azubiContext } = buildContextsAndVacancies(affectedEntries, absentSet, settings);
    const proposals = resolveVacancies(vacancies, absentSet);

    const activeStudents = SSD.StudentService.getActiveByRole('student').filter(SSD.StatisticsService.hasAnyAvailability);
    const afterCounts = activeStudents.map((s) => studentContext.totalCount.get(s.id));
    const fairnessAfter = SSD.StatisticsService.fairnessScoreForCounts(afterCounts);

    // Ursprüngliche Reihenfolge (nach Datum/Block) statt MRV-Bearbeitungsreihenfolge für die Anzeige.
    proposals.sort((a, b) => (a.slot.key + a.absentStudentId).localeCompare(b.slot.key + b.absentStudentId));

    return { proposals, fairnessBefore, fairnessAfter, noAffectedEntries: false };
  }

  /**
   * Baut je einen `SchedulingContext` für reguläre Schüler-Vakanzen und für
   * Azubi-Vakanzen (dritter, einzelner Platz) und ermittelt alle konkreten
   * (Dienst, abwesende Person)-Vakanzen. Zwei getrennte Kontexte sind nötig,
   * weil beide Rollen unabhängige Kandidat:innen-Pools und Fairness-Zählungen
   * haben — ein Azubi darf nie als Ersatz für eine reguläre Schüler-Person
   * vorgeschlagen werden (und umgekehrt).
   */
  function buildContextsAndVacancies(affectedEntries, absentSet, settings) {
    const state = SSD.Store.getState();
    const studentEntries = affectedEntries.filter((e) => e.studentIds.some((id) => absentSet.has(id)));
    const azubiEntries = affectedEntries.filter((e) => absentSet.has(e.azubiId));

    const studentSlots = studentEntries.map((e) => SSD.Scheduler.slotFromEntry(e));
    const azubiSlots = azubiEntries.map((e) => SSD.Scheduler.slotFromEntry(e));

    const activeStudents = SSD.StudentService.getActiveByRole('student');
    const activeAzubis = SSD.StudentService.getActiveByRole('azubi');

    const studentContext = new SSD.Scheduler.SchedulingContext(activeStudents, state.schedule.entries, studentSlots, settings);
    studentEntries.forEach((entry, i) => {
      entry.studentIds.filter((id) => !absentSet.has(id)).forEach((id) => {
        if (studentContext.studentsById.has(id)) studentContext.assign(studentSlots[i], id);
      });
    });

    const azubiHistory = SSD.Scheduler.buildAzubiHistoryEntries(new Set(azubiSlots.map((s) => s.key)));
    const azubiContext = new SSD.Scheduler.SchedulingContext(activeAzubis, azubiHistory, azubiSlots, SSD.Scheduler.azubiSettingsFrom(settings));
    // Kein "verbleibender Partner" beim Solo-Azubi-Platz vorzubelegen — die Vakanz ist die gesamte Zuteilung.

    const vacancies = [];
    studentEntries.forEach((entry, i) => {
      entry.studentIds.forEach((id) => {
        if (absentSet.has(id)) vacancies.push({ entry, slot: studentSlots[i], absentStudentId: id, context: studentContext });
      });
    });
    azubiEntries.forEach((entry, i) => {
      vacancies.push({ entry, slot: azubiSlots[i], absentStudentId: entry.azubiId, context: azubiContext });
    });

    return { vacancies, studentContext, azubiContext };
  }

  /**
   * Most-Constrained-First: löst eine Liste von Vakanzen (ggf. gemischter Sitzplatztypen) auf.
   * @param {Function} [isExcluded] - optional `(personId, vacancy) => boolean` für zusätzliche,
   *   vakanzabhängige Ausschlüsse (z. B. bei der automatischen Vertretung: wer an dem Tag selbst ausfällt).
   */
  function resolveVacancies(vacancies, absentSet, isExcluded) {
    const proposals = [];
    while (vacancies.length) {
      let bestIndex = 0;
      let bestEligible = null;
      for (let i = 0; i < vacancies.length; i++) {
        const v = vacancies[i];
        const currentIds = v.context.assignments.get(v.slot.key) || [];
        const excludeIds = new Set([...absentSet, ...currentIds]);
        const eligible = v.context.students.filter((s) => !excludeIds.has(s.id) && !(isExcluded && isExcluded(s.id, v)) && v.context.isEligible(s.id, v.slot));
        if (bestEligible === null || eligible.length < bestEligible.length) {
          bestEligible = eligible;
          bestIndex = i;
          if (eligible.length === 0) break;
        }
      }

      const vacancy = vacancies.splice(bestIndex, 1)[0];
      const currentIds = (vacancy.context.assignments.get(vacancy.slot.key) || []).slice();
      // Eine Azubi-Vakanz ist immer die dritte Person eines Dienstes: erkennbar
      // daran, dass die abwesende Person genau der bisherige `azubiId` ist.
      const isAzubiSeat = vacancy.entry.azubiId === vacancy.absentStudentId;
      const base = {
        entryId: vacancy.entry.id, slot: vacancy.slot, isAzubiSeat,
        absentStudentId: vacancy.absentStudentId, remainingPartnerIds: currentIds,
      };

      if (!bestEligible.length) {
        const excludeIds = new Set([...absentSet, ...currentIds]);
        proposals.push(Object.assign({}, base, {
          chosen: null, ranked: [],
          noCandidateReason: buildNoCandidateExplanation(vacancy.context, vacancy.slot, excludeIds),
        }));
        continue;
      }

      const ranked = bestEligible
        .map((s) => scoreCandidate(vacancy.context, vacancy.slot, s.id, currentIds))
        .sort((a, b) => b.score - a.score);
      vacancy.context.assign(vacancy.slot, ranked[0].studentId);
      proposals.push(Object.assign({}, base, { chosen: ranked[0], ranked }));
    }
    return proposals;
  }

  /**
   * Automatische Vertretung, wenn sich jemand selbst abmeldet ("Ich falle aus"):
   * dieselbe Auswahl wie im Vertretungsassistenten (harte Regeln des
   * Dienstplans, nur als "Verfügbar" eingetragene Zeiten, beste Eignungs-
   * bewertung, mehrere Dienste gemeinsam aufgelöst) — zusätzlich nie mit
   * Personen, die an dem Tag selbst ausfallen (Vertretung angefragt oder einen
   * Dienst abgegeben) oder die genau diesen Dienst schon einmal abgegeben haben.
   * Ändert nichts — die aufrufende Funktion übernimmt das Ergebnis per Commit.
   * @returns {Array<{entryId:string, absentStudentId:string, isAzubiSeat:boolean, replacementStudentId:?string}>}
   */
  function proposeAutoReplacements(personId, entryIds) {
    const state = SSD.Store.getState();
    const wanted = new Set(entryIds);
    const affected = state.schedule.entries
      .filter((e) => wanted.has(e.id) && (e.studentIds.includes(personId) || e.azubiId === personId))
      .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
    if (!affected.length) return [];

    // Wer ist an welchem Tag selbst verhindert? (offene Anfrage oder bereits abgegebener Dienst)
    const absentOnDate = new Map();
    const markAbsent = (dateIso, id) => {
      if (!id) return;
      if (!absentOnDate.has(dateIso)) absentOnDate.set(dateIso, new Set());
      absentOnDate.get(dateIso).add(id);
    };
    state.schedule.entries.forEach((e) => {
      (e.substitutionRequests || []).forEach((r) => markAbsent(e.date, r.studentId));
      (e.substitutionLog || []).forEach((log) => markAbsent(e.date, log.originalStudentId));
    });
    const gaveAwayEntry = new Map(affected.map((e) => [e.id, new Set((e.substitutionLog || []).map((log) => log.originalStudentId).filter(Boolean))]));
    const isExcluded = (id, vacancy) =>
      (absentOnDate.get(vacancy.entry.date) || new Set()).has(id) || gaveAwayEntry.get(vacancy.entry.id).has(id);

    const absentSet = new Set([personId]);
    const { vacancies } = buildContextsAndVacancies(affected, absentSet, state.settings);
    return resolveVacancies(vacancies, absentSet, isExcluded).map((p) => ({
      entryId: p.entryId,
      absentStudentId: p.absentStudentId,
      isAzubiSeat: p.isAzubiSeat,
      replacementStudentId: p.chosen ? p.chosen.studentId : null,
    }));
  }

  /**
   * Prüft nach einer manuellen Überschreibung im Vertretungsassistenten
   * erneut den gesamten aktuellen Auswahlstand auf Konflikte. Relevant,
   * sobald mehrere Vakanzen in einer Anfrage dieselbe Kandidat:in als
   * naheliegende Wahl hätten: Wählt der Administrator sie für eine Vakanz
   * manuell aus, kann sie für eine andere (z. B. wegen Wochenlimit oder
   * Tagesüberschneidung) nicht mehr zulässig sein — das wird hier erkannt
   * und am jeweiligen Vorschlag als `conflict`-Hinweis markiert, statt still
   * eine unzulässige Zuteilung zuzulassen.
   * @param {object[]} proposals - aktuelle Vorschlagsliste; jeder Eintrag kann
   *   ein `chosenOverrideId` tragen, falls der Administrator ihn überschrieben hat.
   * @returns {{ proposals: object[], fairnessAfter: number }}
   */
  function validateBatch(proposals) {
    const state = SSD.Store.getState();
    const settings = state.settings;

    const studentProposals = proposals.filter((p) => !p.isAzubiSeat);
    const azubiProposals = proposals.filter((p) => p.isAzubiSeat);

    const activeStudents = SSD.StudentService.getActiveByRole('student');
    const studentContext = new SSD.Scheduler.SchedulingContext(activeStudents, state.schedule.entries, studentProposals.map((p) => p.slot), settings);

    const activeAzubis = SSD.StudentService.getActiveByRole('azubi');
    const azubiSlots = azubiProposals.map((p) => p.slot);
    const azubiHistory = SSD.Scheduler.buildAzubiHistoryEntries(new Set(azubiSlots.map((s) => s.key)));
    const azubiContext = new SSD.Scheduler.SchedulingContext(activeAzubis, azubiHistory, azubiSlots, SSD.Scheduler.azubiSettingsFrom(settings));

    studentProposals.forEach((p) => {
      p.remainingPartnerIds.forEach((id) => { if (studentContext.studentsById.has(id)) studentContext.assign(p.slot, id); });
    });

    function resolve(list, context) {
      list.forEach((p) => {
        p.conflict = null;
        if (p.skip) return;
        const effectiveId = effectiveChoiceId(p);
        if (!effectiveId) return;
        if (context.isEligible(effectiveId, p.slot)) {
          context.assign(p.slot, effectiveId);
        } else {
          p.conflict = `${studentName(effectiveId)} ${explainIneligibility(context, p.slot, context.studentsById.get(effectiveId))} — bitte andere Person wählen.`;
        }
      });
    }
    resolve(studentProposals, studentContext);
    resolve(azubiProposals, azubiContext);

    const afterCounts = activeStudents.filter(SSD.StatisticsService.hasAnyAvailability).map((s) => studentContext.totalCount.get(s.id));
    const fairnessAfter = SSD.StatisticsService.fairnessScoreForCounts(afterCounts);
    return { proposals, fairnessAfter };
  }

  /* ---------------------------------------------------------------------
   * Anwenden der (ggf. vom Administrator angepassten) Vertretungen — ändert
   * ausschließlich die betroffenen Dienste, alles andere bleibt unberührt.
   * ------------------------------------------------------------------- */

  /** @param {Array<{entryId:string, absentStudentId:string, replacementStudentId:?string, isAzubiSeat?:boolean, skip?:boolean, reasonText?:string}>} finalChoices */
  function applySubstitutions(finalChoices, reasonLabel) {
    const appliedAt = new Date().toISOString();
    const applied = finalChoices.filter((c) => !c.skip);
    if (!applied.length) return 0;

    SSD.Store.commit(`Vertretung eingetragen (${reasonLabel || 'Abwesenheit'})`, (draft) => {
      const N = SSD.NotificationService;
      const lines = [];
      applied.forEach((choice) => {
        const entry = draft.schedule.entries.find((e) => e.id === choice.entryId);
        if (!entry) return;
        if (choice.isAzubiSeat) {
          if (entry.azubiId !== choice.absentStudentId) return;
          entry.azubiId = choice.replacementStudentId || null;
        } else {
          const idx = entry.studentIds.indexOf(choice.absentStudentId);
          if (idx === -1) return;
          if (choice.replacementStudentId) entry.studentIds[idx] = choice.replacementStudentId;
          else entry.studentIds.splice(idx, 1);
        }
        entry.isManual = true;
        // Eine offene "Vertretung gesucht"-Anfrage der ersetzten Person ist damit erledigt.
        entry.substitutionRequests = (entry.substitutionRequests || []).filter((r) => r.studentId !== choice.absentStudentId);
        entry.substitutionLog = entry.substitutionLog || [];
        entry.substitutionLog.push({
          originalStudentId: choice.absentStudentId,
          replacementStudentId: choice.replacementStudentId || null,
          reason: choice.reasonText || reasonLabel || '',
          appliedAt,
        });
        const seat = choice.isAzubiSeat ? ' (Azubi-Platz)' : '';
        lines.push(choice.replacementStudentId
          ? `${N.dutyLabel(entry)}: ${N.personName(choice.replacementStudentId)} vertritt ${N.personName(choice.absentStudentId)}${seat}`
          : `${N.dutyLabel(entry)}: ${N.personName(choice.absentStudentId)} fällt aus — Platz bleibt offen${seat}`);
      });
      if (lines.length) N.add(draft, 'substitution', N.withDetails(`Vertretung eingetragen${reasonLabel ? ` (${reasonLabel})` : ''}:`, lines));
    });
    return applied.length;
  }

  return {
    ABSENCE_REASONS,
    getAffectedEntries,
    proposeSubstitutions,
    proposeAutoReplacements,
    validateBatch,
    applySubstitutions,
    studentName,
    effectiveChoiceId,
    // Wiederverwendet von SSD.SelfServiceService für die Eignungsprüfung beim
    // eigenständigen Übernehmen offener Dienste, damit dieselbe verständliche
    // Begründung ("nicht verfügbar", "Wochenlimit erreicht", ...) an beiden
    // Stellen erscheint, ohne die Logik zweimal zu pflegen.
    explainIneligibility,
  };
})();
