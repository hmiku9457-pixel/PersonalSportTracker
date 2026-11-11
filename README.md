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
