import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchJson } from '../lib/http.mjs';
import { fetchFootballSeason, updateFootballSeason, seasonOverview } from './season.mjs';

const BASE = 'https://api.openligadb.de';
const dayMs = 86400000;
const ID_MAP = { bundesliga: 'bl1', bundesliga2: 'bl2', liga3: 'bl3' };

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeChanged(path, data) {
  const next = JSON.stringify(data, null, 2) + '\n';
  let old = null;
  try { old = await readFile(path, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (old === next) return false;
  await writeFile(path, next);
  return true;
}
export async function getFootballArchiveCatalog(dataDir, now = Date.now()) {
  const root = join(dataDir, 'football');
  await mkdir(root, { recursive: true });
  const path = join(root, 'available.json');
  const old = await readJson(path);
  if (old && now - Date.parse(old.checkedAt) < 30 * dayMs) return old;

  try {
    const leagues = await fetchJson(BASE + '/getavailableleagues');
    if (!Array.isArray(leagues) || !leagues.length) throw Error('Empty league list');
    const byLeague = {};
    for (const id of Object.keys(ID_MAP)) {
      const shortcut = ID_MAP[id];
      byLeague[id] = [...new Set(leagues.filter(l =>
        l.leagueShortcut?.toLowerCase() === shortcut)
        .map(l => Number(l.leagueSeason))
        .filter(y => Number.isInteger(y) && y > 1900 && y <= new Date(now).getUTCFullYear()))]
        .sort((a,b) => b - a);
    }
    const next = { checkedAt: new Date(now).toISOString(), byLeague };
    await writeChanged(path, next);
    return next;
  } catch (error) {
    if (old) {
      console.warn('Using cached OpenLigaDB availability catalog:', error.message);
      return old;
    }
    throw error;
  }
}

export async function refreshFootballArchive({ dataDir, competition, currentYear, catalog }) {
  const root = join(dataDir, 'football', competition.id);
  await mkdir(root, { recursive: true });
  const now = Date.now();
  const seasonFile = join(root, currentYear + '.json');
  const saved = await readJson(seasonFile);
  let current;
  try {
    current = await updateFootballSeason(saved, competition, currentYear, now);
    if (!current) {
      // Before new-season fixtures are published, keep serving last season.
      const previous = await readJson(join(root, (currentYear - 1) + '.json'));
      if (!previous) throw Error('No matches available for current football season');
      current = previous;
    } else {
      await writeChanged(seasonFile, current);
    }
  } catch (error) {
    if (!saved) throw error;
    console.warn(competition.id + ': continuing with saved season after API failure: ' + error.message);
    current = saved;
  }

  const failuresPath = join(root, 'unavailable.json');
  const unavailable = await readJson(failuresPath) ?? { years: [] };
  const rejected = new Set(unavailable.years);
  const max = Math.max(0, Math.min(8, Number(process.env.FOOTBALL_HISTORY_BATCH ?? 2) || 0));
  let count = 0;
  const years = (catalog.byLeague[competition.id] ?? [])
    .filter(y => y < currentYear)
    .sort((a,b)=>b-a);
  for (const year of years) {
    if (count >= max) break;
    const target = join(root, year + '.json');
    if (await readJson(target) || rejected.has(year)) continue;
    try {
      console.log('Importing ' + competition.id + ' ' + year + '/' + (year + 1));
      const history = await fetchFootballSeason(competition, year, { historical: true, delay: 550 });
      if (history && history.matches.some(match => match.finished)) {
        await writeChanged(target, history);
      } else {
        rejected.add(year); // incomplete/unavailable historical source data
      }
      count++;
    } catch (error) {
      console.warn(competition.id + ' historical import paused: ' + error.message);
      break; // retry this season on the next scheduled run
    }
  }
  const rejectedList = [...rejected].sort((a,b)=>b-a);
  if (JSON.stringify(unavailable.years) !== JSON.stringify(rejectedList)) {
    await writeChanged(failuresPath, { years: rejectedList });
  }
  const files = await readdir(root);
  const stored = files.filter(f => /^\d{4}\.json$/.test(f))
    .map(f => Number(f.slice(0,4))).sort((a,b)=>b-a);
  await writeChanged(join(root, 'seasons.json'), {
    leagueId: competition.id,
    currentSeason: currentYear,
    available: stored,
    pending: years.filter(y => !stored.includes(y) && !rejected.has(y)).length
  });
  return seasonOverview(current, competition);
}
