/**
 * ============================================================================
 * SSD.Views.Login — Anmeldebildschirm (Schüler:in, Azubi & Administrator)
 * ============================================================================
 * Neben der Anmeldung bietet dieser Bildschirm auch die Selbstregistrierung
 * für Schüler:innen und Azubis an (sofern in den Einstellungen erlaubt):
 * Ist ein Schulcode festgelegt, wird er abgefragt und das Konto mit dem
 * richtigen Code sofort freigeschaltet (und angemeldet). Ohne Schulcode
 * werden neue Konten inaktiv angelegt und müssen freigeschaltet werden.
 *
 * Vor der Anmeldung kennt die App nur öffentliche Angaben (Schulname,
 * Registrierung) — Benutzername, Passwort und Schulcode prüft der Server.
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

  /** Links unter der Karte: Datenschutzhinweise und (falls hinterlegt) Impressum der Schule. */
  function buildLegalLinks() {
    const info = SSD.Store.getPublicInfo();
    const privacyLink = U.el('a', { href: '#/datenschutz' }, ['Datenschutz']);
    const links = [privacyLink];
    const imprint = String((info.privacy && info.privacy.imprintUrl) || '').trim();
    if (/^https:\/\//i.test(imprint)) links.push(U.el('a', { href: imprint, target: '_blank', rel: 'noopener' }, ['Impressum']));
    return U.el('p', { class: 'auth-footer-note legal-links' }, links.flatMap((a, i) => (i ? [' · ', a] : [a])));
  }

  function render(container) {
    const info = SSD.Store.getPublicInfo();
    const screen = U.el('div', { class: 'centered-screen' });
    const card = U.el('div', { class: 'card auth-card animate-pop-in' });

    card.appendChild(U.el('div', { class: 'auth-card__logo' }, [U.el('img', { src: 'assets/logo.png', alt: 'Vereinslogo' })]));
    const titleEl = U.el('h1', {}, [info.schoolName || 'Schulsanitätsdienst']);
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
      if (mode !== 'register') subtitleEl.textContent = 'Dienstplan-Verwaltung — bitte melden Sie sich an.';
      else if (SSD.Auth.hasRegistrationCode()) subtitleEl.textContent = 'Neues Konto erstellen — mit dem Schulcode Ihres Sanitätsdienstes ist es sofort freigeschaltet.';
      else subtitleEl.textContent = 'Neues Konto erstellen — nach dem Absenden schaltet ein Administrator es frei.';
      formHost.appendChild(mode === 'register' ? buildRegisterForm() : buildLoginForm());
    }

    function errorBoxEl() {
      return U.el('div', { class: 'auth-error', style: 'display:none;' }, [
        U.el('span', { html: SSD.Icons.svg('warning', { size: 16 }) }),
        U.el('span', {}, ['']),
      ]);
    }

    function buildLoginForm() {
      const errorBox = errorBoxEl();
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
        const result = await SSD.Auth.login(role === 'admin' ? 'admin' : 'student', username, password);
        if (!result.ok) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Anmelden';
          showError(result.error);
          passwordInput.value = '';
          passwordInput.focus();
          return;
        }
        SSD.Toast.success('Willkommen!', role === 'admin' ? 'Als Administrator angemeldet.' : 'Erfolgreich angemeldet.');
      });

      if (role !== 'admin' && info.selfRegistration) {
        const switchLink = U.el('button', { type: 'button', class: 'btn btn--ghost btn--block btn--sm', style: 'margin-top:10px;' }, ['Noch kein Konto? Jetzt registrieren']);
        switchLink.addEventListener('click', () => { mode = 'register'; renderForm(); });
        form.appendChild(switchLink);
      }

      setTimeout(() => usernameInput.focus(), 50);
      return form;
    }

    function buildRegisterForm() {
      const errorBox = errorBoxEl();
      const minLength = SSD.Auth.PASSWORD_MIN_LENGTH;
      const firstNameInput = U.el('input', { class: 'input', placeholder: 'Vorname' });
      const lastNameInput = U.el('input', { class: 'input', placeholder: 'Nachname' });
      const usernameInput = U.el('input', { class: 'input', autocomplete: 'username', placeholder: 'Benutzername wählen' });
      const passwordInput = U.el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: `Passwort (mind. ${minLength} Zeichen)` });
      const passwordConfirmInput = U.el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Passwort bestätigen' });
      const genderSelect = U.el('select', { class: 'select' }, SSD.Models.GENDERS.map((g) => U.el('option', { value: g.key, selected: g.key === 'n' }, [g.label])));
      const classInput = U.el('input', { class: 'input', placeholder: 'z. B. 10a' });
      const firstAbi = U.schoolYearEnd();
      const yearInput = U.el('input', { class: 'input', type: 'number', min: String(firstAbi), max: String(firstAbi + 9), placeholder: `z. B. ${firstAbi + 2}` });
      const hasCode = SSD.Auth.hasRegistrationCode();
      const codeInput = U.el('input', { class: 'input', placeholder: 'z. B. SANI-7K3Q-P9XM', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
      const submitBtn = U.el('button', { class: 'btn btn--primary btn--block btn--lg', type: 'submit' }, ['Konto erstellen']);
      const privacyNote = U.el('p', { class: 'field__hint', style: 'margin:0 0 12px;' }, [
        'Mit dem Konto speichert der Schulsanitätsdienst Ihren Namen, Ihre Klasse, Ihre Verfügbarkeiten und Ihre Dienste, um den Dienstplan zu organisieren. Das Geschlecht ist freiwillig und wird nur genutzt, um auf Wunsch gemischte Teams zu bilden. Details stehen in den ',
        U.el('a', { href: '#/datenschutz' }, ['Datenschutzhinweisen']),
        '.',
      ]);

      const form = U.el('form', {}, [
        errorBox,
        U.el('div', { class: 'grid grid-cols-2' }, [field('Vorname', firstNameInput), field('Nachname', lastNameInput)]),
        field('Benutzername', usernameInput),
        U.el('div', { class: 'grid grid-cols-2' }, [field('Passwort', passwordInput), field('Passwort bestätigen', passwordConfirmInput)]),
        U.el('div', { class: 'grid grid-cols-3' }, [field('Geschlecht (freiwillig)', genderSelect), field('Klasse', classInput), field(role === 'azubi' ? 'Abijahrgang (optional)' : 'Abijahrgang', yearInput)]),
        hasCode ? field('Schulcode', codeInput) : null,
        privacyNote,
        submitBtn,
      ]);

      function showError(msg) {
        errorBox.querySelector('span:last-child').textContent = msg;
        errorBox.style.display = 'flex';
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.style.display = 'none';

        const yearValue = Number(yearInput.value);
        const data = {
          firstName: firstNameInput.value.trim(),
          lastName: lastNameInput.value.trim(),
          username: usernameInput.value.trim(),
          gender: genderSelect.value,
          schoolClass: classInput.value.trim(),
          yearGroup: yearValue || null,
          role,
        };

        const problems = [];
        if (!U.Validate.required(data.firstName)) problems.push('Bitte einen Vornamen eingeben.');
        if (!U.Validate.required(data.lastName)) problems.push('Bitte einen Nachnamen eingeben.');
        if (!U.Validate.usernameFormat(data.username)) problems.push('Benutzername: 3–32 Zeichen, nur Buchstaben/Zahlen/._-');
        if (!U.Validate.minLength(passwordInput.value, minLength)) problems.push(`Das Passwort muss mindestens ${minLength} Zeichen lang sein.`);
        else if (passwordInput.value !== passwordConfirmInput.value) problems.push('Die Passwörter stimmen nicht überein.');
        if (yearInput.value && (!Number.isInteger(yearValue) || yearValue < firstAbi || yearValue > firstAbi + 9)) problems.push(`Bitte einen Abijahrgang zwischen ${firstAbi} und ${firstAbi + 9} angeben.`);
        else if (role !== 'azubi' && !yearInput.value) problems.push(`Bitte Ihren Abijahrgang angeben (Jahr des Abiturs, z. B. ${firstAbi + 2}).`);
        if (hasCode && !codeInput.value.trim()) problems.push('Bitte den Schulcode eingeben, den Sie vom Sanitätsdienst erhalten haben.');

        if (problems.length) { showError(problems[0]); return; }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Wird erstellt …';
        const result = await SSD.StudentService.registerSelf({ ...data, password: passwordInput.value, code: codeInput.value });
        submitBtn.disabled = false;
        submitBtn.textContent = 'Konto erstellen';

        if (!result.ok) { showError(result.error); return; }
        if (!result.pending) {
          SSD.Toast.success('Willkommen!', 'Ihr Konto ist freigeschaltet — Sie sind jetzt angemeldet.');
          return;
        }
        mode = 'login';
        renderForm();
        SSD.Toast.success('Konto erstellt!', 'Ein Administrator oder die Sanisprecher:innen müssen Ihr Konto noch freischalten, bevor Sie sich anmelden können.');
      });

      const switchLink = U.el('button', { type: 'button', class: 'btn btn--ghost btn--block btn--sm', style: 'margin-top:10px;' }, ['Bereits ein Konto? Zur Anmeldung']);
      switchLink.addEventListener('click', () => { mode = 'login'; renderForm(); });
      form.appendChild(switchLink);

      setTimeout(() => firstNameInput.focus(), 50);
      return form;
    }

    setRole('student');
    screen.appendChild(card);
    card.appendChild(buildLegalLinks());
    container.appendChild(screen);
  }

  return { render, buildLegalLinks };
})();
