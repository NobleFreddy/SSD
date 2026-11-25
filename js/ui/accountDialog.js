/**
 * ============================================================================
 * SSD.PasswordDialog / SSD.AccountDialog — eigenes Konto
 * ============================================================================
 * PasswordDialog: Passwort ändern. Erscheint nach der Anmeldung von selbst,
 * wenn die Administration das Passwort vergeben hat (muss geändert werden)
 * oder es kürzer als die Mindestlänge ist.
 *
 * AccountDialog ("Mein Konto" im Schülerbereich): Passwort ändern, die
 * eigenen Engagement-Zahlen, die angemeldeten Geräte (zum Abmelden z. B. eines
 * verlorenen Handys) und eine Kopie aller eigenen Daten zum Herunterladen
 * (Auskunft/Datenübertragbarkeit, Art. 15 und 20 DSGVO).
 */
window.SSD = window.SSD || {};

SSD.PasswordDialog = (function () {
  'use strict';

  const U = SSD.Utils;
  let open = false;

  function ownId() {
    const session = SSD.Auth.getSession();
    if (!session) return null;
    return session.role === 'admin' ? 'admin' : session.studentId;
  }

  function field(labelText, inputEl) {
    return U.el('div', { class: 'field' }, [U.el('label', { class: 'field__label' }, [labelText]), inputEl]);
  }

  /** @param {{reason?: 'must'|'weak'}} [opts] */
  function show(opts) {
    if (open || !SSD.Auth.getSession()) return;
    open = true;
    const reason = opts && opts.reason;
    const minLength = SSD.Auth.PASSWORD_MIN_LENGTH;
    const currentInput = U.el('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
    const newInput = U.el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: `mind. ${minLength} Zeichen` });
    const confirmInput = U.el('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });
    const intro = reason === 'must'
      ? 'Ihr Passwort wurde von der Administration vergeben. Bitte wählen Sie jetzt ein eigenes Passwort, das nur Sie kennen.'
      : reason === 'weak'
        ? `Ihr Passwort ist kürzer als ${minLength} Zeichen. Bitte wählen Sie ein längeres — am einfachsten einen kurzen Satz.`
        : `Das neue Passwort braucht mindestens ${minLength} Zeichen. Gut merkbar und sicher ist ein kurzer Satz.`;

    const body = U.el('div', { class: 'stack gap-3' }, [
      U.el('p', { style: 'margin:0;' }, [intro]),
      errorBox,
      field('Aktuelles Passwort', currentInput),
      U.el('div', { class: 'grid grid-cols-2' }, [field('Neues Passwort', newInput), field('Neues Passwort bestätigen', confirmInput)]),
    ]);

    async function submit() {
      errorBox.style.display = 'none';
      const showError = (msg) => { errorBox.textContent = msg; errorBox.style.display = 'flex'; };
      if (!currentInput.value) { showError('Bitte das aktuelle Passwort eingeben.'); return; }
      if (!U.Validate.minLength(newInput.value, minLength)) { showError(`Das neue Passwort muss mindestens ${minLength} Zeichen lang sein.`); return; }
      if (newInput.value !== confirmInput.value) { showError('Die neuen Passwörter stimmen nicht überein.'); return; }
      if (newInput.value === currentInput.value) { showError('Bitte ein anderes als das bisherige Passwort wählen.'); return; }
      try {
        await SSD.Auth.setPassword(ownId(), newInput.value, currentInput.value);
      } catch (err) {
        showError(String(err.message || err));
        return;
      }
      handle.close();
      SSD.Toast.success('Passwort geändert', 'Andere Anmeldungen mit dem alten Passwort wurden beendet.');
    }

    const buttons = [];
    if (reason === 'weak') {
      buttons.push({ label: 'Später', variant: 'secondary', onClick: () => SSD.Auth.clearPasswordFlags() });
    } else if (reason !== 'must') {
      buttons.push({ label: 'Abbrechen', variant: 'secondary' });
    }
    buttons.push({ label: 'Passwort ändern', variant: 'primary', closeOnClick: false, onClick: submit });

    const handle = SSD.Dialog.open({
      title: 'Passwort ändern',
      body,
      closeOnOverlayClick: false,
      onClose: () => { open = false; },
      footerButtons: buttons,
    });
    [currentInput, newInput, confirmInput].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
  }

  /** Nach Anmeldung/Seitenwechsel: Pflicht-Wechsel bzw. Hinweis auf ein zu kurzes Passwort. */
  function promptIfNeeded() {
    const session = SSD.Auth.getSession();
    if (!session) return;
    if (session.mustChangePassword) show({ reason: 'must' });
    else if (session.weakPassword) show({ reason: 'weak' });
  }

  return { show, promptIfNeeded };
})();

