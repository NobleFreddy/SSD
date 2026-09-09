/**
 * ============================================================================
 * SSD.Menu — kleines Kontextmenü/Dropdown (z. B. Export-Optionen)
 * ============================================================================
 */
window.SSD = window.SSD || {};

SSD.Menu = (function () {
  'use strict';

  const U = SSD.Utils;
  let activeMenu = null;
  let activeCleanup = null;

  /**
   * Öffnet ein Dropdown-Menü unterhalb eines Auslöser-Elements.
   * @param {HTMLElement} anchorEl
   * @param {Array<{label:string, icon?:string, onClick:Function, danger?:boolean}>} items
   */
  function open(anchorEl, items) {
    close();
    const rect = anchorEl.getBoundingClientRect();
    const menu = U.el('div', { class: 'menu' });
    items.forEach((item) => {
      const btn = U.el('button', {
        class: `menu__item${item.danger ? ' menu__item--danger' : ''}`,
        html: item.icon ? SSD.Icons.svg(item.icon, { size: 16 }) : '',
      }, [item.label]);
      btn.addEventListener('click', () => { close(); item.onClick(); });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    const menuRect = menu.getBoundingClientRect();
    let left = rect.right - menuRect.width;
    left = U.clamp(left, 8, window.innerWidth - menuRect.width - 8);
    let top = rect.bottom + 6;
    if (top + menuRect.height > window.innerHeight - 8) top = rect.top - menuRect.height - 6;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    activeMenu = menu;
    const onDocClick = (e) => { if (!menu.contains(e.target) && e.target !== anchorEl) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    activeCleanup = () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }

  function close() {
    if (activeMenu) { activeMenu.remove(); activeMenu = null; }
    if (activeCleanup) { activeCleanup(); activeCleanup = null; }
  }

  return { open, close };
})();
