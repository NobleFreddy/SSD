/**
 * ============================================================================
 * SSD.Views.AdminLayout — gemeinsame App-Shell für alle Admin-Ansichten
 * ============================================================================
 * Erzeugt Sidebar + Topbar einmalig und liefert den Inhaltsbereich zurück,
 * in den die jeweilige Admin-View ihren Inhalt rendert. Vermeidet doppelten
 * Layout-Code in jeder einzelnen Admin-Unteransicht.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminLayout = (function () {
  'use strict';

  const U = SSD.Utils;
  const NAV_ITEMS = [
    { key: 'dashboard', path: '/admin/dashboard', label: 'Übersicht', icon: 'dashboard' },
    { key: 'students', path: '/admin/students', label: 'Schülerverwaltung', icon: 'students' },
    { key: 'calendar', path: '/admin/calendar', label: 'Kalender', icon: 'calendar' },
    { key: 'schedule', path: '/admin/schedule', label: 'Dienstplan', icon: 'schedule' },
    { key: 'events', path: '/admin/events', label: 'Veranstaltungen', icon: 'flag' },
    { key: 'tasks', path: '/admin/tasks', label: 'Aufgaben', icon: 'check' },
    { key: 'materials', path: '/admin/materials', label: 'Material', icon: 'box' },
    { key: 'statistics', path: '/admin/statistics', label: 'Statistik', icon: 'stats' },
    { key: 'settings', path: '/admin/settings', label: 'Einstellungen', icon: 'settings' },
  ];

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('ssd_theme_pref', theme); } catch (err) { /* ignore */ }
  }

  function getStoredTheme() {
    try { return localStorage.getItem('ssd_theme_pref') || 'light'; } catch (err) { return 'light'; }
  }

  function renderShell(container, activeKey) {
    const state = SSD.Store.getState();
    const shell = U.el('div', { class: 'app-shell' });

    const overlay = U.el('div', { class: 'mobile-overlay', onClick: () => shell.classList.remove('is-mobile-nav-open') });

    const nav = U.el('nav', { class: 'sidebar__nav' });
    NAV_ITEMS.forEach((item) => {
      const btn = U.el('button', {
        class: `nav-item${item.key === activeKey ? ' is-active' : ''}`,
        onClick: () => { SSD.Router.navigate(item.path); shell.classList.remove('is-mobile-nav-open'); },
        html: SSD.Icons.svg(item.icon),
      });
      btn.appendChild(document.createTextNode(item.label));
      nav.appendChild(btn);
    });

    const sidebar = U.el('aside', { class: 'sidebar' }, [
      U.el('div', { class: 'sidebar__brand' }, [
        U.el('div', { class: 'sidebar__brand-icon' }, [U.el('img', { src: 'assets/logo.png', alt: 'Vereinslogo' })]),
        U.el('div', { class: 'sidebar__brand-text' }, [
          U.el('div', { class: 'sidebar__brand-title' }, ['Schulsanitätsdienst']),
          U.el('div', { class: 'sidebar__brand-subtitle' }, [state.school.name || 'Verwaltung']),
        ]),
      ]),
      nav,
      U.el('div', { class: 'sidebar__footer' }, [
        U.el('div', { class: 'user-chip' }, [
          U.el('div', { class: 'avatar', style: `background:${U.colorFromString(state.admin?.username || 'admin')}` }, ['AD']),
          U.el('div', { class: 'user-chip__text' }, [
            U.el('div', { class: 'user-chip__name' }, [state.admin?.username || 'Administrator']),
            U.el('div', { class: 'user-chip__role' }, ['Administrator']),
          ]),
        ]),
        U.el('button', {
          class: 'nav-item', 'data-tooltip': 'Abmelden', html: SSD.Icons.svg('logout'),
          onClick: async () => {
            const ok = await SSD.Dialog.confirm({ title: 'Abmelden', message: 'Möchten Sie sich wirklich abmelden?', confirmLabel: 'Abmelden' });
            if (ok) SSD.Auth.logout();
          },
        }, ['Abmelden']),
      ]),
    ]);

    const topbar = U.el('header', { class: 'topbar' });
    const currentTheme = getStoredTheme();
    applyTheme(currentTheme);

    const themeToggle = U.el('button', {
      class: 'btn btn--icon btn--ghost', 'data-tooltip': 'Dark Mode umschalten',
      html: SSD.Icons.svg(currentTheme === 'dark' ? 'sun' : 'moon'),
      onClick: () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        themeToggle.innerHTML = SSD.Icons.svg(next === 'dark' ? 'sun' : 'moon');
      },
    });

    const undoBtn = U.el('button', { class: 'btn btn--icon btn--ghost', 'data-tooltip': 'Rückgängig (Strg+Z)', html: SSD.Icons.svg('undo'), onClick: () => SSD.Store.undo() });
    const redoBtn = U.el('button', { class: 'btn btn--icon btn--ghost', 'data-tooltip': 'Wiederholen (Strg+Y)', html: SSD.Icons.svg('redo'), onClick: () => SSD.Store.redo() });
    function refreshUndoRedo() {
      undoBtn.disabled = !SSD.Store.canUndo();
      redoBtn.disabled = !SSD.Store.canRedo();
      undoBtn.setAttribute('data-tooltip', SSD.Store.canUndo() ? `Rückgängig: ${SSD.Store.peekUndoLabel()}` : 'Nichts rückgängig zu machen');
      redoBtn.setAttribute('data-tooltip', SSD.Store.canRedo() ? `Wiederholen: ${SSD.Store.peekRedoLabel()}` : 'Nichts zu wiederholen');
      // Ein evtl. bereits sichtbarer Tooltip zeigt sonst den alten (jetzt falschen) Text weiter an,
      // da ein reines Attribut-Update kein erneutes "mouseover" auslöst.
      SSD.Tooltip.hide();
    }
    refreshUndoRedo();
    const unsubscribe = SSD.EventBus.on('store:changed', refreshUndoRedo);

    const mobileToggle = U.el('button', {
      class: 'btn btn--icon btn--ghost sidebar-toggle-btn', 'aria-label': 'Menü',
      html: SSD.Icons.svg('menu'),
      onClick: () => shell.classList.toggle('is-mobile-nav-open'),
    });

    const saveIndicatorHandle = buildSaveIndicator();

    topbar.appendChild(mobileToggle);
    topbar.appendChild(U.el('div', { class: 'topbar__title' }, [NAV_ITEMS.find((n) => n.key === activeKey)?.label || '']));
    topbar.appendChild(saveIndicatorHandle.el);
    topbar.appendChild(U.el('div', { class: 'divider--v' }));
    topbar.appendChild(undoBtn);
    topbar.appendChild(redoBtn);
    topbar.appendChild(themeToggle);

    const viewContainer = U.el('div', { class: 'view-container' });
    const inner = U.el('div', { class: 'view-container__inner' });
    viewContainer.appendChild(inner);

    const mainArea = U.el('div', { class: 'main-area' }, [topbar, viewContainer]);

    shell.appendChild(sidebar);
    shell.appendChild(overlay);
    shell.appendChild(mainArea);
    container.appendChild(shell);

    return {
      contentEl: inner,
      cleanup: () => { unsubscribe(); saveIndicatorHandle.cleanup(); },
    };
  }

  /**
   * Baut den Speicherstatus-Indikator im Topbar. Verhält sich reaktiv zur
   * Einstellung "Automatisches Speichern": Ist sie aktiv, wird nur der
   * letzte Speicherzeitpunkt angezeigt; ist sie deaktiviert, erscheint statt-
   * dessen ein manueller Speichern-Button samt "ungespeicherte Änderungen"-
   * Hinweis, damit bei ausgeschaltetem Auto-Save keine Daten verloren gehen.
   */
  function buildSaveIndicator() {
    const el = U.el('div', { class: 'save-indicator', style: 'display:flex; align-items:center; gap:6px;' });

    function render() {
      el.innerHTML = '';
      const autoSave = SSD.SettingsService.get().autoSave !== false;
      if (autoSave) {
        el.appendChild(U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs); display:flex; align-items:center; gap:6px;' }, [
          U.el('span', { html: SSD.Icons.svg('checkCircle', { size: 14 }), style: 'display:flex;color:var(--color-success-500)' }),
          U.el('span', { class: 'save-indicator__label' }, ['Automatisch gespeichert']),
        ]));
      } else if (SSD.Store.isDirty()) {
        const btn = U.el('button', {
          class: 'btn btn--sm btn--primary', html: SSD.Icons.svg('save', { size: 14 }),
          'data-tooltip': 'Änderungen jetzt dauerhaft speichern',
        }, ['Speichern']);
        btn.addEventListener('click', async () => {
          // Bei Fehlschlag/Konflikt übernimmt der zentrale Hinweis in app.js
          // (SSD.Toast auf 'storage:error'/'store:conflict') die Meldung.
          btn.disabled = true;
          const ok = await SSD.Store.forceSave();
          if (ok) SSD.Toast.success('Gespeichert', 'Alle Änderungen wurden gespeichert.');
          btn.disabled = false;
        });
        el.appendChild(btn);
      } else {
        el.appendChild(U.el('div', { class: 'text-tertiary', style: 'font-size:var(--font-size-xs); display:flex; align-items:center; gap:6px;' }, [
          U.el('span', { html: SSD.Icons.svg('lock', { size: 13 }) }),
          U.el('span', { class: 'save-indicator__label' }, ['Auto-Save deaktiviert']),
        ]));
      }
    }
    render();
    const offChanged = SSD.EventBus.on('store:changed', render);
    const offDirty = SSD.EventBus.on('store:dirty', render);
    return { el, cleanup: () => { offChanged(); offDirty(); } };
  }

  return { renderShell, NAV_ITEMS, buildSaveIndicator };
})();
