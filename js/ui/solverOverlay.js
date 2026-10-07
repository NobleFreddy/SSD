/**
 * ============================================================================
 * SSD.SolverOverlay — Ladeanimation für längere Berechnungen
 * ============================================================================
 * Vollflächiges Overlay mit Fortschrittsbalken und kurzem Protokoll, das die
 * Fortschrittsmeldungen des Schedulers (`onProgress`) anzeigt. Genutzt beim
 * Erstellen des Dienstplans und beim Auffüllen von Lücken (Administrator und
 * Team-Verwaltung der Sanisprecher:innen).
 */
window.SSD = window.SSD || {};

SSD.SolverOverlay = (function () {
  'use strict';

  const U = SSD.Utils;

  /** Hängt das Overlay an `document.body` an und liefert `{ update(info), close() }`. */
  function open(opts) {
    const title = (opts && opts.title) || 'Dienstplan wird erstellt';
    const icon = (opts && opts.icon) || 'wand';
    const logEl = U.el('div', { class: 'solver-card__log' });
    const progressFill = U.el('div', { class: 'progress-bar__fill', style: 'width:4%' });
    const messageEl = U.el('p', {}, ['Initialisiere …']);
    const el = U.el('div', { class: 'solver-overlay' }, [
      U.el('div', { class: 'solver-card' }, [
        U.el('div', { class: 'solver-card__orbit' }, [
          U.el('div', { class: 'spinner spinner--lg' }),
          U.el('span', { html: SSD.Icons.svg(icon, { size: 30 }) }),
        ]),
        U.el('h3', {}, [title]),
        messageEl,
        U.el('div', { class: 'solver-card__progress' }, [U.el('div', { class: 'progress-bar' }, [progressFill])]),
        logEl,
      ]),
    ]);
    document.body.appendChild(el);

    function update(info) {
      progressFill.style.width = `${info.percent}%`;
      messageEl.textContent = info.message;
      logEl.appendChild(U.el('div', {}, [`${info.percent}% — ${info.message}`]));
      logEl.scrollTop = logEl.scrollHeight;
      while (logEl.children.length > 6) logEl.removeChild(logEl.firstChild);
    }
    return { el, update, close: () => el.remove() };
  }

  return { open };
})();
