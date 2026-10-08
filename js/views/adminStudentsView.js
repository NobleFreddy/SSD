/**
 * ============================================================================
 * SSD.Views.AdminStudents — Schülerverwaltung (Admin)
 * ============================================================================
 * Anlegen, Bearbeiten, Deaktivieren und Löschen von Schülerkonten sowie
 * Suche/Filter und CSV/Excel-Import/-Export der Schülerliste.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminStudents = (function () {
  'use strict';

  const U = SSD.Utils;
  let layoutHandle = null;
  let unsubscribe = null;
  const filters = { query: '', schoolClass: '', gender: '', yearGroup: '', status: '', role: '' };
  let sort = { key: 'lastName', dir: 1 };

  /* ---------------------------------------------------------------------
   * Formular-Modal (Anlegen / Bearbeiten)
   * ------------------------------------------------------------------- */

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  function openStudentModal(existing) {
    const isEdit = !!existing;
    const settings = SSD.SettingsService.get();

    const firstNameInput = U.el('input', { class: 'input', value: existing?.firstName || '' });
    const lastNameInput = U.el('input', { class: 'input', value: existing?.lastName || '' });
    const usernameInput = U.el('input', { class: 'input', value: existing?.username || '', autocomplete: 'off' });
    const passwordInput = U.el('input', { class: 'input', autocomplete: 'off', spellcheck: 'false', placeholder: isEdit ? 'Unverändert lassen' : `mind. ${SSD.Auth.PASSWORD_MIN_LENGTH} Zeichen` });
    if (!isEdit) passwordInput.value = SSD.Auth.generateInitialPassword();
    const generateBtn = U.el('button', { type: 'button', class: 'btn btn--secondary', 'data-tooltip': 'Zufälliges Startpasswort', 'aria-label': 'Zufälliges Startpasswort', html: SSD.Icons.svg('refresh', { size: 15 }) });
    generateBtn.addEventListener('click', () => { passwordInput.value = SSD.Auth.generateInitialPassword(); passwordInput.focus(); });

    const roleSelect = U.el('select', { class: 'select' }, SSD.Models.ROLES.map((r) => U.el('option', { value: r.key, selected: (existing?.role || 'student') === r.key }, [r.label])));
    const genderSelect = U.el('select', { class: 'select' }, SSD.Models.GENDERS.map((g) => U.el('option', { value: g.key, selected: existing?.gender === g.key || (!existing && g.key === 'n') }, [g.label])));
    const classInput = U.el('input', { class: 'input', value: existing?.schoolClass || '', placeholder: 'z. B. 10a' });
    const yearInput = U.el('input', { class: 'input', type: 'number', value: existing?.yearGroup || '', placeholder: `z. B. ${U.schoolYearEnd() + 2}` });
    const maxDutiesInput = U.el('input', { class: 'input', type: 'number', min: '0', value: existing?.maxDutiesPerWeek ?? '', placeholder: `Standard (${settings.maxDutiesPerWeek})` });
    const notesInput = U.el('textarea', { class: 'input', rows: '2', placeholder: SSD.Utils.FREE_TEXT_HINT }, [existing?.notes || '']);
    const adminMessageInput = U.el('textarea', { class: 'input', rows: '2', placeholder: 'Wird der Person im Dashboard angezeigt' }, [existing?.adminMessage || '']);
    const activeCheckbox = U.el('input', { type: 'checkbox' });
    activeCheckbox.checked = existing ? existing.active : true;

    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      U.el('div', { class: 'grid grid-cols-2' }, [field('Vorname', firstNameInput), field('Nachname', lastNameInput)]),
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Benutzername', usernameInput, 'Zum Anmelden im Schülerbereich.'),
        field(isEdit ? 'Neues Passwort' : 'Startpasswort', U.el('div', { class: 'cluster gap-2', style: 'flex-wrap:nowrap;' }, [passwordInput, generateBtn]),
          'Bitte der Person persönlich mitteilen — sie muss es bei der ersten Anmeldung ändern.'),
      ]),
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Kategorie', roleSelect, 'Azubis erhalten keine Zweier-Zuteilung, sondern werden einzeln als dritte Person zu Diensten hinzugefügt.'),
        field('Geschlecht (freiwillig)', genderSelect, 'Nur für die Gewichtung „gemischte Teams“.'),
      ]),
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Klasse', classInput),
        field('Abijahrgang', yearInput, 'Jahr des Abiturs — wird für Abijahrgangs-Regeln der Verteilung genutzt.'),
      ]),
      field('Maximale Dienste pro Woche', maxDutiesInput, 'Leer lassen für den globalen Standardwert.'),
      field('Bemerkungen', notesInput, `Sichtbar für die Administration und die Person selbst. ${SSD.Utils.FREE_TEXT_HINT}`),
      field('Persönlicher Hinweis', adminMessageInput, `Erscheint im Dashboard der Person. ${SSD.Utils.FREE_TEXT_HINT}`),
      existing && (existing.role || 'student') === 'student' ? U.el('div', { class: 'field' }, [
        U.el('label', { class: 'field__label' }, ['Wunschpartner:innen (selbst gewählt)']),
        U.el('div', { class: 'cluster gap-2' }, SSD.StudentService.getPreferredPartners(existing).length
          ? SSD.StudentService.getPreferredPartners(existing).map((p) => U.el('span', { class: 'badge' }, [SSD.StudentService.fullName(p)]))
          : [U.el('span', { class: 'text-tertiary' }, ['— keine —'])]),
      ]) : null,
      existing?.pendingApproval ? U.el('div', { class: 'notice-box' }, [
        U.el('span', { html: SSD.Icons.svg('info', { size: 18 }) }),
        U.el('div', {}, [U.el('strong', {}, ['Selbstregistrierung']), U.el('p', {}, ['Diese Person hat sich selbst registriert und wartet auf Freischaltung. Konto aktivieren, um sie für Dienste verfügbar zu machen.'])]),
      ]) : null,
      U.el('label', { class: 'checkbox-row' }, [activeCheckbox, U.el('span', {}, ['Konto aktiv (kann sich anmelden und eingeteilt werden)'])]),
    ]);

    const footerButtons = [
      { label: 'Abbrechen', variant: 'secondary' },
    ];

    if (isEdit) {
      footerButtons.push({
        label: 'Löschen', variant: 'danger', closeOnClick: false,
        onClick: async () => {
          const ok = await SSD.Dialog.confirm({
            title: 'Schüler:in löschen', danger: true, confirmLabel: 'Endgültig löschen',
            message: `"${SSD.StudentService.fullName(existing)}" wird inklusive aller zugehörigen Dienstplan-Einträge unwiderruflich gelöscht. Fortfahren?`,
          });
          if (ok) {
            SSD.StudentService.remove(existing.id);
            SSD.Toast.success('Gelöscht', 'Der Schüler wurde entfernt.');
            handle.close();
          }
        },
      });
    }

    footerButtons.push({
      label: isEdit ? 'Speichern' : 'Schüler anlegen', variant: 'primary', closeOnClick: false,
      onClick: async () => {
        errorBox.style.display = 'none';
        const data = {
          firstName: firstNameInput.value.trim(),
          lastName: lastNameInput.value.trim(),
          username: usernameInput.value.trim(),
          role: roleSelect.value,
          gender: genderSelect.value,
          schoolClass: classInput.value.trim(),
          yearGroup: Number(yearInput.value) || null,
          maxDutiesPerWeek: maxDutiesInput.value ? Number(maxDutiesInput.value) : null,
          notes: notesInput.value.trim(),
          adminMessage: adminMessageInput.value.trim(),
        };

        const problems = [];
        if (!U.Validate.required(data.firstName)) problems.push('Bitte einen Vornamen eingeben.');
        if (!U.Validate.required(data.lastName)) problems.push('Bitte einen Nachnamen eingeben.');
        if (!U.Validate.usernameFormat(data.username)) problems.push('Benutzername: 3–32 Zeichen, nur Buchstaben/Zahlen/._-');
        else if (SSD.Auth.isUsernameTaken(data.username, existing?.id)) problems.push('Dieser Benutzername ist bereits vergeben.');
        const minLength = SSD.Auth.PASSWORD_MIN_LENGTH;
        if (!isEdit && !U.Validate.minLength(passwordInput.value, minLength)) problems.push(`Das Passwort muss mindestens ${minLength} Zeichen lang sein.`);
        if (isEdit && passwordInput.value && !U.Validate.minLength(passwordInput.value, minLength)) problems.push(`Das neue Passwort muss mindestens ${minLength} Zeichen lang sein.`);

        if (problems.length) {
          errorBox.textContent = problems[0];
          errorBox.style.display = 'flex';
          return;
        }

        try {
          if (isEdit) {
            data.active = activeCheckbox.checked;
            SSD.StudentService.update(existing.id, data);
            if (passwordInput.value) await SSD.StudentService.resetPassword(existing.id, passwordInput.value);
            SSD.Toast.success('Gespeichert', `${data.firstName} ${data.lastName} wurde aktualisiert.`);
          } else {
            await SSD.StudentService.create({ ...data, password: passwordInput.value });
            SSD.Toast.success('Angelegt', `${data.firstName} ${data.lastName} wurde hinzugefügt. Startpasswort bitte persönlich mitteilen.`);
          }
        } catch (err) {
          errorBox.textContent = String(err.message || err);
          errorBox.style.display = 'flex';
          return;
        }
        handle.close();
      },
    });

    const handle = SSD.Dialog.open({
      title: isEdit ? 'Schüler:in bearbeiten' : 'Neue:n Schüler:in anlegen',
      body, wide: true, footerButtons,
    });
  }

  /* ---------------------------------------------------------------------
   * CSV-Import-Dialog
   * ------------------------------------------------------------------- */

  async function handleCsvImport() {
    const file = await U.pickFile('.csv,text/csv');
    if (!file) return;
    let rows;
    try {
      rows = await SSD.ImportExport.parseStudentsCsv(file);
    } catch (err) {
      SSD.Toast.error('Import fehlgeschlagen', String(err.message || err));
      return;
    }
    if (!rows.length) { SSD.Toast.warning('Keine Daten gefunden', 'Die CSV-Datei enthält keine gültigen Schülerzeilen.'); return; }

    const minLength = SSD.Auth.PASSWORD_MIN_LENGTH;
    const ok = await SSD.Dialog.confirm({
      title: 'Schüler:innen importieren',
      message: `${rows.length} Schüler:innen werden neu angelegt. Zeilen ohne Passwort erhalten ein zufälliges Startpasswort (Liste folgt), Passwörter unter ${minLength} Zeichen werden ersetzt. Alle müssen ihr Passwort bei der ersten Anmeldung ändern. Fortfahren?`,
      confirmLabel: `${rows.length} importieren`,
    });
    if (!ok) return;

    const entries = [];
    const generated = [];
    let skipped = 0;
    const taken = new Set();
    for (const row of rows) {
      const username = (row.username || U.slugifyUsername(`${row.firstName}.${row.lastName}`).slice(0, 32)).trim();
      // Gleiche Regeln wie beim Anlegen per Formular — sonst entstünden Konten, mit denen sich niemand anmelden kann.
      if (!U.Validate.usernameFormat(username) || SSD.Auth.isUsernameTaken(username) || taken.has(username.toLowerCase())) { skipped++; continue; }
      taken.add(username.toLowerCase());
      const password = row.password && row.password.length >= minLength ? row.password : SSD.Auth.generateInitialPassword();
      if (password !== row.password) generated.push({ name: `${row.firstName} ${row.lastName}`.trim(), username, password });
      entries.push({ ...row, username, password });
    }

    SSD.Toast.info('Import läuft', `${entries.length} Konten werden angelegt …`);
    const { failed } = await SSD.StudentService.createMany(entries);
    SSD.Toast.success('Import abgeschlossen', `${entries.length - failed.length} angelegt, ${skipped} übersprungen (Duplikate/ungültig)${failed.length ? `, ${failed.length} ohne Passwort` : ''}.`);
    if (generated.length) showInitialPasswords(generated.filter((g) => !failed.some((f) => f.student.username === g.username)));
  }

  /** Einmalige Anzeige der erzeugten Startpasswörter (werden nirgends gespeichert). */
  function showInitialPasswords(list) {
    if (!list.length) return;
    const text = list.map((g) => [g.name, g.username, g.password].join('\t')).join('\n');
    const copyBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('copy', { size: 15 }) }, ['Liste kopieren']);
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(['Name\tBenutzername\tStartpasswort', text].join('\n'));
        SSD.Toast.success('Kopiert', 'Die Liste liegt in der Zwischenablage.');
      } catch (err) {
        SSD.Toast.warning('Kopieren nicht möglich', 'Bitte die Tabelle markieren und manuell kopieren.');
      }
    });
    const table = U.el('table', { class: 'table' }, [
      U.el('thead', {}, [U.el('tr', {}, [U.el('th', {}, ['Name']), U.el('th', {}, ['Benutzername']), U.el('th', {}, ['Startpasswort'])])]),
      U.el('tbody', {}, list.map((g) => U.el('tr', {}, [U.el('td', {}, [g.name]), U.el('td', {}, [g.username]), U.el('td', { style: 'font-family:var(--font-mono, monospace);' }, [g.password])]))),
    ]);
    SSD.Dialog.open({
      title: 'Startpasswörter',
      wide: true,
      body: U.el('div', { class: 'stack gap-3' }, [
        U.el('p', { style: 'margin:0;' }, ['Diese Passwörter werden nur jetzt angezeigt und nirgends gespeichert. Bitte jeder Person persönlich mitteilen — bei der ersten Anmeldung muss sie ein eigenes Passwort wählen. Ausdrucke oder kopierte Listen danach vernichten bzw. löschen.']),
        U.el('div', { class: 'table-wrap' }, [table]),
        U.el('div', {}, [copyBtn]),
      ]),
      footerButtons: [{ label: 'Fertig', variant: 'primary' }],
      closeOnOverlayClick: false,
    });
  }

  /* ---------------------------------------------------------------------
   * Tabelle & Filter
   * ------------------------------------------------------------------- */

  function buildHeader() {
    const importBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('upload', { size: 16 }) }, ['CSV importieren']);
    importBtn.addEventListener('click', handleCsvImport);

    const exportCsvBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('fileCsv', { size: 16 }) }, ['CSV']);
    exportCsvBtn.addEventListener('click', () => SSD.ImportExport.exportStudentsCsv());
    const exportExcelBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('fileExcel', { size: 16 }) }, ['Excel']);
    exportExcelBtn.addEventListener('click', () => SSD.ImportExport.exportStudentsExcel());

    const addBtn = U.el('button', { class: 'btn btn--primary', html: SSD.Icons.svg('plus', { size: 16 }) }, ['Schüler hinzufügen']);
    addBtn.addEventListener('click', () => openStudentModal(null));

    return U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [
        U.el('h1', {}, ['Schülerverwaltung']),
        U.el('p', {}, [`${SSD.StudentService.getAll().length} Schüler:innen im System`]),
      ]),
      U.el('div', { class: 'page-header__actions' }, [importBtn, exportCsvBtn, exportExcelBtn, addBtn]),
    ]);
  }

  function buildFilterBar() {
    const searchInput = U.el('input', { class: 'input', placeholder: 'Suche nach Name, Benutzername, Klasse …', value: filters.query });
    searchInput.addEventListener('input', U.debounce(() => { filters.query = searchInput.value; renderContent(); }, 200));

    const roleSelect = U.el('select', { class: 'select' }, [
      U.el('option', { value: '' }, ['Alle Kategorien']),
      ...SSD.Models.ROLES.map((r) => U.el('option', { value: r.key, selected: filters.role === r.key }, [r.label])),
    ]);
    roleSelect.addEventListener('change', () => { filters.role = roleSelect.value; renderContent(); });

    const classSelect = U.el('select', { class: 'select' }, [
      U.el('option', { value: '' }, ['Alle Klassen']),
      ...SSD.StudentService.getDistinctClasses().map((c) => U.el('option', { value: c, selected: filters.schoolClass === c }, [c])),
    ]);
    classSelect.addEventListener('change', () => { filters.schoolClass = classSelect.value; renderContent(); });

    const genderSelect = U.el('select', { class: 'select' }, [
      U.el('option', { value: '' }, ['Alle Geschlechter']),
      ...SSD.Models.GENDERS.map((g) => U.el('option', { value: g.key, selected: filters.gender === g.key }, [g.label])),
    ]);
    genderSelect.addEventListener('change', () => { filters.gender = genderSelect.value; renderContent(); });

    const yearSelect = U.el('select', { class: 'select' }, [
      U.el('option', { value: '' }, ['Alle Abijahrgänge']),
      ...SSD.StudentService.getDistinctYearGroups().map((y) => U.el('option', { value: y, selected: String(filters.yearGroup) === String(y) }, [String(y)])),
    ]);
    yearSelect.addEventListener('change', () => { filters.yearGroup = yearSelect.value; renderContent(); });

    const statusSelect = U.el('select', { class: 'select' }, [
      U.el('option', { value: '' }, ['Aktiv & Inaktiv']),
      U.el('option', { value: 'active', selected: filters.status === 'active' }, ['Nur aktive']),
      U.el('option', { value: 'inactive', selected: filters.status === 'inactive' }, ['Nur inaktive']),
    ]);
    statusSelect.addEventListener('change', () => { filters.status = statusSelect.value; renderContent(); });

    return U.el('div', { class: 'filter-bar card--flat' }, [
      U.el('div', { class: 'search-box' }, [U.el('span', { html: SSD.Icons.svg('search', { size: 17 }) }), searchInput]),
      roleSelect, classSelect, genderSelect, yearSelect, statusSelect,
    ]);
  }

  function sortIndicator(key) {
    return sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
  }

  function buildTable() {
    let list = SSD.StudentService.filterStudents(SSD.StudentService.getAll(), filters);
    const overview = SSD.StatisticsService.computeOverview();
    const dutyCounts = new Map([
      ...overview.perStudentList.map((p) => [p.student.id, p.count]),
      ...overview.azubi.perAzubiList.map((p) => [p.student.id, p.count]),
    ]);

    list = list.sort((a, b) => {
      let av, bv;
      if (sort.key === 'duties') { av = dutyCounts.get(a.id) || 0; bv = dutyCounts.get(b.id) || 0; }
      else { av = String(a[sort.key] || '').toLowerCase(); bv = String(b[sort.key] || '').toLowerCase(); }
      return av > bv ? sort.dir : av < bv ? -sort.dir : 0;
    });

    const columns = [
      { key: 'lastName', label: 'Name' },
      { key: 'role', label: 'Kategorie' },
      { key: 'schoolClass', label: 'Klasse' },
      { key: 'yearGroup', label: 'Abijahrgang' },
      { key: 'gender', label: 'Geschlecht' },
      { key: 'duties', label: 'Dienste' },
      { key: 'maxDutiesPerWeek', label: 'Max/Woche' },
      { key: 'active', label: 'Status' },
    ];

    const thead = U.el('tr', {}, columns.map((col) => {
      const th = U.el('th', {}, [col.label + sortIndicator(col.key)]);
      th.addEventListener('click', () => {
        sort.dir = sort.key === col.key ? -sort.dir : 1;
        sort.key = col.key;
        renderContent();
      });
      return th;
    }).concat([U.el('th', { style: 'text-align:right;' }, ['Aktionen'])]));

    const tbody = U.el('tbody');
    if (!list.length) {
      tbody.appendChild(U.el('tr', { class: 'data-table--empty-row' }, [U.el('td', { colspan: '9' }, ['Keine Schüler:innen/Azubis gefunden.'])]));
    }
    list.forEach((student) => {
      const genderLabel = SSD.Models.GENDERS.find((g) => g.key === student.gender)?.label || student.gender;
      const roleLabel = SSD.Models.ROLES.find((r) => r.key === (student.role || 'student'))?.label;
      const editBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Bearbeiten', html: SSD.Icons.svg('edit', { size: 15 }) });
      editBtn.addEventListener('click', () => openStudentModal(student));
      const toggleBtn = U.el('button', {
        class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': student.active ? 'Deaktivieren' : 'Aktivieren',
        html: SSD.Icons.svg(student.active ? 'lock' : 'unlock', { size: 15 }),
      });
      toggleBtn.addEventListener('click', () => {
        SSD.StudentService.setActive(student.id, !student.active);
        SSD.Toast.info(student.active ? 'Deaktiviert' : 'Aktiviert', SSD.StudentService.fullName(student));
      });
      const deleteBtn = U.el('button', { class: 'btn btn--icon btn--sm btn--ghost', 'data-tooltip': 'Löschen', html: SSD.Icons.svg('trash', { size: 15 }) });
      deleteBtn.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({ title: 'Löschen bestätigen', danger: true, message: `"${SSD.StudentService.fullName(student)}" wirklich löschen?` });
        if (ok) { SSD.StudentService.remove(student.id); SSD.Toast.success('Gelöscht', 'Der Schüler wurde entfernt.'); }
      });

      const row = U.el('tr', {}, [
        U.el('td', {}, [
          U.el('div', { class: 'data-table__name-cell', style: 'cursor:pointer;' }, [
            U.el('div', { class: 'avatar avatar--sm', style: `background:${U.colorFromString(student.id)}` }, [U.initials(student.firstName, student.lastName)]),
            U.el('div', {}, [
              U.el('div', { class: 'cluster gap-2', style: 'font-weight:600;' }, [
                SSD.StudentService.fullName(student),
                student.leadershipRole ? U.el('span', { class: 'badge badge--primary', html: SSD.Icons.svg('star', { size: 10 }) }, [SSD.Models.LEADERSHIP_ROLES.find((r) => r.key === student.leadershipRole)?.label]) : null,
              ]),
              U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [`@${student.username}`]),
            ]),
          ]),
        ]),
        U.el('td', {}, [U.el('span', { class: `badge ${student.role === 'azubi' ? 'badge--primary' : ''}` }, [roleLabel])]),
        U.el('td', {}, [student.schoolClass || '—']),
        U.el('td', {}, [String(student.yearGroup || '—')]),
        U.el('td', {}, [genderLabel]),
        U.el('td', {}, [String(dutyCounts.get(student.id) || 0)]),
        U.el('td', {}, [String(student.maxDutiesPerWeek || `${SSD.SettingsService.get().maxDutiesPerWeek} (Standard)`)]),
        U.el('td', {}, [
          student.pendingApproval
            ? U.el('span', { class: 'badge badge--warning' }, ['Neu — wartet'])
            : U.el('span', { class: `badge ${student.active ? 'badge--success' : ''}` }, [student.active ? 'Aktiv' : 'Inaktiv']),
        ]),
        U.el('td', {}, [U.el('div', { class: 'data-table__actions' }, [editBtn, toggleBtn, deleteBtn])]),
      ]);
      row.querySelector('.data-table__name-cell').addEventListener('click', () => openStudentModal(student));
      tbody.appendChild(row);
    });

    return U.el('div', { class: 'table-wrap' }, [U.el('table', { class: 'data-table' }, [U.el('thead', {}, [thead]), tbody])]);
  }

  /* ---------------------------------------------------------------------
   * Lifecycle
   * ------------------------------------------------------------------- */

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    layoutHandle.contentEl.appendChild(buildHeader());
    layoutHandle.contentEl.appendChild(buildFilterBar());
    layoutHandle.contentEl.appendChild(buildTable());
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'students');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
