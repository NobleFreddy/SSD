/**
 * ============================================================================
 * SSD.Shortcuts — globale Tastaturbedienung
 * ============================================================================
 * Registriert Tastenkombinationen zentral, statt sie über die Anwendung
 * verstreut an einzelnen Elementen zu binden. Kombinationen wie Strg+Z werden
 * automatisch unterdrückt, während der Fokus in einem Eingabefeld liegt,
 * damit das native Undo eines Textfeldes nicht überschrieben wird.
 */
window.SSD = window.SSD || {};

SSD.Shortcuts = (function () {
  'use strict';

  const bindings = []; // { combo, handler, allowInInputs }

  function parseCombo(combo) {
    const parts = combo.toLowerCase().split('+').map((p) => p.trim());
    return {
      ctrl: parts.includes('ctrl') || parts.includes('cmd'),
      shift: parts.includes('shift'),
      alt: parts.includes('alt'),
      key: parts.filter((p) => !['ctrl', 'cmd', 'shift', 'alt'].includes(p))[0],
    };
  }

  function isEditableTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function register(combo, handler, opts = {}) {
    bindings.push({ parsed: parseCombo(combo), handler, allowInInputs: !!opts.allowInInputs });
  }

  function handleKeydown(e) {
    const editable = isEditableTarget(e.target);
    const key = e.key.toLowerCase();
    for (const binding of bindings) {
      const p = binding.parsed;
      const ctrlOk = p.ctrl ? (e.ctrlKey || e.metaKey) : (!e.ctrlKey && !e.metaKey);
      if (ctrlOk && p.shift === e.shiftKey && p.alt === e.altKey && p.key === key) {
        if (editable && !binding.allowInInputs) continue;
        e.preventDefault();
        binding.handler(e);
      }
    }
  }

  function init() {
    document.addEventListener('keydown', handleKeydown);
  }

  return { register, init };
})();
