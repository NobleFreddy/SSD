# Schulsanitätsdienst — Dienstplan-Verwaltung

Eine vollständig lokale, serverlose Webanwendung zur Planung und Verwaltung
des Schulsanitätsdienstes: Schüler:innen tragen ihre Verfügbarkeit ein, der
Administrator lässt per Knopfdruck einen fairen, optimierten Dienstplan
berechnen und pflegt Stammdaten, Kalender und Einstellungen.

## Inhaltsverzeichnis

- [Schnellstart](#schnellstart)
- [Architektur](#architektur)
- [Der Planungsalgorithmus](#der-planungsalgorithmus)
- [Vertretungsmodus](#vertretungsmodus)
- [Datenmodell & Datenhaltung](#datenmodell--datenhaltung)
- [Rollen & Rechte](#rollen--rechte)
- [Import / Export](#import--export)
- [Bereitstellung im Schulnetzwerk](#bereitstellung-im-schulnetzwerk)
- [Sicherheit — bitte lesen](#sicherheit--bitte-lesen)
- [Erweiterbarkeit](#erweiterbarkeit)

## Schnellstart

Die Anwendung benötigt **keine Installation, keinen Server und keine
Datenbank**. Es reicht, `index.html` im Browser zu öffnen (Doppelklick
genügt):

```
Dienstplan/index.html
```

Beim allerersten Start erscheint ein kurzer Einrichtungsassistent, der den
Schulnamen sowie das erste Administrator-Konto anlegt. Optional kann dabei
ein Satz von 18 Beispiel-Schüler:innen mit zufälliger, aber plausibler
Verfügbarkeit geladen werden — praktisch, um den Planungsalgorithmus sofort
auszuprobieren, ohne zuerst manuell Daten zu erfassen (Startpasswort dieser
Demo-Konten: `willkommen`).

Alle Daten werden ausschließlich im `localStorage` des Browsers gespeichert
und automatisch bei jeder Änderung aktualisiert (siehe
[Datenmodell & Datenhaltung](#datenmodell--datenhaltung)).

### Optional: über HTTP statt `file://` testen

Für die Entwicklung liegt ein winziger, abhängigkeitsfreier Node-Server unter
[`tools/local-preview-server.js`](tools/local-preview-server.js) bei (kein
`npm install` nötig). Er ist **nicht** Teil der Anwendung, sondern nur eine
Komfort-Option, z. B. wenn mehrere Rechner im Schulnetzwerk auf dieselbe
laufende Instanz zugreifen sollen:

```bash
node tools/local-preview-server.js
# -> http://localhost:8080
```

## Architektur

Der Code ist bewusst als reines, modulares JavaScript ohne Build-Schritt
aufgebaut (kein npm/Bundler notwendig) — dadurch läuft die App garantiert
in jedem modernen Browser, auch direkt von der Festplatte (`file://`), ohne
CORS-Stolperfallen, wie sie bei ES-Modulen oder `fetch()` unter `file://`
auftreten würden. Jede Datei registriert sich unter dem gemeinsamen
Namensraum `window.SSD`.

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
   zufällige, aber stets zulässige Änderungen erprobt (zwei Personen
   tauschen, offene Dienste nachbesetzen). Verbesserungen werden immer
   übernommen, Verschlechterungen nur mit einer über die Zeit sinkenden
   Wahrscheinlichkeit — dadurch entkommt der Algorithmus lokalen
   Sackgassen, ohne sich in einer schlechteren Lösung festzufahren. Diese
   Phase läuft "gechunkt" (`async`/`await` mit `nextTick`-Pausen), damit der
   Haupt-Thread nicht blockiert und die Ladeanimation flüssig bleibt.

**Harte Bedingungen** (nie verletzt): nur verfügbare/aktive Schüler:innen,
keine gesperrten Zeiten, keine deaktivierten Tage/Blöcke, niemand doppelt im
selben Dienst, wöchentliche/gesamte Höchstgrenzen pro Person.

**Weiche Bedingungen** (Kostenfunktion, siehe `WEIGHTS` in `scheduler.js`):
Fairness (Streuung der Gesamtdienste), Geschlechtermischung, Partnerwechsel
(quadratisch bestrafte Wiederholungen), keine Wiederholung desselben
Wochentag/Block-Slots wie in der Vorwoche, gleichmäßige Verteilung über die
Wochentage. Die Gewichte lassen sich zentral an einer Stelle anpassen, falls
eine Schule andere Prioritäten setzen möchte.

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

## Datenmodell & Datenhaltung

Der komplette Anwendungszustand ist ein einziges JSON-Objekt
(`js/core/models.js` → `createDefaultAppData()`), das in `localStorage`
gehalten wird ([`js/core/storage.js`](js/core/storage.js)):

```
{ version, school, admin, students[], specialDays[],
  dutyBlockConfig, settings, schedule: { entries[] }, meta }
```

- **Automatisches Speichern:** Jede Änderung läuft über
  `SSD.Store.commit()`, das (sofern in den Einstellungen aktiviert) sofort
  persistiert, einen Undo/Redo-Schnappschuss anlegt und die UI per
  Event-Bus benachrichtigt.
- **Wichtig — kein Server/keine Datenbank bedeutet auch:** `localStorage`
  ist strikt pro Browser/Gerät. Wenn Schüler:innen ihre Verfügbarkeit von
  **eigenen** Geräten aus eintragen sollen, ist entweder (a) ein gemeinsam
  genutzter Rechner (z. B. im Sanitätsraum) vorgesehen, auf dem sich jede
  Person mit ihrem Konto anmeldet, oder (b) der JSON-Export/Import wird
  aktiv als Austauschformat genutzt. Dies ist eine bewusste Konsequenz der
  Vorgabe "keine Datenbank/kein Server" und in den Einstellungen unter
  „Datenverwaltung“ jederzeit einsehbar (Speichergröße, Export-Button).
- Regelmäßige JSON-Exports als Backup werden empfohlen (Button unter
  *Einstellungen → Datenverwaltung*).

## Rollen & Rechte

- **Administrator:** ein Konto, im Einrichtungsassistenten angelegt,
  Zugangsdaten änderbar unter *Einstellungen*. Vollzugriff auf alle
  Bereiche.
- **Schüler:in:** vom Administrator angelegtes Konto. Sieht ausschließlich
  die eigene Verfügbarkeit, eigene Dienste und persönliche Hinweise.
  Änderungen an der Verfügbarkeit sind nur innerhalb des in den
  Einstellungen konfigurierten Zeitfensters möglich ("Änderungsfrist").

## Import / Export

| Format  | Wofür | Ort |
|---------|-------|-----|
| JSON    | Vollständiges Backup/Migration aller Daten | Einstellungen |
| CSV     | Schülerliste (Im-/Export) & Dienstplan (Export) | Schülerverwaltung / Dienstplan |
| Excel (.xls) | Schülerliste & Dienstplan, mit Formatierung | Schülerverwaltung / Dienstplan |
| Druck/PDF | Dienstplan & Statistik, druckoptimiert | Dienstplan / Statistik |

Der CSV-Import unterstützt Massenanlage von Konten (z. B. aus einer
Klassenliste) inkl. optionaler Passwort-Spalte; fehlt sie, wird der
Benutzername als Startpasswort vergeben.

## Bereitstellung im Schulnetzwerk

Die App kann unverändert auf jedem beliebigen statischen Webserver
(Schul-Intranet, IIS, Apache, GitHub Pages, …) abgelegt werden — es sind
keine serverseitigen Komponenten nötig. Zu beachten ist dabei weiterhin die
oben beschriebene `localStorage`-Eigenschaft: Jeder Browser hat seinen
eigenen, unabhängigen Datenstand.

## Sicherheit — bitte lesen

Passwörter werden nicht im Klartext, sondern als gesalzener SHA-256-Hash
gespeichert (`js/auth/auth.js`, Web-Crypto-API). Das ist eine sinnvolle
Grundabsicherung gegen versehentliches Mitlesen (z. B. in einem JSON-Export),
**ersetzt aber keine serverseitige Zugriffskontrolle**. Für ein rein
internes Organisationswerkzeug einer Schule ist dieses Schutzniveau
angemessen; für sensiblere Anwendungsfälle wäre eine echte Backend-Anbindung
erforderlich.

## Erweiterbarkeit

Neue Funktionen lassen sich gezielt an einer Stelle ergänzen, ohne andere
Module anzufassen:

- Neue Statistik-Kennzahl → `js/modules/statisticsService.js`
- Neues Export-Format → `js/modules/importExport.js`
- Neue Admin-Unteransicht → neue Datei in `js/views/`, Route in `js/app.js`
  registrieren, Navigationspunkt in `js/views/adminLayout.js` ergänzen
- Andere Gewichtung der Fairness-Kriterien → `WEIGHTS` in
  `js/modules/scheduler.js`
