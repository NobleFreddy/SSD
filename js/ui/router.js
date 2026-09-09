/**
 * ============================================================================
 * SSD.Router — schlanker Hash-Router
 * ============================================================================
 * Verwaltet den Wechsel zwischen den "Seiten" der Anwendung über den
 * URL-Hash (z. B. #/admin/students). Ein eigenes Framework (React/Vue) würde
 * einen Build-Schritt erfordern — der Hash-Router funktioniert ohne jeden
 * Build-Prozess direkt im Browser, auch unter file://.
 */
window.SSD = window.SSD || {};

SSD.Router = (function () {
  'use strict';

  const routes = []; // { pattern: RegExp, keys: string[], view, roles }
  let rootEl = null;
  let currentView = null;
  let currentPath = null;

  function register(path, view, roles) {
    const keys = [];
    const patternStr = path.replace(/:[^/]+/g, (match) => {
      keys.push(match.slice(1));
      return '([^/]+)';
    });
    routes.push({ pattern: new RegExp(`^${patternStr}$`), keys, view, roles: roles || null });
  }

  function matchRoute(path) {
    for (const route of routes) {
      const match = path.match(route.pattern);
      if (match) {
        const params = {};
        route.keys.forEach((key, i) => { params[key] = decodeURIComponent(match[i + 1]); });
        return { route, params };
      }
    }
    return null;
  }

  function currentHashPath() {
    const hash = window.location.hash || '#/';
    return hash.slice(1) || '/';
  }

  function navigate(path) {
    if (window.location.hash.slice(1) === path) {
      render();
    } else {
      window.location.hash = path;
    }
  }

  function resolveRedirectForRole(session) {
    if (!SSD.Store.isSetupComplete()) return '/setup';
    if (!session) return '/login';
    if (session.role === 'admin') return '/admin/dashboard';
    return '/student';
  }

  function render() {
    const path = currentHashPath();
    const session = SSD.Auth.getSession();
    const matched = matchRoute(path);

    if (!matched) {
      navigate(resolveRedirectForRole(session));
      return;
    }

    const { route, params } = matched;
    const setupComplete = SSD.Store.isSetupComplete();

    // 1. Die Ersteinrichtung muss immer zuerst abgeschlossen werden.
    if (!setupComplete && path !== '/setup') { navigate('/setup'); return; }
    if (setupComplete && path === '/setup') { navigate(resolveRedirectForRole(session)); return; }

    // 2. Öffentliche Seiten (Login) ergeben nur ohne aktive Sitzung Sinn.
    if (route.roles === 'public-only') {
      if (session) { navigate(resolveRedirectForRole(session)); return; }
    } else if (route.roles) {
      // 3. Geschützte Seiten erfordern eine passende Rolle.
      if (!session || !route.roles.includes(session.role)) {
        navigate(resolveRedirectForRole(session));
        return;
      }
    }

    if (currentView && typeof currentView.destroy === 'function') {
      try { currentView.destroy(); } catch (err) { console.error(err); }
    }
    SSD.Tooltip.hide();

    rootEl.innerHTML = '';
    currentPath = path;
    currentView = route.view;
    route.view.render(rootEl, params);
    SSD.EventBus.emit('router:navigated', { path, params });
    rootEl.scrollTop = 0;
  }

  function start(container) {
    rootEl = container;
    window.addEventListener('hashchange', render);
    SSD.EventBus.on('auth:changed', () => navigate(resolveRedirectForRole(SSD.Auth.getSession())));
    render();
  }

  function getCurrentPath() { return currentPath; }

  return { register, navigate, start, getCurrentPath };
})();
