/**
 * ============================================================================
 * SSD.Toast — nicht-blockierende Benachrichtigungen
 * ============================================================================
 */
window.SSD = window.SSD || {};

SSD.Toast = (function () {
  'use strict';

  const U = SSD.Utils;
  const ICONS = { success: 'checkCircle', error: 'xCircle', warning: 'warning', info: 'info' };
  let region = null;

  function ensureRegion() {
    if (region && document.body.contains(region)) return region;
    region = U.el('div', { class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(region);
    return region;
  }

  function show({ type = 'info', title, message, duration = 4200 }) {
    const container = ensureRegion();
    const toast = U.el('div', { class: `toast toast--${type}` }, [
      U.el('div', { class: 'toast__icon', html: SSD.Icons.svg(ICONS[type] || 'info', { size: 13, strokeWidth: 2.2 }) }),
      U.el('div', { class: 'toast__body' }, [
        title ? U.el('div', { class: 'toast__title' }, [title]) : null,
        message ? U.el('div', { class: 'toast__message' }, [message]) : null,
      ]),
      U.el('button', {
        class: 'toast__close', 'aria-label': 'Schließen', html: SSD.Icons.svg('x', { size: 15 }),
        onClick: () => dismiss(toast),
      }),
    ]);
    container.appendChild(toast);

    const timer = setTimeout(() => dismiss(toast), duration);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    return toast;
  }

  function dismiss(toast) {
    if (!toast || toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400);
  }

  return {
    show,
    success: (title, message, opts) => show({ type: 'success', title, message, ...opts }),
    error: (title, message, opts) => show({ type: 'error', title, message, ...opts }),
    warning: (title, message, opts) => show({ type: 'warning', title, message, ...opts }),
    info: (title, message, opts) => show({ type: 'info', title, message, ...opts }),
  };
})();
