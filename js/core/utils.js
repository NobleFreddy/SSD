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
    WEEKDAY_KEYS, WEEKDAY_LABELS, WEEKDAY_LABELS_SHORT,
    DUTY_BLOCKS, DUTY_BLOCK_KEYS, blockLabel,
    toIsoDate, parseIsoDate, today, addDays, schoolYearEnd, getMondayOfWeek, getIsoWeekNumber,
    formatDateShort, formatDateLong, formatDateMedium, formatDateTime,
    isSameDay, isWeekend, weekdayKeyFromDate, getWeekDates, dayDiff,
    generateId, createSeededRandom, shuffleInPlace,
    debounce, clamp, deepClone, nextTick, mean, standardDeviation, round, fairnessScoreFromStdDev,
    normalizeForSearch, slugifyUsername, initials, escapeHtml, colorFromString,
    Validate,
    downloadBlob, readFileAsText, pickFile,
    el, qs, qsa,
  };
})();
