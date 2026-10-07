/**
 * ============================================================================
 * SSD.Dialog — modale Dialoge (generisch) & Bestätigungsabfragen
 * ============================================================================
 * Stellt einen einzigen generischen Modal-Container bereit, den alle Views
 * für Formulare, Detailansichten und Bestätigungsdialoge wiederverwenden.
 * Das vermeidet doppelten Modal-Boilerplate in jeder einzelnen View.
 */
window.SSD = window.SSD || {};

SSD.Dialog = (function () {
  'use strict';

  const U = SSD.Utils;
  let activeOverlay = null;
  let activeKeyHandler = null;

  /**
   * Öffnet ein Modal.
   * @param {{
   *   title: string, body: HTMLElement|string, wide?: boolean, narrow?: boolean,
   *   footerButtons?: Array<{label:string, variant?:string, onClick?:Function, closeOnClick?:boolean, autofocus?:boolean}>,
   *   onClose?: Function, closeOnOverlayClick?: boolean
   * }} opts
   * @returns {{close: Function, el: HTMLElement}}
   */
  function open(opts) {
    close(); // stets nur ein Modal gleichzeitig

    const overlay = U.el('div', { class: 'modal-overlay' });
    const modalClass = 'modal' + (opts.wide ? ' modal--wide' : '') + (opts.narrow ? ' modal--narrow' : '');
    const modal = U.el('div', { class: modalClass, role: 'dialog', 'aria-modal': 'true' });

    const header = U.el('div', { class: 'modal__header' }, [
      U.el('h2', { class: 'modal__title' }, [opts.title || '']),
      U.el('button', { class: 'modal__close', 'aria-label': 'Schließen', html: SSD.Icons.svg('x', { size: 18 }), onClick: () => close() }),
    ]);

    const body = U.el('div', { class: 'modal__body' });
    if (typeof opts.body === 'string') body.innerHTML = opts.body;
    else if (opts.body instanceof HTMLElement) body.appendChild(opts.body);

    modal.appendChild(header);
    modal.appendChild(body);

    if (opts.footerButtons && opts.footerButtons.length) {
      const footer = U.el('div', { class: 'modal__footer' });
      opts.footerButtons.forEach((btnDef) => {
        const btn = U.el('button', {
          class: `btn btn--${btnDef.variant || 'secondary'}`,
          html: btnDef.icon ? SSD.Icons.svg(btnDef.icon, { size: 15 }) : undefined,
          onClick: () => {
            if (btnDef.onClick) btnDef.onClick();
            if (btnDef.closeOnClick !== false) close();
          },
        }, [btnDef.label]);
        footer.appendChild(btn);
        if (btnDef.autofocus) setTimeout(() => btn.focus(), 30);
      });
      modal.appendChild(footer);
    }

    overlay.appendChild(modal);
    if (opts.closeOnOverlayClick !== false) {
      overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    }

    document.body.appendChild(overlay);
    activeOverlay = { el: overlay, onClose: opts.onClose };

    activeKeyHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', activeKeyHandler);

    const firstInput = body.querySelector('input, select, textarea, button');
    if (firstInput && !opts.footerButtons?.some((b) => b.autofocus)) setTimeout(() => firstInput.focus(), 30);

    return { close, el: overlay };
  }

  function close() {
    if (!activeOverlay) return;
    const { el, onClose } = activeOverlay;
    el.style.animation = 'fade-out 140ms ease both';
    setTimeout(() => el.remove(), 130);
    if (activeKeyHandler) document.removeEventListener('keydown', activeKeyHandler);
    activeKeyHandler = null;
    activeOverlay = null;
    if (onClose) onClose();
  }

  /**
   * Bestätigungsdialog als Promise<boolean>.
   * @param {{title:string, message:string, confirmLabel?:string, cancelLabel?:string, danger?:boolean}} opts
   */
  function confirm(opts) {
    return new Promise((resolve) => {
      let resolved = false;
      const resolveOnce = (val) => { if (!resolved) { resolved = true; resolve(val); } };

      // Eine Rückfrage legt sich über einen bereits offenen Dialog, statt ihn zu schließen:
      // "Abbrechen" führt so zurück zum Formular samt Eingaben. Nach "Ja" ist wieder der
      // ursprüngliche Dialog aktiv — der Aufrufer schließt ihn wie gewohnt mit handle.close().
      const parent = activeOverlay;
      const parentKeyHandler = activeKeyHandler;
      if (parent) {
        if (parentKeyHandler) document.removeEventListener('keydown', parentKeyHandler);
        activeOverlay = null;
        activeKeyHandler = null;
      }
      const restoreParent = () => {
        if (!parent || !parent.el.isConnected) return;
        activeOverlay = parent;
        if (parentKeyHandler) {
          activeKeyHandler = parentKeyHandler;
          document.addEventListener('keydown', parentKeyHandler);
        }
      };

      const body = U.el('div', {}, [
        U.el('div', {
          class: 'modal__icon-badge',
          style: `background:${opts.danger ? 'var(--color-danger-50)' : 'var(--color-primary-soft)'}; color:${opts.danger ? 'var(--color-danger-500)' : 'var(--color-primary)'}`,
          html: SSD.Icons.svg(opts.danger ? 'warning' : 'info', { size: 22 }),
        }),
        U.el('p', { style: 'color:var(--text-primary); font-size:var(--font-size-base); margin:0;' }, [opts.message || '']),
      ]);

      open({
        title: opts.title || 'Bitte bestätigen',
        body,
        narrow: true,
        closeOnOverlayClick: false,
        onClose: () => { resolveOnce(false); restoreParent(); },
        footerButtons: [
          { label: opts.cancelLabel || 'Abbrechen', variant: 'secondary', onClick: () => resolveOnce(false) },
          { label: opts.confirmLabel || 'Bestätigen', variant: opts.danger ? 'danger' : 'primary', autofocus: true, onClick: () => resolveOnce(true) },
        ],
      });
    });
  }

  return { open, close, confirm };
})();
