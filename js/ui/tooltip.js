/**
 * ============================================================================
 * SSD.Tooltip — dezente Hover-Tooltips über [data-tooltip]
 * ============================================================================
 * Statt an jedem Element einen eigenen Listener zu registrieren, wird ein
 * einziger delegierter Listener am `document` verwendet (Event Delegation).
 * Jedes Element mit `data-tooltip="Text"` erhält so automatisch einen Tooltip.
 */
window.SSD = window.SSD || {};

SSD.Tooltip = (function () {
  'use strict';

  let bubble = null;
  let currentTarget = null;

  function ensureBubble() {
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.className = 'tooltip-bubble';
      document.body.appendChild(bubble);
    }
    return bubble;
  }

  function position(target) {
    const rect = target.getBoundingClientRect();
    const b = ensureBubble();
    b.style.left = '0px';
    b.style.top = '0px';
    const bubbleRect = b.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - bubbleRect.width / 2;
    left = SSD.Utils.clamp(left, 8, window.innerWidth - bubbleRect.width - 8);
    let top = rect.top - bubbleRect.height - 8;
    if (top < 4) top = rect.bottom + 8;
    b.style.left = `${left}px`;
    b.style.top = `${top}px`;
  }

  function init() {
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest && e.target.closest('[data-tooltip]');
      if (!target || target === currentTarget) return;
      currentTarget = target;
      const text = target.getAttribute('data-tooltip');
      if (!text) return;
      const b = ensureBubble();
      b.textContent = text;
      b.classList.add('is-visible');
      requestAnimationFrame(() => position(target));
    });

    document.addEventListener('mouseout', (e) => {
      const target = e.target.closest && e.target.closest('[data-tooltip]');
      if (target && target === currentTarget) {
        currentTarget = null;
        if (bubble) bubble.classList.remove('is-visible');
      }
    });

    document.addEventListener('scroll', () => { if (bubble) bubble.classList.remove('is-visible'); currentTarget = null; }, true);
  }

  /** Blendet einen evtl. sichtbaren Tooltip sofort aus (z. B. bei Seitenwechsel/Re-Render). */
  function hide() {
    currentTarget = null;
    if (bubble) bubble.classList.remove('is-visible');
  }

  return { init, hide };
})();
