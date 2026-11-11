# PersonalSportTracker

Persönliches, kostenloses Sport-Dashboard für Formel 1 und Fußball.

## V1

- Formel 1: Fahrer-WM und Konstrukteurs-WM
- 1. Bundesliga
- 2. Bundesliga
- 3. Liga
- Champions-League-Ligaphase
- tägliches Datenupdate über GitHub Actions
- statische Bereitstellung über GitHub Pages

## Datenquellen

- Formel 1: Jolpica F1
- Fußball: OpenLigaDB

Die Webseite greift nicht direkt auf die externen APIs zu. Die GitHub Action normalisiert die API-Daten einmal täglich in eigene JSON-Dateien unter `public/data/`.

## Lokal testen

Voraussetzung: Node.js 20 oder neuer.

```bash
npm run update-data
python -m http.server 8000 -d public
```

Danach `http://localhost:8000` öffnen.

## GitHub Pages

In den Repository-Einstellungen unter **Settings → Pages → Build and deployment** als Source **GitHub Actions** auswählen. Danach kann der Workflow `Update sports data and deploy Pages` manuell gestartet werden und läuft zusätzlich einmal täglich.

## Geplante nächste Schritte

1. Tabellen-Grundansicht stabilisieren
2. F1 Best-/Worst-Case-Szenarien
3. Fußball Best-/Worst-Case-Szenarien (zunächst iterativ pro Spieltag)
4. Detailansichten je Wettbewerb
5. später optional: F2, F3, DFB-Pokal, CL-K.-o.-Phase, Premier League

## Seiten

`index.html` und `details.html` liegen im Repository-Root. Der Pages-Workflow kopiert beim Build alle Root-HTML-Dateien nach `public/`, sodass CSS/JS/Daten weiterhin relativ aus `public/` geladen werden.

## Layout-Update v4

- F1: Fahrer-WM links, letztes Rennergebnis mittig, nächstes Rennen rechts oben und Konstrukteurs-WM rechts darunter.
- F1-Rennergebnisse bleiben bei langen Fahrer-/Teamnamen einzeilig.
- Fußball: Tabelle, letzter, aktueller und nächster Spieltag werden nebeneinander dargestellt.
- Vereinsnamen in den Spieltagslisten bleiben einzeilig; bei Platzmangel werden sie gekürzt dargestellt und sind per Hover vollständig lesbar.

## F1-Saisonarchiv und Detailansicht

- Die Detailansicht unter `details.html` lädt pro ausgewähltem Jahr eine Datei aus `public/data/f1/<jahr>.json`.
- Abgeschlossene Saisons ab 1950 werden einmalig importiert und dauerhaft ins Repository eingecheckt. Um API-Limits zu schonen, werden pro täglichem Lauf maximal 10 noch fehlende Saisons importiert, neueste zuerst; mit `F1_HISTORY_BATCH` lässt sich das Limit ändern.
- Die laufende Saison wird über den Kalender überwacht. Neue Grand-Prix- und Sprintergebnisse werden nach ihrer Fälligkeit nachgetragen. Die letzten beiden Rennwochenenden werden für nachträgliche Korrekturen bis 15 Tage überprüft.
- GitHub Actions schreibt das Archiv nach dem Abruf auf `main` zurück. Fehlende Ergebnisse werden am Folgetag erneut probiert.
- Alte Wertungssysteme enthielten Streichresultate. Die Punktkurve zeigt dann erzielte Rennpunkte, während die offiziellen WM-Endpunkte aus der API stammen.

## Bundesliga-Detailseiten (1., 2. und 3. Liga)

- In jeder der drei Bundesligakarten führt **Liga-Details** zur `football-details.html?league=<liga-id>`.
- Saisonauswahl und Ligawechsel erfolgen auf der gemeinsamen Detailseite. Die Dateien liegen unter `public/data/football/<liga-id>/<startjahr>.json` (mit `seasons.json` pro Liga).
- Mannschaften können in Tabelle, Punkteverlauf und Spieltagsmatrix gemeinsam ausgewählt und hervorgehoben werden; die Diagrammlinien lassen sich einzeln an- oder abwählen.
- Die Spieltagsmatrix zeigt 3/1/0 Punkte pro Verein und Spieltag, einen Punkt für einen noch offenen Termin sowie einen Strich für fehlende Begegnungen. Ein Klick auf die Zelle öffnet den Gegner, Heim-/Auswärtsspiel, Ergebnis und Datum.
- Best-/Worst-Werte stellen vorerst **äußere mathematische Ranggrenzen** dar. Eine exakte kombinatorische Prüfung aller möglichen Restspiel-Ergebnisse ist ausdrücklich noch nicht implementiert.
- Einmalig verfügbare historische Saisons werden aus dem OpenLigaDB-Ligakatalog ermittelt und inkrementell importiert, standardmäßig höchstens zwei Saisons **je Bundesliga und Workflow-Lauf**. `FOOTBALL_HISTORY_BATCH` steuert die Anzahl (0 bis 8).
- Die laufende Saison wird aus dem Kalender abgeleitet (August bis Juli). Der Saisonspielplan wird wöchentlich abgeglichen. Fällige Spieltage und jüngste mögliche Korrekturen werden gezielt geladen, sonst werden gespeicherte Spielstände wiederverwendet. OpenLigaDBs Änderungsdatum hilft, unnötige vollständige Spieltagsabfragen zu vermeiden.
- GitHub Actions persistiert die Saisonarchive für F1 und Bundesliga ins Repository. Die Champions League behält zunächst ihre bestehende Datenaufbereitung und Übersichtsansicht.
- Das historische Angebot ist auf tatsächlich bei OpenLigaDB verfügbare und mit Ergebnissen gefüllte Spielzeiten begrenzt; ältere Saisons erscheinen erst nach Abschluss des jeweiligen Backfills.
- Bei historischen Punktabzügen oder nachträglichen Ligastrafen kann die offizielle Tabelle von der aus einzelnen Spielen errechneten Punktekurve abweichen. Die Tabelle verwendet soweit verfügbar die von OpenLigaDB gelieferte Abschlusstabelle.
