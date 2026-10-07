/**
 * ============================================================================
 * SSD.TeamMembersPanel — Freischaltungen & "Wer fehlt noch?"
 * ============================================================================
 * Gemeinsame Ansicht für den Administrator (Team → Mitglieder) und die
 * Sanisprecher:innen (Team-Verwaltung → Mitglieder):
 *   1. Selbstregistrierungen ohne Schulcode freischalten oder ablehnen.
 *   2. Wer hat noch keine Verfügbarkeit eingetragen bzw. sie seit einem
 *      Stichtag nicht mehr aktualisiert? — mit Erinnerung in der App: Die
 *      Person sieht nach dem Anmelden einen Hinweis, bis sie ihre
 *      Verfügbarkeit ändert oder als aktuell bestätigt.
 */
window.SSD = window.SSD || {};

SSD.TeamMembersPanel = (function () {
  'use strict';

  const U = SSD.Utils;
  let cutoffIso = null; // Stichtag "nicht mehr aktualisiert seit" — gilt bis zum Neuladen der Seite

  function roleLabel(person) {
    return person.role === 'azubi' ? 'Azubi' : 'Schüler:in';
  }

  function personMeta(person, extra) {
    const parts = [roleLabel(person)];
    if (person.schoolClass) parts.push(`Klasse ${person.schoolClass}`);
    if (person.yearGroup) parts.push(`Abi ${person.yearGroup}`);
    return parts.concat(extra || []).join(' · ');
  }

  function avatar(person) {
    return U.el('div', { class: 'avatar avatar--sm', style: `background:${U.colorFromString(person.id)}` }, [U.initials(person.firstName, person.lastName)]);
  }

  /* ---------------------------------------------------------------------
   * 1. Neue Registrierungen
   * ------------------------------------------------------------------- */

  function buildRegistrationsCard(onChange) {
    const pending = SSD.StudentService.getPendingRegistrations();
    const body = U.el('div', { class: 'card__body' });

    if (!pending.length) {
      body.appendChild(U.el('p', { class: 'text-tertiary', style: 'margin:0;' }, ['Keine offenen Registrierungen.']));
    } else {
      pending.forEach((person) => {
        const approveBtn = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('checkCircle', { size: 14 }) }, ['Freischalten']);
        approveBtn.addEventListener('click', () => {
          try {
            SSD.StudentService.approveRegistration(person.id);
            SSD.Toast.success('Freigeschaltet', `${SSD.StudentService.fullName(person)} kann sich jetzt anmelden.`);
          } catch (err) {
            SSD.Toast.error('Nicht möglich', String(err.message || err));
          }
          if (onChange) onChange();
        });
        const rejectBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('xCircle', { size: 14 }) }, ['Ablehnen']);
        rejectBtn.addEventListener('click', async () => {
          const ok = await SSD.Dialog.confirm({
            title: 'Registrierung ablehnen', danger: true, confirmLabel: 'Ablehnen',
            message: `Die Registrierung von ${SSD.StudentService.fullName(person)} ablehnen? Das Konto wird gelöscht; die Person kann sich bei Bedarf neu registrieren.`,
          });
          if (!ok) return;
          try {
            SSD.StudentService.rejectRegistration(person.id);
            SSD.Toast.success('Abgelehnt', 'Die Registrierung wurde gelöscht.');
          } catch (err) {
            SSD.Toast.error('Nicht möglich', String(err.message || err));
          }
          if (onChange) onChange();
        });

        const registered = person.createdAt ? `registriert am ${U.formatDateMedium(new Date(person.createdAt))}` : null;
        body.appendChild(U.el('div', { class: 'member-row' }, [
          U.el('div', { class: 'member-row__main' }, [
            avatar(person),
            U.el('div', {}, [
              U.el('strong', {}, [SSD.StudentService.fullName(person)]),
              U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [personMeta(person, [`@${person.username}`, registered].filter(Boolean))]),
            ]),
          ]),
          U.el('div', { class: 'cluster gap-2' }, [rejectBtn, approveBtn]),
        ]));
      });
    }

    return U.el('div', { class: 'card' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title' }, ['Neue Registrierungen']),
          U.el('div', { class: 'card__subtitle' }, ['Ohne Schulcode registrierte Konten — anmelden können sich die Personen erst nach der Freischaltung.']),
        ]),
        pending.length ? U.el('span', { class: 'badge badge--warning' }, [`${pending.length} offen`]) : null,
      ]),
      body,
    ]);
  }

  /* ---------------------------------------------------------------------
   * 2. Verfügbarkeit — wer fehlt noch?
   * ------------------------------------------------------------------- */

  function reminderBadge(person) {
    if (!SSD.StudentService.needsAvailabilityReminder(person)) return null;
    return U.el('span', { class: 'badge badge--primary', 'data-tooltip': 'Die Person sieht beim Anmelden einen Hinweis.' }, [
      `erinnert am ${U.formatDateShort(new Date(person.availabilityReminderAt))}`,
    ]);
  }

  function remind(ids, onChange) {
    try {
      const count = SSD.StudentService.remindAvailability(ids);
      SSD.Toast.success('Erinnerung gesetzt', count === 1
        ? 'Die Person sieht beim nächsten Anmelden einen Hinweis.'
        : `${count} Personen sehen beim nächsten Anmelden einen Hinweis.`);
    } catch (err) {
      SSD.Toast.error('Nicht möglich', String(err.message || err));
    }
    if (onChange) onChange();
  }

  function gapRow(person, statusText, onChange) {
    const reminded = SSD.StudentService.needsAvailabilityReminder(person);
    const btn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('bell', { size: 14 }) }, [reminded ? 'Erneut erinnern' : 'Erinnern']);
    btn.addEventListener('click', () => remind([person.id], onChange));
    return U.el('div', { class: 'member-row' }, [
      U.el('div', { class: 'member-row__main' }, [
        avatar(person),
        U.el('div', {}, [
          U.el('strong', {}, [SSD.StudentService.fullName(person)]),
          U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs);' }, [personMeta(person, [statusText])]),
        ]),
      ]),
      U.el('div', { class: 'cluster gap-2' }, [reminderBadge(person), btn]),
    ]);
  }

  function buildAvailabilityCard(onChange) {
    const S = SSD.StudentService;
    if (!cutoffIso) cutoffIso = S.currentHalfYearStart();
    const gaps = S.getAvailabilityGaps(cutoffIso);
    const allIds = gaps.missing.concat(gaps.outdated).map((p) => p.id);
    const enteredCount = gaps.activeCount - gaps.missing.length;

    const card = U.el('div', { class: 'card' });
    const remindAllBtn = U.el('button', { class: 'btn btn--primary btn--sm', html: SSD.Icons.svg('bell', { size: 14 }), disabled: !allIds.length }, [
      allIds.length ? `Alle erinnern (${allIds.length})` : 'Alle erinnern',
    ]);
    remindAllBtn.addEventListener('click', async () => {
      const ok = await SSD.Dialog.confirm({
        title: 'Alle erinnern', confirmLabel: 'Erinnern',
        message: `${allIds.length} Person(en) sehen beim nächsten Anmelden den Hinweis, ihre Verfügbarkeit einzutragen bzw. zu prüfen.`,
      });
      if (ok) remind(allIds, onChange);
    });

    const cutoffInput = U.el('input', { class: 'input', type: 'date', value: cutoffIso, max: U.toIsoDate(U.today()), style: 'width:auto; display:inline-block;' });
    cutoffInput.addEventListener('change', () => {
      if (!cutoffInput.value) return;
      cutoffIso = cutoffInput.value;
      card.replaceWith(buildAvailabilityCard(onChange));
    });

    const body = U.el('div', { class: 'card__body stack gap-4' });

    body.appendChild(U.el('div', {}, [
      U.el('div', { class: 'section-label' }, [`Noch nichts eingetragen (${gaps.missing.length})`]),
      gaps.missing.length
        ? U.el('div', {}, gaps.missing.map((p) => gapRow(p, 'noch keine verfügbare Zeit eingetragen', onChange)))
        : U.el('p', { class: 'text-tertiary', style: 'margin:4px 0 0;' }, ['Alle aktiven Mitglieder haben mindestens eine verfügbare Zeit eingetragen.']),
    ]));

    body.appendChild(U.el('div', {}, [
      U.el('div', { class: 'cluster gap-2 section-label' }, [
        U.el('span', {}, [`Seit dem Stichtag nicht mehr geändert oder bestätigt (${gaps.outdated.length})`]),
        cutoffInput,
      ]),
      gaps.outdated.length
        ? U.el('div', {}, gaps.outdated.map((p) => gapRow(p, `zuletzt am ${U.formatDateMedium(U.parseIsoDate(S.availabilityUpdatedDate(p)))}`, onChange)))
        : U.el('p', { class: 'text-tertiary', style: 'margin:4px 0 0;' }, ['Alle anderen haben ihre Verfügbarkeit seit dem Stichtag geändert oder bestätigt.']),
    ]));

    body.appendChild(U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, [
      'Erinnerte Personen sehen nach dem Anmelden einen Hinweis, bis sie ihre Verfügbarkeit ändern oder als aktuell bestätigen. Der Stichtag ist anfangs der Beginn des Schulhalbjahres (1. August bzw. 1. Februar).',
    ]));

    card.appendChild(U.el('div', { class: 'card__header' }, [
      U.el('div', {}, [
        U.el('div', { class: 'card__title' }, ['Verfügbarkeit — wer fehlt noch?']),
        U.el('div', { class: 'card__subtitle' }, [`${enteredCount} von ${gaps.activeCount} aktiven Mitgliedern haben ihre Verfügbarkeit eingetragen.`]),
      ]),
      remindAllBtn,
    ]));
    card.appendChild(body);
    return card;
  }

  /** @param {{ onChange?: Function }} [opts] */
  function render(opts) {
    const onChange = opts && opts.onChange;
    return U.el('div', { class: 'stack gap-5' }, [
      buildRegistrationsCard(onChange),
      buildAvailabilityCard(onChange),
    ]);
  }

  return { render };
})();
