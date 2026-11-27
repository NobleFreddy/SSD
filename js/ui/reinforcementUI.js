/**
 * ============================================================================
 * SSD.ReinforcementUI — „Verstärkung anfordern“ (Oberfläche)
 * ============================================================================
 *  - openRequestDialog(): Tag und Stunde wählen, verfügbare Sanis selbst
 *    ankreuzen oder per Anzahl („1“, „2“, „3“, „Alle“) einteilen lassen.
 *    Mit `requestId` werden zu einer bestehenden Anfrage weitere eingeteilt.
 *  - buildRequestCard(): Stand der eigenen Anfrage — wer eingeteilt ist, wer
 *    es gesehen hat, wer nicht kann; „Kommt nicht“, „Weitere einteilen“,
 *    „Zurücknehmen“.
 *  - buildAssignmentNotice(): Hinweis für Eingeteilte („Verstanden“ / „Kann nicht“).
 * Regeln und Speichern: SSD.ReinforcementService.
 */
window.SSD = window.SSD || {};

SSD.ReinforcementUI = (function () {
  'use strict';

  const U = SSD.Utils;
  const COUNT_OPTIONS = [1, 2, 3];

  function R() { return SSD.ReinforcementService; }

  function name(id) {
    const person = id && SSD.StudentService.getById(id);
    return person ? SSD.StudentService.fullName(person) : '(gelöscht)';
  }

  function dayLabel(iso) {
    const date = U.parseIsoDate(iso);
    const rel = U.relativeDayLabel(iso);
    const short = `${U.WEEKDAY_LABELS_SHORT[U.weekdayKeyFromDate(date)]}, ${U.formatDateShort(date)}`;
    return rel ? `${rel} · ${short}` : short;
  }

  /** Nächste Werktage ab heute (für die Tag-Tasten). */
  function nextWeekdays(count) {
    const list = [];
    for (let d = U.today(); list.length < count; d = U.addDays(d, 1)) {
      if (U.weekdayKeyFromDate(d)) list.push(U.toIsoDate(d));
    }
    return list;
  }

  /** Eigener Dienstblock an diesem Tag (als Vorauswahl), sonst null. */
  function ownBlockOn(personId, dateIso) {
    if (!personId) return null;
    const entry = SSD.Store.getState().schedule.entries
      .filter((e) => e.date === dateIso && (e.studentIds.includes(personId) || e.azubiId === personId))
      .sort((a, b) => a.block.localeCompare(b.block))[0];
    return entry ? entry.block : null;
  }

  function field(label, control, hint) {
    return U.el('div', { class: 'field' }, [
      U.el('span', { class: 'field__label' }, [label]),
      control,
      hint ? U.el('div', { class: 'field__hint' }, [hint]) : null,
    ]);
  }

  /* ---------------------------------------------------------------------
   * Dialog
   * ------------------------------------------------------------------- */

  /**
   * @param {{requestId?: string, onDone?: Function}} [opts]
   */
  function openRequestDialog(opts) {
    const o = opts || {};
    const me = SSD.Auth.currentPersonId();
    const existing = o.requestId ? R().getById(o.requestId) : null;
    if (o.requestId && !R().isOpen(existing)) { SSD.Toast.info('Nicht mehr aktiv', 'Diese Anfrage wurde inzwischen zurückgenommen.'); return; }

    const days = nextWeekdays(5);
    let dateIso = existing ? existing.date : days[0];
    let block = existing ? existing.block : ownBlockOn(me, dateIso);
    let selected = new Set();
    let autoCount = null; // per Anzahl-Taste gewählt (und seitdem nicht von Hand geändert)

    const errorBox = U.el('div', { class: 'auth-error', style: 'display:none;' });
    const dayWrap = U.el('div');
    const blockWrap = U.el('div');
    const peopleWrap = U.el('div');
    const noteInput = U.el('input', { class: 'input', maxlength: String(R().MAX_NOTE), placeholder: 'z. B. Sporthalle, viele Verletzte', value: existing ? existing.note || '' : '' });
    let submitBtn = null;

    const list = () => R().candidates(dateIso, block, { requestId: existing ? existing.id : null, requesterId: existing ? existing.requestedBy : me });

    function renderDays() {
      if (existing) return;
      const otherInput = U.el('input', {
        class: 'input', type: 'date', 'aria-label': 'Anderer Tag',
        min: U.toIsoDate(U.today()), max: U.toIsoDate(U.addDays(U.today(), 56)),
        value: days.includes(dateIso) ? '' : dateIso,
      });
      otherInput.addEventListener('change', () => {
        if (!otherInput.value) return;
        const problem = R().checkSlot(otherInput.value, 'b12');
        if (problem) { showError(problem); otherInput.value = ''; return; }
        setDay(otherInput.value);
      });
      const chips = days.map((iso) => {
        const date = U.parseIsoDate(iso);
        const btn = U.el('button', { type: 'button', class: `choice-chip${iso === dateIso ? ' is-active' : ''}`, 'aria-pressed': iso === dateIso ? 'true' : 'false' }, [
          U.el('span', { class: 'choice-chip__main' }, [U.relativeDayLabel(iso) || U.WEEKDAY_LABELS_SHORT[U.weekdayKeyFromDate(date)]]),
          U.el('span', { class: 'choice-chip__sub' }, [U.formatDateShort(date)]),
        ]);
        btn.addEventListener('click', () => setDay(iso));
        return btn;
      });
      dayWrap.replaceChildren(field('Wann?', U.el('div', { class: 'stack gap-2' }, [
        U.el('div', { class: 'choice-grid choice-grid--5' }, chips),
        U.el('div', { class: 'cluster gap-2' }, [U.el('span', { class: 'text-tertiary', style: 'font-size:var(--font-size-sm);' }, ['anderer Tag:']), otherInput]),
      ])));
    }

    function renderBlocks() {
      if (existing) {
        blockWrap.replaceChildren(U.el('div', { class: 'notice-box notice-box--info' }, [
          U.el('span', { html: SSD.Icons.svg('team', { size: 18 }) }),
          U.el('div', {}, [
            U.el('strong', {}, [`${dayLabel(existing.date)}, ${U.blockLabel(existing.block)}`]),
            U.el('p', {}, [`Schon eingeteilt: ${R().activePeople(existing).map((p) => name(p.personId)).join(', ') || 'niemand'}`]),
          ]),
        ]));
        return;
      }
      const own = ownBlockOn(me, dateIso);
      const chips = U.DUTY_BLOCKS.map((b) => {
        const count = R().candidates(dateIso, b.key, { requesterId: me }).length;
        const btn = U.el('button', { type: 'button', class: `choice-chip${b.key === block ? ' is-active' : ''}`, 'aria-pressed': b.key === block ? 'true' : 'false' }, [
          U.el('span', { class: 'choice-chip__main' }, [b.short]),
          U.el('span', { class: 'choice-chip__sub' }, [b.key === own ? 'Ihr Dienst' : (count === 1 ? '1 Sani' : `${count} Sanis`)]),
        ]);
        btn.addEventListener('click', () => { block = b.key; selected = new Set(); autoCount = null; renderBlocks(); renderPeople(); });
        return btn;
      });
      blockWrap.replaceChildren(field('Welche Stunde?', U.el('div', { class: 'choice-grid choice-grid--4' }, chips)));
    }

    function renderPeople() {
      if (!block) {
        peopleWrap.replaceChildren(field('Wen?', U.el('p', { class: 'text-tertiary', style: 'margin:0;' }, ['Bitte zuerst die Stunde wählen.'])));
        updateSubmit();
        return;
      }
      const candidates = list();
      selected = new Set([...selected].filter((id) => candidates.some((c) => c.student.id === id)));
      if (!candidates.length) {
        peopleWrap.replaceChildren(field('Wen?', U.el('p', { class: 'text-tertiary', style: 'margin:0;' }, [
          'Zu dieser Zeit ist keine:r der Sanis als „Verfügbar“ eingetragen (oder alle sind schon im Dienst bzw. eingeteilt).',
        ])));
        updateSubmit();
        return;
      }
      const countBtns = COUNT_OPTIONS.filter((n) => n < candidates.length).concat([candidates.length]).map((n) => {
        const isAll = n === candidates.length;
        const btn = U.el('button', { type: 'button', class: `btn btn--sm ${autoCount === n ? 'btn--primary' : 'btn--secondary'}` }, [isAll ? `Alle (${n})` : String(n)]);
        btn.addEventListener('click', () => {
          autoCount = n;
          selected = new Set(candidates.slice(0, n).map((c) => c.student.id));
          renderPeople();
        });
        return btn;
      });
      const rows = candidates.map(({ student, weekDuties }) => {
        const box = U.el('input', { type: 'checkbox', checked: selected.has(student.id) });
        box.addEventListener('change', () => {
          if (box.checked) selected.add(student.id); else selected.delete(student.id);
          autoCount = null;
          renderPeople();
        });
        return U.el('label', { class: 'checkbox-row pick-row' }, [
          box,
          U.el('span', { class: 'pick-row__name' }, [SSD.StudentService.fullName(student)]),
          U.el('span', { class: 'pick-row__meta' }, [[student.schoolClass ? `Klasse ${student.schoolClass}` : null, weekDuties === 1 ? '1 Dienst diese Woche' : `${weekDuties} Dienste diese Woche`].filter(Boolean).join(' · ')]),
        ]);
      });
      peopleWrap.replaceChildren(field('Wen?', U.el('div', { class: 'stack gap-2' }, [
        U.el('div', { class: 'cluster gap-2' }, [U.el('span', { class: 'text-tertiary', style: 'font-size:var(--font-size-sm);' }, ['Einteilen lassen:']), ...countBtns]),
        U.el('div', { class: 'pick-list' }, rows),
      ]), 'Nur Sanis, die zu dieser Zeit „Verfügbar“ eingetragen haben. Oben stehen die, die diese Woche am wenigsten Dienst haben.'));
      updateSubmit();
    }

    function setDay(iso) {
      dateIso = iso;
      block = ownBlockOn(me, iso) || (block && R().candidates(iso, block, { requesterId: me }).length ? block : null);
      selected = new Set();
      autoCount = null;
      errorBox.style.display = 'none';
      renderDays();
      renderBlocks();
      renderPeople();
    }

    function updateSubmit() {
      if (!submitBtn) return;
      const n = selected.size;
      submitBtn.disabled = !n || !block;
      submitBtn.textContent = n ? `${n === 1 ? '1 Sani' : `${n} Sanis`} einteilen` : 'Einteilen';
    }

    function showError(msg) {
      errorBox.textContent = msg;
      errorBox.style.display = 'flex';
    }

    function submit() {
      errorBox.style.display = 'none';
      const ids = list().map((c) => c.student.id).filter((id) => selected.has(id)); // Reihenfolge der Liste
      try {
        if (existing) R().addPeople(existing.id, ids, autoCount != null);
        else R().create({ date: dateIso, block, note: noteInput.value, personIds: ids, auto: autoCount != null });
      } catch (err) {
        showError(String(err.message || err));
        renderBlocks();
        renderPeople();
        return;
      }
      const names = ids.map(name);
      const teams = SSD.NotificationService.isActive('reinforcement') ? ' Die Teams-Meldung folgt in etwa 30 Sekunden.' : '';
      SSD.Toast.show({
        type: 'success', duration: 7000,
        title: existing ? 'Weitere eingeteilt' : 'Verstärkung angefordert',
        message: `${names.join(', ')} ${names.length === 1 ? 'ist' : 'sind'} eingeteilt und ${names.length === 1 ? 'sieht' : 'sehen'} einen Hinweis in der App.${teams}`,
      });
      handle.close();
      if (o.onDone) o.onDone();
    }

    const body = U.el('div', { class: 'stack gap-4' }, [
      errorBox,
      dayWrap,
      blockWrap,
      existing ? null : field('Wo / was ist los? (optional)', noteInput),
      peopleWrap,
    ]);
    renderDays();
    renderBlocks();
    renderPeople();

    const handle = SSD.Dialog.open({
      title: existing ? 'Weitere Verstärkung einteilen' : 'Verstärkung anfordern',
      body,
      wide: true,
      footerButtons: [
        { label: 'Abbrechen', variant: 'secondary' },
        { label: 'Einteilen', variant: 'primary', closeOnClick: false, onClick: submit },
      ],
    });
    submitBtn = handle.el.querySelector('.modal__footer .btn--primary');
    updateSubmit();
  }

  /* ---------------------------------------------------------------------
   * Eigene Anfrage: Stand und Aktionen
   * ------------------------------------------------------------------- */

  function statusBadge(p) {
    if (p.removedAt) return U.el('span', { class: 'badge' }, ['herausgenommen']);
    if (p.declinedAt) return U.el('span', { class: 'badge badge--danger' }, ['kann nicht']);
    if (p.seenAt) return U.el('span', { class: 'badge badge--success', html: SSD.Icons.svg('check', { size: 11 }) }, ['gesehen']);
    return U.el('span', { class: 'badge badge--primary' }, ['eingeteilt']);
  }

  /**
   * @param {object} req
   * @param {Function} onChange - nach jeder Aktion (Seite neu zeichnen)
   */
  function buildRequestCard(req, onChange) {
    const run = (fn, done) => {
      try { fn(); if (done) done(); } catch (err) { SSD.Toast.error('Nicht möglich', String(err.message || err)); }
      if (onChange) onChange();
    };
    const active = R().activePeople(req);
    const rows = (req.people || []).map((p) => {
      const isActive = !p.declinedAt && !p.removedAt;
      let action = null;
      if (isActive) {
        action = U.el('button', { class: 'btn btn--ghost btn--sm' }, ['Kommt nicht']);
        action.addEventListener('click', async () => {
          const ok = await SSD.Dialog.confirm({ title: 'Kommt nicht', message: `${name(p.personId)} aus dieser Verstärkung herausnehmen? Danach können Sie jemand anderen einteilen.`, confirmLabel: 'Herausnehmen' });
          if (ok) run(() => R().removePerson(req.id, p.personId));
        });
      }
      return U.el('div', { class: `rf-person${isActive ? '' : ' rf-person--off'}` }, [
        U.el('div', { class: 'rf-person__main' }, [U.el('span', { class: 'rf-person__name' }, [name(p.personId)]), statusBadge(p)]),
        action,
      ]);
    });

    const addBtn = U.el('button', { class: `btn btn--sm ${active.length ? 'btn--secondary' : 'btn--primary'}`, html: SSD.Icons.svg('plus', { size: 14 }) }, ['Weitere einteilen']);
    addBtn.addEventListener('click', () => openRequestDialog({ requestId: req.id, onDone: onChange }));
    const cancelBtn = U.el('button', { class: 'btn btn--ghost btn--sm', html: SSD.Icons.svg('x', { size: 14 }) }, ['Zurücknehmen']);
    cancelBtn.addEventListener('click', async () => {
      const ok = await SSD.Dialog.confirm({
        title: 'Verstärkung zurücknehmen', danger: true, confirmLabel: 'Zurücknehmen',
        message: active.length ? `Die Anfrage zurücknehmen? ${active.map((p) => name(p.personId)).join(', ')} ${active.length === 1 ? 'sieht' : 'sehen'}, dass sie nicht kommen müssen.` : 'Die Anfrage zurücknehmen?',
      });
      if (ok) run(() => R().cancel(req.id), () => SSD.Toast.info('Zurückgenommen', 'Die Verstärkung ist abgesagt.'));
    });

    const grace = R().teamsGraceLeft(req);
    return U.el('section', { class: 'card rf-card', 'aria-label': 'Angeforderte Verstärkung' }, [
      U.el('div', { class: 'card__header' }, [
        U.el('div', {}, [
          U.el('div', { class: 'card__title rf-card__title' }, [U.el('span', { html: SSD.Icons.svg('team', { size: 17 }) }), 'Ihre Verstärkung']),
          U.el('div', { class: 'card__subtitle' }, [`${dayLabel(req.date)}, ${U.blockLabel(req.block)}${req.note ? ` · ${req.note}` : ''}`]),
        ]),
      ]),
      U.el('div', { class: 'card__body stack gap-3' }, [
        rows.length ? U.el('div', {}, rows) : null,
        !active.length ? U.el('p', { class: 'text-tertiary', style: 'margin:0;' }, ['Niemand mehr eingeteilt.']) : null,
        grace ? U.el('p', { class: 'text-tertiary', style: 'margin:0; font-size:var(--font-size-xs);' }, [`Teams-Meldung in etwa ${grace} Sekunden — Änderungen bis dahin fließen noch ein.`]) : null,
        U.el('div', { class: 'cluster gap-2' }, [addBtn, cancelBtn]),
      ]),
    ]);
  }

  /* ---------------------------------------------------------------------
   * Hinweis für Eingeteilte
   * ------------------------------------------------------------------- */

  function buildAssignmentNotice(student, onChange) {
    const unseen = R().unseenFor(student.id);
    if (!unseen.length) return null;
    const okBtn = U.el('button', { class: 'btn btn--primary btn--sm' }, ['Verstanden']);
    okBtn.addEventListener('click', () => {
      R().acknowledge(student.id);
      SSD.Toast.success('Danke!', 'Die Einsätze stehen unter „Meine Dienste“.');
      if (onChange) onChange();
    });
    const items = unseen.map(({ request }) => {
      const declineBtn = U.el('button', { class: 'btn btn--ghost btn--sm' }, ['Kann nicht']);
      declineBtn.addEventListener('click', async () => {
        const ok = await SSD.Dialog.confirm({
          title: 'Kann nicht kommen', confirmLabel: 'Absagen',
          message: `${request.requestedBy ? name(request.requestedBy) : 'Die anfordernde Person'} sieht das und kann jemand anderen einteilen.`,
        });
        if (!ok) return;
        try {
          R().decline(request.id, student.id);
          SSD.Toast.info('Abgesagt', 'Danke für die Rückmeldung.');
        } catch (err) {
          SSD.Toast.error('Nicht möglich', String(err.message || err));
        }
        if (onChange) onChange();
      });
      return U.el('li', { class: 'rf-notice__item' }, [
        U.el('span', {}, [
          U.el('strong', {}, [`${dayLabel(request.date)}, ${U.blockLabel(request.block)}`]),
          request.note ? ` — ${request.note}` : '',
          request.requestedBy ? ` (angefordert von ${name(request.requestedBy)})` : '',
        ]),
        declineBtn,
      ]);
    });
    return U.el('div', { class: 'notice-box notice-box--info', role: 'alert' }, [
      U.el('span', { html: SSD.Icons.svg('team', { size: 20 }) }),
      U.el('div', { class: 'stack gap-3', style: 'min-width:0; flex:1;' }, [
        U.el('div', {}, [
          U.el('strong', {}, [unseen.length === 1 ? 'Sie werden als Verstärkung gebraucht' : `Sie werden ${unseen.length}-mal als Verstärkung gebraucht`]),
          U.el('ul', { class: 'notice-list rf-notice' }, items),
          U.el('p', {}, ['Sie sind eingeteilt, weil Sie zu dieser Zeit als verfügbar eingetragen sind.']),
        ]),
        U.el('div', { class: 'cluster gap-2' }, [okBtn]),
      ]),
    ]);
  }

  return { openRequestDialog, buildRequestCard, buildAssignmentNotice, dayLabel };
})();
