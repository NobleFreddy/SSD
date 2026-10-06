/**
 * ============================================================================
 * SSD.Views.Setup — Ersteinrichtungs-Assistent
 * ============================================================================
 * Wird genau einmal angezeigt, bevor die Anwendung produktiv genutzt werden
 * kann: legt den Schulnamen sowie das erste Administrator-Konto an.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.Setup = (function () {
  'use strict';

  const U = SSD.Utils;

  function render(container) {
    const screen = U.el('div', { class: 'centered-screen' });
    const card = U.el('div', { class: 'card auth-card animate-pop-in' });

    card.appendChild(U.el('div', { class: 'auth-card__logo' }, [U.el('img', { src: 'assets/logo.png', alt: 'Vereinslogo' })]));
    card.appendChild(U.el('h1', {}, ['Willkommen!']));
    card.appendChild(U.el('p', { class: 'auth-card__subtitle' }, ['Richten Sie den Schulsanitätsdienst-Dienstplan in wenigen Sekunden ein.']));

    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });

    const schoolField = U.el('div', { class: 'field' }, [
      U.el('label', { class: 'field__label' }, ['Name der Schule']),
      U.el('input', { class: 'input', id: 'setup-school', placeholder: 'z. B. Gymnasium Musterstadt', autocomplete: 'off' }),
    ]);

    const usernameField = U.el('div', { class: 'field' }, [
      U.el('label', { class: 'field__label' }, ['Administrator-Benutzername']),
      U.el('input', { class: 'input', id: 'setup-username', placeholder: 'admin', autocomplete: 'off' }),
      U.el('div', { class: 'field__hint' }, ['Mindestens 3 Zeichen, nur Buchstaben/Zahlen/._-']),
    ]);

    const passwordField = U.el('div', { class: 'field' }, [
      U.el('label', { class: 'field__label' }, ['Passwort']),
      U.el('input', { class: 'input', id: 'setup-password', type: 'password', autocomplete: 'new-password' }),
      U.el('div', { class: 'field__hint' }, ['Mindestens 6 Zeichen.']),
    ]);

    const passwordConfirmField = U.el('div', { class: 'field' }, [
      U.el('label', { class: 'field__label' }, ['Passwort bestätigen']),
      U.el('input', { class: 'input', id: 'setup-password-confirm', type: 'password', autocomplete: 'new-password' }),
    ]);

    const codeInput = U.el('input', { class: 'input', id: 'setup-code', placeholder: 'z. B. SANI-7K3Q-P9XM', autocomplete: 'off', spellcheck: 'false', style: 'flex:1; min-width:0;' });
    const generateCodeBtn = U.el('button', { type: 'button', class: 'btn btn--secondary', html: SSD.Icons.svg('refresh', { size: 15 }) }, ['Zufällig']);
    generateCodeBtn.addEventListener('click', () => { codeInput.value = SSD.Auth.generateRegistrationCode(); });
    const codeField = U.el('div', { class: 'field' }, [
      U.el('label', { class: 'field__label' }, ['Schulcode für die Selbstregistrierung (optional)']),
      U.el('div', { class: 'cluster gap-2', style: 'flex-wrap:nowrap;' }, [codeInput, generateCodeBtn]),
      U.el('div', { class: 'field__hint' }, ['Wer sich mit diesem Code registriert, ist sofort freigeschaltet. Bitte notieren — der Code wird verschlüsselt gespeichert und später nicht mehr angezeigt.']),
    ]);

    const demoCheckbox = U.el('input', { type: 'checkbox', id: 'setup-demo' });
    const demoField = U.el('label', { class: 'checkbox-row', style: 'margin-bottom:16px;' }, [
      demoCheckbox,
      U.el('span', {}, ['Mit 18 Beispiel-Schüler:innen starten (zum Ausprobieren des Dienstplan-Generators)']),
    ]);

    const submitBtn = U.el('button', { class: 'btn btn--primary btn--block btn--lg' }, ['Einrichtung abschließen']);

    const form = U.el('form', {}, [errorBox, schoolField, usernameField, passwordField, passwordConfirmField, codeField, demoField, submitBtn]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';

      const schoolName = U.qs('#setup-school', form).value.trim();
      const username = U.qs('#setup-username', form).value.trim();
      const password = U.qs('#setup-password', form).value;
      const passwordConfirm = U.qs('#setup-password-confirm', form).value;
      const registrationCode = codeInput.value.trim();

      const problems = [];
      if (!U.Validate.required(schoolName)) problems.push('Bitte geben Sie den Namen Ihrer Schule ein.');
      if (!U.Validate.usernameFormat(username)) problems.push('Der Benutzername ist ungültig (3–32 Zeichen, Buchstaben/Zahlen/._-).');
      if (!U.Validate.minLength(password, 6)) problems.push('Das Passwort muss mindestens 6 Zeichen lang sein.');
      if (password !== passwordConfirm) problems.push('Die Passwörter stimmen nicht überein.');
      if (registrationCode && !SSD.Auth.isValidRegistrationCode(registrationCode)) problems.push(`Der Schulcode muss mindestens ${SSD.Auth.REGISTRATION_CODE_MIN_LENGTH} Zeichen haben (Leerzeichen/Bindestriche zählen nicht).`);

      if (problems.length) {
        errorBox.textContent = problems[0];
        errorBox.style.display = 'flex';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Wird eingerichtet …';
      await SSD.Auth.completeSetup({ schoolName, adminUsername: username, adminPassword: password, registrationCode });
      const codeNote = registrationCode ? ` Schulcode für die Registrierung: ${registrationCode} — bitte notieren.` : '';
      let message = `Willkommen, ${username}!${codeNote}`;
      if (demoCheckbox.checked) {
        await SSD.DemoData.seed();
        message = `Willkommen, ${username}! Beispieldaten wurden geladen (Schüler-Startpasswort: "willkommen").${codeNote}`;
      }
      SSD.Toast.show({ type: 'success', title: 'Einrichtung abgeschlossen', message, duration: registrationCode ? 15000 : undefined });
    });

    card.appendChild(form);
    card.appendChild(U.el('p', { class: 'auth-footer-note' }, ['Alle Daten werden zentral gespeichert und sind für alle Geräte sofort sichtbar.']));

    screen.appendChild(card);
    container.appendChild(screen);
  }

  return { render };
})();
