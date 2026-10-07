# Schulsanitätsdienst — Dienstplan-Verwaltung

Eine schlanke Webanwendung zur Planung und Verwaltung des Schulsanitäts-
dienstes: Schüler:innen tragen ihre Verfügbarkeit ein, der Administrator
lässt per Knopfdruck einen fairen, optimierten Dienstplan berechnen und
pflegt Stammdaten, Kalender und Einstellungen. Der Code selbst ist reines,
serverfreies HTML/CSS/JavaScript ohne Build-Schritt; die Daten liegen in
einer gemeinsamen Supabase-Datenbank, damit alle Geräte/Browser denselben,
live aktuellen Stand sehen (siehe [Datenmodell & Datenhaltung](#datenmodell--datenhaltung)).

## Inhaltsverzeichnis

- [Schnellstart](#schnellstart)
- [Architektur](#architektur)
- [Der Planungsalgorithmus](#der-planungsalgorithmus)
- [Vertretungsmodus](#vertretungsmodus)
- [Datenmodell & Datenhaltung](#datenmodell--datenhaltung)
- [Rollen & Rechte](#rollen--rechte)
- [Team-Koordination](#team-koordination)
- [Import / Export](#import--export)
- [Bereitstellung im Schulnetzwerk](#bereitstellung-im-schulnetzwerk)
- [Teams-Benachrichtigungen](#teams-benachrichtigungen)
- [Sicherheit — bitte lesen](#sicherheit--bitte-lesen)
- [Erweiterbarkeit](#erweiterbarkeit)

## Schnellstart

Die Anwendung benötigt **keine Installation und keinen eigenen Server** —
es reicht, `index.html` im Browser zu öffnen (Doppelklick genügt) oder die
Datei auf einem beliebigen statischen Webhost (z. B. GitHub Pages)
bereitzustellen:

```
Dienstplan/index.html
```

Eine Internetverbindung ist nötig, da die Daten in einer gemeinsamen
Supabase-Datenbank liegen (siehe [Datenmodell & Datenhaltung](#datenmodell--datenhaltung)).

Beim allerersten Start (leere Datenbank) erscheint ein kurzer Einrichtungs-
assistent, der den Schulnamen sowie das erste Administrator-Konto anlegt.
Optional kann dabei ein Satz von 18 Beispiel-Schüler:innen mit zufälliger,
aber plausibler Verfügbarkeit geladen werden — praktisch, um den Planungs-
algorithmus sofort auszuprobieren, ohne zuerst manuell Daten zu erfassen
(Startpasswort dieser Demo-Konten: `willkommen`).

Alle Änderungen werden automatisch in Echtzeit gespeichert und an alle
anderen gerade geöffneten Browser/Geräte übertragen (siehe
[Datenmodell & Datenhaltung](#datenmodell--datenhaltung)).

### Lokale Entwicklung über HTTP

Für die Entwicklung liegt ein winziger, abhängigkeitsfreier Node-Server unter
[`tools/local-preview-server.js`](tools/local-preview-server.js) bei (kein
`npm install` nötig). Er ist **nicht** Teil der Anwendung, sondern nur eine
Komfort-Option zum lokalen Ausprobieren über eine `http://`-Adresse:

```bash
node tools/local-preview-server.js
# -> http://localhost:8080
```

## Architektur

Der Code ist bewusst als reines, modulares JavaScript ohne Build-Schritt
aufgebaut (kein npm/Bundler notwendig) — dadurch läuft die App in jedem
modernen Browser, sobald sie über `http(s)://` ausgeliefert wird (lokaler
Server, Schulnetzwerk, GitHub Pages, …). Jede Datei registriert sich unter
dem gemeinsamen Namensraum `window.SSD`.

```
index.html                 Einstiegspunkt, lädt alle Skripte in Reihenfolge
css/
  variables.css             Design-Tokens (Farben, Radien, Abstände, Dark Mode)
  base.css, layout.css       Reset, Typografie, App-Shell, Responsive-Regeln
  components.css             Buttons, Karten, Formulare, Tabellen, Modals, …
  views.css, animations.css  Seiten-spezifische Styles, Keyframes
  print.css                  Druckansicht / PDF-Export
js/
  core/                      Utils, Datenmodelle, Storage, State-Store (Undo/Redo)
  auth/                      Login, Sitzungen, Passwort-Hashing
  modules/                   Fachlogik: Schüler, Kalender, Einstellungen,
                              *Scheduler (Optimierungsalgorithmus)*, Statistik,
                              Import/Export
  ui/                        Wiederverwendbare UI-Bausteine (Toast, Dialog,
                              Router, Charts, Tooltips, Tastenkürzel, Icons)
  views/                     Eine Datei je Bildschirm (Login, Setup,
                              Schülerbereich, Admin-Unteransichten)
  app.js                     Bootstrap: verdrahtet Module & startet den Router
```

**Warum kein Framework/TypeScript-Build?** Die Anwendung soll laut
Anforderung *ohne weitere Anpassungen produktiv nutzbar* sein — ein
Build-Schritt würde voraussetzen, dass auf dem Schulrechner Node.js/npm
installiert ist. Reines JavaScript mit klaren Modulgrenzen, JSDoc-Kommentaren
und strikter Trennung der Zuständigkeiten erreicht dieselbe Wartbarkeit ohne
diese Hürde.

**Warum keine externen Bibliotheken/CDNs?** Damit die App wirklich
*vollständig lokal* funktioniert (auch ganz ohne Internetzugang), sind
Diagramme als handgeschriebene SVG-Komponenten umgesetzt
([`js/ui/charts.js`](js/ui/charts.js)), der Excel-Export nutzt einen
HTML-Tabellen-Trick mit `.xls`-Endung, und der PDF-Export erfolgt über eine
gestylte Druckansicht (`window.print()` → „Als PDF speichern“ im
Browser-Druckdialog).

## Der Planungsalgorithmus

Herzstück der Anwendung ist [`js/modules/scheduler.js`](js/modules/scheduler.js).
Es handelt sich **nicht** um eine Zufallszuteilung, sondern um ein
zweiphasiges Verfahren:

1. **Konstruktion (Constraint Satisfaction).** Die noch offenen Dienste
   werden wiederholt nach der *Minimum-Remaining-Values*-Heuristik
   bearbeitet: Der Dienst mit den aktuell wenigsten zulässigen
   Kandidat:innen wird zuerst besetzt. So werden knappe Ressourcen zuerst
   verplant, statt sich durch eine ungünstige Reihenfolge selbst in eine
   Sackgasse zu manövrieren.
2. **Lokale Suche (Simulated Annealing).** Anschließend werden tausende
   zufällige, aber stets zulässige Änderungen erprobt: offene Dienste
   nachbesetzen, einen Dienst von einer stark auf eine weniger belastete
   Person **umverteilen**, zwei Personen tauschen und — für Wunsch- und
   bevorzugte Paare — gezielte Partner-Züge. Verbesserungen werden immer
   übernommen, Verschlechterungen nur mit einer über die Zeit sinkenden
   Wahrscheinlichkeit. Diese Phase läuft "gechunkt" (`async`/`await` mit
   `nextTick`-Pausen), damit die Ladeanimation flüssig bleibt.

**Harte Bedingungen** (nie verletzt): nur verfügbare/aktive Schüler:innen,
keine gesperrten Zeiten, keine deaktivierten Tage/Blöcke, niemand doppelt im
selben Dienst, wöchentliche/gesamte Höchstgrenzen pro Person, Paar-Regeln
„nie zusammen“.

**Weiche Bedingungen** (Kostenfunktion, Basis siehe `WEIGHTS` in
`scheduler.js`): gleichmäßige Dienstanzahl pro Woche und über das Schuljahr
(jeweils nur unter Personen, die laut Verfügbarkeit überhaupt infrage
kommen), Geschlechtermischung, Partnerwechsel, Partnerwünsche der Sanis,
Paar-Regeln „bevorzugt“, Abijahrgangs-Regeln, Abwechslung der Termine und
Verteilung über die Wochentage. Wie stark jedes Kriterium zählt, stellt der
Administrator unter **Verteilung → Prioritäten** ein (Aus / Niedrig / Mittel
/ Hoch).

### Verteilung steuern (Admin-Bereich „Verteilung“)

- **Grundregeln:** Max. Dienste pro Person und Woche/insgesamt, Personen pro
  Dienst, Mindestpause, mehrere Dienste am selben Tag. Soll niemand mehr als
  eine bestimmte Zahl Dienste pro Woche machen — auch wenn dann Dienste offen
  bleiben —, ist das Wochenlimit das richtige Werkzeug.
- **Prioritäten:** Stärke der weichen Kriterien (siehe oben).
- **Abijahrgänge:** Grundregel (egal / verschiedene Jahrgänge mischen /
  gleiche Jahrgänge zusammen) plus einzelne Kombinationen „bevorzugt“ oder
  „möglichst nicht“. Personen ohne Abijahrgang werden ignoriert.
- **Paar-Regeln:** zwei bestimmte Personen „bevorzugt zusammen“ oder „nie
  zusammen“ (gilt auch bei Vertretungen und beim Selbst-Übernehmen).
- **Partnerwünsche:** Jede:r Sani wählt im eigenen Bereich bis zu drei
  Wunschpartner:innen; gegenseitige Wünsche zählen stärker. Die Übersicht
  sieht nur der Administrator.

Bei sehr knapper Verfügbarkeit sind viele Paarungen bereits vorgegeben —
Wünsche und Jahrgangsregeln wirken dann entsprechend schwächer. Die
Abdeckung (möglichst viele besetzte Dienste) wird dafür nie geopfert.

## Vertretungsmodus

Für kurzfristige Ausfälle (Krankheit, Klassenfahrt, spontane Abwesenheit)
gibt es einen zweiten, gezielteren Algorithmus in
[`js/modules/substitutionService.js`](js/modules/substitutionService.js):
Statt den gesamten Dienstplan neu zu berechnen, wird **ausschließlich** für
die betroffenen Dienste der ausgefallenen Person(en) eine Ersatzperson
gesucht — der Rest des Plans bleibt unangetastet.

- **Zugang:** Button „Abwesenheit melden" auf der Dienstplan-Seite (eine
  oder mehrere Personen, ein Datumsbereich), oder direkt aus dem
  Bearbeiten-Dialog eines einzelnen Dienstes heraus ("Vertretung suchen").
- **Harte Bedingungen** sind identisch zur regulären Planung (Verfügbarkeit,
  Sperrzeiten, keine Doppelbelegung, Wochen-/Gesamtlimits) — technisch durch
  Wiederverwendung derselben `SchedulingContext`-Klasse aus `scheduler.js`
  sichergestellt, es gibt also keine zweite, potenziell abweichende
  Implementierung der Regeln.
- **Bewertung:** Jede zulässige Ersatzperson erhält eine 0–100-Punkte-
  Eignungsbewertung (Fairness, Geschlechtermischung, Partnerhistorie,
  Wochentagsverteilung, freie Wochenkapazität) inklusive einer
  nachvollziehbaren Begründung — sichtbar im **Vertretungsassistenten**, der
  alle zulässigen Kandidat:innen sortiert auflistet.
- **Vorschau vor Übernahme:** Vor dem endgültigen Eintragen zeigt die
  Anwendung alle betroffenen Dienste mit Vorschlag, Begründung und der
  Auswirkung auf den Fairness-Score des gesamten Plans. Jeder Vorschlag kann
  einzeln über den Assistenten manuell überschrieben werden; danach werden
  alle Zuteilungen der aktuellen Anfrage automatisch erneut auf Konflikte
  geprüft (z. B. wenn dieselbe Person versehentlich für zwei sich
  überschneidende Dienste ausgewählt würde).
- **Kein Ersatz gefunden:** Die Anwendung nennt konkrete Gründe (z. B. "8
  Personen nicht verfügbar, 3 am Wochenlimit") und bietet als Alternative an,
  stattdessen die betroffene Woche vollständig neu berechnen zu lassen — das
  bleibt aber immer eine explizite, separate Aktion.

### Selbst abmelden („Ich falle aus“) mit automatischer Vertretung

Wer z. B. morgens krank ist, meldet das direkt im eigenen Dashboard: Ganz
oben steht die Karte **„Meine nächsten Dienste“** (Heute/Morgen farbig
markiert) mit **„Vertretung anfordern“** je Dienst sowie **„Ich falle aus …“**
für mehrere Tage (Zeitraum wählen, alle betroffenen Dienste sind
vorausgewählt, ein Speichervorgang). Ein Grund wird bewusst nicht abgefragt
(Gesundheitsdaten).

**Automatische Vertretung** (Standard; abschaltbar unter *Einstellungen →
Allgemein → „Vertretung automatisch einteilen“): Die App teilt sofort die
passendste verfügbare Person ein —
`SSD.SubstitutionService.proposeAutoReplacements` nutzt dieselben harten
Regeln und dieselbe Eignungsbewertung wie der Vertretungsassistent (nur als
„Verfügbar“ eingetragene Zeiten, Wochen-/Gesamtlimit, Tages-/Pausenregeln,
Paar-Regeln; Azubi-Plätze nur mit Azubis). Zusätzlich nie eingeteilt wird,
wer an diesem Tag selbst ausfällt (eigene Anfrage oder abgegebener Dienst)
oder genau diesen Dienst schon einmal abgegeben hat.

- Die **eingeteilte Person** sieht beim Anmelden einen Hinweis („Sie wurden
  als Vertretung eingeteilt … für X“) und bestätigt ihn mit „Verstanden“.
  Kann sie doch nicht, meldet sie sich beim Dienst ebenfalls ab — die App
  sucht dann die nächste Person.
- Die **abgemeldete Person** sieht unter „Abgegeben“, wer ihren Dienst jetzt
  macht (auch wenn er weitergegeben wurde).
- **Administrator und Team-Leitung** sehen unter „Automatisch eingeteilte
  Vertretungen“ (Admin-Übersicht bzw. Team-Verwaltung), wer welchen Dienst
  übernommen hat und ob der Hinweis schon **gesehen** wurde.
- Findet sich niemand (oder ist die Automatik ausgeschaltet), bleibt der Dienst
  als „Vertretung gesucht“ offen: Die Person bleibt eingeteilt, bis jemand
  übernimmt; der Dienst erscheint bei den anderen unter „Offene Dienste“, in
  der Team-Verwaltung und als Hinweis in der Admin-Übersicht („… davon für
  heute“), jeweils mit der Markierung Heute/Morgen.

## Datenmodell & Datenhaltung

Der komplette Anwendungszustand ist ein einziges JSON-Objekt
(`js/core/models.js` → `createDefaultAppData()`):

```
{ version, school, admin, students[], specialDays[],
  dutyBlockConfig, settings, schedule: { entries[] }, events[], tasks[],
  materials[], announcements[], meetings[], teamsOutbox[], meta }
```

Neue Felder ergänzt `migrateIfNeeded` ([`js/core/storage.js`](js/core/storage.js))
beim Laden mit Standardwerten — bestehende Daten bleiben unverändert erhalten.

Dieses Objekt liegt vollständig in **einer Zeile einer Supabase-Tabelle**
(`ssd_dienstplan_state`, Spalte `data`, siehe
[`js/core/storage.js`](js/core/storage.js)) — es gibt bewusst kein
relationales Schema und kein eigenes Backend: Der Browser spricht direkt
(über den öffentlichen "anon"-Schlüssel, siehe
[`js/core/supabaseConfig.js`](js/core/supabaseConfig.js)) mit Supabase, genau
wie er zuvor direkt mit `localStorage` gesprochen hat. Das hält die gesamte
Fachlogik (Planungsalgorithmus, Vertretungsmodus, Statistik, …) unverändert
einfach: Sie arbeitet weiterhin auf einem gewöhnlichen In-Memory-JavaScript-
Objekt, nicht auf einzelnen Datenbank-Zeilen.

- **Automatisches Speichern:** Jede Änderung läuft über `SSD.Store.commit()`,
  das (sofern in den Einstellungen aktiviert) die Änderung sofort im
  Hintergrund nach Supabase überträgt, einen lokalen Undo/Redo-Schnappschuss
  anlegt und die UI per Event-Bus benachrichtigt.
- **Alle Geräte sehen dieselben Daten:** Anders als bei einer reinen
  `localStorage`-Lösung ist der Datenstand nicht mehr an einen einzelnen
  Browser gebunden. Über Supabase Realtime werden Änderungen einer Person
  automatisch an alle anderen gerade geöffneten Sitzungen übertragen, ohne
  dass ein manueller Reload nötig wäre.
- **Nebenläufigkeit:** Speichern nutzt eine optimistische Versionsprüfung
  (Spalte `version`) — speichert eine Person, während eine andere
  zwischenzeitlich bereits gespeichert hat, wird die fremde Änderung nicht
  stillschweigend überschrieben; stattdessen erscheint ein Hinweis, die Seite
  neu zu laden. Für die kleine Nutzerzahl eines Schulteams ist das ein
  angemessener Kompromiss gegenüber einer vollständigen Operational-
  Transform-/CRDT-Lösung. Innerhalb eines Tabs speichert `SSD.Store`
  nacheinander: Folgen Änderungen schneller aufeinander, als eine Speicherung
  dauert (z. B. mehrere angetippte Verfügbarkeiten), wird danach einmal mit
  dem vollständigen Stand nachgespeichert, statt fälschlich einen Konflikt
  mit sich selbst zu melden; Realtime-Updates, die während des eigenen
  Speicherns eintreffen, werden erst danach ausgewertet.
- **Sicherheit des Zugriffs:** Die Datenbankzeile ist per Row-Level-Security
  auf Lesen/Aktualisieren beschränkt (kein Anlegen/Löschen über den Client).
  Der inhaltliche Zugriffsschutz (wer sich anmelden und was sehen darf)
  erfolgt weiterhin über den Login-Bildschirm der Anwendung selbst — siehe
  [Sicherheit — bitte lesen](#sicherheit--bitte-lesen).
- Regelmäßige JSON-Exports als Backup werden weiterhin empfohlen (Button
  unter *Einstellungen → Datenverwaltung*), z. B. um einen Stand vor einer
  größeren Umstellung zu sichern.

## Rollen & Rechte

- **Administrator:** ein Konto, im Einrichtungsassistenten angelegt,
  Zugangsdaten änderbar unter *Einstellungen*. Vollzugriff auf alle
  Bereiche.
- **Schüler:in:** vom Administrator angelegtes oder selbst registriertes
  Konto. Sieht die eigene Verfügbarkeit, eigene Dienste, persönliche
  Hinweise und die eigenen Wunschpartner:innen. Änderungen an der
  Verfügbarkeit sind nur innerhalb des in den Einstellungen konfigurierten
  Zeitfensters möglich ("Änderungsfrist").
- **Sanisprecher:in / Stellv. Sanisprecher:in:** Zusatzbezeichnung für je
  eine Person (Admin-Übersicht → *Team-Leitung*). Zusätzlich zum
  Schülerbereich gibt es den Reiter *Team-Verwaltung* sowie Bearbeitungsrechte
  für Pinnwand, Aufgaben und Teamtreffen — siehe
  [Team-Koordination](#team-koordination). Kein Zugriff auf Einstellungen,
  Kontenverwaltung oder die Neuberechnung des Dienstplans.
- **Selbstregistrierung & Schulcode:** Ist unter *Einstellungen →
  Selbstregistrierung* (oder bei der Ersteinrichtung) ein Schulcode
  festgelegt, wird er bei der Registrierung abgefragt; mit dem richtigen Code
  ist das Konto sofort freigeschaltet und angemeldet. Ohne Schulcode warten
  neue Konten auf die Freischaltung — durch den Administrator (*Team →
  Mitglieder* oder Schülerverwaltung) oder die Sanisprecher:innen.

## Team-Koordination

Administrator und Sanisprecher:innen arbeiten mit denselben Bausteinen
(`js/ui/announcementBoard.js`, `meetingsPanel.js`, `teamMembersPanel.js`,
`engagementPanel.js`, `gapFillFlow.js`, `taskEditor.js`): der Administrator
unter *Team* (Reiter Pinnwand, Teamtreffen, Mitglieder, Engagement), die
Sanisprecher:innen in ihrem Dashboard.

| Funktion | Was sie tut | Administrator | Sanisprecher:innen |
|---|---|---|---|
| **Pinnwand** | Mitteilungen oben im Dashboard aller Sanis/Azubis; „wichtig“ heftet oben an, „sichtbar bis“ blendet automatisch aus | alle Beiträge | anlegen, eigene bearbeiten/löschen |
| **Teamtreffen** | Treffen ansetzen, alle aktiven Sanis/Azubis sagen zu oder ab, danach Anwesenheit erfassen | alle Treffen | anlegen, eigene bearbeiten; Anwesenheit bei allen |
| **Aufgaben anlegen** | offener Aufgaben-Pool (wie bisher), jetzt auch von der Team-Leitung befüllbar | alle Aufgaben | anlegen, eigene bearbeiten/löschen |
| **Lücken auffüllen** | besetzt unbesetzte Dienste ab heute per Algorithmus, ohne den übrigen Plan zu ändern | Dienstplan-Ansicht | Team-Verwaltung → Überblick |
| **Registrierungen** | Selbstregistrierungen ohne Schulcode freischalten oder ablehnen | ✓ | ✓ |
| **Wer fehlt noch?** | wer noch keine Verfügbarkeit eingetragen bzw. sie seit einem Stichtag (Halbjahresbeginn) nicht aktualisiert hat; „Erinnern“ zeigt der Person beim Anmelden einen Hinweis, bis sie ihre Verfügbarkeit ändert oder bestätigt | ✓ | ✓ |
| **Engagement-Übersicht** | je Person geleistete Dienste (davon eingesprungen), Veranstaltungen, erledigte Aufgaben, besuchte Teamtreffen — gezählt bis heute, z. B. als Grundlage für Zeugnisbemerkungen; CSV-Export | ✓ inkl. **Nachweis drucken** (eine Seite pro Person zum Unterschreiben) | ✓ (ohne Nachweise) |

Pinnwand, Teamtreffen, Erinnerungen und Freischaltungen erzeugen bewusst
**keine** Teams-Meldungen. Aufgaben und aufgefüllte Lücken melden — wie
bisher — die bestehenden Teams-Kategorien „Aufgaben“ bzw. „Dienstplan“.
Abwesenheitsgründe (z. B. Krankheit) fließen nirgends in die
Engagement-Übersicht ein; vergangene Dienste werden beim Auffüllen nie
nachträglich besetzt.

## Import / Export

| Format  | Wofür | Ort |
|---------|-------|-----|
| JSON    | Vollständiges Backup/Migration aller Daten | Einstellungen |
| CSV     | Schülerliste (Im-/Export) & Dienstplan (Export) | Schülerverwaltung / Dienstplan |
| Excel (.xls) | Schülerliste & Dienstplan, mit Formatierung | Schülerverwaltung / Dienstplan |
| Druck/PDF | Dienstplan & Statistik, druckoptimiert | Dienstplan / Statistik |
| CSV     | Engagement-Übersicht (Export) | Team → Engagement |
| Druck/PDF | Nachweise über die Mitarbeit (eine Seite pro Person) | Team → Engagement (nur Administrator) |

Der CSV-Import unterstützt Massenanlage von Konten (z. B. aus einer
Klassenliste) inkl. optionaler Passwort-Spalte; fehlt sie, wird der
Benutzername als Startpasswort vergeben.

## Bereitstellung im Schulnetzwerk

Die App kann unverändert auf jedem beliebigen statischen Webhost
(Schul-Intranet, IIS, Apache, GitHub Pages, …) abgelegt werden — es sind
keine eigenen serverseitigen Komponenten nötig, lediglich eine
Internetverbindung zur gemeinsamen Supabase-Datenbank (siehe
[Datenmodell & Datenhaltung](#datenmodell--datenhaltung)).

## Teams-Benachrichtigungen

Änderungen werden gesammelt als **eine** Nachricht in einen Microsoft-Teams-
Kanal gepostet — etwa 5 Minuten nach der ersten Änderung, damit z. B. zehn
nacheinander bearbeitete Dienste nicht zehn Nachrichten erzeugen. Gemeldet
werden (einzeln abschaltbar unter *Einstellungen → Microsoft Teams*):
Dienstplan (neu erstellt/übertragen, Lücken aufgefüllt, manuelle Änderungen an
kommenden Diensten), Vertretungen (eingetragen, automatisch eingeteilt,
„Vertretung gesucht“, offene Dienste selbst übernommen), Veranstaltungen,
Aufgaben und Material.

**So funktioniert es:** Die App legt jede Meldung im selben Speichervorgang
wie die eigentliche Änderung in `teamsOutbox` ab
([`js/modules/notificationService.js`](js/modules/notificationService.js)) —
wird die Änderung rückgängig gemacht, verschwindet auch die Meldung. Den
Versand übernimmt die Datenbank selbst: Ein `pg_cron`-Job ruft jede Minute
`ssd_private.send_teams_digest()` auf (Supabase-Migration
`ssd_teams_notifications`), der neue Meldungen sammelt und als Adaptive Card
per `pg_net` an einen Teams-Workflow schickt. Das Ergebnis (gesendet/Fehler/
wartend) steht in der lesbaren Tabelle `ssd_teams_status` und wird in den
Einstellungen angezeigt. Pro Stunde gehen höchstens 12 Nachrichten raus;
nach einem Fehler wird nach 15 Minuten erneut versucht.

**Einrichtung** (Anleitung auch direkt in der App):

1. In Teams im gewünschten Kanal „…“ → *Workflows* → Vorlage „Bei Empfang
   einer Webhookanforderung in einem Kanal posten“ → Team/Kanal bestätigen →
   *Workflow hinzufügen* → angezeigte Adresse kopieren. Fehlt der Menüpunkt,
   hat die Schul-IT Workflows/Power Automate gesperrt.
2. Im Supabase-Dashboard → *SQL Editor* einmalig ausführen:
   ```sql
   select vault.create_secret('ADRESSE', 'ssd_teams_webhook_url');
   -- optional, für den Button „Dienstplan öffnen“:
   select vault.create_secret('https://ADRESSE-DER-WEBSEITE/', 'ssd_teams_app_url');
   ```
   Die Workflow-Adresse ist geheim (wer sie kennt, kann in den Kanal
   schreiben) und gehört deshalb nicht in den Code oder den Datenbestand,
   sondern verschlüsselt in den Vault. Ändern:
   `vault.update_secret(...)`, trennen: `delete from vault.secrets where name = 'ssd_teams_webhook_url';`
3. In der App *Einstellungen → Microsoft Teams* → „Benachrichtigungen aktiv“
   einschalten → „Testnachricht senden“ (erscheint nach etwa einer Minute).

**Datenschutz:** Die Nachrichten enthalten Namen und Dienstzeiten — bitte
einen Kanal wählen, den nur das Sanitätsdienst-Team und die Verantwortlichen
sehen.

## Sicherheit — bitte lesen

Passwörter werden nicht im Klartext, sondern als gesalzener SHA-256-Hash
gespeichert (`js/auth/auth.js`, Web-Crypto-API). Die Prüfung "wer darf sich
anmelden und was sehen" erfolgt vollständig im Browser-JavaScript der
Anwendung — es gibt kein eigenes Backend, das dies serverseitig
durchsetzt. Die Supabase-Tabelle selbst ist per Row-Level-Security nur für
Lesen/Aktualisieren freigegeben (kein Anlegen/Löschen), der dafür verwendete
Schlüssel ist der öffentliche "anon"-Schlüssel, der bei Supabase bewusst dazu
gedacht ist, im Client-Code zu stehen.

**Praktisch bedeutet das:** Jede Person, die den Schlüssel und die
Projekt-URL kennt (beides steht offen im ausgelieferten JavaScript, siehe
`js/core/supabaseConfig.js`), könnte technisch versiert die Datenbank auch
direkt über die Supabase-API ansprechen und so den Login-Bildschirm
umgehen. Dieses Schutzniveau ist für ein internes Organisationswerkzeug
einer Schule (Namen, Klassen, Dienstzeiten — keine besonders sensiblen
personenbezogenen Daten) angemessen, entspricht aber weiterhin **keiner
harten Zugriffskontrolle**. Für sensiblere Anwendungsfälle wäre eine echte
Backend-Anbindung mit Supabase Auth und pro Nutzer:in geltenden
Row-Level-Security-Regeln erforderlich — ein deutlich größerer Umbau, der
bei Bedarf nachträglich ergänzt werden kann, ohne die übrige Anwendung
umschreiben zu müssen (die Fachlogik kennt die Datenbank nicht direkt,
sondern ausschließlich über `js/core/storage.js`).

Der **Schulcode** wird wie Passwörter nur als gesalzener Hash gespeichert und
im Browser geprüft. Er hält Außenstehende, die nur die Adresse kennen, von
einer sofort freigeschalteten Registrierung ab — ist aber aus denselben
Gründen eine Komfort-Hürde und keine harte Zugangskontrolle. Ein langer,
zufällig erzeugter Code (Button „Zufällig“) ist schwerer zu erraten als ein
kurzes Wort.

**Teams-Benachrichtigungen:** Die Workflow-Adresse liegt nur verschlüsselt im
Supabase Vault und ist über die API nicht erreichbar; Versandfunktion und
interne Tabellen liegen im nicht veröffentlichten Schema `ssd_private`. Weil
der Datenbestand aber mit dem öffentlichen Schlüssel beschreibbar ist, könnte
eine technisch versierte Person mit Kenntnis des Schlüssels eigene Texte in
den Postausgang schreiben, die dann im Kanal erscheinen. Das ist begrenzt:
höchstens 12 Nachrichten pro Stunde, Links werden entfernt, alles wird als
reiner Text ohne Formatierung angezeigt, und der Button-Link stammt aus dem
Vault, nicht aus dem Datenbestand. Bei Missbrauch den Vault-Eintrag
`ssd_teams_webhook_url` löschen oder den Workflow in Teams ausschalten.

**Datenbank wach halten:** Supabase pausiert Projekte im kostenlosen Tarif
nach etwa einer Woche ohne Zugriff. Der GitHub-Workflow
[`.github/workflows/supabase-keepalive.yml`](.github/workflows/supabase-keepalive.yml)
schickt deshalb alle drei Tage eine Mini-Leseabfrage (manuell auslösbar unter
*Actions*). Ist das Projekt doch einmal pausiert, lässt es sich im
Supabase-Dashboard über „Restore project“ wieder aktivieren.

## Erweiterbarkeit

Neue Funktionen lassen sich gezielt an einer Stelle ergänzen, ohne andere
Module anzufassen:

- Neue Statistik-Kennzahl → `js/modules/statisticsService.js`
- Neues Export-Format → `js/modules/importExport.js`
- Neue Admin-Unteransicht → neue Datei in `js/views/`, Route in `js/app.js`
  registrieren, Navigationspunkt in `js/views/adminLayout.js` ergänzen
- Andere Gewichtung der Fairness-Kriterien → `WEIGHTS` in
  `js/modules/scheduler.js`
