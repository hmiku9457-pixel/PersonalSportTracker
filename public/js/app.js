import { loadJson } from './data-loader.js';
import { createCompetitionCard } from './components/competition-card.js';

const grid = document.querySelector('#competition-grid');
const status = document.querySelector('#status');

async function start() {
  try {
    const manifest = await loadJson('./data/manifest.json');

    if (!manifest.competitions.length) {
      status.textContent = 'Noch keine Sportdaten vorhanden. Führe zuerst das Update-Skript aus.';
      return;
    }

    const results = await Promise.all(
      manifest.competitions.map(async meta => ({
        meta,
        data: await loadJson(`./${meta.file}`)
      }))
    );

    grid.replaceChildren(...results.map(({ meta, data }) => createCompetitionCard(meta, data)));
    status.textContent = `Daten zuletzt erzeugt: ${new Date(manifest.generatedAt).toLocaleString('de-DE')}`;
  } catch (error) {
    console.error(error);
    status.textContent = 'Sportdaten konnten nicht geladen werden.';
  }
}

start();
