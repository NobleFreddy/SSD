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

    const demoCheckbox = U.el('input', { type: 'checkbox', id: 'setup-demo' });
    const demoField = U.el('label', { class: 'checkbox-row', style: 'margin-bottom:16px;' }, [
      demoCheckbox,
      U.el('span', {}, ['Mit 18 Beispiel-Schüler:innen starten (zum Ausprobieren des Dienstplan-Generators)']),
    ]);

    const submitBtn = U.el('button', { class: 'btn btn--primary btn--block btn--lg' }, ['Einrichtung abschließen']);

    const form = U.el('form', {}, [errorBox, schoolField, usernameField, passwordField, passwordConfirmField, demoField, submitBtn]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';

      const schoolName = U.qs('#setup-school', form).value.trim();
      const username = U.qs('#setup-username', form).value.trim();
      const password = U.qs('#setup-password', form).value;
      const passwordConfirm = U.qs('#setup-password-confirm', form).value;

      const problems = [];
      if (!U.Validate.required(schoolName)) problems.push('Bitte geben Sie den Namen Ihrer Schule ein.');
      if (!U.Validate.usernameFormat(username)) problems.push('Der Benutzername ist ungültig (3–32 Zeichen, Buchstaben/Zahlen/._-).');
      if (!U.Validate.minLength(password, 6)) problems.push('Das Passwort muss mindestens 6 Zeichen lang sein.');
      if (password !== passwordConfirm) problems.push('Die Passwörter stimmen nicht überein.');

      if (problems.length) {
        errorBox.textContent = problems[0];
        errorBox.style.display = 'flex';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Wird eingerichtet …';
      await SSD.Auth.completeSetup({ schoolName, adminUsername: username, adminPassword: password });
      if (demoCheckbox.checked) {
        await SSD.DemoData.seed();
        SSD.Toast.success('Einrichtung abgeschlossen', `Willkommen, ${username}! Beispieldaten wurden geladen (Schüler-Startpasswort: "willkommen").`);
      } else {
        SSD.Toast.success('Einrichtung abgeschlossen', `Willkommen, ${username}!`);
      }
    });

    card.appendChild(form);
    card.appendChild(U.el('p', { class: 'auth-footer-note' }, ['Alle Daten werden ausschließlich lokal in diesem Browser gespeichert.']));

    screen.appendChild(card);
    container.appendChild(screen);
  }

  return { render };
})();
