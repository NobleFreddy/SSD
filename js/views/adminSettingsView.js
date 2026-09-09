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

  function buildRulesCard() {
    const s = SSD.SettingsService.get();
    const maxWeekInput = U.el('input', { class: 'input', type: 'number', min: '1', value: s.maxDutiesPerWeek });
    const maxTotalInput = U.el('input', { class: 'input', type: 'number', min: '0', value: s.maxDutiesTotal ?? '', placeholder: 'Kein Limit' });
    const minBreakInput = U.el('input', { class: 'input', type: 'number', min: '0', value: s.minBreakBlocks });
    const perDutyInput = U.el('input', { class: 'input', type: 'number', min: '1', max: '4', value: s.studentsPerDuty });
    const deadlineInput = U.el('input', { class: 'input', type: 'number', min: '0', value: s.changeDeadlineDaysBeforeWeek });

    function commit(patch, message) {
      SSD.SettingsService.update(patch);
      SSD.Toast.success('Gespeichert', message);
    }

    maxWeekInput.addEventListener('change', () => commit({ maxDutiesPerWeek: Math.max(1, Number(maxWeekInput.value) || 1) }, 'Maximale Dienste pro Woche aktualisiert.'));
    maxTotalInput.addEventListener('change', () => commit({ maxDutiesTotal: maxTotalInput.value ? Math.max(0, Number(maxTotalInput.value)) : null }, 'Maximale Dienste insgesamt aktualisiert.'));
    minBreakInput.addEventListener('change', () => commit({ minBreakBlocks: Math.max(0, Number(minBreakInput.value) || 0) }, 'Mindestpause aktualisiert.'));
    perDutyInput.addEventListener('change', () => commit({ studentsPerDuty: U.clamp(Number(perDutyInput.value) || 2, 1, 4) }, 'Teamgröße pro Dienst aktualisiert.'));
    deadlineInput.addEventListener('change', () => commit({ changeDeadlineDaysBeforeWeek: Math.max(0, Number(deadlineInput.value) || 0) }, 'Änderungsfrist aktualisiert.'));

    const card = U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [U.el('div', { class: 'card__title' }, ['Planungsregeln'])]),
    ]);
    const body = U.el('div', { class: 'card__body stack gap-2' }, [
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Maximale Dienste pro Woche (Standard)', maxWeekInput, 'Kann pro Schüler:in individuell überschrieben werden.'),
        field('Maximale Dienste insgesamt', maxTotalInput, 'Optionales Gesamtlimit über das ganze Schuljahr.'),
      ]),
      U.el('div', { class: 'grid grid-cols-2' }, [
        field('Anzahl Schüler:innen pro Dienst', perDutyInput, 'Standard: 2'),
        field('Mindestpause zwischen zwei Diensten (in Blöcken)', minBreakInput, 'Nur relevant, wenn mehrere Dienste am selben Tag erlaubt sind.'),
      ]),
      field('Änderungsfrist für Schüler:innen (Tage vor Wochenbeginn)', deadlineInput, 'Ab diesem Zeitpunkt ist die Verfügbarkeit für die Folgewoche gesperrt.'),
      U.el('hr', { class: 'divider' }),
      switchRow('Gemischte Paare bevorzugen', 'Bei der Optimierung möglichst ein Mädchen und einen Jungen einteilen.', s.preferMixedGender, (val) => commit({ preferMixedGender: val }, 'Einstellung aktualisiert.')),
      switchRow('Mehrere Dienste am selben Tag erlauben', 'Standardmäßig deaktiviert, um Schüler:innen nicht zu überlasten.', s.allowSameDayDuties, (val) => commit({ allowSameDayDuties: val }, 'Einstellung aktualisiert.')),
      switchRow('Automatisches Speichern', 'Änderungen sofort für alle sichtbar speichern (empfohlen). Bei Deaktivierung erscheint oben ein manueller Speichern-Button.', s.autoSave, (val) => commit({ autoSave: val }, 'Einstellung aktualisiert.')),
      switchRow('Selbstregistrierung erlauben', 'Schüler:innen und Azubis können sich über den Login-Bildschirm selbst ein Konto anlegen. Neue Konten sind zunächst inaktiv und müssen in der Schülerverwaltung freigeschaltet werden.', s.allowSelfRegistration, (val) => commit({ allowSelfRegistration: val }, 'Einstellung aktualisiert.')),
    ]);
    card.appendChild(body);
    return card;
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
      U.el('div', { class: 'page-header__text' }, [U.el('h1', {}, ['Einstellungen']), U.el('p', {}, ['Planungsregeln, Zugangsdaten und Datenverwaltung.'])]),
    ]));
    layoutHandle.contentEl.appendChild(buildSchoolCard());
    layoutHandle.contentEl.appendChild(buildRulesCard());
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
