/**
 * ============================================================================
 * SSD.StatisticsService — Kennzahlen & Auswertungen
 * ============================================================================
 * Berechnet aus dem aktuell gespeicherten Dienstplan sämtliche in der
 * Statistik-Ansicht benötigten Kennzahlen. Reine Lesefunktionen ohne
 * Seiteneffekte — die eigentliche Optimierung erfolgt in `SSD.Scheduler`.
 */
window.SSD = window.SSD || {};

SSD.StatisticsService = (function () {
  'use strict';

  const U = SSD.Utils;

  function hasAnyAvailability(student) {
    return Object.values(student.availability || {}).some((day) => day.includes('available'));
  }

  /** Anzahl der Wochen, für die es Diensteinträge gibt (mind. 1). */
  function plannedWeekCount() {
    const weeks = new Set(SSD.Store.getState().schedule.entries.map((e) => U.toIsoDate(U.getMondayOfWeek(U.parseIsoDate(e.date)))));
    return Math.max(1, weeks.size);
  }

  /**
   * Fairness-Score (0–100) aus den Dienstzahlen je Person — bezogen auf die
   * Streuung *pro Woche*, damit der Wert über ein ganzes Schuljahr
   * vergleichbar bleibt (die Gesamtzahlen streuen mit jeder weiteren Woche
   * zwangsläufig stärker, auch wenn jede einzelne Woche gleich fair ist).
   */
  function fairnessScoreForCounts(counts) {
    if (!counts.length) return 100;
    return U.fairnessScoreFromStdDev(U.standardDeviation(counts) / plannedWeekCount());
  }

  function computeOverview() {
    const state = SSD.Store.getState();
    // Nur reguläre Schüler:innen fließen in die Zweier-Paar-Statistik ein —
    // Azubis besetzen einen unabhängigen dritten Platz und werden separat
    // ausgewertet (siehe `azubiList` weiter unten), sonst würde ihre naturgemäß
    // andere Dienstfrequenz die Fairness-Kennzahlen der Kernzuteilung verfälschen.
    const students = SSD.StudentService.getActiveByRole('student');
    const entries = state.schedule.entries;
    const requiredCount = state.settings.studentsPerDuty;

    const dutiesPerStudent = new Map(students.map((s) => [s.id, 0]));
    const pairCounts = new Map();
    const weekdayCounts = { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 };
    let mixed = 0, boys = 0, girls = 0, incomplete = 0, empty = 0;

    entries.forEach((entry) => {
      entry.studentIds.forEach((id) => {
        if (dutiesPerStudent.has(id)) dutiesPerStudent.set(id, dutiesPerStudent.get(id) + 1);
      });
      if (entry.studentIds.length === 0) {
        empty += 1;
      } else if (entry.studentIds.length < requiredCount) {
        incomplete += 1;
      } else {
        const cls = SSD.Scheduler.classifyDuty(entry.studentIds, requiredCount);
        if (cls === 'mixed') mixed += 1;
        else if (cls === 'boys') boys += 1;
        else if (cls === 'girls') girls += 1;
      }
      if (entry.studentIds.length === requiredCount) weekdayCounts[entry.weekday] += 1;
      if (entry.studentIds.length === 2) {
        // Wichtig: den Schlüssel NICHT später wieder "auseinandersplitten" —
        // IDs enthalten selbst Unterstriche (Präfix "stu_"), daher würde ein
        // naives `key.split('_')` die ursprünglichen IDs zerstückeln. Die IDs
        // werden deshalb direkt im Map-Wert mitgeführt.
        const pk = SSD.Scheduler.pairKey(entry.studentIds);
        const existing = pairCounts.get(pk);
        pairCounts.set(pk, { ids: entry.studentIds.slice(), count: (existing?.count || 0) + 1 });
      }
    });

    // Fairness nur über Personen, die laut Verfügbarkeit überhaupt eingeteilt
    // werden können — wer (noch) nichts eingetragen hat, würde den Wert sonst
    // dauerhaft drücken, ohne dass die Verteilung daran etwas ändern könnte.
    const counts = students.filter(hasAnyAvailability).map((s) => dutiesPerStudent.get(s.id));
    const average = U.mean(counts);
    const stdDev = U.standardDeviation(counts);
    const fairnessScore = fairnessScoreForCounts(counts);

    const perStudentList = students
      .map((s) => ({ student: s, count: dutiesPerStudent.get(s.id) || 0 }))
      .sort((a, b) => b.count - a.count);

    const topPairs = Array.from(pairCounts.values())
      .map(({ ids, count }) => {
        const names = ids.map((id) => {
          const s = SSD.StudentService.getById(id);
          return s ? SSD.StudentService.fullName(s) : 'Unbekannt';
        });
        return { ids, names, count };
      })
      .filter((p) => p.count > 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const genderRoster = { w: 0, m: 0, d: 0 };
    students.forEach((s) => { genderRoster[s.gender] = (genderRoster[s.gender] || 0) + 1; });

    const azubiStats = computeAzubiOverview(entries);

    return {
      perStudentList,
      average: U.round(average, 2),
      stdDev: U.round(stdDev, 2),
      fairnessScore,
      genderDistribution: { mixed, boys, girls },
      genderRoster,
      topPairs,
      weekdayCounts,
      emptySlots: empty,
      incompleteSlots: incomplete,
      totalPlannedSlots: entries.length,
      filledSlots: entries.length - empty - incomplete,
      studentCount: students.length,
      azubi: azubiStats,
    };
  }

  /** Separate Fairness-Auswertung für Azubis (unabhängiger dritter Dienstplatz). */
  function computeAzubiOverview(entries) {
    const azubis = SSD.StudentService.getActiveByRole('azubi');
    const dutiesPerAzubi = new Map(azubis.map((a) => [a.id, 0]));
    let filled = 0;
    entries.forEach((entry) => {
      if (!entry.azubiId) return;
      if (dutiesPerAzubi.has(entry.azubiId)) dutiesPerAzubi.set(entry.azubiId, dutiesPerAzubi.get(entry.azubiId) + 1);
      filled += 1;
    });
    const counts = Array.from(dutiesPerAzubi.values());
    const perAzubiList = azubis
      .map((a) => ({ student: a, count: dutiesPerAzubi.get(a.id) || 0 }))
      .sort((a, b) => b.count - a.count);
    return {
      azubiCount: azubis.length,
      filledSlots: filled,
      average: azubis.length ? U.round(U.mean(counts), 2) : 0,
      fairnessScore: azubis.length ? fairnessScoreForCounts(counts) : 100,
      perAzubiList,
    };
  }

  /** Prognose der künftig noch offenen (nicht besetzbaren) Dienste im gewählten Zeitraum. */
  function computeCapacityWarning() {
    const students = SSD.StudentService.getActiveByRole('student');
    const settings = SSD.Store.getState().settings;
    const totalWeeklyCapacity = students.reduce((sum, s) => sum + (s.maxDutiesPerWeek || settings.maxDutiesPerWeek), 0);
    let neededPerWeek = 0;
    U.WEEKDAY_KEYS.forEach((day) => {
      neededPerWeek += SSD.CalendarService.getEnabledBlocksForWeekday(day).length * settings.studentsPerDuty;
    });
    return {
      totalWeeklyCapacity,
      neededPerWeek,
      sufficient: totalWeeklyCapacity >= neededPerWeek,
    };
  }

  return { computeOverview, computeCapacityWarning, hasAnyAvailability, fairnessScoreForCounts };
})();
