/**
 * ============================================================================
 * SSD.App — Bootstrap
 * ============================================================================
 * Initialisiert Zustand, globale UI-Dienste (Tooltips, Tastenkürzel) und
 * registriert alle Routen. Wird als letztes Skript geladen, nachdem alle
 * anderen SSD.*-Module definiert wurden.
 *
 * Vor der Anmeldung lädt die App nur öffentliche Angaben (Schulname,
 * Registrierung, Datenschutzhinweise). Die eigentlichen Daten kommen erst mit
 * einer gültigen Sitzung (siehe `js/core/storage.js`). Im Fehlerfall (z. B.
 * keine Internetverbindung) erscheint ein Hinweis mit Wiederholen-Möglichkeit.
 */
(function () {
  'use strict';

  function registerRoutes() {
    SSD.Router.register('/setup', SSD.Views.Setup, 'public-only');
    SSD.Router.register('/login', SSD.Views.Login, 'public-only');
    SSD.Router.register('/datenschutz', SSD.Views.Privacy, 'public');
    SSD.Router.register('/student', SSD.Views.StudentDashboard, ['student', 'azubi']);
    SSD.Router.register('/admin/dashboard', SSD.Views.AdminDashboard, ['admin']);
    SSD.Router.register('/admin/students', SSD.Views.AdminStudents, ['admin']);
    SSD.Router.register('/admin/team', SSD.Views.AdminTeam, ['admin']);
    SSD.Router.register('/admin/team/:tab', SSD.Views.AdminTeam, ['admin']);
    SSD.Router.register('/admin/calendar', SSD.Views.AdminCalendar, ['admin']);
    SSD.Router.register('/admin/schedule', SSD.Views.AdminSchedule, ['admin']);
    SSD.Router.register('/admin/distribution', SSD.Views.AdminDistribution, ['admin']);
    SSD.Router.register('/admin/events', SSD.Views.AdminEvents, ['admin']);
    SSD.Router.register('/admin/tasks', SSD.Views.AdminTasks, ['admin']);
    SSD.Router.register('/admin/materials', SSD.Views.AdminMaterials, ['admin']);
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

  /** Zentrale Rückmeldung für alle Speichervorgänge (auch die "fire-and-forget"-Saves aus SSD.Store.commit). */
  function handleStorageEvents() {
    SSD.EventBus.on('storage:error', () => {
      SSD.Toast.error('Speichern fehlgeschlagen', 'Keine Verbindung zur Datenbank möglich. Bitte Internetverbindung prüfen — diese Änderung ist derzeit nicht gesichert.');
    });
    SSD.EventBus.on('store:conflict', () => {
      SSD.Toast.warning('Zwischenzeitlich geändert', 'Jemand anderes hat gerade gespeichert. Bitte die Seite neu laden, um die aktuellen Daten zu sehen, und die eigene Änderung erneut vornehmen.');
    });
    SSD.EventBus.on('store:remote-update-deferred', () => {
      SSD.Toast.info('Neue Daten verfügbar', 'Es gibt Änderungen von einem anderen Gerät. Bitte zuerst speichern, dann die Seite neu laden.');
    });
    let expiredShown = false;
    SSD.EventBus.on('auth:expired', () => {
      if (expiredShown || !SSD.Auth.getSession()) return;
      expiredShown = true;
      SSD.Toast.warning('Bitte neu anmelden', 'Die Sitzung ist abgelaufen oder das Konto wurde geändert. Nicht gespeicherte Änderungen gingen dabei verloren.');
      SSD.Auth.logout();
      setTimeout(() => { expiredShown = false; }, 3000);
    });
    // Nach der Anmeldung: vom Administrator vergebenes Startpasswort ändern bzw. zu kurzes Passwort ersetzen.
    SSD.EventBus.on('router:navigated', () => {
      const session = SSD.Auth.getSession();
      if (session && (session.mustChangePassword || session.weakPassword)) SSD.PasswordDialog.promptIfNeeded();
    });
  }

  function renderLoadingScreen(root) {
    root.innerHTML = '';
    root.appendChild(SSD.Utils.el('div', { class: 'centered-screen' }, [
      SSD.Utils.el('div', { style: 'display:flex; flex-direction:column; align-items:center; gap:16px;' }, [
        SSD.Utils.el('div', { class: 'spinner spinner--lg' }),
        SSD.Utils.el('div', { style: 'color:var(--text-secondary); font-weight:600;' }, ['Verbindung wird hergestellt …']),
      ]),
    ]));
  }

  function renderErrorScreen(root, message) {
    root.innerHTML = '';
    const retryBtn = SSD.Utils.el('button', { class: 'btn btn--primary btn--block btn--lg', style: 'margin-top:20px;' }, ['Erneut versuchen']);
    retryBtn.addEventListener('click', () => window.location.reload());
    root.appendChild(SSD.Utils.el('div', { class: 'centered-screen' }, [
      SSD.Utils.el('div', { class: 'card auth-card' }, [
        SSD.Utils.el('h1', { style: 'text-align:center;' }, ['Verbindung fehlgeschlagen']),
        SSD.Utils.el('p', { class: 'auth-card__subtitle' }, [message]),
        retryBtn,
      ]),
    ]));
  }

  async function init() {
    const root = document.getElementById('app-root');
    renderLoadingScreen(root);

    try {
      SSD.Store.setPublicInfo(await SSD.Storage.fetchPublicInfo());
      if (SSD.Auth.getSession()) {
        // Noch angemeldet (z. B. Seite neu geladen): Daten mit der bestehenden Sitzung laden.
        try {
          await SSD.Store.load();
        } catch (err) {
          if (!err.sessionExpired) throw err;
          SSD.Auth.clearSession();
        }
      } else {
        SSD.Auth.clearSession(); // Sitzung aus einer früheren Version (ohne Token)
      }
    } catch (err) {
      console.error('[App] Initialisierung fehlgeschlagen:', err);
      renderErrorScreen(root, `Die Daten konnten nicht geladen werden (${err.message || err}). Bitte Internetverbindung prüfen.`);
      return;
    }

    SSD.Tooltip.init();
    SSD.Shortcuts.init();
    registerGlobalShortcuts();
    handleStorageEvents();
    registerRoutes();
    SSD.Router.start(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
