/**
 * ============================================================================
 * SSD.Views.AdminSettings — Einstellungen & Datenverwaltung
 * ============================================================================
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminSettings = (function () {
  'use strict';

  const U = SSD.Utils;
  let layoutHandle = null;
  let unsubscribe = null;

  function field(labelText, inputEl, hint) {
    const wrap = U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
    if (hint) wrap.appendChild(U.el('div', { class: 'field__hint' }, [hint]));
    return wrap;
  }

  function switchRow(labelText, hint, checked, onChange) {
    const checkbox = U.el('input', { type: 'checkbox' });
    checkbox.checked = checked;
    checkbox.addEventListener('change', () => onChange(checkbox.checked));
    return U.el('div', { class: 'switch-row' }, [
      U.el('div', { class: 'switch-row__text' }, [U.el('strong', {}, [labelText]), U.el('span', {}, [hint])]),
      U.el('label', { class: 'switch' }, [checkbox, U.el('span', { class: 'switch__track' })]),
    ]);
  }

  function buildSchoolCard() {
    const school = SSD.SettingsService.getSchool();
    const nameInput = U.el('input', { class: 'input', value: school.name });
    nameInput.addEventListener('change', () => {
      SSD.SettingsService.updateSchool({ name: nameInput.value.trim() || 'Meine Schule' });
      SSD.Toast.success('Gespeichert', 'Schulname aktualisiert.');
    });
    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Schule'])]),
      U.el('div', { class: 'card__body' }, [field('Name der Schule', nameInput)]),
    ]);
  }

  function buildGeneralCard() {
    const s = SSD.SettingsService.get();
    const deadlineInput = U.el('input', { class: 'input', type: 'number', min: '0', max: '6', value: Math.min(6, s.changeDeadlineDaysBeforeWeek) });

    function commit(patch, message) {
      SSD.SettingsService.update(patch);
      SSD.Toast.success('Gespeichert', message);
    }
    deadlineInput.addEventListener('change', () => {
      // Ab 7 Tagen läge die Sperre vor dem Montag der laufenden Woche — die Verfügbarkeit wäre nie änderbar.
      const days = U.clamp(Math.round(Number(deadlineInput.value) || 0), 0, 6);
      deadlineInput.value = String(days);
      commit({ changeDeadlineDaysBeforeWeek: days }, 'Änderungsfrist aktualisiert.');
    });

    const toDistribution = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('sliders', { size: 14 }) }, ['Zur Verteilung']);
    toDistribution.addEventListener('click', () => SSD.Router.navigate('/admin/distribution'));

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Allgemein'])]),
      U.el('div', { class: 'card__body stack gap-2' }, [
        field('Änderungsfrist für Schüler:innen (Tage vor Wochenbeginn)', deadlineInput, 'Ab diesem Zeitpunkt ist die Verfügbarkeit für die Folgewoche gesperrt (0–6 Tage; mit dem neuen Wochenbeginn ist sie wieder änderbar).'),
        U.el('hr', { class: 'divider' }),
        switchRow('Automatisches Speichern', 'Änderungen sofort für alle sichtbar speichern (empfohlen). Bei Deaktivierung erscheint oben ein manueller Speichern-Button.', s.autoSave, (val) => commit({ autoSave: val }, 'Einstellung aktualisiert.')),
        U.el('hr', { class: 'divider' }),
        switchRow(
          'Vertretung automatisch einteilen',
          'Meldet sich jemand im Dashboard ab („Ich falle aus“), teilt die App sofort die passendste verfügbare Person ein — nach denselben Regeln wie der Dienstplan (nur als „Verfügbar“ eingetragene Zeiten, Wochenlimit, Paar-Regeln …). Die eingeteilte Person sieht beim Anmelden einen Hinweis. Ausgeschaltet bleibt der Dienst als „Vertretung gesucht“ offen, bis jemand übernimmt.',
          s.autoSubstitution !== false,
          (val) => commit({ autoSubstitution: val }, val ? 'Vertretungen werden ab jetzt automatisch eingeteilt.' : 'Abmeldungen bleiben ab jetzt als „Vertretung gesucht“ offen.')
        ),
        U.el('hr', { class: 'divider' }),
        U.el('div', { class: 'cluster gap-3', style: 'justify-content:space-between;' }, [
          U.el('span', { class: 'text-secondary', style: 'font-size:var(--font-size-sm);' }, ['Dienste pro Woche, Teamgröße, Prioritäten, Abijahrgangs- und Paar-Regeln finden Sie unter „Verteilung“.']),
          toDistribution,
        ]),
      ]),
    ]);
  }

  function buildRegistrationCard() {
    const s = SSD.SettingsService.get();
    const hasCode = SSD.Auth.hasRegistrationCode();

    const codeInput = U.el('input', { class: 'input', placeholder: hasCode ? 'Neuen Schulcode eingeben' : 'Schulcode festlegen', autocomplete: 'off', spellcheck: 'false', style: 'flex:1; min-width:0;' });
    const generateBtn = U.el('button', { type: 'button', class: 'btn btn--secondary', html: SSD.Icons.svg('refresh', { size: 15 }) }, ['Zufällig']);
    generateBtn.addEventListener('click', () => { codeInput.value = SSD.Auth.generateRegistrationCode(); codeInput.focus(); });

    const saveBtn = U.el('button', { class: 'btn btn--primary' }, [hasCode ? 'Code ersetzen' : 'Code speichern']);
    saveBtn.addEventListener('click', async () => {
      const code = codeInput.value.trim();
      if (!SSD.Auth.isValidRegistrationCode(code)) {
        SSD.Toast.error('Code zu kurz', `Der Schulcode braucht mindestens ${SSD.Auth.REGISTRATION_CODE_MIN_LENGTH} Zeichen (Leerzeichen/Bindestriche zählen nicht).`);
        return;
      }
      saveBtn.disabled = true;
      await SSD.Auth.setRegistrationCode(code);
      SSD.Toast.show({ type: 'success', title: 'Schulcode gespeichert', message: `Neuer Code: ${code} — bitte notieren, er wird aus Sicherheitsgründen nicht mehr angezeigt.`, duration: 15000 });
    });

    const actions = [saveBtn];
    if (hasCode) {
      const removeBtn = U.el('button', { class: 'btn btn--ghost' }, ['Code entfernen']);
      removeBtn.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({
          title: 'Schulcode entfernen', confirmLabel: 'Entfernen',
          message: 'Neue Registrierungen müssen danach wieder von Ihnen in der Schülerverwaltung freigeschaltet werden. Fortfahren?',
        });
        if (!ok) return;
        await SSD.Auth.setRegistrationCode(null);
        SSD.Toast.info('Schulcode entfernt', 'Neue Konten warten jetzt wieder auf Ihre Freischaltung.');
      });
      actions.push(removeBtn);
    }

    const status = hasCode
      ? U.el('div', { class: 'cluster gap-2' }, [U.el('span', { class: 'badge badge--success' }, ['Schulcode aktiv']), U.el('span', { class: 'text-secondary', style: 'font-size:var(--font-size-sm);' }, ['Wer sich mit dem richtigen Code registriert, ist sofort freigeschaltet.'])])
      : U.el('div', { class: 'cluster gap-2' }, [U.el('span', { class: 'badge' }, ['Kein Schulcode']), U.el('span', { class: 'text-secondary', style: 'font-size:var(--font-size-sm);' }, ['Neue Konten müssen in der Schülerverwaltung freigeschaltet werden.'])]);

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Selbstregistrierung'])]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        switchRow('Selbstregistrierung erlauben', 'Schüler:innen und Azubis können sich über den Login-Bildschirm selbst ein Konto anlegen.', s.allowSelfRegistration, (val) => {
          SSD.SettingsService.update({ allowSelfRegistration: val });
          SSD.Toast.success('Gespeichert', 'Einstellung aktualisiert.');
        }),
        U.el('hr', { class: 'divider' }),
        status,
        field(hasCode ? 'Schulcode ersetzen' : 'Schulcode festlegen', U.el('div', { class: 'cluster gap-2', style: 'flex-wrap:nowrap;' }, [codeInput, generateBtn]),
          'Groß-/Kleinschreibung, Leerzeichen und Bindestriche spielen bei der Eingabe keine Rolle. Der Code wird verschlüsselt gespeichert und kann danach nicht mehr angezeigt werden — bitte notieren.'),
        U.el('div', { class: 'cluster gap-2' }, actions),
      ]),
    ]);
  }

  function buildAdminCard() {
    const state = SSD.Store.getState();
    const usernameInput = U.el('input', { class: 'input', value: state.admin.username });
    const newPasswordInput = U.el('input', { class: 'input', type: 'password', placeholder: 'Unverändert lassen', autocomplete: 'new-password' });
    const saveBtn = U.el('button', { class: 'btn btn--primary' }, ['Zugangsdaten speichern']);
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    saveBtn.addEventListener('click', async () => {
      errorBox.style.display = 'none';
      if (!U.Validate.usernameFormat(usernameInput.value.trim())) {
        errorBox.textContent = 'Ungültiger Benutzername.';
        errorBox.style.display = 'flex';
        return;
      }
      if (newPasswordInput.value && !U.Validate.minLength(newPasswordInput.value, 6)) {
        errorBox.textContent = 'Das neue Passwort muss mindestens 6 Zeichen haben.';
        errorBox.style.display = 'flex';
        return;
      }
      await SSD.Auth.changeAdminCredentials({ username: usernameInput.value.trim(), newPassword: newPasswordInput.value });
      newPasswordInput.value = '';
      SSD.Toast.success('Gespeichert', 'Administrator-Zugangsdaten aktualisiert.');
    });

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Administrator-Zugang'])]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        errorBox,
        U.el('div', { class: 'grid grid-cols-2' }, [field('Benutzername', usernameInput), field('Neues Passwort', newPasswordInput)]),
        U.el('div', {}, [saveBtn]),
      ]),
    ]);
  }

  function buildDataCard() {
    const usage = SSD.Storage.getStorageUsageInfo();
    const exportBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('download', { size: 16 }) }, ['Als JSON exportieren']);
    exportBtn.addEventListener('click', () => SSD.ImportExport.exportDataJson());

    const importBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('upload', { size: 16 }) }, ['JSON importieren']);
    importBtn.addEventListener('click', async () => {
      const file = await U.pickFile('.json,application/json');
      if (!file) return;
      try {
        const data = await SSD.ImportExport.importDataJson(file);
        const ok = await SSD.Dialog.confirm({
          title: 'Daten importieren', danger: true, confirmLabel: 'Überschreiben & importieren',
          message: `Alle aktuellen Daten werden durch den Inhalt der Datei ersetzt (${data.students.length} Schüler:innen gefunden). Dieser Schritt kann nicht rückgängig gemacht werden. Fortfahren?`,
        });
        if (ok) {
          SSD.Store.replaceState(data, 'Daten importiert');
          SSD.Toast.success('Import erfolgreich', 'Die Daten wurden ersetzt.');
        }
      } catch (err) {
        SSD.Toast.error('Import fehlgeschlagen', String(err.message || err));
      }
    });

    const resetBtn = U.el('button', { class: 'btn btn--danger', html: SSD.Icons.svg('trash', { size: 16 }) }, ['Alle Daten zurücksetzen']);
    resetBtn.addEventListener('click', async () => {
      const ok = await SSD.Dialog.confirm({
        title: 'Alle Daten löschen', danger: true, confirmLabel: 'Endgültig löschen',
        message: 'Dies löscht alle Schüler:innen, den Dienstplan, den Kalender und alle Einstellungen unwiderruflich — für alle Personen, die auf diese Datenbank zugreifen, nicht nur für diesen Browser. Erstellen Sie vorher unbedingt ein JSON-Backup. Wirklich fortfahren?',
      });
      if (ok) {
        await SSD.Storage.clearAll();
        window.location.hash = '#/setup';
        window.location.reload();
      }
    });

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [U.el('div', { class: 'card__title' }, ['Datenverwaltung']), U.el('div', { class: 'card__subtitle' }, [`Aktueller Datenumfang: ${usage.kb} KB`])]),
      ]),
      U.el('div', { class: 'card__body' }, [
        U.el('p', {}, ['Alle Daten liegen zentral in einer gemeinsamen Datenbank, damit jedes Gerät denselben, aktuellen Dienstplan sieht. Exportieren Sie trotzdem regelmäßig ein JSON-Backup, um bei Bedarf einen früheren Stand wiederherstellen zu können.']),
        U.el('div', { class: 'cluster gap-2' }, [exportBtn, importBtn, resetBtn]),
      ]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Microsoft Teams
   * ------------------------------------------------------------------- */

  function statusLine(badgeClass, badgeText, text) {
    return U.el('div', { class: 'cluster gap-2', style: 'font-size:var(--font-size-sm);' }, [
      U.el('span', { class: `badge ${badgeClass}` }, [badgeText]),
      U.el('span', { class: 'text-secondary' }, [text]),
    ]);
  }

  /** Lädt den Versandstatus (Tabelle `ssd_teams_status`, vom Server gepflegt) und zeigt ihn an. */
  async function loadTeamsStatus(el, enabled) {
    const st = await SSD.Storage.fetchTeamsStatus();
    el.innerHTML = '';
    if (!st) {
      el.appendChild(statusLine('', 'Status unbekannt', 'Der Versand-Status ist nicht abrufbar (Datenbank-Erweiterung fehlt oder keine Verbindung).'));
      return;
    }
    const at = (iso) => U.formatDateTime(new Date(iso));
    if (!st.configured) {
      el.appendChild(statusLine('badge--warning', 'Nicht eingerichtet', 'Es ist noch keine Teams-Workflow-Adresse hinterlegt — siehe Anleitung unten.'));
    } else if (st.last_error) {
      el.appendChild(statusLine('badge--danger', 'Fehler', `${st.last_error} (${at(st.last_error_at)}). Es wird automatisch erneut versucht.`));
    } else if (st.last_sent_at) {
      el.appendChild(statusLine('badge--success', 'Verbunden', `Zuletzt gesendet: ${at(st.last_sent_at)} (${st.last_sent_count === 1 ? '1 Meldung' : `${st.last_sent_count} Meldungen`}).`));
    } else {
      el.appendChild(statusLine('badge--primary', 'Eingerichtet', 'Bisher wurde noch nichts gesendet.'));
    }
    const notes = [];
    if (!enabled) notes.push('Benachrichtigungen sind ausgeschaltet.');
    if (st.pending_count > 0) notes.push(`${st.pending_count === 1 ? '1 Meldung wartet' : `${st.pending_count} Meldungen warten`} auf den nächsten Versand (gesammelt etwa 5 Minuten nach der ersten Änderung).`);
    if (st.note) notes.push(st.note);
    if (st.configured && st.last_checked_at && Date.now() - new Date(st.last_checked_at).getTime() > 5 * 60 * 1000) {
      notes.push(`Achtung: Die Datenbank hat seit ${at(st.last_checked_at)} nicht mehr nach neuen Meldungen gesehen — der Zeitplan (pg_cron) scheint nicht zu laufen.`);
    }
    notes.forEach((n) => el.appendChild(U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [n])));
  }

  function codeBlock(text) {
    const pre = U.el('pre', { style: 'margin:0; padding:10px 12px; background:var(--bg-sunken); border:1px solid var(--border-subtle); border-radius:var(--radius-md); font-size:var(--font-size-xs); white-space:pre-wrap; word-break:break-all;' }, [text]);
    const copyBtn = U.el('button', { type: 'button', class: 'btn btn--secondary btn--sm', style: 'align-self:flex-start;' }, ['Kopieren']);
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        SSD.Toast.success('Kopiert', 'Im Supabase-SQL-Editor einfügen und die Platzhalter ersetzen.');
      } catch (err) {
        SSD.Toast.warning('Kopieren nicht möglich', 'Bitte den Text markieren und manuell kopieren.');
      }
    });
    return U.el('div', { class: 'stack gap-2' }, [pre, copyBtn]);
  }

  function buildTeamsGuide() {
    const appUrl = location.protocol === 'https:' ? `${location.origin}${location.pathname}` : 'https://ADRESSE-DER-WEBSEITE/';
    const setupSql = [
      '-- 1) Teams-Workflow-Adresse hinterlegen (ADRESSE durch die kopierte Adresse ersetzen):',
      "select vault.create_secret('ADRESSE', 'ssd_teams_webhook_url');",
      '',
      '-- 2) Optional: Link für den Button „Dienstplan öffnen“ in der Teams-Nachricht:',
      `select vault.create_secret('${appUrl}', 'ssd_teams_app_url');`,
    ].join('\n');
    const changeSql = [
      '-- Adresse später ändern (NEUE_ADRESSE ersetzen):',
      "select vault.update_secret((select id from vault.secrets where name = 'ssd_teams_webhook_url'), 'NEUE_ADRESSE');",
      '',
      '-- Teams-Anbindung komplett trennen:',
      "delete from vault.secrets where name = 'ssd_teams_webhook_url';",
    ].join('\n');
    const li = (children) => U.el('li', { style: 'margin-bottom:8px;' }, children);

    return U.el('details', {}, [
      U.el('summary', { style: 'cursor:pointer; font-weight:600;' }, ['Einrichtung — Schritt für Schritt']),
      U.el('ol', { style: 'margin:12px 0 0; padding-left:20px; font-size:var(--font-size-sm);' }, [
        li(['In Teams den gewünschten Kanal öffnen, beim Kanalnamen auf „…“ (Weitere Optionen) klicken und „Workflows“ wählen. Gibt es diesen Punkt nicht, hat die Schul-IT Workflows (Power Automate) gesperrt — dann dort nachfragen.']),
        li(['Die Vorlage „Bei Empfang einer Webhookanforderung in einem Kanal posten“ (englisch „Post to a channel when a webhook request is received“) wählen, Team und Kanal bestätigen und „Workflow hinzufügen“ klicken.']),
        li(['Die angezeigte Adresse kopieren. Sie ist geheim — wer sie kennt, kann in den Kanal schreiben. Deshalb wird sie nicht hier in der App eingetragen, sondern verschlüsselt in der Datenbank.']),
        li([
          'Im Supabase-Dashboard das Projekt des Dienstplans öffnen, links „SQL Editor“ wählen, den folgenden Text einfügen, ADRESSE ersetzen und „Run“ klicken:',
          U.el('div', { style: 'margin-top:8px;' }, [codeBlock(setupSql)]),
        ]),
        li(['Hier oben „Benachrichtigungen aktiv“ einschalten und „Testnachricht senden“ klicken — die Nachricht erscheint nach etwa einer Minute im Kanal.']),
      ]),
      U.el('div', { class: 'field__label', style: 'margin-top:8px;' }, ['Später ändern oder trennen']),
      codeBlock(changeSql),
    ]);
  }

  function buildTeamsCard() {
    const teams = Object.assign(SSD.Models.createDefaultTeamsSettings(), SSD.SettingsService.get().teams || {});
    function saveTeams(patch) {
      SSD.SettingsService.update({ teams: Object.assign({}, teams, patch) });
      SSD.Toast.success('Gespeichert', 'Teams-Einstellung aktualisiert.');
    }

    const statusEl = U.el('div', { class: 'stack gap-1' }, [U.el('span', { class: 'text-tertiary', style: 'font-size:var(--font-size-sm);' }, ['Status wird geladen …'])]);
    loadTeamsStatus(statusEl, teams.enabled);

    const testBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('bell', { size: 15 }), disabled: !teams.enabled }, ['Testnachricht senden']);
    testBtn.addEventListener('click', () => {
      SSD.NotificationService.sendTest();
      SSD.Toast.show({ type: 'info', title: 'Testnachricht vorgemerkt', message: 'Sie erscheint nach etwa einer Minute im Teams-Kanal — sofern die Workflow-Adresse hinterlegt ist.', duration: 6000 });
    });

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Microsoft Teams']),
          U.el('div', { class: 'card__subtitle' }, ['Änderungen werden gesammelt (etwa 5 Minuten nach der ersten Änderung) als eine Nachricht in einen Teams-Kanal gepostet.']),
        ]),
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        statusEl,
        switchRow('Benachrichtigungen aktiv', 'Meldungen werden nur gesammelt und gesendet, solange dieser Schalter an ist.', teams.enabled, (val) => saveTeams({ enabled: val })),
        U.el('hr', { class: 'divider' }),
        U.el('div', { class: 'field__label' }, ['Was soll gemeldet werden?']),
        U.el('div', {}, SSD.NotificationService.CATEGORIES.map((c) => switchRow(c.label, c.hint, teams.categories[c.key] !== false,
          (val) => saveTeams({ categories: Object.assign({}, teams.categories, { [c.key]: val }) })))),
        U.el('div', { class: 'cluster gap-2' }, [testBtn]),
        U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, [
          'Hinweis: In den Nachrichten stehen Namen und Dienstzeiten — bitte einen Kanal wählen, den nur das Sanitätsdienst-Team und die Verantwortlichen sehen.',
        ]),
        U.el('hr', { class: 'divider' }),
        buildTeamsGuide(),
      ]),
    ]);
  }

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    layoutHandle.contentEl.appendChild(U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [U.el('h1', {}, ['Einstellungen']), U.el('p', {}, ['Schule, Selbstregistrierung, Zugangsdaten und Datenverwaltung.'])]),
    ]));
    layoutHandle.contentEl.appendChild(buildSchoolCard());
    layoutHandle.contentEl.appendChild(buildGeneralCard());
    layoutHandle.contentEl.appendChild(buildRegistrationCard());
    layoutHandle.contentEl.appendChild(buildTeamsCard());
    layoutHandle.contentEl.appendChild(buildAdminCard());
    layoutHandle.contentEl.appendChild(buildDataCard());
  }

  function render(container) {
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'settings');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
