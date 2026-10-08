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
        switchRow(
          'Sanisprecher:innen sehen die Engagement-Übersicht',
          'Zeigt der Team-Leitung die Zahlen aller Personen (Dienste, Einspringen, Teamtreffen …). Jede Person sieht ihre eigenen Zahlen ohnehin unter „Mein Konto“. Ob die Team-Leitung das braucht, entscheidet die Schule.',
          s.leadsSeeEngagement !== false,
          (val) => commit({ leadsSeeEngagement: val }, val ? 'Die Team-Leitung sieht die Engagement-Übersicht.' : 'Die Engagement-Übersicht ist jetzt nur für die Administration sichtbar.')
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
      try {
        await SSD.Auth.setRegistrationCode(code);
      } catch (err) {
        saveBtn.disabled = false;
        SSD.Toast.error('Nicht gespeichert', String(err.message || err));
        return;
      }
      SSD.Toast.show({ type: 'success', title: 'Schulcode gespeichert', message: `Neuer Code: ${code} — bitte notieren, er wird aus Sicherheitsgründen nicht mehr angezeigt.`, duration: 15000 });
      renderContent();
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
        try {
          await SSD.Auth.setRegistrationCode(null);
        } catch (err) {
          SSD.Toast.error('Nicht entfernt', String(err.message || err));
          return;
        }
        SSD.Toast.info('Schulcode entfernt', 'Neue Konten warten jetzt wieder auf Ihre Freischaltung.');
        renderContent();
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
          'Groß-/Kleinschreibung, Leerzeichen und Bindestriche spielen bei der Eingabe keine Rolle. Der Code wird nur als Hash auf dem Server gespeichert und kann danach nicht mehr angezeigt werden — bitte notieren.'),
        U.el('div', { class: 'cluster gap-2' }, actions),
      ]),
    ]);
  }

  function buildAdminCard() {
    const state = SSD.Store.getState();
    const minLength = SSD.Auth.PASSWORD_MIN_LENGTH;
    const usernameInput = U.el('input', { class: 'input', value: state.admin.username, autocomplete: 'username' });
    const currentPasswordInput = U.el('input', { class: 'input', type: 'password', placeholder: 'Nur bei Passwortwechsel', autocomplete: 'current-password' });
    const newPasswordInput = U.el('input', { class: 'input', type: 'password', placeholder: `Unverändert lassen (sonst mind. ${minLength} Zeichen)`, autocomplete: 'new-password' });
    const saveBtn = U.el('button', { class: 'btn btn--primary' }, ['Zugangsdaten speichern']);
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });
    const showError = (msg) => { errorBox.textContent = msg; errorBox.style.display = 'flex'; };

    saveBtn.addEventListener('click', async () => {
      errorBox.style.display = 'none';
      const username = usernameInput.value.trim();
      if (!U.Validate.usernameFormat(username)) { showError('Ungültiger Benutzername.'); return; }
      if (username.toLowerCase() !== state.admin.username.toLowerCase() && state.students.some((st) => st.username.toLowerCase() === username.toLowerCase())) {
        showError('Dieser Benutzername ist bereits an eine Schüler:in vergeben.');
        return;
      }
      if (newPasswordInput.value && !U.Validate.minLength(newPasswordInput.value, minLength)) { showError(`Das neue Passwort muss mindestens ${minLength} Zeichen haben.`); return; }
      if (newPasswordInput.value && !currentPasswordInput.value) { showError('Bitte zur Bestätigung das aktuelle Passwort eingeben.'); return; }
      saveBtn.disabled = true;
      try {
        await SSD.Auth.changeAdminCredentials({ username, newPassword: newPasswordInput.value, currentPassword: currentPasswordInput.value });
      } catch (err) {
        saveBtn.disabled = false;
        showError(String(err.message || err));
        return;
      }
      saveBtn.disabled = false;
      newPasswordInput.value = '';
      currentPasswordInput.value = '';
      SSD.Toast.success('Gespeichert', 'Administrator-Zugangsdaten aktualisiert.');
    });

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Administrator-Zugang']),
          U.el('div', { class: 'card__subtitle' }, ['Das Passwort prüft nur der Server; es ist nirgends im Datenbestand gespeichert.']),
        ]),
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        errorBox,
        field('Benutzername', usernameInput),
        U.el('div', { class: 'grid grid-cols-2' }, [field('Aktuelles Passwort', currentPasswordInput), field('Neues Passwort', newPasswordInput)]),
        U.el('div', {}, [saveBtn]),
      ]),
    ]);
  }

  /** Passwortabfrage als Dialog — liefert das eingegebene Passwort oder null. */
  function promptPassword({ title, message, confirmLabel }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => { if (!done) { done = true; resolve(value); } };
      const input = U.el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
      const body = U.el('div', { class: 'stack gap-3' }, [U.el('p', { style: 'margin:0;' }, [message]), field('Administrator-Passwort', input)]);
      const handle = SSD.Dialog.open({
        title, body, narrow: true, closeOnOverlayClick: false,
        onClose: () => finish(null),
        footerButtons: [
          { label: 'Abbrechen', variant: 'secondary' },
          { label: confirmLabel, variant: 'danger', closeOnClick: false, onClick: () => { finish(input.value || null); handle.close(); } },
        ],
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value || null); handle.close(); } });
    });
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
        message: 'Dies löscht alle Schüler:innen samt Zugängen, den Dienstplan, den Kalender und alle Einstellungen unwiderruflich — für alle Personen, die auf diese Datenbank zugreifen, nicht nur für diesen Browser. Erstellen Sie vorher bei Bedarf ein JSON-Backup. Wirklich fortfahren?',
      });
      if (!ok) return;
      const password = await promptPassword({
        title: 'Passwort bestätigen', confirmLabel: 'Alle Daten löschen',
        message: 'Zur Sicherheit: Bitte das Administrator-Passwort eingeben. Der Administrator-Zugang und der Schulname bleiben erhalten, alle anderen Konten werden gelöscht.',
      });
      if (!password) return;
      try {
        await SSD.Auth.resetAllData(password);
      } catch (err) {
        SSD.Toast.error('Nicht zurückgesetzt', String(err.message || err));
        return;
      }
      SSD.Toast.success('Zurückgesetzt', 'Alle Daten wurden gelöscht.');
      SSD.Router.navigate('/admin/dashboard');
    });

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [U.el('div', { class: 'card__title' }, ['Datenverwaltung']), U.el('div', { class: 'card__subtitle' }, [`Aktueller Datenumfang: ${usage.kb} KB`])]),
      ]),
      U.el('div', { class: 'card__body' }, [
        U.el('p', {}, ['Alle Daten liegen zentral in einer gemeinsamen Datenbank (Rechenzentrum Frankfurt), damit jedes Gerät denselben, aktuellen Dienstplan sieht. Ein JSON-Backup hilft, bei Bedarf einen früheren Stand wiederherzustellen.']),
        U.el('div', { class: 'notice-box notice-box--info', style: 'margin-bottom:12px;' }, [
          U.el('span', { html: SSD.Icons.svg('shield', { size: 18 }) }),
          U.el('div', {}, [U.el('p', { style: 'margin:0;' }, ['Exporte (JSON, CSV, Excel) enthalten personenbezogene Daten. Bitte nur auf dienstlichen, geschützten Geräten speichern, nicht weitergeben und löschen, sobald sie nicht mehr gebraucht werden. Passwörter sind darin nicht enthalten.'])]),
        ]),
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

  function buildNameStyleSelect(teams, saveTeams) {
    const select = U.el('select', { class: 'select' }, [
      U.el('option', { value: 'short', selected: teams.nameStyle !== 'full' }, ['Vorname und Initial (z. B. „Lena C.“) — empfohlen']),
      U.el('option', { value: 'full', selected: teams.nameStyle === 'full' }, ['Vor- und Nachname']),
    ]);
    select.addEventListener('change', () => saveTeams({ nameStyle: select.value }));
    return select;
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
        field('Namen in den Nachrichten', buildNameStyleSelect(teams, saveTeams), 'Datensparsam: Im Kanal genügt meist der Vorname mit Initial. Abwesenheitsgründe werden nie gesendet.'),
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

  /* ---------------------------------------------------------------------
   * Datenschutz: Angaben für die Datenschutzhinweise
   * ------------------------------------------------------------------- */

  function buildPrivacyCard() {
    const p = Object.assign(SSD.Models.createDefaultPrivacySettings(), SSD.SettingsService.get().privacy || {});
    const save = (patch) => {
      SSD.SettingsService.update({ privacy: Object.assign({}, p, patch) });
      SSD.Toast.success('Gespeichert', 'Datenschutzhinweise aktualisiert.');
    };
    const textInput = (key, opts) => {
      const el = opts && opts.multiline
        ? U.el('textarea', { class: 'input', rows: '2', placeholder: opts.placeholder || '' }, [p[key] || ''])
        : U.el('input', { class: 'input', value: p[key] || '', placeholder: (opts && opts.placeholder) || '' });
      el.addEventListener('change', () => save({ [key]: el.value.trim() }));
      return el;
    };
    const basisSelect = U.el('select', { class: 'select' }, [
      U.el('option', { value: 'school', selected: p.legalBasis === 'school' }, ['Schulische Aufgabe (Schulgesetz des Landes)']),
      U.el('option', { value: 'consent', selected: p.legalBasis === 'consent' }, ['Einwilligung (freiwillige Teilnahme)']),
      U.el('option', { value: 'custom', selected: p.legalBasis === 'custom' }, ['Eigener Text (z. B. KDG bei katholischer Trägerschaft)']),
    ]);
    basisSelect.addEventListener('change', () => save({ legalBasis: basisSelect.value }));
    const missing = ['controller', 'dpo'].filter((k) => !String(p[k] || '').trim());

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Datenschutzhinweise']),
          U.el('div', { class: 'card__subtitle' }, ['Diese Angaben erscheinen auf der Seite „Datenschutz“, die ohne Anmeldung erreichbar und auf der Anmeldeseite verlinkt ist.']),
        ]),
        U.el('a', { class: 'btn btn--secondary btn--sm', href: '#/datenschutz', html: SSD.Icons.svg('shield', { size: 14 }) }, ['Ansehen']),
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        missing.length ? U.el('div', { class: 'notice-box' }, [
          U.el('span', { html: SSD.Icons.svg('warning', { size: 18 }) }),
          U.el('div', {}, [U.el('p', { style: 'margin:0;' }, ['Noch unvollständig: Bitte mindestens die verantwortliche Stelle und die/den Datenschutzbeauftragte:n eintragen (Angaben von der Schulleitung).'])]),
        ]) : null,
        field('Verantwortliche Stelle', textInput('controller', { multiline: true, placeholder: 'Name und Anschrift der Schule, vertreten durch die Schulleitung' })),
        U.el('div', { class: 'grid grid-cols-2' }, [
          field('Ansprechperson', textInput('contact', { placeholder: 'z. B. betreuende Lehrkraft, E-Mail' })),
          field('Datenschutzbeauftragte:r', textInput('dpo', { placeholder: 'Name und Kontakt' })),
        ]),
        field('Zuständige Aufsichtsbehörde', textInput('authority', { placeholder: 'z. B. Landesbeauftragte:r für Datenschutz oder kirchliche Datenschutzaufsicht' })),
        field('Rechtsgrundlage', basisSelect, 'Welche zutrifft, entscheidet die Schulleitung mit der/dem Datenschutzbeauftragten.'),
        p.legalBasis === 'custom' ? field('Text zur Rechtsgrundlage', textInput('legalBasisText', { multiline: true })) : null,
        field('Link zum Impressum der Schule', textInput('imprintUrl', { placeholder: 'https://www.meine-schule.de/impressum' }), 'Optional; erscheint auf der Anmeldeseite.'),
      ]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Aufbewahrung: Löschfristen
   * ------------------------------------------------------------------- */

  function buildRetentionCard() {
    const R = SSD.RetentionService;
    const r = R.settings();
    const graceInput = U.el('input', { class: 'input', type: 'number', min: '0', max: '12', value: String(R.graceMonths()), style: 'max-width:110px;' });
    graceInput.addEventListener('change', () => {
      const value = U.clamp(Math.round(Number(graceInput.value) || 0), 0, 12);
      SSD.SettingsService.update({ retention: Object.assign({}, r, { graceMonths: value }) });
      SSD.Toast.success('Gespeichert', 'Aufbewahrungsfrist aktualisiert.');
    });
    const expired = R.findExpired();
    const lastDay = U.addDays(R.cutoffDate(), -1);
    const parts = [
      [expired.scheduleEntries.length, 'Dienste'], [expired.dutyLogEntries, 'Einträge im Dienstverlauf'], [expired.meetings.length, 'Teamtreffen'],
      [expired.events.length, 'Veranstaltungen'], [expired.tasks.length, 'erledigte Aufgaben'], [expired.materials.length, 'erledigte Materialanfragen'],
      [expired.announcements.length, 'Pinnwand-Beiträge'], [expired.pendingRegistrations.length, 'nie freigeschaltete Registrierungen'], [expired.teamsOutbox, 'Teams-Meldungen'],
    ].filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
    const applyBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('trash', { size: 15 }), disabled: !expired.total }, ['Jetzt löschen']);
    applyBtn.addEventListener('click', async () => {
      const ok = await SSD.Dialog.confirm({ title: 'Abgelaufene Daten löschen', danger: true, confirmLabel: 'Löschen', message: `Gelöscht werden: ${parts.join(', ')}. Fortfahren?` });
      if (!ok) return;
      const count = R.apply();
      SSD.Toast.success('Gelöscht', `${count} Einträge gelöscht.`);
    });
    const inactive = SSD.StudentService.getAll().filter((st) => !st.active && !st.pendingApproval).length;
    const toStudents = U.el('button', { class: 'btn btn--ghost btn--sm' }, ['Zur Schülerverwaltung']);
    toStudents.addEventListener('click', () => SSD.Router.navigate('/admin/students'));

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Aufbewahrung']),
          U.el('div', { class: 'card__subtitle' }, ['Personenbezogene Daten werden nur so lange gespeichert, wie sie gebraucht werden.']),
        ]),
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        field('Daten eines Schuljahres löschen … Monate nach Schuljahresende (31.07.)', graceInput,
          `Betrifft Dienste, Dienstverlauf, Teamtreffen, Veranstaltungen, erledigte Aufgaben und Materialanfragen. Nächste Löschung am ${U.formatDateMedium(R.nextDeletionDate())} — Engagement-Nachweise bitte vorher drucken. Abgelaufene Pinnwand-Beiträge, nie freigeschaltete Registrierungen und Teams-Meldungen werden nach 30 Tagen gelöscht.`),
        switchRow('Automatisch löschen', 'Beim Öffnen der Administration wird Abgelaufenes ohne Nachfrage gelöscht.', r.auto !== false,
          (val) => { SSD.SettingsService.update({ retention: Object.assign({}, r, { auto: val }) }); SSD.Toast.success('Gespeichert', 'Einstellung aktualisiert.'); }),
        U.el('div', { class: 'cluster gap-2', style: 'justify-content:space-between;' }, [
          U.el('span', { class: 'text-secondary', style: 'font-size:var(--font-size-sm);' }, [
            expired.total ? `Derzeit abgelaufen (bis ${U.formatDateMedium(lastDay)}): ${parts.join(', ')}.` : 'Derzeit ist nichts abgelaufen.',
          ]),
          applyBtn,
        ]),
        inactive ? U.el('div', { class: 'cluster gap-2', style: 'justify-content:space-between;' }, [
          U.el('span', { class: 'text-secondary', style: 'font-size:var(--font-size-sm);' }, [`${inactive} deaktivierte Konten — Konten von Personen, die den Sanitätsdienst verlassen haben, bitte löschen.`]),
          toStudents,
        ]) : null,
      ]),
    ]);
  }

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    layoutHandle.contentEl.appendChild(U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [U.el('h1', {}, ['Einstellungen']), U.el('p', {}, ['Schule, Datenschutz, Selbstregistrierung, Zugangsdaten und Datenverwaltung.'])]),
    ]));
    layoutHandle.contentEl.appendChild(buildSchoolCard());
    layoutHandle.contentEl.appendChild(buildGeneralCard());
    layoutHandle.contentEl.appendChild(buildPrivacyCard());
    layoutHandle.contentEl.appendChild(buildRetentionCard());
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
