/**
 * ============================================================================
 * SSD.Views.AdminTeam — Team-Koordination für den Administrator
 * ============================================================================
 * Bündelt Pinnwand, Teamtreffen, Freischaltungen/"Wer fehlt noch?" und die
 * Engagement-Übersicht. Die Sanisprecher:innen arbeiten in ihrer
 * Team-Verwaltung mit denselben Komponenten (js/ui/announcementBoard.js,
 * meetingsPanel.js, teamMembersPanel.js, engagementPanel.js).
 *
 * Route: #/admin/team bzw. #/admin/team/<reiter> (board | meetings | members | engagement).
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.AdminTeam = (function () {
  'use strict';

  const U = SSD.Utils;
  const TABS = [
    { key: 'board', label: 'Pinnwand' },
    { key: 'meetings', label: 'Teamtreffen' },
    { key: 'members', label: 'Mitglieder' },
    { key: 'engagement', label: 'Engagement' },
  ];
  let layoutHandle = null;
  let unsubscribe = null;
  let activeTab = 'board';

  function tabBadge(key) {
    if (key === 'members') return SSD.StudentService.getPendingApprovalCount();
    if (key === 'meetings') return SSD.MeetingsService.getPast().filter((m) => !m.attendanceTaken).length;
    return 0;
  }

  function buildTabs() {
    return U.el('div', { class: 'tabs', role: 'tablist' }, TABS.map((tab) => {
      const badge = tabBadge(tab.key);
      const btn = U.el('button', { class: `tab${tab.key === activeTab ? ' is-active' : ''}`, role: 'tab', 'aria-selected': tab.key === activeTab ? 'true' : 'false' }, [
        tab.label,
        badge ? U.el('span', { class: 'badge badge--warning', style: 'margin-left:6px;' }, [String(badge)]) : null,
      ]);
      btn.addEventListener('click', () => SSD.Router.navigate(`/admin/team/${tab.key}`));
      return btn;
    }));
  }

  function buildTabBody() {
    if (activeTab === 'meetings') return SSD.MeetingsPanel.render({ viewer: null });
    if (activeTab === 'members') return SSD.TeamMembersPanel.render({});
    if (activeTab === 'engagement') return SSD.EngagementPanel.render({});
    return SSD.AnnouncementBoard.render({ showAll: true });
  }

  function renderContent() {
    const content = layoutHandle.contentEl;
    content.innerHTML = '';
    content.appendChild(U.el('div', { class: 'page-header' }, [
      U.el('div', { class: 'page-header__text' }, [
        U.el('h1', {}, ['Team']),
        U.el('p', {}, ['Pinnwand, Teamtreffen, Freischaltungen, fehlende Verfügbarkeiten und Engagement. Die Sanisprecher:innen haben dieselben Werkzeuge in ihrer Team-Verwaltung.']),
      ]),
    ]));
    content.appendChild(buildTabs());
    content.appendChild(U.el('div', { style: 'margin-top:20px;' }, [buildTabBody()]));
  }

  function render(container, params) {
    activeTab = TABS.some((t) => t.key === (params && params.tab)) ? params.tab : 'board';
    layoutHandle = SSD.Views.AdminLayout.renderShell(container, 'team');
    renderContent();
    unsubscribe = SSD.EventBus.on('store:changed', renderContent);
  }

  function destroy() {
    if (unsubscribe) unsubscribe();
    if (layoutHandle) layoutHandle.cleanup();
  }

  return { render, destroy };
})();
