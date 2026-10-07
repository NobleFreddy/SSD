/**
 * ============================================================================
 * SSD.Models — Datenmodelle, Fabrikfunktionen & Standardwerte
 * ============================================================================
 * Definiert die Form aller in der Anwendung verwendeten Datensätze sowie
 * Fabrikfunktionen ("factory functions"), die stets vollständige, valide
 * Objekte mit sinnvollen Standardwerten erzeugen. Dadurch entsteht an keiner
 * Stelle der Anwendung ein Objekt mit fehlenden Feldern.
 *
 * Datenformat-Version: wird beim Import/Export mitgeschrieben, damit künftige
 * Versionen der App alte Exporte erkennen und ggf. migrieren können.
 */
window.SSD = window.SSD || {};

SSD.Models = (function () {
  'use strict';

  const U = SSD.Utils;
  const DATA_VERSION = 1;

  const SPECIAL_DAY_TYPES = [
    { key: 'ferien', label: 'Ferien', color: '#2f6feb' },
    { key: 'feiertag', label: 'Feiertag', color: '#dc2626' },
    { key: 'projekttag', label: 'Projekttag', color: '#d97706' },
    { key: 'wandertag', label: 'Wandertag', color: '#16a34a' },
    { key: 'klausurtag', label: 'Klausurtag', color: '#db2777' },
    { key: 'studientag', label: 'Studientag', color: '#0891b2' },
  ];

  const AVAILABILITY_STATES = ['available', 'unavailable', 'blocked'];

  const GENDERS = [
    { key: 'w', label: 'Weiblich' },
    { key: 'm', label: 'Männlich' },
    { key: 'd', label: 'Divers' },
  ];

  /**
   * Personen-Kategorien. "Azubi" ist eine zusätzliche Kategorie neben den
   * regulären Schüler:innen: Azubis tragen ebenfalls ihre Verfügbarkeit ein,
   * werden aber nicht in die reguläre Zweier-Zuteilung einbezogen, sondern
   * einzeln als dritte, gekennzeichnete Person zu einem Dienst hinzugefügt
   * (siehe `SSD.Scheduler.assignAzubis`).
   */
  const ROLES = [
    { key: 'student', label: 'Schüler:in' },
    { key: 'azubi', label: 'Azubi' },
  ];

  /**
   * Zusatzbezeichnung oberhalb der regulären Kategorie — sitzt zwischen
   * Schüler:in und Administrator: erweiterte Koordinationsrechte (Vertretungen
   * für Mitschüler:innen melden, Team-Überblick), aber keine Konto-/System-
   * verwaltung. Genau eine Person je Bezeichnung gleichzeitig (siehe
   * `SSD.StudentService.setLeadershipRole`).
   */
  const LEADERSHIP_ROLES = [
    { key: 'sanisprecher', label: 'Sanisprecher:in' },
    { key: 'vize_sanisprecher', label: 'Stellv. Sanisprecher:in' },
  ];

  /** Leere Verfügbarkeit: an jedem Wochentag/Block standardmäßig "nicht verfügbar". */
  function createEmptyAvailability() {
    const week = {};
    U.WEEKDAY_KEYS.forEach((day) => {
      week[day] = U.DUTY_BLOCK_KEYS.map(() => 'unavailable');
    });
    return week;
  }

  function createStudent(overrides = {}) {
    const now = new Date().toISOString();
    return Object.assign(
      {
        id: U.generateId('stu'),
        username: '',
        passwordHash: '',
        salt: '',
        firstName: '',
        lastName: '',
        role: 'student', // 'student' | 'azubi'
        leadershipRole: null, // null | 'sanisprecher' | 'vize_sanisprecher'
        gender: 'd',
        schoolClass: '',
        yearGroup: null, // Abijahrgang, z. B. 2028; null = nicht angegeben
        preferredPartnerIds: [], // Wunschpartner:innen (max. 3, nur Kategorie "student")
        notes: '',
        adminMessage: '',
        maxDutiesPerWeek: null, // null = globalen Wert aus Settings verwenden
        active: true,
        pendingApproval: false, // true = Selbstregistrierung, noch nicht vom Administrator geprüft
        availability: createEmptyAvailability(),
        availabilityUpdatedAt: now,
        dutyLog: [], // { date, block, partnerId } — Verlauf aller je zugewiesenen Dienste
        createdAt: now,
      },
      overrides
    );
  }

  function createSpecialDay(overrides = {}) {
    return Object.assign(
      {
        id: U.generateId('day'),
        startDate: U.toIsoDate(U.today()),
        endDate: U.toIsoDate(U.today()),
        type: 'ferien',
        label: '',
      },
      overrides
    );
  }

  /** Standard-Dienstblock-Konfiguration: alle vier Blöcke an allen Wochentagen aktiv. */
  function createDefaultDutyBlockConfig() {
    const config = {};
    U.WEEKDAY_KEYS.forEach((day) => {
      config[day] = {};
      U.DUTY_BLOCK_KEYS.forEach((block) => {
        config[day][block] = true;
      });
    });
    return config;
  }

  /**
   * Gewichtungsstufen der weichen Verteilungskriterien (siehe SSD.Scheduler):
   * 0 = Aus, 1 = Niedrig, 2 = Mittel, 3 = Hoch.
   */
  const WEIGHT_LEVELS = [
    { value: 0, label: 'Aus' },
    { value: 1, label: 'Niedrig' },
    { value: 2, label: 'Mittel' },
    { value: 3, label: 'Hoch' },
  ];

  function createDefaultWeights() {
    return {
      weeklyFairness: 3,
      totalFairness: 2,
      genderMix: 2,
      partnerRotation: 2,
      partnerWishes: 2,
      yearGroups: 2,
      consecutiveWeek: 2,
      weekdaySpread: 2,
    };
  }

  function createDefaultSettings() {
    return {
      maxDutiesPerWeek: 2,
      maxDutiesTotal: null,
      minBreakBlocks: 1,
      studentsPerDuty: 2,
      allowSameDayDuties: false,
      changeDeadlineDaysBeforeWeek: 2,
      autoSave: true,
      allowSelfRegistration: true,
      weights: createDefaultWeights(),
      yearGroupMode: 'none', // 'none' | 'mixed' | 'same'
      yearGroupRules: [], // { id, a, b, type: 'prefer' | 'avoid' } — a/b = Abijahrgang
      pairRules: [], // { id, a, b, type: 'prefer' | 'never' } — a/b = Personen-IDs
      registrationCodeHash: null, // gesalzener Hash des Schulcodes (nie im Klartext)
      registrationCodeSalt: null,
      teams: createDefaultTeamsSettings(),
    };
  }

  /**
   * Teams-Benachrichtigungen. Die geheime Workflow-Adresse und der Link für
   * den Button in der Teams-Nachricht stehen bewusst NICHT hier (der
   * Datenbestand ist öffentlich les- und schreibbar), sondern im Supabase Vault.
   */
  function createDefaultTeamsSettings() {
    return {
      enabled: false,
      categories: { schedule: true, substitution: true, event: true, task: true, material: true },
    };
  }

  function createScheduleEntry(overrides = {}) {
    return Object.assign(
      {
        id: U.generateId('sch'),
        date: '',
        weekday: '',
        block: '',
        studentIds: [],
        azubiId: null, // dritte, einzelne Person (Rolle "azubi"), unabhängig von studentIds
        isManual: false,
        generatedAt: new Date().toISOString(),
        substitutionLog: [], // { originalStudentId, replacementStudentId, reason, appliedAt }
        substitutionRequests: [], // { studentId, requestedAt } — noch unbeantwortete Selbstmeldungen "brauche Vertretung"
      },
      overrides
    );
  }

  /**
   * Außerschulische Veranstaltung (z. B. Schulfest, Sporttag), organisiert vom
   * Administrator. Bewusst komplett getrennt vom regulären Dienstplan: zählt
   * nicht in die Fairness-/Dienststatistik hinein und wird nicht vom
   * Optimierungsalgorithmus verplant — Schüler:innen und Azubis tragen sich
   * freiwillig selbst ein, bis die optionale Höchstteilnehmerzahl erreicht ist.
   */
  function createEvent(overrides = {}) {
    const now = new Date().toISOString();
    return Object.assign(
      {
        id: U.generateId('evt'),
        title: '',
        description: '',
        date: U.toIsoDate(U.today()),
        startTime: '',
        endTime: '',
        location: '',
        capacity: null, // null = unbegrenzt
        participantIds: [],
        createdAt: now,
      },
      overrides
    );
  }

  /**
   * Sonstige, vom Administrator erstellte Aufgabe für Sanis/Azubis. Bewusst
   * ein "offener Pool" ohne feste Zuweisung: sichtbar für alle aktiven
   * Sanis/Azubis, wer sie erledigt hat, markiert sie selbst als "Erledigt"
   * (siehe `SSD.TasksService`).
   */
  function createTask(overrides = {}) {
    const now = new Date().toISOString();
    return Object.assign(
      {
        id: U.generateId('task'),
        title: '',
        description: '',
        dueDate: null, // 'YYYY-MM-DD' | null
        status: 'open', // 'open' | 'done'
        createdAt: now,
        completedAt: null,
        completedBy: null, // Schüler:in/Azubi-ID
      },
      overrides
    );
  }

  /**
   * Eintrag in der gemeinsamen Materialliste. Wird von Sanis/Azubis selbst
   * angelegt; eigene, noch offene Einträge dürfen von der anlegenden Person
   * bearbeitet/gelöscht werden, alles andere macht der Administrator (siehe
   * `SSD.MaterialService.canEdit`).
   */
  function createMaterialRequest(overrides = {}) {
    const now = new Date().toISOString();
    return Object.assign(
      {
        id: U.generateId('mat'),
        name: '',
        quantity: '', // bewusst Text, nicht Zahl — erlaubt z. B. "2 Packungen"
        note: '',
        requestedBy: null, // Schüler:in/Azubi-ID
        requestedAt: now,
        status: 'offen', // 'offen' | 'bestellt' | 'erledigt'
        updatedAt: now,
      },
      overrides
    );
  }

  /** Vollständiges, leeres Anwendungsdatenobjekt (Grundzustand vor Ersteinrichtung). */
  function createDefaultAppData() {
    const now = new Date().toISOString();
    return {
      version: DATA_VERSION,
      school: { name: 'Meine Schule' },
      admin: null, // wird im Setup-Assistenten gesetzt
      students: [],
      specialDays: [],
      dutyBlockConfig: createDefaultDutyBlockConfig(),
      settings: createDefaultSettings(),
      schedule: { entries: [] },
      events: [],
      tasks: [],
      materials: [],
      teamsOutbox: [], // { id, at, category, text, by } — wird serverseitig gesammelt an Teams gesendet
      meta: { createdAt: now, lastModifiedAt: now, setupComplete: false },
    };
  }

  return {
    DATA_VERSION,
    SPECIAL_DAY_TYPES,
    AVAILABILITY_STATES,
    GENDERS,
    ROLES,
    LEADERSHIP_ROLES,
    WEIGHT_LEVELS,
    createEmptyAvailability,
    createStudent,
    createSpecialDay,
    createDefaultDutyBlockConfig,
    createDefaultWeights,
    createDefaultTeamsSettings,
    createDefaultSettings,
    createScheduleEntry,
    createEvent,
    createTask,
    createMaterialRequest,
    createDefaultAppData,
  };
})();
