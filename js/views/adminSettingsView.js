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
    const deadlineInput = U.el('input', { class: 'input', type: 'number', min: '0', value: s.changeDeadlineDaysBeforeWeek });

    function commit(patch, message) {
      SSD.SettingsService.update(patch);
      SSD.Toast.success('Gespeichert', message);
    }
    deadlineInput.addEventListener('change', () => commit({ changeDeadlineDaysBeforeWeek: Math.max(0, Number(deadlineInput.value) || 0) }, 'Änderungsfrist aktualisiert.'));

    const toDistribution = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('sliders', { size: 14 }) }, ['Zur Verteilung']);
    toDistribution.addEventListener('click', () => SSD.Router.navigate('/admin/distribution'));

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Allgemein'])]),
      U.el('div', { class: 'card__body stack gap-2' }, [
        field('Änderungsfrist für Schüler:innen (Tage vor Wochenbeginn)', deadlineInput, 'Ab diesem Zeitpunkt ist die Verfügbarkeit für die Folgewoche gesperrt.'),
        U.el('hr', { class: 'divider' }),
        switchRow('Automatisches Speichern', 'Änderungen sofort für alle sichtbar speichern (empfohlen). Bei Deaktivierung erscheint oben ein manueller Speichern-Button.', s.autoSave, (val) => commit({ autoSave: val }, 'Einstellung aktualisiert.')),
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

  function renderContent() {
    layoutHandle.contentEl.innerHTML = '';
    layoutHandle.contentEl.appendChild(U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [U.el('h1', {}, ['Einstellungen']), U.el('p', {}, ['Schule, Selbstregistrierung, Zugangsdaten und Datenverwaltung.'])]),
    ]));
    layoutHandle.contentEl.appendChild(buildSchoolCard());
    layoutHandle.contentEl.appendChild(buildGeneralCard());
    layoutHandle.contentEl.appendChild(buildRegistrationCard());
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
