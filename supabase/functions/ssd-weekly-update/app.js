// ERZEUGT von tools/build-weekly-function.js — bitte nicht von Hand ändern.
// Enthält die App-Module für die Wochen-Aktualisierung in einer eigenen,
// abgeschlossenen Umgebung (kein DOM, keine Datenbankverbindung).

export function createApp(initialData) {
  const window = {};
  const document = { hidden: false, addEventListener() {} };
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const sessionStorage = localStorage;
  const location = { search: '', hash: '' };
  window.addEventListener = () => {};
  window.supabase = { createClient: () => ({}) };
  window.SSD = {};
  const SSD = window.SSD;
  SSD.SupabaseConfig = { URL: '', ANON_KEY: '' };

  // ---- js/core/utils.js ----
  /**
   * ============================================================================
   * SSD.Utils — allgemeine Hilfsfunktionen
   * ============================================================================
   * Sammlung reiner, zustandsloser Hilfsfunktionen, die von allen anderen
   * Modulen genutzt werden (Datum/Zeit, IDs, Validierung, Datei-Handling,
   * DOM-Helfer). Es gibt bewusst keine Abhängigkeiten zu anderen SSD.*-Modulen,
   * damit dieses Modul als erstes geladen werden kann.
   */
  window.SSD = window.SSD || {};

  SSD.Utils = (function () {
    'use strict';

    /* ---------------------------------------------------------------------
     * Konstanten: Wochentage & Dienstblöcke
     * ------------------------------------------------------------------- */

    /** Interne Schlüssel der fünf Schultage (Montag bis Freitag). */
    const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

    /** Anzeigename je Wochentag. */
    const WEEKDAY_LABELS = {
      mon: 'Montag', tue: 'Dienstag', wed: 'Mittwoch', thu: 'Donnerstag', fri: 'Freitag',
    };
    const WEEKDAY_LABELS_SHORT = {
      mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr',
    };

    /** Die vier Dienstblöcke der Schule inkl. Anzeigename und Sortierindex. */
    const DUTY_BLOCKS = [
      { key: 'b12', label: '1./2. Stunde', short: '1./2.', order: 0 },
      { key: 'b34', label: '3./4. Stunde', short: '3./4.', order: 1 },
      { key: 'b56', label: '5./6. Stunde', short: '5./6.', order: 2 },
      { key: 'b78', label: '7./8. Stunde', short: '7./8.', order: 3 },
    ];

    const DUTY_BLOCK_KEYS = DUTY_BLOCKS.map((b) => b.key);

    function blockLabel(blockKey) {
      const b = DUTY_BLOCKS.find((x) => x.key === blockKey);
      return b ? b.label : blockKey;
    }

    /* ---------------------------------------------------------------------
     * Datum / Zeit
     * ------------------------------------------------------------------- */

    /** Gibt YYYY-MM-DD (ISO, ohne Zeitzonen-Zeitanteil) für ein Date-Objekt zurück. */
    function toIsoDate(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    /** Parst ein 'YYYY-MM-DD'-Datum als lokales Datum (keine UTC-Verschiebung). */
    function parseIsoDate(iso) {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(y, m - 1, d);
    }

    /** Heutiges Datum ohne Uhrzeitanteil. */
    function today() {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }

    function addDays(date, days) {
      const d = new Date(date);
      d.setDate(d.getDate() + days);
      return d;
    }

    /**
     * Kalenderjahr, in dem das laufende Schuljahr endet (ab August zählt das
     * neue Schuljahr) — zugleich der früheste noch mögliche Abijahrgang.
     */
    function schoolYearEnd(date) {
      const d = date || new Date();
      return d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear();
    }

    /** Liefert den Montag der Woche, in der `date` liegt. */
    function getMondayOfWeek(date) {
      const d = new Date(date);
      const day = d.getDay(); // 0 = Sonntag, 1 = Montag, ...
      const diff = day === 0 ? -6 : 1 - day;
      return addDays(d, diff);
    }

    /** ISO-Kalenderwoche (grobe, für DE ausreichende Berechnung). */
    function getIsoWeekNumber(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    }

    function formatDateShort(date) {
      return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    }
    function formatDateLong(date) {
      return date.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    function formatDateMedium(date) {
      return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    function formatDateTime(date) {
      return date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    /** "Heute" / "Morgen" für ein ISO-Datum (YYYY-MM-DD), sonst `null` — für Dringlichkeits-Hinweise. */
    function relativeDayLabel(dateIso) {
      const now = today();
      if (dateIso === toIsoDate(now)) return 'Heute';
      if (dateIso === toIsoDate(addDays(now, 1))) return 'Morgen';
      return null;
    }

    function isSameDay(a, b) {
      return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }

    function isWeekend(date) {
      const day = date.getDay();
      return day === 0 || day === 6;
    }

    /** Wandelt einen JS-Wochentagsindex (0=So) in unseren Schlüssel um, oder null am Wochenende. */
    function weekdayKeyFromDate(date) {
      const day = date.getDay();
      const map = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' };
      return map[day] || null;
    }

    /** Liefert die 5 Datumsobjekte (Mo-Fr) der Woche, deren Montag übergeben wird. */
    function getWeekDates(monday) {
      return WEEKDAY_KEYS.map((_, i) => addDays(monday, i));
    }

    /** Anzahl ganzer Tage zwischen zwei Datumsangaben (b - a). */
    function dayDiff(a, b) {
      const msPerDay = 86400000;
      const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
      const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
      return Math.round((utcB - utcA) / msPerDay);
    }

    /* ---------------------------------------------------------------------
     * IDs & Zufall
     * ------------------------------------------------------------------- */

    /** Erzeugt eine kurze, kollisionsarme ID (kein UUID-Standard nötig, rein lokal). */
    function generateId(prefix) {
      const rand = Math.random().toString(36).slice(2, 9);
      const time = Date.now().toString(36).slice(-5);
      return `${prefix ? prefix + '_' : ''}${time}${rand}`;
    }

    /** Mulberry32 — deterministischer, schneller Pseudozufallsgenerator (für reproduzierbare Optimierungsläufe). */
    function createSeededRandom(seed) {
      let a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function shuffleInPlace(arr, rng) {
      const random = rng || Math.random;
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    /* ---------------------------------------------------------------------
     * Funktionale Helfer
     * ------------------------------------------------------------------- */

    function debounce(fn, wait) {
      let timer = null;
      return function debounced(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), wait);
      };
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max);
    }

    function deepClone(obj) {
      return obj == null ? obj : JSON.parse(JSON.stringify(obj));
    }

    /** Wartet einen Frame / Tick — wird genutzt, um lange Berechnungen für die UI zu "chunken". */
    function nextTick() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    function mean(values) {
      if (!values.length) return 0;
      return values.reduce((a, b) => a + b, 0) / values.length;
    }

    function standardDeviation(values) {
      if (values.length < 2) return 0;
      const m = mean(values);
      const variance = mean(values.map((v) => (v - m) ** 2));
      return Math.sqrt(variance);
    }

    /**
     * Einheitliche Fairness-Score-Formel (0-100), verwendet vom Planungs-
     * algorithmus, der Statistik-Ansicht und dem Vertretungsmodus, damit alle
     * drei Stellen exakt dieselbe Zahl berichten.
     */
    function fairnessScoreFromStdDev(stdDev) {
      return clamp(Math.round(100 - stdDev * 18), 0, 100);
    }

    function round(value, decimals = 1) {
      const f = 10 ** decimals;
      return Math.round(value * f) / f;
    }

    /* ---------------------------------------------------------------------
     * Text / Suche
     * ------------------------------------------------------------------- */

    /** Normalisiert Text für tolerante Suche (Kleinschreibung, ohne Umlaut-Sonderzeichen-Störung). */
    function normalizeForSearch(str) {
      return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
    }

    /**
     * Erzeugt aus einem Namen einen zulässigen Benutzernamen-Baustein.
     * Deutsche Umlaute werden nach der üblichen Konvention transliteriert
     * (ä→ae, ö→oe, ü→ue, ß→ss) statt einfach entfernt zu werden — sonst würde
     * z. B. "Krüger" zu "krger" statt zum erwarteten "krueger".
     */
    function slugifyUsername(text) {
      return String(text || '')
        .toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // übrige Akzente (é, à, ç, …) entfernen
        .replace(/[^a-z0-9._-]/g, '');
    }

    function initials(firstName, lastName) {
      const a = (firstName || '').trim().charAt(0);
      const b = (lastName || '').trim().charAt(0);
      return (a + b).toUpperCase() || '?';
    }

    function escapeHtml(str) {
      return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    }

    /** Erzeugt aus einem String eine stabile Pastellfarbe (für Avatare). */
    function colorFromString(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash) % 360;
      return `hsl(${hue}, 58%, 48%)`;
    }

    /* ---------------------------------------------------------------------
     * Validierung
     * ------------------------------------------------------------------- */

    /** Hinweis an Freitextfeldern (Bemerkungen, Pinnwand, Tagesordnung …) — Datensparsamkeit. */
    const FREE_TEXT_HINT = 'Bitte keine Gesundheitsangaben, Noten oder privaten Details eintragen.';

    const Validate = {
      required(value) {
        return value !== null && value !== undefined && String(value).trim() !== '';
      },
      minLength(value, len) {
        return String(value || '').trim().length >= len;
      },
      isInteger(value) {
        return Number.isInteger(Number(value));
      },
      inRange(value, min, max) {
        const n = Number(value);
        return n >= min && n <= max;
      },
      usernameFormat(value) {
        return /^[a-zA-Z0-9._-]{3,32}$/.test(String(value || ''));
      },
    };

    /* ---------------------------------------------------------------------
     * Datei-Handling (Download / Upload) — funktioniert auch unter file://
     * ------------------------------------------------------------------- */

    /** Startet einen Client-seitigen Download über einen temporären Object-URL-Link. */
    function downloadBlob(filename, content, mimeType) {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    /** Liest eine vom Nutzer ausgewählte Datei als Text ein (Promise-basiert). */
    function readFileAsText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, 'utf-8');
      });
    }

    /** Öffnet einen unsichtbaren Datei-Auswahldialog und liefert die gewählte Datei. */
    function pickFile(accept) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept || '*';
        input.style.display = 'none';
        input.addEventListener('change', () => {
          resolve(input.files && input.files[0] ? input.files[0] : null);
          document.body.removeChild(input);
        }, { once: true });
        document.body.appendChild(input);
        input.click();
      });
    }

    /* ---------------------------------------------------------------------
     * Kleine DOM-Helfer
     * ------------------------------------------------------------------- */

    /** Erzeugt ein DOM-Element inkl. Attributen/Klassen/Inhalt (leichtgewichtiger h()-Helfer). */
    function el(tag, attrs, children) {
      const node = document.createElement(tag);
      if (attrs) {
        for (const [key, value] of Object.entries(attrs)) {
          if (key === 'class') node.className = value;
          else if (key === 'html') { if (value !== undefined && value !== null && value !== false) node.innerHTML = value; }
          else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value);
          } else if (value !== undefined && value !== null && value !== false) {
            node.setAttribute(key, value === true ? '' : value);
          }
        }
      }
      (children || []).forEach((child) => {
        if (child == null) return;
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
      });
      return node;
    }

    function qs(selector, root) { return (root || document).querySelector(selector); }
    function qsa(selector, root) { return Array.from((root || document).querySelectorAll(selector)); }

    return {
      FREE_TEXT_HINT,
      WEEKDAY_KEYS, WEEKDAY_LABELS, WEEKDAY_LABELS_SHORT,
      DUTY_BLOCKS, DUTY_BLOCK_KEYS, blockLabel,
      toIsoDate, parseIsoDate, today, addDays, schoolYearEnd, getMondayOfWeek, getIsoWeekNumber,
      formatDateShort, formatDateLong, formatDateMedium, formatDateTime, relativeDayLabel,
      isSameDay, isWeekend, weekdayKeyFromDate, getWeekDates, dayDiff,
      generateId, createSeededRandom, shuffleInPlace,
      debounce, clamp, deepClone, nextTick, mean, standardDeviation, round, fairnessScoreFromStdDev,
      normalizeForSearch, slugifyUsername, initials, escapeHtml, colorFromString,
      Validate,
      downloadBlob, readFileAsText, pickFile,
      el, qs, qsa,
    };
  })();

  // ---- js/core/eventBus.js ----
  /**
   * ============================================================================
   * SSD.EventBus — einfacher Publish/Subscribe-Mechanismus
   * ============================================================================
   * Entkoppelt Module voneinander: Der Store meldet Datenänderungen, ohne die
   * UI-Module zu kennen; UI-Module abonnieren die für sie relevanten Events.
   */
  window.SSD = window.SSD || {};

  SSD.EventBus = (function () {
    'use strict';

    const listeners = new Map(); // eventName -> Set<callback>

    function on(eventName, callback) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(callback);
      return () => off(eventName, callback);
    }

    function off(eventName, callback) {
      if (listeners.has(eventName)) listeners.get(eventName).delete(callback);
    }

    function emit(eventName, payload) {
      if (!listeners.has(eventName)) return;
      // Kopie iterieren, damit sich ein Listener während der Ausführung sicher abmelden kann.
      Array.from(listeners.get(eventName)).forEach((cb) => {
        try {
          cb(payload);
        } catch (err) {
          console.error(`[EventBus] Fehler in Listener für "${eventName}":`, err);
        }
      });
    }

    return { on, off, emit };
  })();

  // ---- js/core/models.js ----
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

    // "n" = keine Angabe: Das Geschlecht wird nur für die Gewichtung "gemischte Teams"
    // genutzt; ohne Angabe zählt die Person dort weder als gleich noch als verschieden.
    const GENDERS = [
      { key: 'n', label: 'Keine Angabe' },
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
          username: '', // Passwörter liegen nur serverseitig (bcrypt), nie im Datenbestand
          firstName: '',
          lastName: '',
          role: 'student', // 'student' | 'azubi'
          leadershipRole: null, // null | 'sanisprecher' | 'vize_sanisprecher'
          gender: 'n',
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
          availabilityReminderAt: null, // Erinnerung durch Admin/Team-Leitung — Hinweis bis zur nächsten Änderung/Bestätigung
          // Abweichende Verfügbarkeit für einzelne Wochen: { 'YYYY-MM-DD' (Montag): { mon: [...], … } }.
          // Ohne Eintrag gilt für eine Woche die Standardwoche `availability`.
          availabilityWeeks: {},
          exams: [], // Klausuren/Termine, siehe createExam — sperren die Person für diese Zeit
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
        // Meldet sich jemand selbst ab ("Ich falle aus"), teilt die App sofort eine
        // verfügbare Vertretung ein; aus = Dienst bleibt als "Vertretung gesucht" offen.
        autoSubstitution: true,
        // Engagement-Übersicht (Zahlen aller Personen) auch für Sanisprecher:innen — entscheidet die Schule.
        leadsSeeEngagement: true,
        weeklyUpdate: createDefaultWeeklyUpdateSettings(),
        weights: createDefaultWeights(),
        yearGroupMode: 'none', // 'none' | 'mixed' | 'same'
        yearGroupRules: [], // { id, a, b, type: 'prefer' | 'avoid' } — a/b = Abijahrgang
        pairRules: [], // { id, a, b, type: 'prefer' | 'never' } — a/b = Personen-IDs
        // Der Schulcode liegt wie alle Passwörter nur serverseitig (ssd_set_registration_code).
        teams: createDefaultTeamsSettings(),
        privacy: createDefaultPrivacySettings(),
        retention: createDefaultRetentionSettings(),
      };
    }

    /**
     * Teams-Benachrichtigungen. Die geheime Workflow-Adresse und der Link für
     * den Button in der Teams-Nachricht stehen bewusst NICHT hier, sondern im
     * Supabase Vault. `nameStyle`: 'short' = "Lena C." (Datensparsamkeit), 'full' = voller Name.
     */
    function createDefaultTeamsSettings() {
      return {
        enabled: false,
        nameStyle: 'short',
        categories: { schedule: true, substitution: true, meeting: true, event: true, task: true, material: true },
        eventReminders: createDefaultEventReminderSettings(),
      };
    }

    /**
     * Teams-Erinnerungen an Veranstaltungen (siehe SSD.EventReminderService).
     * `days`: so viele Tage vorher wird immer erinnert; `openDays`: zusätzlich,
     * solange noch nicht alle Plätze belegt sind. Die Standardwerte stehen auch in
     * der Datenbankfunktion `ssd_private.event_reminder_items`.
     */
    function createDefaultEventReminderSettings() {
      return { enabled: true, days: [7, 1], openDays: [14, 3], time: '16:00' };
    }

    /**
     * Angaben für die Datenschutzhinweise (Seite "Datenschutz", ohne Anmeldung
     * erreichbar). Füllt die Schule in den Einstellungen aus.
     * legalBasis: 'school' (Schulgesetz) | 'consent' (Einwilligung) | 'custom' (eigener Text).
     */
    function createDefaultPrivacySettings() {
      return {
        controller: '', // Name und Anschrift der Schule
        contact: '', // Ansprechperson, z. B. betreuende Lehrkraft
        dpo: '', // Kontakt der/des Datenschutzbeauftragten
        authority: '', // zuständige Aufsichtsbehörde
        legalBasis: 'school',
        legalBasisText: '',
        imprintUrl: '',
      };
    }

    /**
     * Aufbewahrung: Dienst-, Vertretungs- und Teamdaten eines Schuljahres
     * (1.8.–31.7.) werden `graceMonths` Monate nach Schuljahresende gelöscht —
     * Zeit genug, um vorher die Engagement-Nachweise zu drucken.
     */
    /**
     * Wochen-Aktualisierung: Jeden Sonntag um 12 Uhr prüft der Server die
     * kommende Woche und sucht nur für Dienste Ersatz, deren Person gesperrt ist
     * (Klausur, "Gesperrt" in der Verfügbarkeit, Konto deaktiviert). Der übrige
     * Plan bleibt unverändert. `lastRunWeek` = Montag der zuletzt geprüften Woche.
     */
    function createDefaultWeeklyUpdateSettings() {
      // Standardmäßig aus: Erst wenn der Administrator sie einschaltet, ändert sie den Plan.
      return { enabled: false, lastRunWeek: null, lastRunAt: null, lastSummary: null };
    }

    /**
     * Klausur oder fester Termin einer Person: von `startDate` bis `endDate`
     * (je einschließlich), in den Blöcken `blocks` (leer = ganzer Tag).
     */
    function createExam(overrides = {}) {
      const today = U.toIsoDate(U.today());
      return Object.assign(
        {
          id: U.generateId('exm'),
          title: '',
          startDate: today,
          endDate: today,
          blocks: [],
          createdAt: new Date().toISOString(),
        },
        overrides
      );
    }

    function createDefaultRetentionSettings() {
      return { graceMonths: 2, auto: true, lastRunAt: null };
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
     * Sonstige Aufgabe für Sanis/Azubis, angelegt vom Administrator oder von
     * Sanisprecher:innen. Bewusst ein "offener Pool" ohne feste Zuweisung:
     * sichtbar für alle aktiven Sanis/Azubis, wer sie erledigt hat, markiert
     * sie selbst als "Erledigt" (siehe `SSD.TasksService`).
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
          createdBy: null, // null = Administrator, sonst ID der Sanisprecher:in
          completedAt: null,
          completedBy: null, // Schüler:in/Azubi-ID
        },
        overrides
      );
    }

    /**
     * Beitrag auf der Pinnwand: kurze Mitteilung, die alle Sanis/Azubis nach
     * dem Anmelden oben im Dashboard sehen (siehe `SSD.AnnouncementsService`).
     */
    function createAnnouncement(overrides = {}) {
      const now = new Date().toISOString();
      return Object.assign(
        {
          id: U.generateId('ann'),
          title: '',
          text: '',
          important: false, // wird hervorgehoben und oben angeheftet
          visibleUntil: null, // 'YYYY-MM-DD' | null = unbegrenzt sichtbar
          createdAt: now,
          updatedAt: now,
          createdBy: null, // null = Administrator, sonst ID der Sanisprecher:in
        },
        overrides
      );
    }

    /**
     * Internes Teamtreffen. Eingeladen sind alle aktiven Sanis/Azubis; sie
     * sagen zu oder ab, die Team-Koordination erfasst danach die Anwesenheit
     * (siehe `SSD.MeetingsService`).
     */
    function createMeeting(overrides = {}) {
      const now = new Date().toISOString();
      return Object.assign(
        {
          id: U.generateId('mtg'),
          title: '',
          date: U.toIsoDate(U.today()),
          startTime: '',
          endTime: '',
          location: '',
          agenda: '',
          createdAt: now,
          createdBy: null, // null = Administrator, sonst ID der Sanisprecher:in
          responses: [], // { personId, status: 'yes' | 'no', at }
          attendanceTaken: false,
          attendanceTakenAt: null,
          attendeeIds: [],
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
        announcements: [],
        meetings: [],
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
      createDefaultEventReminderSettings,
      createDefaultPrivacySettings,
      createDefaultRetentionSettings,
      createDefaultWeeklyUpdateSettings,
      createExam,
      createDefaultSettings,
      createScheduleEntry,
      createEvent,
      createTask,
      createMaterialRequest,
      createAnnouncement,
      createMeeting,
      createDefaultAppData,
    };
  })();

  // ---- js/core/storage.js ----
  /**
   * ============================================================================
   * SSD.Storage — Persistenzschicht (Supabase-Cloud-Datenbank + JSON-Dateien)
   * ============================================================================
   * Kapselt sämtlichen Zugriff auf die gemeinsame Datenablage. Die Anwendung
   * arbeitet weiterhin mit einem einzigen JSON-Objekt (siehe
   * `js/core/models.js`), das in genau einer Zeile der Supabase-Tabelle
   * `ssd_dienstplan_state` liegt — alle Geräte sehen denselben Stand.
   *
   * Zugriffsschutz: Die Tabelle selbst ist für den öffentlichen Schlüssel
   * gesperrt. Gelesen und geschrieben wird ausschließlich über Datenbank-
   * funktionen (`ssd_load`, `ssd_save` …, siehe supabase/migrations), die eine
   * gültige Sitzung verlangen. Die Sitzung entsteht beim Login auf dem Server
   * (`ssd_login`, Passwortprüfung mit bcrypt); der Browser kennt nur ein
   * zufälliges Token. Jede Rolle bekommt nur, was sie braucht, und darf nur
   * speichern, was sie ändern darf — das prüft der Server, nicht der Browser.
   *
   * Nebenläufigkeit: `save()` nutzt eine optimistische Versionsprüfung. Hat
   * zwischenzeitlich jemand anderes gespeichert, liefert der Server den
   * aktuellen Stand zurück, statt fremde Änderungen zu überschreiben.
   *
   * Live-Aktualisierung: Nach jeder Änderung schickt die Datenbank nur die neue
   * Versionsnummer (Realtime-Broadcast, keine Daten); die App lädt dann über
   * `ssd_load` nach. Zusätzlich fragt sie jede Minute die Version ab, falls die
   * Live-Verbindung ausfällt.
   */
  window.SSD = window.SSD || {};

  SSD.Storage = (function () {
    'use strict';

    const { URL: SUPABASE_URL, ANON_KEY } = SSD.SupabaseConfig;
    const POLL_INTERVAL_MS = 60000;

    // Kein Supabase-Auth: Die Bibliothek soll nichts im Browser speichern.
    const client = window.supabase.createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // Frühere Versionen legten eine Vollkopie aller Daten im Browser ab — einmalig entfernen.
    try { localStorage.removeItem('ssd_schulsanitaetsdienst_dienstplan_v1__localbackup'); } catch (err) { /* ignore */ }

    let cachedData = null;
    let lastKnownVersion = null;

    /** Fehler, wenn die Sitzung abgelaufen oder ungültig ist (z. B. Konto deaktiviert). */
    class SessionError extends Error {
      constructor() {
        super('Die Sitzung ist abgelaufen. Bitte erneut anmelden.');
        this.sessionExpired = true;
      }
    }

    function token() {
      const session = SSD.Auth.getSession();
      return session ? session.token || null : null;
    }

    /** Ruft eine Datenbankfunktion auf. Netzwerk- und Serverfehler werden als Error geworfen. */
    async function call(name, params) {
      const { data, error } = await client.rpc(name, params || {});
      if (error) throw new Error(error.message || 'Unbekannter Datenbankfehler');
      return data;
    }

    /** Öffentliche Angaben für Anmeldeseite und Datenschutzhinweise — ohne personenbezogene Daten. */
    async function fetchPublicInfo() {
      return call('ssd_public_info');
    }

    async function fetchState() {
      const res = await call('ssd_load', { p_token: token() });
      if (!res || !res.ok) throw new SessionError();
      return { data: migrateIfNeeded(res.data), version: res.version };
    }

    /**
     * Lädt den Stand, den die angemeldete Person sehen darf. Wirft bei
     * Netzwerkfehlern einen Error und bei ungültiger Sitzung einen SessionError.
     */
    async function load() {
      const { data, version } = await fetchState();
      cachedData = data;
      lastKnownVersion = version;
      return cachedData;
    }

    /**
     * Speichert einen Zustand.
     * @returns {Promise<{ok: true} | {ok: false, conflict?: boolean, remote?: {data, version}, session?: boolean, error?: any}>}
     */
    async function save(data) {
      data.meta = data.meta || {};
      data.meta.lastModifiedAt = new Date().toISOString();

      try {
        const res = await call('ssd_save', { p_token: token(), p_data: data, p_expected_version: lastKnownVersion });
        if (res && res.ok) {
          lastKnownVersion = res.version;
          cachedData = data;
          SSD.EventBus.emit('storage:saved', { at: data.meta.lastModifiedAt });
          return { ok: true };
        }
        if (res && res.conflict) {
          // Jemand anderes hat zwischenzeitlich gespeichert — dessen Stand übernimmt der Aufrufer.
          SSD.EventBus.emit('storage:conflict', {});
          return { ok: false, conflict: true, remote: { data: migrateIfNeeded(res.data), version: res.version } };
        }
        if (res && res.error === 'session') {
          SSD.EventBus.emit('auth:expired', {});
          return { ok: false, session: true };
        }
        const error = new Error((res && res.error) || 'Speichern fehlgeschlagen');
        SSD.EventBus.emit('storage:error', { error });
        return { ok: false, error };
      } catch (err) {
        // z. B. keine Internetverbindung — nie eine unbehandelte Promise-Ablehnung
        // aus dem "fire-and-forget"-Aufruf in SSD.Store werden lassen.
        SSD.EventBus.emit('storage:error', { error: err });
        return { ok: false, error: err };
      }
    }

    /**
     * Live-Abonnement auf Änderungen anderer Personen. Ruft
     * `onRemoteChange(newData, newVersion)` auf, sobald eine neuere Version
     * vorliegt. Übernimmt die Version bewusst NICHT selbst in
     * `lastKnownVersion` — das entscheidet der Aufrufer (`SSD.Store`), damit
     * eine noch nicht übernommene Änderung beim nächsten eigenen Speichern
     * zuverlässig als Konflikt erkannt wird.
     * @returns {Function} beendet das Abonnement
     */
    function subscribeToRemoteChanges(onRemoteChange) {
      let fetching = false;
      let stopped = false;

      async function refreshIfNewer(version) {
        if (stopped || fetching) return;
        if (version != null && version <= (lastKnownVersion || 0)) return;
        fetching = true;
        try {
          const remote = await fetchState();
          if (!stopped && remote.version > (lastKnownVersion || 0)) onRemoteChange(remote.data, remote.version);
        } catch (err) {
          if (err.sessionExpired) SSD.EventBus.emit('auth:expired', {});
        } finally {
          fetching = false;
        }
      }

      const channel = client
        .channel('ssd_state')
        .on('broadcast', { event: 'state_changed' }, (message) => {
          const version = message && message.payload ? Number(message.payload.version) : null;
          refreshIfNewer(Number.isFinite(version) ? version : null);
        })
        .subscribe();

      const poll = setInterval(async () => {
        if (stopped || document.hidden) return;
        try {
          const res = await call('ssd_version', { p_token: token() });
          if (res && res.ok) refreshIfNewer(res.version);
          else if (res && res.error === 'session') SSD.EventBus.emit('auth:expired', {});
        } catch (err) { /* offline — nächster Versuch beim nächsten Intervall */ }
      }, POLL_INTERVAL_MS);

      return () => {
        stopped = true;
        clearInterval(poll);
        client.removeChannel(channel);
      };
    }

    function setKnownVersion(version) { lastKnownVersion = version; }
    function getKnownVersion() { return lastKnownVersion || 0; }

    /** Vergisst den geladenen Stand (Abmelden). */
    function forget() {
      cachedData = null;
      lastKnownVersion = null;
    }

    /**
     * Status des serverseitigen Teams-Versands (Tabelle `ssd_teams_status`,
     * siehe Supabase-Migration "ssd_teams_notifications") — enthält nur
     * Zeitstempel/Anzahl/Fehlertext, keine Geheimnisse. `null`, falls (noch)
     * nicht verfügbar.
     */
    async function fetchTeamsStatus() {
      try {
        const { data, error } = await client.from('ssd_teams_status').select('*').eq('id', 1).maybeSingle();
        return error ? null : data;
      } catch (err) {
        return null;
      }
    }

    /** Löst den Download der aktuellen Daten als formatierte JSON-Datei aus. */
    function exportJsonFile(data, filename) {
      const pretty = JSON.stringify(data, null, 2);
      const stamp = SSD.Utils.toIsoDate(new Date());
      SSD.Utils.downloadBlob(filename || `dienstplan_export_${stamp}.json`, pretty, 'application/json');
    }

    /**
     * Liest eine vom Benutzer gewählte JSON-Datei ein und prüft grob deren
     * Struktur. Wirft bei ungültigem Format einen Fehler mit verständlicher
     * Meldung (wird von der aufrufenden UI als Toast angezeigt).
     */
    async function importJsonFile(file) {
      const text = await SSD.Utils.readFileAsText(file);
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error('Die Datei enthält kein gültiges JSON.');
      }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.students)) {
        throw new Error('Die Datei entspricht nicht dem erwarteten Dienstplan-Datenformat.');
      }
      return migrateIfNeeded(parsed);
    }

    /** Platz für künftige Datenmigrationen, falls sich das Format zwischen Versionen ändert. */
    function migrateIfNeeded(data) {
      if (!data.version || data.version < SSD.Models.DATA_VERSION) {
        data.version = SSD.Models.DATA_VERSION;
      }
      // Fehlende Teilbäume defensiv auffüllen, damit ältere/unvollständige
      // Exporte nicht zu Laufzeitfehlern in der UI führen.
      const defaults = SSD.Models.createDefaultAppData();
      data.school = data.school || defaults.school;
      data.dutyBlockConfig = data.dutyBlockConfig || defaults.dutyBlockConfig;

      const storedSettings = data.settings || {};
      data.settings = Object.assign({}, defaults.settings, storedSettings);
      data.settings.weights = Object.assign({}, defaults.settings.weights, storedSettings.weights || {});
      // Früherer Schalter "Gemischte Paare bevorzugen" lebt jetzt als Gewichtungsstufe weiter.
      if (!storedSettings.weights && storedSettings.preferMixedGender === false) data.settings.weights.genderMix = 0;
      delete data.settings.preferMixedGender;
      // Zugangsgeheimnisse gehören nie in den Datenbestand (liegen serverseitig).
      delete data.settings.registrationCodeHash;
      delete data.settings.registrationCodeSalt;
      if (!Array.isArray(data.settings.yearGroupRules)) data.settings.yearGroupRules = [];
      if (!Array.isArray(data.settings.pairRules)) data.settings.pairRules = [];
      const storedTeams = storedSettings.teams || {};
      data.settings.teams = Object.assign({}, defaults.settings.teams, storedTeams, {
        categories: Object.assign({}, defaults.settings.teams.categories, storedTeams.categories || {}),
        eventReminders: Object.assign({}, defaults.settings.teams.eventReminders, storedTeams.eventReminders || {}),
      });
      data.settings.privacy = Object.assign({}, defaults.settings.privacy, storedSettings.privacy || {});
      data.settings.retention = Object.assign({}, defaults.settings.retention, storedSettings.retention || {});
      data.settings.weeklyUpdate = Object.assign({}, defaults.settings.weeklyUpdate, storedSettings.weeklyUpdate || {});
      if (!Array.isArray(data.teamsOutbox)) data.teamsOutbox = [];
      if (data.admin && typeof data.admin === 'object') {
        delete data.admin.passwordHash;
        delete data.admin.salt;
      }

      data.students = Array.isArray(data.students) ? data.students : [];
      data.students.forEach((s) => {
        delete s.passwordHash;
        delete s.salt;
        if (!Array.isArray(s.preferredPartnerIds)) s.preferredPartnerIds = [];
        if (s.availabilityReminderAt === undefined) s.availabilityReminderAt = null;
        if (!s.gender) s.gender = 'n';
        // Neue, rein ergänzende Felder — vorhandene Verfügbarkeiten bleiben unverändert.
        if (!s.availabilityWeeks || typeof s.availabilityWeeks !== 'object' || Array.isArray(s.availabilityWeeks)) s.availabilityWeeks = {};
        if (!Array.isArray(s.exams)) s.exams = [];
      });
      data.schedule = data.schedule || defaults.schedule;
      // Frühere Versionen konnten "Krankheit" als Abwesenheitsgrund speichern (Gesundheitsangabe).
      (data.schedule.entries || []).forEach((entry) => {
        (entry.substitutionLog || []).forEach((log) => {
          if (/krank/i.test(log.reason || '')) log.reason = 'Abwesenheit';
        });
      });
      data.specialDays = data.specialDays || [];
      data.events = data.events || [];
      data.tasks = data.tasks || [];
      data.tasks.forEach((t) => {
        if (t.createdBy === undefined) t.createdBy = null; // ältere Aufgaben stammen alle vom Administrator
      });
      data.materials = data.materials || [];
      data.announcements = Array.isArray(data.announcements) ? data.announcements : [];
      data.meetings = Array.isArray(data.meetings) ? data.meetings : [];
      data.meetings.forEach((m) => {
        if (!Array.isArray(m.responses)) m.responses = [];
        if (!Array.isArray(m.attendeeIds)) m.attendeeIds = [];
      });
      data.meta = Object.assign({}, defaults.meta, data.meta || {});
      return data;
    }

    function getStorageUsageInfo() {
      try {
        const raw = cachedData ? JSON.stringify(cachedData) : '';
        const bytes = new Blob([raw]).size;
        return { bytes, kb: SSD.Utils.round(bytes / 1024, 1) };
      } catch (err) {
        return { bytes: 0, kb: 0 };
      }
    }

    return {
      call, fetchPublicInfo,
      load, save, forget, subscribeToRemoteChanges, setKnownVersion, getKnownVersion, fetchTeamsStatus,
      exportJsonFile, importJsonFile, migrateIfNeeded,
      getStorageUsageInfo,
    };
  })();

  // ---- js/modules/availabilityService.js ----
  /**
   * ============================================================================
   * SSD.AvailabilityService — Verfügbarkeit nach Woche & Klausuren
   * ============================================================================
   * Die Verfügbarkeit einer Person ergibt sich für einen Dienst aus drei Ebenen
   * (die erste zutreffende gewinnt):
   *   1. Klausur/Termin (`student.exams`) → "gesperrt"
   *   2. Eintrag für genau diese Woche (`student.availabilityWeeks[Montag]`)
   *   3. Standardwoche (`student.availability`)
   * Planung, Vertretungen und die Wochen-Aktualisierung fragen ausschließlich
   * `stateAt()` — so gilt überall dieselbe Regel.
   *
   * Bearbeiten: Sanis ändern die eigenen Angaben (Standardwoche und einzelne
   * Wochen nur bis zur Änderungsfrist der jeweiligen Woche, Klausuren jederzeit),
   * der Administrator die aller Personen ohne Frist. Der Server lässt fremde
   * Angaben ohnehin nur vom Administrator ändern (ssd_private.merge_incoming).
   */
  window.SSD = window.SSD || {};

  SSD.AvailabilityService = (function () {
    'use strict';

    const U = SSD.Utils;
    const WEEKS_AHEAD = 8; // so viele Wochen im Voraus lassen sich einzeln eintragen
    const STATES = ['available', 'unavailable', 'blocked'];
    const MAX_EXAM_DAYS = 31;

    function toDate(value) {
      return value instanceof Date ? value : U.parseIsoDate(value);
    }

    /** Montag der Woche als 'YYYY-MM-DD'. */
    function mondayIso(value) {
      return U.toIsoDate(U.getMondayOfWeek(toDate(value)));
    }

    function examCovers(exam, dateIso, blockKey) {
      if (!exam || !exam.startDate || dateIso < exam.startDate || dateIso > (exam.endDate || exam.startDate)) return false;
      return !exam.blocks || !exam.blocks.length || exam.blocks.includes(blockKey);
    }

    /** Klausur/Termin, der die Person zu diesem Zeitpunkt sperrt (oder null). */
    function examAt(student, dateIso, blockKey) {
      return (student.exams || []).find((exam) => examCovers(exam, dateIso, blockKey)) || null;
    }

    /**
     * Verfügbarkeit einer Person für einen Dienst: 'available' | 'unavailable' | 'blocked'.
     * `weekday`/`weekMonday` sind optional (Planungs-Slots bringen sie schon mit).
     */
    function stateAt(student, dateIso, blockKey, weekday, weekMonday) {
      if (!student) return 'unavailable';
      if (examAt(student, dateIso, blockKey)) return 'blocked';
      const day = weekday || U.weekdayKeyFromDate(U.parseIsoDate(dateIso));
      const blockIdx = U.DUTY_BLOCK_KEYS.indexOf(blockKey);
      const week = student.availabilityWeeks && student.availabilityWeeks[weekMonday || mondayIso(dateIso)];
      const row = (week && week[day]) || (student.availability && student.availability[day]);
      return (row && row[blockIdx]) || 'unavailable';
    }

    /** Warum ist die Person (nicht) verfügbar? Für Hinweise in der Oberfläche. */
    function reasonAt(student, dateIso, blockKey) {
      const exam = examAt(student, dateIso, blockKey);
      if (exam) return { state: 'blocked', source: 'exam', exam };
      const monday = mondayIso(dateIso);
      const isWeek = !!(student.availabilityWeeks && student.availabilityWeeks[monday]);
      return { state: stateAt(student, dateIso, blockKey), source: isWeek ? 'week' : 'template' };
    }

    /** Raster einer Woche (Kopie): eigener Wocheneintrag, sonst die Standardwoche. */
    function weekGrid(student, monday) {
      const week = monday && student.availabilityWeeks && student.availabilityWeeks[monday];
      const source = week || student.availability || SSD.Models.createEmptyAvailability();
      const grid = {};
      U.WEEKDAY_KEYS.forEach((day) => { grid[day] = (source[day] || U.DUTY_BLOCK_KEYS.map(() => 'unavailable')).slice(); });
      return { grid, isOverride: !!week };
    }

    /** Hat die Person überhaupt irgendwo "verfügbar" eingetragen (Standardwoche oder eine kommende Woche)? */
    function hasAnyAvailable(student) {
      const has = (grid) => Object.values(grid || {}).some((day) => Array.isArray(day) && day.includes('available'));
      if (has(student.availability)) return true;
      const thisMonday = mondayIso(U.today());
      return Object.keys(student.availabilityWeeks || {}).some((monday) => monday >= thisMonday && has(student.availabilityWeeks[monday]));
    }

    /* ---------------------------------------------------------------------
     * Wochen & Fristen
     * ------------------------------------------------------------------- */

    /** Frist für Sanis: Eine Woche ist bis `Änderungsfrist` Tage vor ihrem Montag änderbar. */
    function weekLock(monday, refDate) {
      const ref = refDate || U.today();
      const deadlineDays = U.clamp(Number(SSD.Store.getState().settings.changeDeadlineDaysBeforeWeek) || 0, 0, 6);
      const lockDate = U.addDays(U.parseIsoDate(monday), -deadlineDays);
      return { editable: ref < lockDate, lockDate };
    }

    /**
     * Die kommenden Wochen zum Eintragen. Mit `includeCurrent` (Administrator)
     * zusätzlich die laufende Woche.
     * @returns {Array<{monday:string, label:string, short:string, editable:boolean, lockDate:Date, isCurrent:boolean}>}
     */
    function upcomingWeeks(options) {
      const opts = options || {};
      const today = U.today();
      const thisMonday = U.getMondayOfWeek(today);
      const weeks = [];
      for (let i = opts.includeCurrent ? 0 : 1; i <= WEEKS_AHEAD; i++) {
        const mondayDate = U.addDays(thisMonday, i * 7);
        const monday = U.toIsoDate(mondayDate);
        const lock = weekLock(monday, today);
        weeks.push({
          monday,
          isCurrent: i === 0,
          short: `KW ${U.getIsoWeekNumber(mondayDate)}`,
          label: `KW ${U.getIsoWeekNumber(mondayDate)} · ${U.formatDateShort(mondayDate)}–${U.formatDateShort(U.addDays(mondayDate, 4))}`,
          editable: lock.editable,
          lockDate: lock.lockDate,
        });
      }
      return weeks;
    }

    function assertCanEdit(studentId) {
      if (SSD.Auth.isAdminSession()) return;
      if (SSD.Auth.currentPersonId() !== studentId) throw new Error('Verfügbarkeiten anderer Personen kann nur der Administrator ändern.');
    }

    /**
     * Setzt einen Block. `scope` = 'template' (Standardwoche) oder der Montag einer
     * Woche — dann entsteht beim ersten Ändern ein eigener Wocheneintrag als Kopie
     * der Standardwoche.
     */
    function setCell(studentId, scope, day, blockIdx, newState) {
      assertCanEdit(studentId);
      if (!STATES.includes(newState)) throw new Error('Ungültiger Wert.');
      if (!SSD.Auth.isAdminSession()) {
        const open = scope === 'template' ? SSD.StudentService.getAvailabilityWindow().isOpen : weekLock(scope).editable;
        if (!open) throw new Error('Die Änderungsfrist für diese Woche ist abgelaufen.');
      }
      SSD.Store.commit(scope === 'template' ? 'Verfügbarkeit geändert' : `Verfügbarkeit für die Woche ab ${U.formatDateShort(U.parseIsoDate(scope))} geändert`, (draft) => {
        const student = draft.students.find((s) => s.id === studentId);
        if (!student) return;
        if (scope === 'template') {
          student.availability[day][blockIdx] = newState;
        } else {
          if (!student.availabilityWeeks || typeof student.availabilityWeeks !== 'object') student.availabilityWeeks = {};
          if (!student.availabilityWeeks[scope]) student.availabilityWeeks[scope] = weekGrid(student, null).grid;
          student.availabilityWeeks[scope][day][blockIdx] = newState;
        }
        student.availabilityUpdatedAt = new Date().toISOString();
      });
    }

    /** Eigenen Wocheneintrag verwerfen — die Woche richtet sich dann wieder nach der Standardwoche. */
    function resetWeek(studentId, monday) {
      assertCanEdit(studentId);
      if (!SSD.Auth.isAdminSession() && !weekLock(monday).editable) throw new Error('Die Änderungsfrist für diese Woche ist abgelaufen.');
      SSD.Store.commit('Woche auf Standardwoche zurückgesetzt', (draft) => {
        const student = draft.students.find((s) => s.id === studentId);
        if (student && student.availabilityWeeks) delete student.availabilityWeeks[monday];
      });
    }

    /* ---------------------------------------------------------------------
     * Klausuren & feste Termine
     * ------------------------------------------------------------------- */

    function getExams(student) {
      return (student.exams || []).slice().sort((a, b) => (a.startDate + (a.blocks || []).join()).localeCompare(b.startDate + (b.blocks || []).join()));
    }

    function upcomingExams(student) {
      const todayIso = U.toIsoDate(U.today());
      return getExams(student).filter((exam) => (exam.endDate || exam.startDate) >= todayIso);
    }

    /** "Mo, 30.11., 1./2. + 3./4. Stunde" bzw. "Mo, 30.11. – Mi, 02.12., ganzer Tag" */
    function describeExam(exam) {
      const day = (iso) => `${U.WEEKDAY_LABELS_SHORT[U.weekdayKeyFromDate(U.parseIsoDate(iso))] || ''}, ${U.formatDateShort(U.parseIsoDate(iso))}`;
      const range = exam.endDate && exam.endDate !== exam.startDate ? `${day(exam.startDate)} – ${day(exam.endDate)}` : day(exam.startDate);
      const blocks = exam.blocks && exam.blocks.length ? exam.blocks.map((b) => U.blockLabel(b).replace(' Stunde', '')).join(' + ') + ' Stunde' : 'ganzer Tag';
      return `${range}, ${blocks}`;
    }

    function cleanExam(data) {
      const startDate = String(data.startDate || '');
      const endDate = String(data.endDate || data.startDate || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Bitte ein Datum angeben.');
      if (endDate < startDate) throw new Error('Das Enddatum darf nicht vor dem Beginn liegen.');
      if (U.dayDiff(U.parseIsoDate(startDate), U.parseIsoDate(endDate)) > MAX_EXAM_DAYS) throw new Error(`Höchstens ${MAX_EXAM_DAYS} Tage am Stück — für längere Zeiträume bitte die Wochen-Verfügbarkeit nutzen.`);
      if (endDate < U.toIsoDate(U.today())) throw new Error('Der Termin liegt in der Vergangenheit.');
      const blocks = Array.from(new Set((data.blocks || []).filter((b) => U.DUTY_BLOCK_KEYS.includes(b))));
      return {
        title: String(data.title || '').trim().slice(0, 60),
        startDate, endDate,
        blocks: blocks.length === U.DUTY_BLOCK_KEYS.length ? [] : blocks.sort((a, b) => U.DUTY_BLOCK_KEYS.indexOf(a) - U.DUTY_BLOCK_KEYS.indexOf(b)),
      };
    }

    /** Legt eine Klausur an (ohne `data.id`) oder ändert sie. Gibt die gespeicherte Klausur zurück. */
    function saveExam(studentId, data) {
      assertCanEdit(studentId);
      const clean = cleanExam(data);
      const exam = data.id ? Object.assign({}, clean, { id: data.id }) : SSD.Models.createExam(clean);
      SSD.Store.commit(data.id ? 'Klausur geändert' : 'Klausur eingetragen', (draft) => {
        const student = draft.students.find((s) => s.id === studentId);
        if (!student) return;
        if (!Array.isArray(student.exams)) student.exams = [];
        const existing = student.exams.find((e) => e.id === exam.id);
        if (existing) Object.assign(existing, clean);
        else student.exams.push(exam);
      });
      return exam;
    }

    function removeExam(studentId, examId) {
      assertCanEdit(studentId);
      SSD.Store.commit('Klausur gelöscht', (draft) => {
        const student = draft.students.find((s) => s.id === studentId);
        if (student) student.exams = (student.exams || []).filter((e) => e.id !== examId);
      });
    }

    /** Kommende Dienste der Person, die in die Klausurzeit fallen (z. B. um gleich eine Vertretung anzufordern). */
    function dutiesDuringExam(studentId, exam) {
      const todayIso = U.toIsoDate(U.today());
      return SSD.Store.getState().schedule.entries
        .filter((e) => e.date >= todayIso && ((e.studentIds || []).includes(studentId) || e.azubiId === studentId) && examCovers(exam, e.date, e.block))
        .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
    }

    /**
     * Aufräumen (Aufbewahrungsfrist): vergangene Wocheneinträge und Klausuren,
     * die länger als bis `cutoffIso` zurückliegen. Ändert `draft` direkt; gibt die Anzahl zurück.
     */
    function pruneDraft(draft, cutoffIso) {
      let removed = 0;
      draft.students.forEach((s) => {
        Object.keys(s.availabilityWeeks || {}).forEach((monday) => {
          if (U.toIsoDate(U.addDays(U.parseIsoDate(monday), 6)) < cutoffIso) { delete s.availabilityWeeks[monday]; removed++; }
        });
        const before = (s.exams || []).length;
        s.exams = (s.exams || []).filter((e) => (e.endDate || e.startDate) >= cutoffIso);
        removed += before - s.exams.length;
      });
      return removed;
    }

    function countPrunable(state, cutoffIso) {
      let count = 0;
      state.students.forEach((s) => {
        Object.keys(s.availabilityWeeks || {}).forEach((monday) => { if (U.toIsoDate(U.addDays(U.parseIsoDate(monday), 6)) < cutoffIso) count++; });
        count += (s.exams || []).filter((e) => (e.endDate || e.startDate) < cutoffIso).length;
      });
      return count;
    }

    return {
      WEEKS_AHEAD, STATES,
      mondayIso, stateAt, reasonAt, examAt, examCovers, weekGrid, hasAnyAvailable,
      weekLock, upcomingWeeks, setCell, resetWeek,
      getExams, upcomingExams, describeExam, saveExam, removeExam, dutiesDuringExam,
      pruneDraft, countPrunable,
    };
  })();

  // ---- js/modules/studentService.js ----
  /**
   * ============================================================================
   * SSD.StudentService — Schülerverwaltung
   * ============================================================================
   * Kapselt sämtliche Lese-/Schreiboperationen auf Schülerdaten sowie davon
   * abgeleitete Informationen (Verfügbarkeitsfenster, Dienst-Historie,
   * Suche/Filter). UI-Views greifen ausschließlich über dieses Modul auf
   * Schülerdaten zu, nie direkt auf `SSD.Store`.
   */
  window.SSD = window.SSD || {};

  SSD.StudentService = (function () {
    'use strict';

    const U = SSD.Utils;

    function getAll() {
      return SSD.Store.getState().students;
    }

    function getById(id) {
      return getAll().find((s) => s.id === id) || null;
    }

    function getActive() {
      return getAll().filter((s) => s.active);
    }

    /** Aktive Personen einer bestimmten Kategorie ('student' oder 'azubi'). */
    function getActiveByRole(role) {
      return getActive().filter((s) => (s.role || 'student') === role);
    }

    function buildStudent({ firstName, lastName, username, role, gender, schoolClass, yearGroup, maxDutiesPerWeek, notes, adminMessage, active, pendingApproval }) {
      return SSD.Models.createStudent({
        firstName, lastName, username, gender: gender || 'n', schoolClass, yearGroup,
        role: role || 'student',
        maxDutiesPerWeek: maxDutiesPerWeek || null,
        notes: notes || '', adminMessage: adminMessage || '',
        active: active !== false,
        pendingApproval: !!pendingApproval,
      });
    }

    /**
     * Legt Personen an (Administrator) und setzt danach ihre Startpasswörter
     * serverseitig. Der Server nimmt Passwörter nur für gespeicherte Personen
     * an, daher wird zuerst gespeichert. Vom Administrator vergebene Passwörter
     * müssen bei der ersten Anmeldung geändert werden.
     * @param {Array<object>} entries — Personendaten inkl. `password`
     * @returns {Promise<{students: object[], failed: Array<{student: object, error: string}>}>}
     */
    async function createMany(entries) {
      const students = entries.map(buildStudent);
      if (!students.length) return { students, failed: [] };
      SSD.Store.commit(students.length === 1 ? `Schüler "${students[0].firstName} ${students[0].lastName}" angelegt` : `${students.length} Personen angelegt`, (draft) => {
        draft.students.push(...students);
      });
      const failed = [];
      if (!(await SSD.Store.flush())) {
        students.forEach((student) => failed.push({ student, error: 'Speichern fehlgeschlagen' }));
        return { students, failed };
      }
      for (let i = 0; i < students.length; i++) {
        try {
          await SSD.Auth.setPassword(students[i].id, entries[i].password);
        } catch (err) {
          failed.push({ student: students[i], error: String(err.message || err) });
        }
      }
      return { students, failed };
    }

    async function create(data) {
      const { students, failed } = await createMany([data]);
      if (failed.length) throw new Error(`Die Person wurde angelegt, das Passwort aber nicht gesetzt: ${failed[0].error}`);
      return students[0];
    }

    /**
     * Selbstregistrierung durch Schüler:innen/Azubis über den Login-Bildschirm.
     * Der Server legt das Konto an: ohne Schulcode inaktiv, bis es freigeschaltet
     * wird, mit gültigem Schulcode sofort aktiv (und angemeldet).
     * @returns {Promise<{ok: boolean, pending?: boolean, error?: string}>}
     */
    async function registerSelf({ firstName, lastName, username, password, role, gender, schoolClass, yearGroup, code }) {
      const student = buildStudent({ firstName, lastName, username, role, gender, schoolClass, yearGroup, active: false, pendingApproval: true });
      return SSD.Auth.register(student, password, code);
    }

    /** Anzahl der Selbstregistrierungen, die noch auf eine Entscheidung des Administrators warten. */
    function getPendingApprovalCount() {
      return getAll().filter((s) => s.pendingApproval).length;
    }

    function update(id, patch) {
      SSD.Store.commit('Schülerdaten bearbeitet', (draft) => {
        const student = draft.students.find((s) => s.id === id);
        if (!student) return;
        Object.assign(student, patch);
        if ('active' in patch) student.pendingApproval = false; // Administrator hat die Zusage/Ablehnung bearbeitet
      });
    }

    /** Neues Passwort durch den Administrator — die Person muss es bei der nächsten Anmeldung ändern. */
    async function resetPassword(id, newPassword) {
      await SSD.Auth.setPassword(id, newPassword);
    }

    function removeFromDraft(draft, id) {
      draft.students = draft.students.filter((s) => s.id !== id);
      draft.schedule.entries.forEach((entry) => {
        entry.studentIds = entry.studentIds.filter((sid) => sid !== id);
        if (entry.azubiId === id) entry.azubiId = null;
        if (entry.substitutionRequests) entry.substitutionRequests = entry.substitutionRequests.filter((r) => r.studentId !== id);
      });
      // Gelöschte Personen belegen keine Veranstaltungsplätze mehr.
      (draft.events || []).forEach((event) => {
        event.participantIds = (event.participantIds || []).filter((pid) => pid !== id);
      });
      draft.students.forEach((s) => {
        if (Array.isArray(s.preferredPartnerIds)) s.preferredPartnerIds = s.preferredPartnerIds.filter((pid) => pid !== id);
      });
      draft.settings.pairRules = (draft.settings.pairRules || []).filter((r) => r.a !== id && r.b !== id);
      (draft.meetings || []).forEach((m) => {
        m.responses = (m.responses || []).filter((r) => r.personId !== id);
        m.attendeeIds = (m.attendeeIds || []).filter((pid) => pid !== id);
      });
    }

    function remove(id) {
      const student = getById(id);
      SSD.Store.commit(`Schüler "${student ? student.firstName + ' ' + student.lastName : ''}" gelöscht`, (draft) => {
        removeFromDraft(draft, id);
      });
    }

    /* ---------------------------------------------------------------------
     * Selbstregistrierungen freigeben/ablehnen (Administrator + Team-Leitung)
     * ---------------------------------------------------------------------
     * Beide Aktionen prüfen den *aktuellen* Stand: Hat inzwischen jemand
     * anderes entschieden (z. B. die zweite Sanisprecher:in auf einem anderen
     * Gerät), wird nichts verändert — eine Ablehnung darf nie versehentlich
     * ein bereits freigeschaltetes Konto löschen.
     */

    function getPendingRegistrations() {
      return getAll().filter((s) => s.pendingApproval).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    }

    function assertPendingRegistration(id) {
      if (!SSD.Auth.canCoordinate()) throw new Error('Dafür fehlt die Berechtigung.');
      const student = getById(id);
      if (!student || !student.pendingApproval) throw new Error('Diese Registrierung wurde inzwischen bereits bearbeitet.');
      return student;
    }

    function approveRegistration(id) {
      const student = assertPendingRegistration(id);
      SSD.Store.commit(`Registrierung freigeschaltet: ${fullName(student)}`, (draft) => {
        const target = draft.students.find((s) => s.id === id);
        if (!target) return;
        target.active = true;
        target.pendingApproval = false;
      });
    }

    function rejectRegistration(id) {
      const student = assertPendingRegistration(id);
      SSD.Store.commit(`Registrierung abgelehnt: ${fullName(student)}`, (draft) => {
        removeFromDraft(draft, id);
      });
    }

    /* ---------------------------------------------------------------------
     * Wunschpartner:innen (nur Kategorie "student" — Azubis haben einen
     * eigenen Einzelplatz und werden nicht gepaart)
     * ------------------------------------------------------------------- */

    const MAX_PREFERRED_PARTNERS = 3;

    function isPairable(person) {
      return !!(person && person.active && (person.role || 'student') === 'student');
    }

    /** Aktuell gültige Wunschpartner:innen einer Person (gelöschte/inaktive werden übersprungen). */
    function getPreferredPartners(student) {
      return (student.preferredPartnerIds || []).map(getById).filter(isPairable);
    }

    function setPreferredPartners(id, partnerIds) {
      const student = getById(id);
      if (!student || (student.role || 'student') !== 'student') return [];
      const valid = Array.from(new Set(partnerIds))
        .filter((pid) => pid !== id && isPairable(getById(pid)))
        .slice(0, MAX_PREFERRED_PARTNERS);
      SSD.Store.commit('Wunschpartner:innen geändert', (draft) => {
        const target = draft.students.find((s) => s.id === id);
        if (target) target.preferredPartnerIds = valid;
      }, { trackHistory: false });
      return valid;
    }

    function setActive(id, active) {
      const student = getById(id);
      SSD.Store.commit(active ? `Schüler "${student.firstName}" aktiviert` : `Schüler "${student.firstName}" deaktiviert`, (draft) => {
        const target = draft.students.find((s) => s.id === id);
        target.active = active;
        target.pendingApproval = false; // Administrator hat eine Entscheidung getroffen
      });
    }

    /* ---------------------------------------------------------------------
     * Sanisprecher:in / Stellv. Sanisprecher:in — Zusatzbezeichnung
     * ------------------------------------------------------------------- */

    /** Aktive Person mit einer bestimmten Zusatzbezeichnung ('sanisprecher' | 'vize_sanisprecher'), falls vergeben. */
    function getLeadershipHolder(key) {
      return getActive().find((s) => s.leadershipRole === key) || null;
    }

    function isTeamLead(student) {
      return !!(student && student.leadershipRole);
    }

    /**
     * Vergibt eine Zusatzbezeichnung an eine Person. Da es je Bezeichnung immer
     * nur eine Trägerin/einen Träger gibt, wird eine evtl. bisherige Inhaberin
     * automatisch abgelöst; hält die Zielperson bereits die jeweils andere
     * Bezeichnung, wird diese ersetzt (niemand trägt beide gleichzeitig).
     */
    function setLeadershipRole(studentId, key) {
      const student = getById(studentId);
      if (!student) return;
      const label = SSD.Models.LEADERSHIP_ROLES.find((r) => r.key === key)?.label || key;
      SSD.Store.commit(`${label} festgelegt: ${fullName(student)}`, (draft) => {
        draft.students.forEach((s) => {
          if (s.id === studentId || s.leadershipRole === key) s.leadershipRole = null;
        });
        const target = draft.students.find((s) => s.id === studentId);
        if (target) target.leadershipRole = key;
      });
    }

    function clearLeadershipRole(studentId) {
      const student = getById(studentId);
      if (!student) return;
      SSD.Store.commit(`Zusatzbezeichnung entfernt: ${fullName(student)}`, (draft) => {
        const target = draft.students.find((s) => s.id === studentId);
        if (target) target.leadershipRole = null;
      });
    }

    /** Standardwoche ändern (Wochen und Klausuren: SSD.AvailabilityService). */
    function setAvailabilityCell(id, dayKey, blockIndex, newState) {
      SSD.AvailabilityService.setCell(id, 'template', dayKey, blockIndex, newState);
    }

    /* ---------------------------------------------------------------------
     * "Wer fehlt noch?" — fehlende/veraltete Verfügbarkeiten & Erinnerungen
     * ------------------------------------------------------------------- */

    /** Beginn des laufenden Schulhalbjahres (1. August bzw. 1. Februar) — Standard-Stichtag für "veraltet". */
    function currentHalfYearStart(referenceDate) {
      const ref = referenceDate || U.today();
      const year = ref.getFullYear();
      const month = ref.getMonth(); // 0 = Januar
      if (month >= 7) return `${year}-08-01`;
      if (month >= 1) return `${year}-02-01`;
      return `${year - 1}-08-01`;
    }

    /** Datum (YYYY-MM-DD, lokale Zeit) der letzten Änderung/Bestätigung der Verfügbarkeit. */
    function availabilityUpdatedDate(student) {
      const stamp = student.availabilityUpdatedAt || student.createdAt;
      return stamp ? U.toIsoDate(new Date(stamp)) : null;
    }

    /**
     * Aktive Sanis/Azubis ohne eingetragene Verfügbarkeit (`missing`) bzw. mit
     * Eintrag, der seit dem Stichtag nicht mehr geändert/bestätigt wurde (`outdated`).
     */
    function getAvailabilityGaps(sinceIso) {
      const active = getActive();
      const missing = [];
      const outdated = [];
      active.forEach((s) => {
        if (!SSD.StatisticsService.hasAnyAvailability(s)) missing.push(s);
        else if (sinceIso && (availabilityUpdatedDate(s) || '') < sinceIso) outdated.push(s);
      });
      const byName = (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
      return { missing: missing.sort(byName), outdated: outdated.sort(byName), activeCount: active.length };
    }

    /** Die Personen sehen nach dem Anmelden einen Hinweis, bis sie ihre Verfügbarkeit ändern oder bestätigen. */
    function remindAvailability(ids) {
      if (!SSD.Auth.canCoordinate()) throw new Error('Dafür fehlt die Berechtigung.');
      const idSet = new Set(ids);
      let count = 0;
      if (!idSet.size) return count;
      const now = new Date().toISOString();
      SSD.Store.commit(`An Verfügbarkeit erinnert (${idSet.size})`, (draft) => {
        draft.students.forEach((s) => {
          if (idSet.has(s.id) && s.active) { s.availabilityReminderAt = now; count += 1; }
        });
      }, { trackHistory: false });
      return count;
    }

    function needsAvailabilityReminder(student) {
      if (!student || !student.availabilityReminderAt) return false;
      return !student.availabilityUpdatedAt || student.availabilityUpdatedAt < student.availabilityReminderAt;
    }

    /** "Meine Verfügbarkeit ist aktuell" — ändert nichts am Stundenplan, beendet aber eine Erinnerung. */
    function confirmAvailability(id) {
      SSD.Store.commit('Verfügbarkeit bestätigt', (draft) => {
        const student = draft.students.find((s) => s.id === id);
        if (student) student.availabilityUpdatedAt = new Date().toISOString();
      }, { trackHistory: false });
    }

    /* ---------------------------------------------------------------------
     * Änderungsfrist ("Zeitraum, in dem Änderungen erlaubt sind")
     * ------------------------------------------------------------------- */

    /**
     * Berechnet das aktuelle Verfügbarkeitsfenster für Schüler-Änderungen.
     * Regel: Die Vorlage für die kommende Woche kann bis N Tage vor deren
     * Montag bearbeitet werden; danach ist sie gesperrt, bis die neue Woche
     * beginnt und sich das Fenster für die übernächste Woche neu öffnet.
     */
    function getAvailabilityWindow(referenceDate) {
      const settings = SSD.Store.getState().settings;
      const ref = referenceDate || U.today();
      const thisMonday = U.getMondayOfWeek(ref);
      const nextMonday = U.addDays(thisMonday, 7);
      // Höchstens 6 Tage: Bei 7+ läge die Sperre vor dem laufenden Montag — nie änderbar.
      const deadlineDays = U.clamp(Number(settings.changeDeadlineDaysBeforeWeek) || 0, 0, 6);
      const lockDate = U.addDays(nextMonday, -deadlineDays);
      const isOpen = ref < lockDate;
      return {
        isOpen,
        lockDate,
        nextMonday,
        daysUntilLock: Math.max(0, U.dayDiff(ref, lockDate)),
      };
    }

    /* ---------------------------------------------------------------------
     * Abgeleitete Dienst-Historie (aus dem generierten Dienstplan)
     * ------------------------------------------------------------------- */

    /** Findet alle Diensteinträge einer Person — berücksichtigt sowohl die regulären
     * Schüler-Plätze als auch (für Azubis) den dritten, einzelnen Azubi-Platz. */
    function getDutiesForStudent(id) {
      const entries = SSD.Store.getState().schedule.entries;
      return entries
        .filter((e) => e.studentIds.includes(id) || e.azubiId === id)
        .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
    }

    function getDutySummary(id) {
      const todayIso = U.toIsoDate(U.today());
      const duties = getDutiesForStudent(id);
      const past = duties.filter((d) => d.date < todayIso);
      const upcoming = duties.filter((d) => d.date >= todayIso);
      return { total: duties.length, past, upcoming };
    }

    /* ---------------------------------------------------------------------
     * Suche & Filter
     * ------------------------------------------------------------------- */

    function filterStudents(students, filters = {}) {
      const query = U.normalizeForSearch(filters.query || '');
      return students.filter((s) => {
        if (filters.role && (s.role || 'student') !== filters.role) return false;
        if (filters.schoolClass && s.schoolClass !== filters.schoolClass) return false;
        if (filters.gender && s.gender !== filters.gender) return false;
        if (filters.yearGroup && String(s.yearGroup) !== String(filters.yearGroup)) return false;
        if (filters.status === 'active' && !s.active) return false;
        if (filters.status === 'inactive' && s.active) return false;
        if (query) {
          const haystack = U.normalizeForSearch(`${s.firstName} ${s.lastName} ${s.username} ${s.schoolClass}`);
          if (!haystack.includes(query)) return false;
        }
        return true;
      });
    }

    function getDistinctClasses() {
      return Array.from(new Set(getAll().map((s) => s.schoolClass).filter(Boolean))).sort();
    }

    function getDistinctYearGroups() {
      return Array.from(new Set(getAll().map((s) => s.yearGroup).filter(Boolean))).sort((a, b) => a - b);
    }

    function fullName(student) {
      return `${student.firstName} ${student.lastName}`.trim();
    }

    return {
      getAll, getById, getActive, getActiveByRole, create, createMany, registerSelf, update, remove, removeFromDraft, setActive,
      MAX_PREFERRED_PARTNERS, getPreferredPartners, setPreferredPartners,
      getLeadershipHolder, isTeamLead, setLeadershipRole, clearLeadershipRole,
      setAvailabilityCell, resetPassword, getAvailabilityWindow, getPendingApprovalCount,
      getPendingRegistrations, approveRegistration, rejectRegistration,
      currentHalfYearStart, availabilityUpdatedDate, getAvailabilityGaps, remindAvailability,
      needsAvailabilityReminder, confirmAvailability,
      getDutiesForStudent, getDutySummary,
      filterStudents, getDistinctClasses, getDistinctYearGroups, fullName,
    };
  })();

  // ---- js/modules/notificationService.js ----
  /**
   * ============================================================================
   * SSD.NotificationService — Meldungen für Microsoft Teams
   * ============================================================================
   * Meldenswerte Änderungen (Dienstplan, Vertretungen, Teamtreffen,
   * Veranstaltungen, Aufgaben, Material) werden als lesbarer Text in `state.teamsOutbox`
   * abgelegt — immer innerhalb des Speichervorgangs der eigentlichen Änderung
   * (`add(draft, …)` im Commit-Mutator), damit kein zusätzlicher Save entsteht
   * und ein Rückgängig-Machen die Meldung automatisch wieder entfernt.
   *
   * Versendet wird serverseitig: Ein pg_cron-Job in Supabase sammelt neue
   * Einträge und schickt sie gebündelt an den Teams-Workflow, dessen geheime
   * Adresse nur im Supabase Vault liegt (siehe README, "Teams-Benachrichtigungen").
   */
  window.SSD = window.SSD || {};

  SSD.NotificationService = (function () {
    'use strict';

    const U = SSD.Utils;
    const MAX_OUTBOX = 100;

    const CATEGORIES = [
      { key: 'schedule', label: 'Dienstplan', hint: 'Neu erstellt oder übertragen, Lücken aufgefüllt, manuelle Änderungen an kommenden Diensten.' },
      { key: 'substitution', label: 'Vertretungen', hint: 'Vertretungen eingetragen, „Vertretung gesucht“, offene Dienste selbst übernommen.' },
      { key: 'meeting', label: 'Teamtreffen', hint: 'Neue Treffen sowie Verlegungen und Absagen kommender Treffen (einzelne Zu-/Absagen nicht).' },
      { key: 'event', label: 'Veranstaltungen', hint: 'Neu angelegt, geändert, gelöscht oder automatisch aufgefüllt (einzelne An-/Abmeldungen nicht).' },
      { key: 'task', label: 'Aufgaben', hint: 'Neue Aufgaben, erledigt, wieder geöffnet.' },
      { key: 'material', label: 'Material', hint: 'Neue Materialanfragen und Statusänderungen.' },
    ];

    /**
     * Name in Teams-Meldungen — standardmäßig datensparsam "Lena C." (Einstellung
     * "Namen in den Nachrichten"), auf Wunsch der volle Name.
     */
    function personName(id) {
      const s = id && SSD.StudentService.getById(id);
      if (!s) return '(gelöscht)';
      const teams = (SSD.Store.getState().settings || {}).teams || {};
      if (teams.nameStyle === 'full') return SSD.StudentService.fullName(s);
      const initial = String(s.lastName || '').trim().charAt(0);
      return initial ? `${s.firstName} ${initial}.` : s.firstName;
    }

    function names(ids) {
      const list = (ids || []).filter(Boolean).map(personName);
      return list.length ? list.join(' & ') : 'niemand';
    }

    function actorName() {
      const session = SSD.Auth.getSession();
      if (!session) return '';
      if (session.role === 'admin') return SSD.Store.getState().admin?.username || 'Administrator';
      return personName(session.studentId);
    }

    /** „Mo, 05.10., 3./4. Stunde“ */
    function dutyLabel(entry) {
      return `${U.WEEKDAY_LABELS_SHORT[entry.weekday]}, ${U.formatDateShort(U.parseIsoDate(entry.date))}, ${U.blockLabel(entry.block)}`;
    }

    function isUpcoming(dateIso) {
      return dateIso >= U.toIsoDate(U.today());
    }

    /** Überschrift + Detailzeilen (max. `max`, Rest als „… und N weitere“) als mehrzeiliger Meldungstext. */
    function withDetails(headline, details, max = 8) {
      const shown = details.slice(0, max);
      if (details.length > max) shown.push(`… und ${details.length - max} weitere`);
      return [headline, ...shown].join('\n');
    }

    /**
     * Legt eine Meldung ab — nur innerhalb eines `SSD.Store.commit`-Mutators
     * aufrufen. Ohne aktive Teams-Anbindung oder bei abgeschalteter Kategorie
     * passiert nichts.
     */
    /** @param {{by?: string}} [opts] — Absender überschreiben (z. B. bei der automatischen Wochen-Aktualisierung) */
    function add(draft, category, text, opts) {
      const teams = draft.settings && draft.settings.teams;
      if (!teams || !teams.enabled) return;
      if (category !== 'test' && teams.categories && teams.categories[category] === false) return;
      if (!Array.isArray(draft.teamsOutbox)) draft.teamsOutbox = [];
      draft.teamsOutbox.push({ id: U.generateId('ntf'), at: new Date().toISOString(), category, text, by: (opts && opts.by) || actorName() });
      if (draft.teamsOutbox.length > MAX_OUTBOX) draft.teamsOutbox.splice(0, draft.teamsOutbox.length - MAX_OUTBOX);
    }

    /** Wird eine Meldung dieser Kategorie derzeit an Teams gemeldet? (für Hinweise in der Oberfläche) */
    function isActive(category) {
      const teams = SSD.Store.getState().settings.teams;
      return !!(teams && teams.enabled && !(teams.categories && teams.categories[category] === false));
    }

    /** Testmeldung — wird serverseitig ohne Sammel-Wartezeit verschickt. */
    function sendTest() {
      SSD.Store.commit('Teams-Testnachricht', (draft) => {
        add(draft, 'test', 'Testnachricht aus dem Dienstplan — die Teams-Anbindung funktioniert.');
      }, { trackHistory: false });
    }

    return { CATEGORIES, add, isActive, sendTest, dutyLabel, names, personName, isUpcoming, withDetails };
  })();

  // ---- js/modules/calendarService.js ----
  /**
   * ============================================================================
   * SSD.CalendarService — Sondertage & Dienstzeiten-Konfiguration
   * ============================================================================
   * Verwaltet Ferien/Feiertage/Projekttage etc. (als Datumsbereiche) sowie die
   * pro Wochentag ein-/ausschaltbaren Dienstblöcke. Beides fließt direkt in den
   * Dienstplan-Generator ein (deaktivierte Tage/Blöcke werden nie verplant).
   */
  window.SSD = window.SSD || {};

  SSD.CalendarService = (function () {
    'use strict';

    const U = SSD.Utils;

    function getAll() {
      return SSD.Store.getState().specialDays.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    }

    function create(data) {
      const day = SSD.Models.createSpecialDay(data);
      SSD.Store.commit(`Sondertag "${day.label || SSD.Models.SPECIAL_DAY_TYPES.find((t) => t.key === day.type).label}" angelegt`, (draft) => {
        draft.specialDays.push(day);
      });
      return day;
    }

    function update(id, patch) {
      SSD.Store.commit('Sondertag bearbeitet', (draft) => {
        const day = draft.specialDays.find((d) => d.id === id);
        if (day) Object.assign(day, patch);
      });
    }

    function remove(id) {
      SSD.Store.commit('Sondertag gelöscht', (draft) => {
        draft.specialDays = draft.specialDays.filter((d) => d.id !== id);
      });
    }

    /** Liefert den (ersten) Sondertag, der ein gegebenes ISO-Datum abdeckt, oder null. */
    function getSpecialDayForDate(dateIso) {
      return getAll().find((d) => dateIso >= d.startDate && dateIso <= d.endDate) || null;
    }

    function isDayUsable(dateIso) {
      return !getSpecialDayForDate(dateIso);
    }

    /* ---------------------------------------------------------------------
     * Dienstblock-Konfiguration (pro Wochentag ein-/ausschaltbar)
     * ------------------------------------------------------------------- */

    function getDutyBlockConfig() {
      return SSD.Store.getState().dutyBlockConfig;
    }

    function isBlockEnabled(weekdayKey, blockKey) {
      const config = getDutyBlockConfig();
      return !!(config[weekdayKey] && config[weekdayKey][blockKey]);
    }

    function setBlockEnabled(weekdayKey, blockKey, enabled) {
      SSD.Store.commit('Dienstzeiten angepasst', (draft) => {
        draft.dutyBlockConfig[weekdayKey][blockKey] = enabled;
      });
    }

    function getEnabledBlocksForWeekday(weekdayKey) {
      const config = getDutyBlockConfig();
      return U.DUTY_BLOCK_KEYS.filter((b) => config[weekdayKey] && config[weekdayKey][b]);
    }

    return {
      getAll, create, update, remove,
      getSpecialDayForDate, isDayUsable,
      getDutyBlockConfig, isBlockEnabled, setBlockEnabled, getEnabledBlocksForWeekday,
    };
  })();

  // ---- js/modules/settingsService.js ----
  /**
   * ============================================================================
   * SSD.SettingsService — Anwendungseinstellungen
   * ============================================================================
   */
  window.SSD = window.SSD || {};

  SSD.SettingsService = (function () {
    'use strict';

    function get() {
      return SSD.Store.getState().settings;
    }

    function update(patch) {
      SSD.Store.commit('Einstellungen gespeichert', (draft) => {
        Object.assign(draft.settings, patch);
      }, { trackHistory: false });
    }

    function getSchool() {
      return SSD.Store.getState().school;
    }

    function updateSchool(patch) {
      SSD.Store.commit('Schulinformationen aktualisiert', (draft) => {
        Object.assign(draft.school, patch);
      }, { trackHistory: false });
    }

    return { get, update, getSchool, updateSchool };
  })();

  // ---- js/modules/distributionService.js ----
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

  // ---- js/modules/scheduler.js ----
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
        // Klausuren, Wocheneintrag oder Standardwoche — siehe SSD.AvailabilityService.stateAt
        const availState = SSD.AvailabilityService.stateAt(student, slot.date, slot.block, slot.weekday, slot.weekMonday);
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
        // Ohne Angabe ('n') zählt eine Person weder als gleich noch als verschieden.
        if (a && b && w.genderMix && a.gender === b.gender && a.gender !== 'n') cost += w.genderMix;

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
        return s ? s.gender : 'n';
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

  // ---- js/modules/statisticsService.js ----
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
      return SSD.AvailabilityService.hasAnyAvailable(student);
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

      const genderRoster = { w: 0, m: 0, d: 0, n: 0 };
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

  // ---- js/modules/substitutionService.js ----
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
        const known = (g) => g && g !== 'n';
        if (partner && known(candidate.gender) && known(partner.gender) && candidate.gender !== partner.gender) {
          reasons.push('Ergibt ein gemischtes Team');
        } else if (partner && known(candidate.gender) && candidate.gender === partner.gender) {
          genderPts = 0;
        } else if (partner) {
          genderPts = SCORE_WEIGHTS.GENDER / 2; // ohne Angabe: neutral
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

      const absentOnDate = buildAbsentOnDate(state);
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

    /** Wer ist an welchem Tag selbst verhindert? (offene Anfrage oder bereits abgegebener Dienst) */
    function buildAbsentOnDate(state) {
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
      return absentOnDate;
    }

    /**
     * Ersatz für einzelne (Dienst, Person)-Paare, z. B. bei der Wochen-
     * Aktualisierung: Nur die genannte Person ist in genau diesem Dienst
     * verhindert, an anderen Diensten derselben Woche kann sie weiterhin
     * eingesetzt werden oder Ersatz sein. Gleiche Regeln wie die übrigen
     * Vertretungen; ausgeschlossen sind zusätzlich Personen, die an dem Tag
     * selbst ausfallen. Ändert nichts.
     * @param {Array<{entryId:string, personId:string}>} conflicts
     * @returns {Array<{entryId:string, absentStudentId:string, isAzubiSeat:boolean, replacementStudentId:?string, reasonText:string}>}
     */
    function proposeForConflicts(conflicts) {
      const state = SSD.Store.getState();
      const blockedIn = new Map();
      conflicts.forEach((c) => {
        if (!blockedIn.has(c.entryId)) blockedIn.set(c.entryId, new Set());
        blockedIn.get(c.entryId).add(c.personId);
      });
      const entries = state.schedule.entries
        .filter((e) => blockedIn.has(e.id))
        .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
      if (!entries.length) return [];

      const isBlocked = (entry, id) => blockedIn.get(entry.id).has(id);
      const studentEntries = entries.filter((e) => e.studentIds.some((id) => isBlocked(e, id)));
      const azubiEntries = entries.filter((e) => e.azubiId && isBlocked(e, e.azubiId));
      const studentSlots = studentEntries.map((e) => SSD.Scheduler.slotFromEntry(e));
      const azubiSlots = azubiEntries.map((e) => SSD.Scheduler.slotFromEntry(e));

      const studentContext = new SSD.Scheduler.SchedulingContext(SSD.StudentService.getActiveByRole('student'), state.schedule.entries, studentSlots, state.settings);
      studentEntries.forEach((entry, i) => {
        entry.studentIds.filter((id) => !isBlocked(entry, id)).forEach((id) => {
          if (studentContext.studentsById.has(id)) studentContext.assign(studentSlots[i], id);
        });
      });
      const azubiHistory = SSD.Scheduler.buildAzubiHistoryEntries(new Set(azubiSlots.map((sl) => sl.key)));
      const azubiContext = new SSD.Scheduler.SchedulingContext(SSD.StudentService.getActiveByRole('azubi'), azubiHistory, azubiSlots, SSD.Scheduler.azubiSettingsFrom(state.settings));

      const vacancies = [];
      studentEntries.forEach((entry, i) => {
        entry.studentIds.forEach((id) => {
          if (isBlocked(entry, id)) vacancies.push({ entry, slot: studentSlots[i], absentStudentId: id, context: studentContext });
        });
      });
      azubiEntries.forEach((entry, i) => {
        vacancies.push({ entry, slot: azubiSlots[i], absentStudentId: entry.azubiId, context: azubiContext });
      });

      const absentOnDate = buildAbsentOnDate(state);
      const isExcluded = (id, vacancy) => isBlocked(vacancy.entry, id) || (absentOnDate.get(vacancy.entry.date) || new Set()).has(id);
      return resolveVacancies(vacancies, new Set(), isExcluded).map((p) => ({
        entryId: p.entryId,
        absentStudentId: p.absentStudentId,
        isAzubiSeat: p.isAzubiSeat,
        replacementStudentId: p.chosen ? p.chosen.studentId : null,
        reasonText: p.chosen ? p.chosen.reasons.join(', ') : (p.noCandidateReason || 'Kein geeigneter Ersatz gefunden'),
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

    /**
     * Gründe für eine Abwesenheit werden bewusst nicht erfasst (z. B. wäre "Krankheit"
     * eine Gesundheitsangabe) — für die Planung genügt, dass jemand verhindert ist.
     * @param {Array<{entryId:string, absentStudentId:string, replacementStudentId:?string, isAzubiSeat?:boolean, skip?:boolean, reasonText?:string}>} finalChoices
     */
    function applySubstitutions(finalChoices) {
      const appliedAt = new Date().toISOString();
      const applied = finalChoices.filter((c) => !c.skip);
      if (!applied.length) return 0;

      SSD.Store.commit('Vertretung eingetragen', (draft) => {
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
            reason: choice.reasonText || 'Abwesenheit',
            appliedAt,
          });
          const seat = choice.isAzubiSeat ? ' (Azubi-Platz)' : '';
          lines.push(choice.replacementStudentId
            ? `${N.dutyLabel(entry)}: ${N.personName(choice.replacementStudentId)} vertritt ${N.personName(choice.absentStudentId)}${seat}`
            : `${N.dutyLabel(entry)}: ${N.personName(choice.absentStudentId)} fällt aus — Platz bleibt offen${seat}`);
        });
        if (lines.length) N.add(draft, 'substitution', N.withDetails('Vertretung eingetragen:', lines));
      });
      return applied.length;
    }

    return {
      getAffectedEntries,
      proposeSubstitutions,
      proposeAutoReplacements,
      proposeForConflicts,
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

  // ---- js/modules/weeklyUpdateService.js ----
  /**
   * ============================================================================
   * SSD.WeeklyUpdateService — Wochen-Aktualisierung (sonntags 12 Uhr)
   * ============================================================================
   * Der Dienstplan wird nicht neu berechnet. Für die kommende Woche (Montag bis
   * Sonntag) prüft die Aktualisierung nur, ob eingeteilte Personen inzwischen
   * verhindert sind:
   *   - Klausur/Termin eingetragen,
   *   - für diesen Block "Gesperrt" (Wocheneintrag oder Standardwoche),
   *   - Konto deaktiviert oder gelöscht.
   * Nur für diese Plätze sucht sie Ersatz, nach denselben Regeln wie jede
   * Vertretung. Findet sich niemand, bleibt der Platz offen (und erscheint wie
   * jede Lücke in der Übersicht). Alles andere bleibt unverändert.
   *
   * Ausgelöst wird sie serverseitig durch einen Zeitplan in Supabase (Edge
   * Function "ssd-weekly-update", siehe supabase/functions), der genau diesen
   * Code ausführt; der Administrator kann sie zusätzlich von Hand starten.
   * `settings.weeklyUpdate.lastRunWeek` verhindert doppelte Läufe.
   */
  window.SSD = window.SSD || {};

  SSD.WeeklyUpdateService = (function () {
    'use strict';

    const U = SSD.Utils;
    const RUN_WEEKDAY = 0; // Sonntag
    const RUN_HOUR = 12;
    const TIME_ZONE = 'Europe/Berlin';
    const AUTO_SENDER = 'Wochen-Aktualisierung (automatisch)';

    function settings() {
      return Object.assign(SSD.Models.createDefaultWeeklyUpdateSettings(), SSD.Store.getState().settings.weeklyUpdate || {});
    }

    /** Datum, Wochentag (0 = Sonntag) und Stunde in Europe/Berlin — unabhängig von der Zeitzone des Geräts oder Servers. */
    function berlinParts(now) {
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
      });
      const parts = {};
      fmt.formatToParts(now).forEach((p) => { parts[p.type] = p.value; });
      return {
        dateIso: `${parts.year}-${parts.month}-${parts.day}`,
        weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
        hour: Number(parts.hour) % 24,
      };
    }

    /** Montag der als Nächstes beginnenden Woche (am Sonntag: der folgende Tag). */
    function upcomingMonday(dateIso) {
      return U.toIsoDate(U.addDays(U.getMondayOfWeek(U.parseIsoDate(dateIso)), 7));
    }

    function weekLabel(mondayIso) {
      const monday = U.parseIsoDate(mondayIso);
      return `KW ${U.getIsoWeekNumber(monday)} (${U.formatDateShort(monday)}–${U.formatDateShort(U.addDays(monday, 4))})`;
    }

    /** Ist der Sonntagslauf jetzt fällig? `{ due, mondayIso, reason? }` */
    function dueInfo(now) {
      const p = berlinParts(now || new Date());
      const mondayIso = upcomingMonday(p.dateIso);
      const cfg = settings();
      if (cfg.enabled === false) return { due: false, mondayIso, reason: 'ausgeschaltet' };
      if (p.weekday !== RUN_WEEKDAY || p.hour < RUN_HOUR) return { due: false, mondayIso, reason: 'noch nicht fällig (sonntags ab 12 Uhr)' };
      if (cfg.lastRunWeek === mondayIso) return { due: false, mondayIso, reason: 'für diese Woche bereits erledigt' };
      return { due: true, mondayIso };
    }

    function entriesOfWeek(mondayIso) {
      const end = U.toIsoDate(U.addDays(U.parseIsoDate(mondayIso), 6));
      return SSD.Store.getState().schedule.entries.filter((e) => e.date >= mondayIso && e.date <= end);
    }

    /** Eingeteilte Personen, die in der Woche verhindert sind. */
    function findConflicts(mondayIso) {
      const conflicts = [];
      entriesOfWeek(mondayIso).forEach((entry) => {
        (entry.studentIds || []).concat(entry.azubiId ? [entry.azubiId] : []).forEach((personId) => {
          const person = SSD.StudentService.getById(personId);
          let reason = null;
          if (!person) reason = 'nicht mehr im Team';
          else if (!person.active) reason = 'Konto deaktiviert';
          else {
            const r = SSD.AvailabilityService.reasonAt(person, entry.date, entry.block);
            if (r.source === 'exam') reason = 'Klausur/Termin';
            else if (r.state === 'blocked') reason = 'gesperrt';
          }
          if (reason) conflicts.push({ entryId: entry.id, personId, reason, date: entry.date, block: entry.block });
        });
      });
      return conflicts.sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block));
    }

    /**
     * Prüft die Woche und setzt (außer bei `dryRun`) die Vertretungen in einem
     * einzigen Speichervorgang um.
     * @param {{mondayIso?: string, trigger?: 'auto'|'manual', dryRun?: boolean}} [options]
     * @returns {{ summary: object, conflicts: object[], proposals: object[] }}
     */
    function run(options) {
      const opts = options || {};
      const mondayIso = opts.mondayIso || upcomingMonday(berlinParts(new Date()).dateIso);
      const trigger = opts.trigger || 'manual';
      const at = new Date().toISOString();
      const conflicts = findConflicts(mondayIso);
      const proposals = conflicts.length ? SSD.SubstitutionService.proposeForConflicts(conflicts) : [];
      const replaced = proposals.filter((p) => p.replacementStudentId).length;
      const summary = {
        mondayIso, at, trigger,
        checked: entriesOfWeek(mondayIso).length,
        conflicts: conflicts.length,
        replaced,
        open: proposals.length - replaced,
      };
      if (opts.dryRun) return { summary, conflicts, proposals };

      SSD.Store.commit(`Wochen-Aktualisierung ${weekLabel(mondayIso)}`, (draft) => {
        const N = SSD.NotificationService;
        const lines = [];
        proposals.forEach((p) => {
          const entry = draft.schedule.entries.find((e) => e.id === p.entryId);
          if (!entry) return;
          if (p.isAzubiSeat) {
            if (entry.azubiId !== p.absentStudentId) return;
            entry.azubiId = p.replacementStudentId || null;
          } else {
            const idx = entry.studentIds.indexOf(p.absentStudentId);
            if (idx === -1) return;
            if (p.replacementStudentId) entry.studentIds[idx] = p.replacementStudentId;
            else entry.studentIds.splice(idx, 1);
          }
          entry.isManual = true;
          entry.substitutionRequests = (entry.substitutionRequests || []).filter((r) => r.studentId !== p.absentStudentId);
          entry.substitutionLog = entry.substitutionLog || [];
          entry.substitutionLog.push({
            originalStudentId: p.absentStudentId,
            replacementStudentId: p.replacementStudentId || null,
            reason: 'Wochen-Aktualisierung (verhindert)', // bewusst ohne Grund
            appliedAt: at,
            auto: !!p.replacementStudentId, // die eingeteilte Person sieht einen Hinweis im Dashboard
            acknowledgedAt: null,
          });
          const seat = p.isAzubiSeat ? ' (Azubi-Platz)' : '';
          lines.push(p.replacementStudentId
            ? `${N.dutyLabel(entry)}: ${N.personName(p.replacementStudentId)} übernimmt für ${N.personName(p.absentStudentId)}${seat}`
            : `${N.dutyLabel(entry)}: ${N.personName(p.absentStudentId)} ist verhindert — Platz bleibt offen${seat}`);
        });
        draft.settings.weeklyUpdate = Object.assign(SSD.Models.createDefaultWeeklyUpdateSettings(), draft.settings.weeklyUpdate || {}, {
          lastRunWeek: mondayIso, lastRunAt: at, lastSummary: summary,
        });
        if (lines.length) {
          const parts = [];
          if (replaced) parts.push(`${replaced} ${replaced === 1 ? 'Dienst' : 'Dienste'} neu besetzt`);
          if (summary.open) parts.push(`${summary.open} ${summary.open === 1 ? 'Platz' : 'Plätze'} offen`);
          N.add(draft, 'substitution', N.withDetails(`Wochen-Aktualisierung ${weekLabel(mondayIso)}: ${parts.join(', ')}`, lines, 12),
            trigger === 'auto' ? { by: AUTO_SENDER } : undefined);
        }
      }, { trackHistory: trigger !== 'auto' });

      return { summary, conflicts, proposals };
    }

    /** Text für die letzte Aktualisierung, z. B. in den Einstellungen. */
    function describeLastRun() {
      const cfg = settings();
      if (!cfg.lastRunAt || !cfg.lastSummary) return 'Noch keine Wochen-Aktualisierung gelaufen.';
      const s = cfg.lastSummary;
      const when = U.formatDateTime(new Date(cfg.lastRunAt));
      const how = s.trigger === 'auto' ? 'automatisch' : 'von Hand';
      if (!s.conflicts) return `Zuletzt ${how} am ${when} für ${weekLabel(s.mondayIso)}: keine gesperrten Dienste.`;
      return `Zuletzt ${how} am ${when} für ${weekLabel(s.mondayIso)}: ${s.conflicts} gesperrt, ${s.replaced} neu besetzt, ${s.open} offen.`;
    }

    return { RUN_HOUR, berlinParts, upcomingMonday, weekLabel, dueInfo, findConflicts, run, describeLastRun, settings };
  })();


  // ---- Server-Ersatz für Store und Anmeldung ----
  let state = SSD.Storage.migrateIfNeeded(initialData);
  SSD.Store = {
    getState: () => state,
    isLoaded: () => true,
    commit(label, mutator) {
      mutator(state);
      state.meta = state.meta || {};
      state.meta.lastModifiedAt = new Date().toISOString();
    },
  };
  SSD.Auth = {
    getSession: () => null,
    isAdminSession: () => true,
    currentPersonId: () => null,
    canCoordinate: () => true,
    canManageItem: () => true,
  };
  return SSD;
}
