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

## Champions League – 36er-Ligaphase

- Der Button **Liga-Details** der Champions-League-Karte öffnet `football-details.html?league=champions-league`.
- Die Darstellung übernimmt Saisonauswahl, verknüpfte Teamauswahl, kumulierten Punkteverlauf, Spieltagsmatrix und Ergebnisdialoge der Bundesliga-Detailseiten. Die Ligatabelle zeigt Plätze 1–8 (direktes Achtelfinale), 9–24 (Playoffs) und 25–36 (ausgeschieden).
- **Ausschließlich Saisons ab 2024/25** werden archiviert: Frühere Spielzeiten hatten das alte Gruppenformat und benötigen eine gesonderte Ansicht.
- Der Import filtert die Phase nach Termin und Gruppenbezeichnung, ordnet die acht UEFA-Ligaspieltage auch bei abweichenden OpenLigaDB-Gruppen-IDs korrekt zu und überprüft, dass maximal 36 Vereine mit je acht Spielen und höchstens 18 Partien je Spieltag enthalten sind.
- Qualifikation sowie sämtliche K.-o.-Spiele (einschließlich K.-o.-Playoffs) bleiben außerhalb der Ligatabelle, der Punktekurve und der Spieltagsmatrix.
- Pro Saison wird `public/data/football/champions-league/<jahr>.json` gespeichert. Beim täglichen Durchlauf werden fällige oder kürzlich geänderte Ligaspieltage nachgetragen. Eine vollständige Kalenderprüfung erfolgt wöchentlich; abgeschlossene Ligaphasen werden nach der Korrekturfrist archiviert.
- Die historischen Ligaphasen ab 2024/25 werden mit höchstens zwei fehlenden Spielzeiten pro Lauf importiert (`UCL_HISTORY_BATCH` steuert die Anzahl). Nur vollständig importierte Ligaphasen werden dauerhaft als historische Saisons abgelegt.
- Wo die OpenLigaDB-Tabelle genau zu den 144 Ligaspielen passt, wird sie verwendet. Sonst wird die Tabelle anhand der Spielergebnisse und wesentlicher UEFA-Tie-Breaker berechnet; Disziplinarpunkte und UEFA-Klubkoeffizienten können dabei nicht zuverlässig rekonstruiert werden. Bei knappen Gleichständen kann die ermittelte Reihenfolge deshalb abweichen.
- Best ≥ / Worst ≤ zeigen in der Champions League **bewiesene äußere Ranggrenzen**, keine exakt erreichbaren Best-/Worst-Case-Endplätze. Für Worst wird neben den individuellen Restspielen auch das gemeinsame maximale Punktebudget sämtlicher verbleibender Spiele berücksichtigt (ein Spiel kann nicht gleichzeitig mehreren Mannschaften einen Sieg liefern). Die exakte kombinatorische Restspiel-Optimierung steht weiterhin aus.
- Während der Spieltage 1–7 werden punktgleiche Teams nach den ersten **fünf** UEFA-Tie-Breakern sortiert. Bleiben sie gleich, erhalten sie denselben Rang (Markierung `=`); überlappen solche Teams eine Qualifikationsgrenze (Platz 8 oder 24), bleibt die Zone bis zur Auflösung neutral. Nach der vollständigen Ligaphase gelten zusätzlich die Gegnerstatistiken sowie gegebenenfalls Disziplinarpunkte und Klubkoeffizienten.
- Für zwischengespeicherte Saisondateien wird die Tabelle auch im Browser und in der Übersicht nach den korrigierten Regeln neu berechnet, ohne historische Saisons erneut abrufen zu müssen.
