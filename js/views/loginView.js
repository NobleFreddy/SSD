/**
 * ============================================================================
 * SSD.Views.Login — Anmeldebildschirm (Schüler:in, Azubi & Administrator)
 * ============================================================================
 * Neben der Anmeldung bietet dieser Bildschirm auch die Selbstregistrierung
 * für Schüler:innen und Azubis an (sofern in den Einstellungen erlaubt):
 * Neue Konten werden inaktiv angelegt und müssen von einem Administrator
 * einmal freigeschaltet werden, bevor eine Anmeldung möglich ist.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.Login = (function () {
  'use strict';

  const U = SSD.Utils;
  let role = 'student'; // 'student' | 'azubi' | 'admin'
  let mode = 'login'; // 'login' | 'register'

  function field(labelText, inputEl) {
    return U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
  }

  function render(container) {
    const state = SSD.Store.getState();
    const screen = U.el('div', { class: 'centered-screen' });
    const card = U.el('div', { class: 'card auth-card animate-pop-in' });

    card.appendChild(U.el('div', { class: 'auth-card__logo' }, [U.el('img', { src: 'assets/logo.png', alt: 'Vereinslogo' })]));
    const titleEl = U.el('h1', {}, [state.school?.name || 'Schulsanitätsdienst']);
    const subtitleEl = U.el('p', { class: 'auth-card__subtitle' }, ['Dienstplan-Verwaltung — bitte melden Sie sich an.']);
    card.appendChild(titleEl);
    card.appendChild(subtitleEl);

    const studentBtn = U.el('button', { class: 'role-switch__btn', type: 'button' }, ['Schüler:in']);
    const azubiBtn = U.el('button', { class: 'role-switch__btn', type: 'button' }, ['Azubi']);
    const adminBtn = U.el('button', { class: 'role-switch__btn', type: 'button' }, ['Administrator']);
    const roleSwitch = U.el('div', { class: 'role-switch' }, [studentBtn, azubiBtn, adminBtn]);
    card.appendChild(roleSwitch);

    const formHost = U.el('div');
    card.appendChild(formHost);

    function setRole(newRole) {
      role = newRole;
      mode = 'login';
      studentBtn.classList.toggle('is-active', role === 'student');
      azubiBtn.classList.toggle('is-active', role === 'azubi');
      adminBtn.classList.toggle('is-active', role === 'admin');
      renderForm();
    }
    studentBtn.addEventListener('click', () => setRole('student'));
    azubiBtn.addEventListener('click', () => setRole('azubi'));
    adminBtn.addEventListener('click', () => setRole('admin'));

    function renderForm() {
      formHost.innerHTML = '';
      subtitleEl.textContent = mode === 'register'
        ? 'Neues Konto erstellen — nach dem Absenden schaltet ein Administrator es frei.'
        : 'Dienstplan-Verwaltung — bitte melden Sie sich an.';
      formHost.appendChild(mode === 'register' ? buildRegisterForm() : buildLoginForm());
    }

    function buildLoginForm() {
      const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' }, [
        U.el('span', { html: SSD.Icons.svg('warning', { size: 16 }) }),
        U.el('span', {}, ['']),
      ]);
      const usernameInput = U.el('input', { class: 'input', autocomplete: 'username', placeholder: 'Benutzername' });
      const passwordInput = U.el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Passwort' });
      const submitBtn = U.el('button', { class: 'btn btn--primary btn--block btn--lg', type: 'submit' }, ['Anmelden']);

      const form = U.el('form', {}, [
        errorBox,
        field('Benutzername', usernameInput),
        field('Passwort', passwordInput),
        submitBtn,
      ]);

      function showError(msg) {
        errorBox.querySelector('span:last-child').textContent = msg;
        errorBox.style.display = 'flex';
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        if (!username || !password) { showError('Bitte Benutzername und Passwort eingeben.'); return; }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Wird geprüft …';
        const result = role === 'admin'
          ? await SSD.Auth.loginAdmin(username, password)
          : await SSD.Auth.loginStudent(username, password);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Anmelden';

        if (!result.ok) {
          showError(result.error);
          passwordInput.value = '';
          passwordInput.focus();
          return;
        }
        SSD.Toast.success('Willkommen!', role === 'admin' ? 'Als Administrator angemeldet.' : 'Erfolgreich angemeldet.');
      });

      if (role !== 'admin' && SSD.SettingsService.get().allowSelfRegistration) {
        const switchLink = U.el('button', { type: 'button', class: 'btn btn--ghost btn--block btn--sm', style: 'margin-top:10px;' }, ['Noch kein Konto? Jetzt registrieren']);
        switchLink.addEventListener('click', () => { mode = 'register'; renderForm(); });
        form.appendChild(switchLink);
      }

      setTimeout(() => usernameInput.focus(), 50);
      return form;
    }

    function buildRegisterForm() {
      const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' }, [
        U.el('span', { html: SSD.Icons.svg('warning', { size: 16 }) }),
        U.el('span', {}, ['']),
      ]);
      const firstNameInput = U.el('input', { class: 'input', placeholder: 'Vorname' });
      const lastNameInput = U.el('input', { class: 'input', placeholder: 'Nachname' });
      const usernameInput = U.el('input', { class: 'input', autocomplete: 'username', placeholder: 'Benutzername wählen' });
      const passwordInput = U.el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Passwort (mind. 6 Zeichen)' });
      const passwordConfirmInput = U.el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Passwort bestätigen' });
      const genderSelect = U.el('select', { class: 'select' }, SSD.Models.GENDERS.map((g) => U.el('option', { value: g.key, selected: g.key === 'd' }, [g.label])));
      const classInput = U.el('input', { class: 'input', placeholder: 'z. B. 10a' });
      const yearInput = U.el('input', { class: 'input', type: 'number', value: new Date().getFullYear() });
      const submitBtn = U.el('button', { class: 'btn btn--primary btn--block btn--lg', type: 'submit' }, ['Konto erstellen']);

      const form = U.el('form', {}, [
        errorBox,
        U.el('div', { class: 'grid grid-cols-2' }, [field('Vorname', firstNameInput), field('Nachname', lastNameInput)]),
        field('Benutzername', usernameInput),
        U.el('div', { class: 'grid grid-cols-2' }, [field('Passwort', passwordInput), field('Passwort bestätigen', passwordConfirmInput)]),
        U.el('div', { class: 'grid grid-cols-3' }, [field('Geschlecht', genderSelect), field('Klasse', classInput), field('Jahrgang', yearInput)]),
        submitBtn,
      ]);

      function showError(msg) {
        errorBox.querySelector('span:last-child').textContent = msg;
        errorBox.style.display = 'flex';
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';

        const data = {
          firstName: firstNameInput.value.trim(),
          lastName: lastNameInput.value.trim(),
          username: usernameInput.value.trim(),
          gender: genderSelect.value,
          schoolClass: classInput.value.trim(),
          yearGroup: Number(yearInput.value) || new Date().getFullYear(),
          role,
        };

        const problems = [];
        if (!U.Validate.required(data.firstName)) problems.push('Bitte einen Vornamen eingeben.');
        if (!U.Validate.required(data.lastName)) problems.push('Bitte einen Nachnamen eingeben.');
        if (!U.Validate.usernameFormat(data.username)) problems.push('Benutzername: 3–32 Zeichen, nur Buchstaben/Zahlen/._-');
        else if (SSD.Auth.isUsernameTaken(data.username)) problems.push('Dieser Benutzername ist bereits vergeben.');
        if (!U.Validate.minLength(passwordInput.value, 6)) problems.push('Das Passwort muss mindestens 6 Zeichen lang sein.');
        else if (passwordInput.value !== passwordConfirmInput.value) problems.push('Die Passwörter stimmen nicht überein.');

        if (problems.length) { showError(problems[0]); return; }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Wird erstellt …';
        await SSD.StudentService.registerSelf({ ...data, password: passwordInput.value });
        submitBtn.disabled = false;
        submitBtn.textContent = 'Konto erstellen';

        mode = 'login';
        renderForm();
        SSD.Toast.success('Konto erstellt!', 'Ein Administrator muss Ihr Konto noch freischalten, bevor Sie sich anmelden können.');
      });

      const switchLink = U.el('button', { type: 'button', class: 'btn btn--ghost btn--block btn--sm', style: 'margin-top:10px;' }, ['Bereits ein Konto? Zur Anmeldung']);
      switchLink.addEventListener('click', () => { mode = 'login'; renderForm(); });
      form.appendChild(switchLink);

      setTimeout(() => firstNameInput.focus(), 50);
      return form;
    }

    setRole('student');
    screen.appendChild(card);
    container.appendChild(screen);
  }

  return { render };
})();
