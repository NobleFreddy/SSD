/**
 * ============================================================================
 * SSD.EngagementPanel — Engagement-Übersicht (Tabelle, Export, Nachweise)
 * ============================================================================
 * Zeigt je Person geleistete Dienste, Einspringen, Veranstaltungen, erledigte
 * Aufgaben und besuchte Teamtreffen (siehe `SSD.EngagementService`).
 * Administrator und Sanisprecher:innen sehen dieselbe Tabelle und können sie
 * als CSV exportieren; druckbare Nachweise zum Unterschreiben (z. B. für
 * Zeugnisbemerkungen) erstellt nur der Administrator — er bestätigt die Zahlen.
 */
window.SSD = window.SSD || {};

SSD.EngagementPanel = (function () {
  'use strict';

  const U = SSD.Utils;
  // Zeitraum und Sortierung bleiben beim Neuzeichnen (z. B. nach Realtime-Updates) erhalten.
  let range = null; // { from, to }
  let sortKey = 'name';
  let sortDir = 1;

  const COLUMNS = [
    { key: 'name', label: 'Name' },
    { key: 'duties', label: 'Dienste', numeric: true, hint: 'Geleistete Dienste bis einschließlich heute' },
    { key: 'jumpIns', label: 'Eingesprungen', numeric: true, hint: 'Davon als Vertretung oder für einen offenen Platz übernommen' },
    { key: 'events', label: 'Veranstaltungen', numeric: true },
    { key: 'tasks', label: 'Aufgaben', numeric: true, hint: 'Erledigte Aufgaben' },
    { key: 'meetings', label: 'Teamtreffen', numeric: true, hint: 'Besucht / Treffen mit erfasster Anwesenheit' },
  ];

  function sortValue(row, key) {
    if (key === 'name') return `${row.person.lastName} ${row.person.firstName}`.toLowerCase();
    if (key === 'meetings') return row.meetingsAttended;
    return row[key];
  }

  function sortRows(rows) {
    return rows.slice().sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -sortDir;
      if (va > vb) return sortDir;
      return sortValue(a, 'name').localeCompare(sortValue(b, 'name'));
    });
  }

  /* ---------------------------------------------------------------------
   * Nachweise drucken (nur Administrator)
   * ------------------------------------------------------------------- */

  function certificateHtml(rows, result) {
    const esc = U.escapeHtml;
    const school = SSD.SettingsService.getSchool().name || '';
    const logoUrl = new URL('assets/logo.png', window.location.href).href;
    const fromLabel = U.formatDateMedium(U.parseIsoDate(result.from));
    const untilLabel = U.formatDateMedium(U.parseIsoDate(result.until));

    const pages = rows.map((r) => {
      const p = r.person;
      const leadership = SSD.Models.LEADERSHIP_ROLES.find((l) => l.key === p.leadershipRole)?.label;
      const lines = [
        ['Geleistete Dienste', `${r.duties}${r.jumpIns ? ` (davon ${r.jumpIns}× eingesprungen)` : ''}`],
        ['Sanitätsdienst bei Veranstaltungen', String(r.events)],
        ['Erledigte Aufgaben', String(r.tasks)],
        ['Teilnahme an Teamtreffen', r.meetingsTotal ? `${r.meetingsAttended} von ${r.meetingsTotal}` : String(r.meetingsAttended)],
      ];
      return `<section class="page">
  <header><img src="${esc(logoUrl)}" alt=""><div><strong>Schulsanitätsdienst</strong><br>${esc(school)}</div></header>
  <h1>Nachweis über die Mitarbeit im Schulsanitätsdienst</h1>
  <p class="lead"><strong>${esc(SSD.StudentService.fullName(p))}</strong>${p.schoolClass ? `, Klasse ${esc(p.schoolClass)}` : ''},
  hat im Zeitraum vom ${esc(fromLabel)} bis ${esc(untilLabel)} im Schulsanitätsdienst${school ? ` der Schule ${esc(school)}` : ''} mitgearbeitet${p.role === 'azubi' ? ' (in Ausbildung)' : ''}.</p>
  <table>${lines.map(([label, value]) => `<tr><td>${esc(label)}</td><td><strong>${esc(value)}</strong></td></tr>`).join('')}</table>
  ${leadership ? `<p>Funktion im Team: <strong>${esc(leadership)}</strong></p>` : ''}
  <div class="sign"><div>Ort, Datum</div><div>Unterschrift (Leitung Schulsanitätsdienst)</div></div>
</section>`;
    }).join('\n');

    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Nachweis Schulsanitätsdienst</title><style>
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 14px; line-height: 1.5; margin: 0; }
  .page { break-after: page; page-break-after: always; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #c8102e; padding-bottom: 10px; }
  header img { width: 60px; height: 60px; object-fit: contain; }
  h1 { font-size: 20px; margin: 34px 0 16px; }
  .lead { margin: 0 0 18px; }
  table { border-collapse: collapse; margin: 0 0 18px; }
  td { padding: 6px 28px 6px 0; border-bottom: 1px solid #ddd; }
  .sign { margin-top: 80px; display: flex; gap: 60px; }
  .sign div { border-top: 1px solid #333; padding-top: 4px; width: 230px; font-size: 12px; color: #444; }
</style></head><body>
${pages}
</body></html>`;
  }

  /** Druckt über einen unsichtbaren Rahmen — die App selbst bleibt unverändert sichtbar. */
  function printCertificates(rows, result) {
    if (!rows.length) {
      SSD.Toast.info('Nichts zu drucken', 'Im gewählten Zeitraum hat niemand Dienste oder anderes Engagement.');
      return;
    }
    const frame = U.el('iframe', { title: 'Nachweis', style: 'position:fixed; right:0; bottom:0; width:0; height:0; border:0;' });
    frame.addEventListener('load', () => {
      const win = frame.contentWindow;
      win.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 0));
      setTimeout(() => frame.remove(), 120000); // Rückfalllösung, falls "afterprint" ausbleibt
      win.focus();
      win.print();
    }, { once: true });
    frame.srcdoc = certificateHtml(rows, result);
    document.body.appendChild(frame);
  }

  /* ---------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------- */

  function schoolYearOptions() {
    const end = U.schoolYearEnd(U.today());
    return [end, end - 1, end - 2].map((y) => SSD.EngagementService.schoolYearRange(y));
  }

  /** @param {{ onChange?: Function }} [opts] */
  function render(opts) {
    const cfg = opts || {};
    const isAdmin = SSD.Auth.isAdminSession();
    if (!range) {
      const current = SSD.EngagementService.currentSchoolYearRange();
      range = { from: current.from, to: current.to };
    }
    const result = SSD.EngagementService.compute(range.from, range.to);
    const rows = sortRows(result.rows);

    const card = U.el('div', { class: 'card' });
    const rerender = () => card.replaceWith(render(cfg));

    // Zeitraum
    const years = schoolYearOptions();
    const matching = years.find((y) => y.from === range.from && y.to === range.to);
    const yearSelect = U.el('select', { class: 'select', style: 'width:auto;' }, [
      ...years.map((y) => U.el('option', { value: y.from, selected: matching === y }, [`Schuljahr ${y.label}`])),
      U.el('option', { value: '', selected: !matching }, ['Eigener Zeitraum']),
    ]);
    yearSelect.addEventListener('change', () => {
      const chosen = years.find((y) => y.from === yearSelect.value);
      if (!chosen) return;
      range = { from: chosen.from, to: chosen.to };
      rerender();
    });
    const fromInput = U.el('input', { class: 'input', type: 'date', value: range.from, style: 'width:auto;' });
    const toInput = U.el('input', { class: 'input', type: 'date', value: range.to, style: 'width:auto;' });
    [fromInput, toInput].forEach((input) => input.addEventListener('change', () => {
      if (!fromInput.value || !toInput.value) return;
      if (toInput.value < fromInput.value) { SSD.Toast.warning('Zeitraum prüfen', 'Das Enddatum liegt vor dem Beginn.'); return; }
      range = { from: fromInput.value, to: toInput.value };
      rerender();
    }));

    const csvBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('fileCsv', { size: 14 }) }, ['CSV']);
    csvBtn.addEventListener('click', () => SSD.EngagementService.exportCsv({ rows, from: result.from, to: result.to, until: result.until }));
    const actions = [csvBtn];
    if (isAdmin) {
      const printAllBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('print', { size: 14 }) }, ['Alle Nachweise drucken']);
      printAllBtn.addEventListener('click', () => printCertificates(rows.filter((r) => r.duties || r.events || r.tasks || r.meetingsAttended), result));
      actions.push(printAllBtn);
    }

    card.appendChild(U.el('div', { class: 'card__header' }, [
      U.el('div', {}, [
        U.el('div', { class: 'card__title' }, ['Engagement-Übersicht']),
        U.el('div', { class: 'card__subtitle' }, ['Was jede:r im Zeitraum für den Schulsanitätsdienst getan hat — gezählt bis einschließlich heute.']),
      ]),
      U.el('div', { class: 'cluster gap-2' }, actions),
    ]));

    const body = U.el('div', { class: 'card__body stack gap-4' });
    body.appendChild(U.el('div', { class: 'cluster gap-2' }, [
      yearSelect,
      U.el('span', { class: 'text-tertiary' }, ['von']), fromInput,
      U.el('span', { class: 'text-tertiary' }, ['bis']), toInput,
    ]));

    if (!rows.length) {
      body.appendChild(U.el('div', { class: 'empty-state' }, [
        U.el('span', { html: SSD.Icons.svg('award', { size: 40 }) }),
        U.el('h3', {}, ['Noch keine Daten im Zeitraum']),
      ]));
    } else {
      const totalDuties = rows.reduce((sum, r) => sum + r.duties, 0);
      body.appendChild(U.el('p', { class: 'text-secondary', style: 'margin:0; font-size:var(--font-size-sm);' }, [
        `${rows.length} Person(en) · ${totalDuties} geleistete Dienste${result.until < result.to ? ` · gezählt bis ${U.formatDateMedium(U.parseIsoDate(result.until))}` : ''}`,
      ]));

      const headRow = U.el('tr', {}, COLUMNS.map((col) => {
        const sorted = sortKey === col.key;
        const th = U.el('th', {
          class: `is-sortable${sorted ? ' is-sorted' : ''}${col.numeric ? ' num' : ''}`,
          'data-tooltip': col.hint,
          'aria-sort': sorted ? (sortDir === 1 ? 'ascending' : 'descending') : 'none',
          tabindex: '0',
        }, [`${col.label}${sorted ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}`]);
        const toggleSort = () => {
          if (sortKey === col.key) sortDir = -sortDir;
          else { sortKey = col.key; sortDir = col.numeric ? -1 : 1; }
          rerender();
        };
        th.addEventListener('click', toggleSort);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(); } });
        return th;
      }));
      if (isAdmin) headRow.appendChild(U.el('th', { style: 'text-align:right' }, ['Nachweis']));

      const bodyRows = rows.map((r) => {
        const p = r.person;
        const cells = [
          U.el('td', {}, [
            U.el('div', { class: 'cluster gap-2', style: 'font-weight:600;' }, [
              SSD.StudentService.fullName(p),
              p.role === 'azubi' ? U.el('span', { class: 'badge badge--primary' }, ['Azubi']) : null,
              p.active ? null : U.el('span', { class: 'badge' }, ['inaktiv']),
            ]),
            p.schoolClass ? U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [`Klasse ${p.schoolClass}`]) : null,
          ]),
          U.el('td', { class: 'num' }, [String(r.duties)]),
          U.el('td', { class: 'num' }, [String(r.jumpIns)]),
          U.el('td', { class: 'num' }, [String(r.events)]),
          U.el('td', { class: 'num' }, [String(r.tasks)]),
          U.el('td', { class: 'num' }, [r.meetingsTotal ? `${r.meetingsAttended} / ${r.meetingsTotal}` : String(r.meetingsAttended)]),
        ];
        if (isAdmin) {
          const printBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Nachweis drucken', 'aria-label': `Nachweis für ${SSD.StudentService.fullName(p)} drucken`, html: SSD.Icons.svg('print', { size: 15 }) });
          printBtn.addEventListener('click', () => printCertificates([r], result));
          cells.push(U.el('td', {}, [U.el('div', { class: 'data-table__actions' }, [printBtn])]));
        }
        return U.el('tr', {}, cells);
      });

      body.appendChild(U.el('div', { class: 'table-wrap' }, [
        U.el('table', { class: 'data-table' }, [U.el('thead', {}, [headRow]), U.el('tbody', {}, bodyRows)]),
      ]));
    }

    body.appendChild(U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, [
      isAdmin
        ? 'Nachweis drucken: eine Seite pro Person zum Unterschreiben, z. B. als Grundlage für Zeugnisbemerkungen. Abwesenheitsgründe werden nicht ausgewertet.'
        : 'Grundlage z. B. für Zeugnisbemerkungen — Nachweise zum Unterschreiben erstellt die Administration. Abwesenheitsgründe werden nicht ausgewertet.',
    ]));
    card.appendChild(body);
    return card;
  }

  return { render, certificateHtml };
})();
