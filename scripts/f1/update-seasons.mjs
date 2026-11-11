import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchCompleteSeason, updateCurrentSeason, toOverview } from './season.mjs';

const BEGIN = 1950;
const file = (root, year) => join(root, year + '.json');
async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function saveIfChanged(path, data) {
  const next = JSON.stringify(data, null, 2) + '\n';
  const previous = await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (previous === next) return false;
  await writeFile(path, next);
  return true;
}
export async function refreshF1Archive({ dataDir, competition, year = new Date().getUTCFullYear() }) {
  const directory = join(dataDir, 'f1');
  await mkdir(directory, { recursive: true });
  const currentPath = file(directory, year);
  const saved = await readJson(currentPath);
  let season;
  try {
    season = await updateCurrentSeason(saved, year);
    await saveIfChanged(currentPath, season);
  } catch (error) {
    if (!saved) throw error;
    console.warn('F1 season update failed; preserving last stored season:', error.message);
    season = saved;
  }

  // A bounded, resumable, one-time import. Newest years appear first.
  // Once imported, a historical season is never fetched during normal updates.
  const limit = Math.max(0, Math.min(25, Number(process.env.F1_HISTORY_BATCH ?? 10) || 0));
  let imported = 0;
  for (let historicalYear = year - 1; historicalYear >= BEGIN && imported < limit; historicalYear--) {
    if (await readJson(file(directory, historicalYear))) continue;
    try {
      console.log('Importing historic F1 season ' + historicalYear);
      const history = await fetchCompleteSeason(historicalYear, { pause: 550 });
      if (!history.races.length || !history.races.some(r => r.results?.length)) {
        console.warn('No completed races found for ' + historicalYear + ', keeping it pending.');
        break;
      }
      await saveIfChanged(file(directory, historicalYear), history);
      imported++;
    } catch (error) {
      console.warn('Historical F1 import paused at ' + historicalYear + ': ' + error.message);
      break; // retry on the next scheduled workflow
    }
  }

  const stored = (await readdir(directory))
    .filter(name => /^\d{4}\.json$/.test(name))
    .map(name => Number(name.slice(0, 4)))
    .sort((a, b) => b - a);
  await saveIfChanged(join(directory, 'seasons.json'), {
    currentSeason: year,
    available: stored,
    historicalImportComplete: stored.filter(y => y < year).length >= year - BEGIN
  });
  return toOverview(season, competition);
}
