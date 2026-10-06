/**
 * ============================================================================
 * SSD.DistributionService — Verteilungsregeln für den Dienstplan-Algorithmus
 * ============================================================================
 * Liest und speichert alles, womit der Administrator die automatische
 * Verteilung steuert: Prioritäten der weichen Kriterien, Abijahrgangs-Regeln,
 * Paar-Regeln für einzelne Personen sowie die Übersicht der von den Sanis
 * selbst gewählten Wunschpartner:innen. Die Regeln liegen in `settings` und
 * werden von `SSD.Scheduler` (siehe `resolveWeights`/`SchedulingContext`)
 * bei der nächsten Erstellung ausgewertet.
 */
window.SSD = window.SSD || {};

SSD.DistributionService = (function () {
  'use strict';

  const U = SSD.Utils;

  /** Einstellbare weiche Kriterien in der Reihenfolge der Anzeige. */
  const CRITERIA = [
    { key: 'weeklyFairness', label: 'Gleichmäßig pro Woche', hint: 'Alle bekommen in jeder Woche — und über den geplanten Zeitraum — möglichst gleich viele Dienste.' },
    { key: 'totalFairness', label: 'Ausgleich übers Schuljahr', hint: 'Wer in früheren Wochen weniger Dienste hatte, bekommt bevorzugt die Extra-Dienste — ohne einzelne Wochen zu überladen.' },
    { key: 'genderMix', label: 'Gemischte Paare', hint: 'Möglichst ein Mädchen und ein Junge pro Dienst.' },
    { key: 'partnerRotation', label: 'Partnerwechsel', hint: 'Möglichst oft mit verschiedenen Personen (gilt nicht für Wunsch- und bevorzugte Paare).' },
    { key: 'partnerWishes', label: 'Partnerwünsche der Sanis', hint: 'Selbst gewählte Wunschpartner:innen öfter gemeinsam einteilen.' },
    { key: 'yearGroups', label: 'Abijahrgangs-Regeln', hint: 'Wie stark die Regeln aus „Abijahrgänge“ berücksichtigt werden.' },
    { key: 'consecutiveWeek', label: 'Abwechslung bei den Zeiten', hint: 'Nicht jede Woche derselbe Termin für dieselbe Person.' },
    { key: 'weekdaySpread', label: 'Verteilung über die Wochentage', hint: 'Dienste einer Person möglichst auf verschiedene Wochentage verteilen.' },
  ];

  const YEAR_GROUP_MODES = [
    { key: 'none', label: 'Egal' },
    { key: 'mixed', label: 'Verschiedene Jahrgänge mischen (Erfahrene mit Neuen)' },
    { key: 'same', label: 'Gleiche Jahrgänge zusammen' },
  ];

  const YEAR_RULE_TYPES = [
    { key: 'prefer', label: 'bevorzugt zusammen' },
    { key: 'avoid', label: 'möglichst nicht zusammen' },
  ];

  const PAIR_RULE_TYPES = [
    { key: 'prefer', label: 'bevorzugt zusammen' },
    { key: 'never', label: 'nie zusammen' },
  ];

  function settings() { return SSD.SettingsService.get(); }

  /* ---------------------------------------------------------------------
   * Prioritäten
   * ------------------------------------------------------------------- */

  function getWeights() {
    return Object.assign(SSD.Models.createDefaultWeights(), settings().weights || {});
  }

  function setWeight(key, level) {
    SSD.SettingsService.update({ weights: Object.assign(getWeights(), { [key]: U.clamp(Number(level), 0, 3) }) });
  }

  function resetWeights() {
    SSD.SettingsService.update({ weights: SSD.Models.createDefaultWeights() });
  }

  function isDefaultWeights() {
    const current = getWeights();
    const defaults = SSD.Models.createDefaultWeights();
    return Object.keys(defaults).every((k) => Number(current[k]) === defaults[k]);
  }

  /* ---------------------------------------------------------------------
   * Abijahrgänge
   * ------------------------------------------------------------------- */

  function getYearGroupMode() { return settings().yearGroupMode || 'none'; }

  function setYearGroupMode(mode) { SSD.SettingsService.update({ yearGroupMode: mode }); }

  function getYearGroupRules() {
    return (settings().yearGroupRules || []).slice().sort((x, y) => x.a - y.a || x.b - y.b);
  }

  /** Legt eine Regel an — eine bereits bestehende für dieselbe Kombination wird ersetzt. */
  function addYearGroupRule(a, b, type) {
    const [lo, hi] = [Number(a), Number(b)].sort((x, y) => x - y);
    const rules = (settings().yearGroupRules || []).filter((r) => !(r.a === lo && r.b === hi));
    rules.push({ id: U.generateId('yr'), a: lo, b: hi, type });
    SSD.SettingsService.update({ yearGroupRules: rules });
  }

  function removeYearGroupRule(id) {
    SSD.SettingsService.update({ yearGroupRules: (settings().yearGroupRules || []).filter((r) => r.id !== id) });
  }

  /** Anzahl aktiver Sanis je Abijahrgang (+ ohne Angabe). */
  function getYearGroupOverview() {
    const counts = new Map();
    let missing = 0;
    SSD.StudentService.getActiveByRole('student').forEach((s) => {
      const y = Number(s.yearGroup);
      if (y > 0) counts.set(y, (counts.get(y) || 0) + 1);
      else missing += 1;
    });
    const years = Array.from(counts.entries()).sort((x, y) => x[0] - y[0]).map(([year, count]) => ({ year, count }));
    return { years, missing };
  }

  /* ---------------------------------------------------------------------
   * Paar-Regeln (einzelne Personen)
   * ------------------------------------------------------------------- */

  /** Regeln, deren beide Personen noch existieren. */
  function getPairRules() {
    return (settings().pairRules || []).filter((r) => SSD.StudentService.getById(r.a) && SSD.StudentService.getById(r.b));
  }

  function findPairRule(a, b) {
    return getPairRules().find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)) || null;
  }

  function isNeverPair(a, b) {
    const rule = findPairRule(a, b);
    return !!(rule && rule.type === 'never');
  }

  /** Legt eine Regel an — eine bereits bestehende für dasselbe Paar wird ersetzt. */
  function addPairRule(a, b, type) {
    if (!a || !b || a === b) throw new Error('Bitte zwei verschiedene Personen auswählen.');
    const rules = (settings().pairRules || []).filter((r) => !((r.a === a && r.b === b) || (r.a === b && r.b === a)));
    rules.push({ id: U.generateId('pr'), a, b, type });
    SSD.SettingsService.update({ pairRules: rules });
  }

  function removePairRule(id) {
    SSD.SettingsService.update({ pairRules: (settings().pairRules || []).filter((r) => r.id !== id) });
  }

  /* ---------------------------------------------------------------------
   * Partnerwünsche (Übersicht für den Administrator)
   * ------------------------------------------------------------------- */

  /** @returns {{ rows: Array<{student, partners: Array<{partner, mutual: boolean}>}>, mutualPairCount: number }} */
  function getWishOverview() {
    const students = SSD.StudentService.getActiveByRole('student').sort((a, b) => a.lastName.localeCompare(b.lastName));
    const wishes = new Map(students.map((s) => [s.id, SSD.StudentService.getPreferredPartners(s)]));
    const rows = students
      .filter((s) => wishes.get(s.id).length)
      .map((s) => ({
        student: s,
        partners: wishes.get(s.id).map((p) => ({ partner: p, mutual: (wishes.get(p.id) || []).some((x) => x.id === s.id) })),
      }));
    const mutualPairCount = rows.reduce((sum, row) => sum + row.partners.filter((p) => p.mutual).length, 0) / 2;
    return { rows, mutualPairCount };
  }

  return {
    CRITERIA, YEAR_GROUP_MODES, YEAR_RULE_TYPES, PAIR_RULE_TYPES,
    getWeights, setWeight, resetWeights, isDefaultWeights,
    getYearGroupMode, setYearGroupMode, getYearGroupRules, addYearGroupRule, removeYearGroupRule, getYearGroupOverview,
    getPairRules, findPairRule, isNeverPair, addPairRule, removePairRule,
    getWishOverview,
  };
})();
