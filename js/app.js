/**
 * ============================================================================
 * SSD.App — Bootstrap
 * ============================================================================
 * Initialisiert Zustand, globale UI-Dienste (Tooltips, Tastenkürzel) und
 * registriert alle Routen. Wird als letztes Skript geladen, nachdem alle
 * anderen SSD.*-Module definiert wurden.
 */
(function () {
  'use strict';

  function registerRoutes() {
    SSD.Router.register('/setup', SSD.Views.Setup, 'public-only');
    SSD.Router.register('/login', SSD.Views.Login, 'public-only');
    SSD.Router.register('/student', SSD.Views.StudentDashboard, ['student', 'azubi']);
    SSD.Router.register('/admin/dashboard', SSD.Views.AdminDashboard, ['admin']);
    SSD.Router.register('/admin/students', SSD.Views.AdminStudents, ['admin']);
    SSD.Router.register('/admin/calendar', SSD.Views.AdminCalendar, ['admin']);
    SSD.Router.register('/admin/schedule', SSD.Views.AdminSchedule, ['admin']);
    SSD.Router.register('/admin/events', SSD.Views.AdminEvents, ['admin']);
    SSD.Router.register('/admin/statistics', SSD.Views.AdminStatistics, ['admin']);
    SSD.Router.register('/admin/settings', SSD.Views.AdminSettings, ['admin']);
  }

  function registerGlobalShortcuts() {
    SSD.Shortcuts.register('ctrl+z', () => {
      if (!SSD.Store.canUndo()) return;
      SSD.Store.undo();
      SSD.Toast.info('Rückgängig gemacht', SSD.Store.peekRedoLabel() || '');
    });
    SSD.Shortcuts.register('ctrl+y', () => {
      if (!SSD.Store.canRedo()) return;
      SSD.Store.redo();
      SSD.Toast.info('Wiederholt', SSD.Store.peekUndoLabel() || '');
    });
    SSD.Shortcuts.register('ctrl+shift+z', () => {
      if (!SSD.Store.canRedo()) return;
      SSD.Store.redo();
    });
  }

  function handleStorageErrors() {
    SSD.EventBus.on('storage:error', () => {
      SSD.Toast.error('Speichern fehlgeschlagen', 'Der lokale Speicher des Browsers ist evtl. voll. Bitte exportieren Sie ein Backup und leeren Sie ggf. Speicherplatz.');
    });
  }

  function init() {
    SSD.Store.init();
    SSD.Tooltip.init();
    SSD.Shortcuts.init();
    registerGlobalShortcuts();
    handleStorageErrors();
    registerRoutes();

    const root = document.getElementById('app-root');
    SSD.Router.start(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
