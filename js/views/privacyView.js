/**
 * ============================================================================
 * SSD.Views.Privacy — Datenschutzhinweise (Art. 13 DSGVO)
 * ============================================================================
 * Ohne Anmeldung erreichbar (#/datenschutz) und auf der Anmeldeseite sowie in
 * den Dashboards verlinkt. Die schulspezifischen Angaben (verantwortliche
 * Stelle, Datenschutzbeauftragte:r, Rechtsgrundlage …) trägt der
 * Administrator unter Einstellungen → Datenschutzhinweise ein; sie kommen
 * über `ssd_public_info` und enthalten keine personenbezogenen Daten von Sanis.
 */
window.SSD = window.SSD || {};
SSD.Views = SSD.Views || {};

SSD.Views.Privacy = (function () {
  'use strict';

  const U = SSD.Utils;
  const LAST_CHANGED = '09.10.2026';
  const MISSING = '[noch nicht angegeben — bitte bei der Schule erfragen]';

  function section(title, children) {
    return U.el('section', { class: 'legal-page__section' }, [U.el('h2', {}, [title]), ...children]);
  }

  function p(text) { return U.el('p', {}, Array.isArray(text) ? text : [text]); }

  function list(items) {
    return U.el('ul', {}, items.map((item) => U.el('li', {}, Array.isArray(item) ? item : [item])));
  }

  function multiline(text) {
    return U.el('p', { style: 'white-space:pre-line;' }, [text]);
  }

  function legalBasisText(privacy) {
    if (privacy.legalBasis === 'consent') {
      return 'Die Teilnahme am Schulsanitätsdienst ist freiwillig. Die Verarbeitung beruht auf Ihrer Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), bei Minderjährigen gegebenenfalls der Einwilligung der Erziehungsberechtigten. Sie können die Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen; Ihr Konto wird dann gelöscht.';
    }
    if (privacy.legalBasis === 'custom' && String(privacy.legalBasisText || '').trim()) return privacy.legalBasisText.trim();
    return 'Der Schulsanitätsdienst ist eine schulische Veranstaltung. Die Verarbeitung ist zur Organisation dieser schulischen Aufgabe erforderlich (Art. 6 Abs. 1 lit. e DSGVO in Verbindung mit dem Schulgesetz und den Datenschutzvorschriften des Landes).';
  }

  /** Angemeldet: aktueller Stand (z. B. direkt nach dem Bearbeiten), sonst die öffentlichen Angaben vom Server. */
  function currentInfo() {
    const state = SSD.Store.getState();
    if (!state) return SSD.Store.getPublicInfo();
    const s = state.settings || {};
    return { schoolName: state.school && state.school.name, privacy: s.privacy, retention: s.retention, teamsEnabled: !!(s.teams && s.teams.enabled) };
  }

  function render(container) {
    const info = currentInfo();
    const privacy = Object.assign(SSD.Models.createDefaultPrivacySettings(), info.privacy || {});
    const retention = Object.assign(SSD.Models.createDefaultRetentionSettings(), info.retention || {});
    const grace = U.clamp(Math.round(Number(retention.graceMonths)), 0, 12) || 0;
    const session = SSD.Auth.getSession();
    const isAdmin = !!(session && session.role === 'admin');
    const missing = ['controller', 'dpo'].filter((k) => !String(privacy[k] || '').trim());

    const backBtn = U.el('button', { class: 'btn btn--secondary btn--sm', html: SSD.Icons.svg('chevronLeft', { size: 15 }) }, [session ? 'Zurück zur App' : 'Zur Anmeldung']);
    backBtn.addEventListener('click', () => SSD.Router.navigate(session ? (isAdmin ? '/admin/dashboard' : '/student') : '/login'));

    const page = U.el('article', { class: 'legal-page card' }, [
      U.el('div', { class: 'legal-page__head' }, [
        backBtn,
        U.el('h1', {}, ['Datenschutzhinweise']),
        U.el('p', { class: 'text-secondary' }, [`Dienstplan des Schulsanitätsdienstes${info.schoolName ? ` — ${info.schoolName}` : ''}. Stand: ${LAST_CHANGED}`]),
      ]),
      isAdmin && missing.length ? U.el('div', { class: 'notice-box' }, [
        U.el('span', { html: SSD.Icons.svg('warning', { size: 18 }) }),
        U.el('div', {}, [U.el('p', { style: 'margin:0;' }, ['Entwurf: Verantwortliche Stelle und Datenschutzbeauftragte:r fehlen noch. Bitte unter Einstellungen → Datenschutzhinweise ergänzen.'])]),
      ]) : null,

      section('1. Verantwortlich', [
        multiline(privacy.controller || MISSING),
        privacy.contact ? p(`Ansprechperson für den Schulsanitätsdienst: ${privacy.contact}`) : null,
        p(`Datenschutzbeauftragte:r: ${privacy.dpo || MISSING}`),
      ]),

      section('2. Wofür wir Daten verarbeiten', [
        p('Die App organisiert den Schulsanitätsdienst: Dienstplan und Vertretungen, Teamtreffen, Veranstaltungen, Aufgaben und Materialanfragen. Außerdem zählt sie, wie oft sich jemand engagiert hat (Dienste, Einspringen, Teamtreffen), damit die Schule das zum Beispiel für Zeugnisbemerkungen oder Bescheinigungen nutzen kann.'),
      ]),

      section('3. Rechtsgrundlage', [p(legalBasisText(privacy))]),

      section('4. Welche Daten', [
        list([
          'Name, Benutzername, Klasse, Abiturjahrgang, Kategorie (Sani/Azubi) und gegebenenfalls Funktion (Sanisprecher:in)',
          'Geschlecht — freiwillig, nur für die Bildung gemischter Teams',
          'Verfügbarkeiten (freie Stunden), Wunschpartner:innen, Dienste und bisheriger Dienstverlauf',
          'Abmeldungen und Vertretungen (ohne Angabe von Gründen), Zu- und Absagen sowie Anwesenheit bei Teamtreffen, Anmeldungen zu Veranstaltungen, erledigte Aufgaben, Materialanfragen',
          'Bemerkungen und Hinweise der Administration zur Person',
          'Anmeldedaten: Das Passwort wird nur als nicht umkehrbarer Hash (bcrypt) auf dem Server gespeichert.',
          'Ein Protokoll der Anmeldungen und Speichervorgänge (wer, wann) zum Schutz vor Missbrauch',
        ]),
      ]),

      section('5. Wer die Daten sieht', [
        list([
          'Die Administration (betreuende Lehrkraft) sieht und verwaltet alle Daten.',
          'Sanisprecher:innen koordinieren das Team: Sie schalten Registrierungen frei, erinnern an fehlende Verfügbarkeiten und sehen, sofern die Schule das vorsieht, die Engagement-Übersicht.',
          'Alle Sanis und Azubis sehen den Dienstplan mit den Namen der eingeteilten Personen, Teamtreffen, Veranstaltungen und Aufgaben. Bemerkungen und persönliche Hinweise sehen nur die betroffene Person und die Administration.',
          'Was jemand sehen und ändern darf, prüft der Server bei jedem Zugriff. Ohne Anmeldung sind keine personenbezogenen Daten abrufbar.',
        ]),
      ]),

      section('6. Dienstleister', [
        list([
          'Supabase Inc. (USA) betreibt die Datenbank in einem Rechenzentrum in Frankfurt am Main.',
          'GitHub Inc. (USA) liefert die Webseite aus und speichert dabei aus Sicherheitsgründen die IP-Adressen der Aufrufe.',
          info.teamsEnabled
            ? 'Microsoft Teams: Änderungen am Dienstplan, Vertretungen und Teamtreffen werden mit Vornamen und Initial (oder Namen) und Dienstzeiten in einen Teams-Kanal des Sanitätsdienstes gemeldet — nie mit Abwesenheitsgründen.'
            : null,
        ].filter(Boolean)),
        p('Für Übermittlungen in die USA gelten Standardvertragsklauseln der EU-Kommission bzw. das EU-US Data Privacy Framework. Eine Weitergabe an andere Stellen findet nicht statt.'),
      ]),

      section('7. Wie lange gespeichert wird', [
        list([
          'Konten bis zum Ausscheiden aus dem Schulsanitätsdienst; danach löscht die Administration das Konto.',
          `Dienste, Dienstverlauf, Teamtreffen, Veranstaltungen, erledigte Aufgaben und Materialanfragen eines Schuljahres: ${grace ? `${grace} Monat${grace === 1 ? '' : 'e'} nach Schuljahresende` : 'zum Schuljahresende'}.`,
          'Abgelaufene Pinnwand-Beiträge, nie freigeschaltete Registrierungen und Teams-Meldungen: 30 Tage.',
          'Anmeldungen enden spätestens nach 12 Stunden; das Zugriffsprotokoll wird nach 90 Tagen, Anmeldeversuche nach einem Tag gelöscht.',
        ]),
      ]),

      section('8. Speicherung im Browser', [
        p('Die App setzt keine Cookies und nutzt keine Analyse- oder Werbedienste. Im Browser gespeichert werden nur die Anmeldung (bis zum Schließen des Tabs) und die Einstellung Hell/Dunkel. Beides ist für die Nutzung erforderlich.'),
      ]),

      section('9. Automatische Einteilung', [
        p('Dienstpläne und Vertretungen schlägt ein Algorithmus nach festen Regeln vor (Verfügbarkeit, gleichmäßige Verteilung, Teamregeln). Die Administration kann jede Einteilung ändern. Eine automatisierte Entscheidung mit rechtlicher Wirkung im Sinne von Art. 22 DSGVO findet nicht statt.'),
      ]),

      section('10. Ihre Rechte', [
        list([
          'Auskunft über Ihre Daten (Art. 15) — eine Kopie Ihrer Daten können Sie im Dashboard unter „Mein Konto“ herunterladen.',
          'Berichtigung (Art. 16), Löschung (Art. 17) und Einschränkung der Verarbeitung (Art. 18)',
          'Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21)',
          privacy.legalBasis === 'consent' ? 'Widerruf einer Einwilligung mit Wirkung für die Zukunft (Art. 7 Abs. 3)' : null,
          `Beschwerde bei einer Datenschutz-Aufsichtsbehörde${privacy.authority ? `, zum Beispiel: ${privacy.authority}` : ''}`,
        ].filter(Boolean)),
        p('Wenden Sie sich dafür an die Administration oder die/den Datenschutzbeauftragte:n (siehe Abschnitt 1).'),
      ]),
    ]);

    const imprint = String(privacy.imprintUrl || '').trim();
    if (/^https:\/\//i.test(imprint)) {
      page.appendChild(U.el('p', { class: 'auth-footer-note' }, [U.el('a', { href: imprint, target: '_blank', rel: 'noopener' }, ['Impressum der Schule'])]));
    }
    container.appendChild(U.el('div', { class: 'legal-screen' }, [page]));
  }

  return { render };
})();
