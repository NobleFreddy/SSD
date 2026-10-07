/**
 * ============================================================================
 * SSD.ImportExport — Datenaustausch (JSON, CSV, Excel, Druck/PDF)
 * ============================================================================
 * Bündelt alle Export-/Importformate an einer Stelle. Es werden bewusst
 * keine externen Bibliotheken eingebunden:
 *   - JSON: direkte Serialisierung der Anwendungsdaten (Voll-Backup).
 *   - CSV: manuell erzeugt/geparst, Semikolon-getrennt mit UTF-8-BOM (öffnet
 *     in deutschem Excel korrekt, inkl. Umlauten).
 *   - Excel: ein HTML-<table>-Dokument wird mit der Dateiendung ".xls"
 *     ausgeliefert — Excel öffnet dieses Format nativ inkl. Formatierung.
 *   - PDF: über die gestylte Druckansicht (`window.print()` → "Als PDF
 *     speichern" im Druckdialog des Browsers).
 */
window.SSD = window.SSD || {};

SSD.ImportExport = (function () {
  'use strict';

  const U = SSD.Utils;

  /* ---------------------------------------------------------------------
   * JSON
   * ------------------------------------------------------------------- */

  function exportDataJson() {
    const state = SSD.Store.getState();
    SSD.Storage.exportJsonFile(state);
  }

  async function importDataJson(file) {
    const data = await SSD.Storage.importJsonFile(file);
    // Meldungen aus einem älteren Backup sollen nicht erneut an Teams gehen.
    data.teamsOutbox = [];
    return data;
  }

  /* ---------------------------------------------------------------------
   * CSV — generischer Parser & Builder
   * ------------------------------------------------------------------- */

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/)[0] || '';
    return (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
  }

  function parseCsv(text) {
    const delimiter = detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const clean = text.replace(/^﻿/, '');

    for (let i = 0; i < clean.length; i++) {
      const char = clean[i];
      if (inQuotes) {
        if (char === '"') {
          if (clean[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else field += char;
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(field); field = '';
      } else if (char === '\n' || char === '\r') {
        if (char === '\r' && clean[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f !== '')) rows.push(row);
        row = [];
      } else {
        field += char;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function csvEscape(value) {
    const str = String(value ?? '');
    return /[;,"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  function buildCsv(rows) {
    return '﻿' + rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
  }

  /* ---------------------------------------------------------------------
   * CSV — Schüler
   * ------------------------------------------------------------------- */

  const STUDENT_CSV_HEADERS = ['Vorname', 'Nachname', 'Benutzername', 'Kategorie', 'Geschlecht', 'Klasse', 'Jahrgang', 'MaxDiensteProWoche', 'Aktiv', 'Bemerkungen'];

  function exportStudentsCsv() {
    const students = SSD.StudentService.getAll();
    const rows = [STUDENT_CSV_HEADERS];
    students.forEach((s) => {
      rows.push([s.firstName, s.lastName, s.username, s.role === 'azubi' ? 'Azubi' : 'Schüler:in', s.gender, s.schoolClass, s.yearGroup ?? '', s.maxDutiesPerWeek ?? '', s.active ? 'ja' : 'nein', s.notes]);
    });
    U.downloadBlob(`schueler_export_${U.toIsoDate(U.today())}.csv`, buildCsv(rows), 'text/csv;charset=utf-8');
  }

  /**
   * Liest eine CSV-Datei mit Schülerdaten ein (Kopfzeile erforderlich,
   * Spaltennamen wie beim Export). Gibt eine Liste von Rohdatensätzen
   * zurück — das Anlegen der Accounts (inkl. Passwortvergabe) erfolgt in
   * der aufrufenden UI, da dort ein Fortschritts-/Bestätigungsdialog
   * gezeigt wird.
   */
  async function parseStudentsCsv(file) {
    const text = await U.readFileAsText(file);
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name) => header.indexOf(name.toLowerCase());
    // Felder immer ohne Leerzeichen am Rand — aus Excel kommen z. B. "anna.m " oder " 10b" vor;
    // ein Benutzername mit Leerzeichen am Ende ließe sich sonst nie anmelden.
    const cell = (row, name) => (idx(name) >= 0 ? String(row[idx(name)] ?? '').trim() : '');
    const genderKey = (value) => {
      const first = value.toLowerCase().charAt(0);
      return ['w', 'm', 'd'].includes(first) ? first : 'd';
    };
    const positiveIntOrNull = (value) => {
      const n = Number(value);
      return value !== '' && Number.isInteger(n) && n >= 0 ? n : null;
    };

    return rows.slice(1).map((row) => ({
      firstName: cell(row, 'Vorname'),
      lastName: cell(row, 'Nachname'),
      username: cell(row, 'Benutzername'),
      role: /azubi/i.test(cell(row, 'Kategorie')) ? 'azubi' : 'student',
      gender: genderKey(cell(row, 'Geschlecht')),
      schoolClass: cell(row, 'Klasse'),
      yearGroup: positiveIntOrNull(cell(row, 'Jahrgang')) || null,
      maxDutiesPerWeek: positiveIntOrNull(cell(row, 'MaxDiensteProWoche')),
      active: idx('Aktiv') >= 0 ? !/^(nein|false|0)$/i.test(cell(row, 'Aktiv')) : true,
      notes: cell(row, 'Bemerkungen'),
      password: cell(row, 'Passwort'),
    })).filter((s) => s.firstName || s.lastName);
  }

  /* ---------------------------------------------------------------------
   * CSV — Dienstplan
   * ------------------------------------------------------------------- */

  /**
   * Gemeinsame Tabelle für CSV/Excel: so viele Schüler:innen-Spalten wie der
   * am stärksten besetzte Dienst (mind. 2) plus Azubi — bei "3 Personen pro
   * Dienst" ging die dritte Person sonst im Export verloren.
   */
  function scheduleTable(entries) {
    const personName = (id) => {
      if (!id) return '';
      const s = SSD.StudentService.getById(id);
      return s ? SSD.StudentService.fullName(s) : '(gelöscht)';
    };
    const seatCount = Math.max(2, ...entries.map((e) => e.studentIds.length));
    const header = ['Datum', 'Wochentag', 'Block', ...Array.from({ length: seatCount }, (_, i) => `Schüler:in ${i + 1}`), 'Azubi'];
    const rows = entries
      .slice()
      .sort((a, b) => (a.date + a.block).localeCompare(b.date + b.block))
      .map((entry) => [
        entry.date, U.WEEKDAY_LABELS[entry.weekday], U.blockLabel(entry.block),
        ...Array.from({ length: seatCount }, (_, i) => personName(entry.studentIds[i])),
        personName(entry.azubiId),
      ]);
    return { header, rows };
  }

  function exportScheduleCsv(entries) {
    const { header, rows } = scheduleTable(entries);
    U.downloadBlob(`dienstplan_export_${U.toIsoDate(U.today())}.csv`, buildCsv([header, ...rows]), 'text/csv;charset=utf-8');
  }

  /* ---------------------------------------------------------------------
   * "Excel"-Export (HTML-Tabelle mit .xls-Endung — von Excel nativ lesbar)
   * ------------------------------------------------------------------- */

  function downloadHtmlAsExcel(filename, title, headerCells, bodyRows) {
    const styles = `
      table { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 12px; }
      th { background: #2f6feb; color: #fff; padding: 6px 10px; text-align: left; }
      td { padding: 5px 10px; border: 1px solid #d7dee8; }
      caption { text-align:left; font-size: 16px; font-weight:bold; padding: 8px 0; }
    `;
    const thead = `<tr>${headerCells.map((h) => `<th>${U.escapeHtml(h)}</th>`).join('')}</tr>`;
    const tbody = bodyRows.map((row) => `<tr>${row.map((c) => `<td>${U.escapeHtml(c)}</td>`).join('')}</tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${styles}</style></head>
      <body><table><caption>${U.escapeHtml(title)}</caption><thead>${thead}</thead><tbody>${tbody}</tbody></table></body></html>`;
    U.downloadBlob(filename, html, 'application/vnd.ms-excel');
  }

  function exportStudentsExcel() {
    const students = SSD.StudentService.getAll();
    downloadHtmlAsExcel(
      `schueler_export_${U.toIsoDate(U.today())}.xls`,
      'Schülerliste — Schulsanitätsdienst',
      STUDENT_CSV_HEADERS,
      students.map((s) => [s.firstName, s.lastName, s.username, s.role === 'azubi' ? 'Azubi' : 'Schüler:in', s.gender, s.schoolClass, s.yearGroup ?? '', s.maxDutiesPerWeek ?? '', s.active ? 'ja' : 'nein', s.notes])
    );
  }

  function exportScheduleExcel(entries) {
    const { header, rows } = scheduleTable(entries);
    downloadHtmlAsExcel(`dienstplan_export_${U.toIsoDate(U.today())}.xls`, 'Dienstplan — Schulsanitätsdienst', header, rows);
  }

  /* ---------------------------------------------------------------------
   * Druck / PDF
   * ------------------------------------------------------------------- */

  function triggerPrint() {
    window.print();
  }

  return {
    exportDataJson, importDataJson,
    parseCsv, buildCsv,
    exportStudentsCsv, parseStudentsCsv, exportStudentsExcel,
    exportScheduleCsv, exportScheduleExcel,
    triggerPrint,
  };
})();