SSD.AccountDialog = (function () {
  'use strict';

  const U = SSD.Utils;

  /** Alle Daten, die sich auf die angemeldete Person beziehen (ohne Passwort — das kennt nur der Server). */
  function collectOwnData(student) {
    const state = SSD.Store.getState();
    const id = student.id;
    const name = (pid) => {
      const p = SSD.StudentService.getById(pid);
      return p ? SSD.StudentService.fullName(p) : null;
    };
    return {
      exportiertAm: new Date().toISOString(),
      hinweis: 'Kopie der im Dienstplan des Schulsanitätsdienstes gespeicherten Daten zu Ihrer Person (Art. 15 und 20 DSGVO). Passwörter werden nur als Hash auf dem Server gespeichert und sind hier nicht enthalten.',
      person: Object.assign({}, student, { preferredPartners: (student.preferredPartnerIds || []).map(name) }),
      dienste: state.schedule.entries
        .filter((e) => (e.studentIds || []).includes(id) || e.azubiId === id)
        .map((e) => ({ datum: e.date, block: U.blockLabel(e.block), mit: (e.studentIds || []).concat(e.azubiId ? [e.azubiId] : []).filter((pid) => pid !== id).map(name) })),
      vertretungen: state.schedule.entries.flatMap((e) => (e.substitutionLog || [])
        .filter((l) => l.originalStudentId === id || l.replacementStudentId === id)
        .map((l) => ({ datum: e.date, block: U.blockLabel(e.block), rolle: l.originalStudentId === id ? 'vertreten worden' : 'eingesprungen', am: l.appliedAt }))),
      vertretungAngefragt: state.schedule.entries.flatMap((e) => (e.substitutionRequests || []).filter((r) => r.studentId === id).map((r) => ({ datum: e.date, block: U.blockLabel(e.block), am: r.requestedAt }))),
      teamtreffen: (state.meetings || []).map((m) => ({
        titel: m.title, datum: m.date,
        antwort: ((m.responses || []).find((r) => r.personId === id) || {}).status || null,
        anwesend: m.attendanceTaken ? (m.attendeeIds || []).includes(id) : null,
      })).filter((m) => m.antwort || m.anwesend !== null),
      veranstaltungen: (state.events || []).filter((e) => (e.participantIds || []).includes(id)).map((e) => ({ titel: e.title, datum: e.date })),
      aufgabenErledigt: (state.tasks || []).filter((t) => t.completedBy === id).map((t) => ({ titel: t.title, erledigtAm: t.completedAt })),
      materialanfragen: (state.materials || []).filter((m) => m.requestedBy === id).map((m) => ({ material: m.name, status: m.status, angefragtAm: m.requestedAt })),
    };
  }

  function engagementOf(student) {
    const range = SSD.EngagementService.currentSchoolYearRange();
    const result = SSD.EngagementService.compute(range.from, range.to);
    const row = result.rows.find((r) => r.person.id === student.id);
    return { range, row };
  }

  /** „heute, 14:05“ / „gestern, 08:12“ / „21.11., 16:30“ */
  function whenLabel(iso) {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return 'unbekannt';
    const day = U.toIsoDate(date);
    const label = day === U.toIsoDate(U.today()) ? 'heute'
      : day === U.toIsoDate(U.addDays(U.today(), -1)) ? 'gestern' : U.formatDateShort(date);
    return `${label}, ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function sessionDetail(s) {
    if (s.remembered) return `zuletzt genutzt: ${whenLabel(s.lastUsedAt)} · bleibt angemeldet bis ${U.formatDateMedium(new Date(s.expiresAt))}, jede Nutzung verlängert das`;
    return `angemeldet: ${whenLabel(s.createdAt)} · endet spätestens nach 12 Stunden`;
  }

  /** Abschnitt „Angemeldete Geräte“ — wird beim Öffnen vom Server geladen. */
  function buildSessionsSection() {
    const box = U.el('div', { class: 'stack gap-2', 'aria-live': 'polite' }, [U.el('p', { class: 'text-tertiary', style: 'margin:0;' }, ['Wird geladen …'])]);

    async function run(action) {
      try {
        const ended = await action();
        SSD.Toast.success('Abgemeldet', ended === 1 ? '1 Anmeldung wurde beendet.' : `${ended} Anmeldungen wurden beendet.`);
      } catch (err) {
        SSD.Toast.error('Nicht möglich', String(err.message || err));
      }
      load();
    }

    function row(title, detail, isCurrent, onEnd) {
      const endBtn = onEnd ? U.el('button', { class: 'btn btn--ghost btn--sm', html: SSD.Icons.svg('logout', { size: 14 }) }, ['Abmelden']) : null;
      if (endBtn) endBtn.addEventListener('click', () => { endBtn.disabled = true; run(onEnd); });
      return U.el('div', { class: 'member-row' }, [
        U.el('div', { class: 'session-row__main' }, [
          U.el('div', { class: 'cluster gap-2' }, [
            U.el('strong', {}, [title]),
            isCurrent ? U.el('span', { class: 'badge badge--primary' }, ['dieses Gerät']) : null,
          ]),
          U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [detail]),
        ]),
        endBtn,
      ]);
    }

    /** Dauerhafte Anmeldungen einzeln; kurze (enden von selbst) zusammengefasst. */
    function rows(sessions) {
      const list = sessions.filter((s) => s.current || s.remembered).map((s) => row(
        s.device || 'Angemeldet bis zum Schließen der Seite', sessionDetail(s), s.current,
        s.current ? null : () => SSD.Auth.endOtherSessions(s.id),
      ));
      const short = sessions.filter((s) => !s.current && !s.remembered);
      if (short.length) {
        list.push(row(
          short.length === 1 ? '1 kurze Anmeldung' : `${short.length} kurze Anmeldungen`,
          `ohne „Angemeldet bleiben“, zuletzt ${whenLabel(short[0].createdAt)} · endet spätestens nach 12 Stunden`, false,
          async () => {
            let ended = 0;
            for (const s of short) ended += await SSD.Auth.endOtherSessions(s.id);
            return ended;
          },
        ));
      }
      return list;
    }

    async function load() {
      let sessions;
      try {
        sessions = await SSD.Auth.listSessions();
      } catch (err) {
        box.replaceChildren(U.el('p', { class: 'text-tertiary', style: 'margin:0;' }, ['Die Liste konnte gerade nicht geladen werden.']));
        return;
      }
      const others = sessions.filter((s) => !s.current);
      const children = [U.el('div', {}, rows(sessions))];
      if (others.length > 1) {
        const allBtn = U.el('button', { class: 'btn btn--secondary btn--sm' }, ['Alle anderen Geräte abmelden']);
        allBtn.addEventListener('click', async () => {
          const ok = await SSD.Dialog.confirm({ title: 'Andere Geräte abmelden', message: `${others.length} andere Anmeldungen beenden? Auf diesem Gerät bleiben Sie angemeldet.`, confirmLabel: 'Abmelden' });
          if (ok) run(() => SSD.Auth.endOtherSessions());
        });
        children.push(U.el('div', {}, [allBtn]));
      }
      box.replaceChildren(...children);
    }
    load();

    return U.el('div', {}, [
      U.el('div', { class: 'section-label' }, ['Angemeldete Geräte']),
      U.el('p', { style: 'margin:0 0 6px;' }, ['Hier sehen Sie, wo Sie angemeldet sind. Handy verloren oder an einem fremden Gerät angemeldet geblieben? Dann hier abmelden und das Passwort ändern.']),
      box,
    ]);
  }

  function stat(label, value) {
    return U.el('div', { class: 'stat-tile' }, [U.el('div', { class: 'stat-tile__value' }, [String(value)]), U.el('div', { class: 'stat-tile__label' }, [label])]);
  }

  function open() {
    const student = SSD.Auth.getCurrentStudent();
    if (!student) return;
    const { range, row } = engagementOf(student);

    const passwordBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('key', { size: 15 }) }, ['Passwort ändern']);
    passwordBtn.addEventListener('click', () => { handle.close(); setTimeout(() => SSD.PasswordDialog.show(), 160); });

    const downloadBtn = U.el('button', { class: 'btn btn--secondary', html: SSD.Icons.svg('download', { size: 15 }) }, ['Meine Daten herunterladen']);
    downloadBtn.addEventListener('click', async () => {
      const data = collectOwnData(student);
      try {
        data.anmeldungen = (await SSD.Auth.listSessions()).map((s) => ({
          geraet: s.device, dauerhaft: s.remembered, angemeldetAm: s.createdAt, zuletztGenutzt: s.lastUsedAt, gueltigBis: s.expiresAt,
        }));
      } catch (err) { /* ohne Verbindung: Kopie ohne die Geräteliste */ }
      U.downloadBlob(`meine_daten_${U.toIsoDate(U.today())}.json`, JSON.stringify(data, null, 2), 'application/json');
    });

    const privacyLink = U.el('a', { href: '#/datenschutz' }, ['Datenschutzhinweise']);
    privacyLink.addEventListener('click', () => handle.close());

    const body = U.el('div', { class: 'stack gap-4' }, [
      U.el('div', {}, [
        U.el('div', { class: 'section-label' }, [`Mein Engagement im Schuljahr ${range.label}`]),
        U.el('div', { class: 'stat-tiles' }, [
          stat('Dienste', row ? row.duties : 0),
          stat('davon eingesprungen', row ? row.jumpIns : 0),
          stat('Veranstaltungen', row ? row.events : 0),
          stat('Aufgaben erledigt', row ? row.tasks : 0),
          stat('Teamtreffen besucht', row ? `${row.meetingsAttended}/${row.meetingsTotal}` : '0/0'),
        ]),
        U.el('p', { class: 'text-tertiary', style: 'margin:8px 0 0; font-size:var(--font-size-xs);' }, ['So zählt auch die Engagement-Übersicht der Team-Koordination. Fehlt etwas oder stimmt etwas nicht, bitte bei der Administration melden.']),
      ]),
      buildSessionsSection(),
      U.el('div', {}, [
        U.el('div', { class: 'section-label' }, ['Meine Daten']),
        U.el('p', { style: 'margin:0 0 10px;' }, ['Laden Sie eine Kopie aller Daten herunter, die zu Ihrer Person gespeichert sind (JSON-Datei). Für Berichtigung oder Löschung wenden Sie sich an die Administration.']),
        U.el('div', { class: 'cluster gap-2' }, [downloadBtn, passwordBtn]),
      ]),
      U.el('p', { class: 'text-secondary', style: 'margin:0; font-size:var(--font-size-sm);' }, ['Mehr dazu in den ', privacyLink, '.']),
    ]);

    const handle = SSD.Dialog.open({ title: 'Mein Konto', body, wide: true, footerButtons: [{ label: 'Schließen', variant: 'primary' }] });
  }

  return { open, collectOwnData };
})();
