import { fetchJson } from '../lib/http.mjs';

const BASE = 'https://api.openf1.org/v1';
const DAY = 86_400_000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timestamp = value => Date.parse(value || '') || 0;

const COUNTRY_ALIASES = {
  usa: 'united states', us: 'united states', 'united states of america': 'united states',
  uk: 'united kingdom', 'great britain': 'united kingdom',
  uae: 'united arab emirates', 'abu dhabi': 'united arab emirates',
  brasil: 'brazil', 'the netherlands': 'netherlands'
};
function normalizedCountry(value) {
  const country = String(value || '').trim().toLowerCase();
  return COUNTRY_ALIASES[country] || country;
}
export function practiceType(session) {
  const match = String(session?.session_name || '').match(/^(?:Free\s+)?Practice\s*([123])$/i);
  return match ? 'FP' + match[1] : null;
}

/** Map session to a known Jolpica race; never use a session from another country. */
export function matchPracticeRace(session, races) {
  const start = timestamp(session?.date_start);
  if (!start || !practiceType(session) || session?.is_cancelled) return null;
  const country = normalizedCountry(session.country_name);
  const candidates = (races || []).filter(race => {
    const delta = timestamp(race.date) - start;
    if (delta < -DAY || delta > 6 * DAY) return false;
    return !country || country === normalizedCountry(race.country);
  }).sort((a, b) => Math.abs(timestamp(a.date) - start) - Math.abs(timestamp(b.date) - start));
  return candidates[0] || null;
}
const cleanName = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z]/g, '');

export function normalizePracticeResults(raw, driverInfo = [], standingDrivers = []) {
  const info = new Map(driverInfo.map(d => [Number(d.driver_number), d]));
  const byCode = new Map(standingDrivers.filter(d => d.shortName)
    .map(d => [String(d.shortName).toUpperCase(), d]));
  const byName = new Map(standingDrivers.filter(d => d.familyName)
    .map(d => [cleanName(d.familyName), d]));
  const results = [];
  const seen = new Set();
  for (const row of raw || []) {
    const car = Number(row.driver_number);
    if (!Number.isFinite(car) || seen.has(car)) continue;
    seen.add(car);
    const personal = info.get(car) || {};
    const code = String(personal.name_acronym || '').toUpperCase();
    const known = byCode.get(code) || byName.get(cleanName(personal.last_name));
    const duration = Number(row.duration);
    const position = Number(row.position);
    const gap = row.gap_to_leader;
    results.push({
      driverId: known?.driverId || 'openf1_' + car,
      name: known?.name || personal.full_name || personal.broadcast_name || 'Fahrer #' + car,
      shortName: known?.shortName || code || String(car),
      driverNumber: car,
      position: Number.isInteger(position) && position > 0 ? position : null,
      time: Number.isFinite(duration) && duration > 0 ? duration : null,
      gap: typeof gap === 'number' && Number.isFinite(gap) ? gap :
        typeof gap === 'string' && gap.trim() ? gap.trim() : null,
      laps: Number.isInteger(Number(row.number_of_laps)) ? Number(row.number_of_laps) : null
    });
  }
  return results.sort((a, b) =>
    (a.position ?? 999) - (b.position ?? 999) ||
    (a.time ?? Infinity) - (b.time ?? Infinity));
}

/**
 * Only 2026 is enabled for this first rollout. Snapshot all already completed
 * sessions once; afterwards fetch only new results and recent corrections.
 * A failed OpenF1 call never overwrites previously stored results.
 */
export async function updatePracticeSeason(saved, {
  now = Date.now(), fetchData = fetchJson, pauseMs = 1150,
  maxSessions = Number(process.env.F1_PRACTICE_BATCH ?? 85)
} = {}) {
  if (saved.year !== 2026) return saved;
  const season = structuredClone(saved);
  let changed = false;
  const request = async (resource, query) => {
    if (pauseMs) await pause(pauseMs);
    return fetchData(BASE + '/' + resource + '?' + new URLSearchParams(query));
  };

  const calendar = await request('sessions', { year: season.year, session_type: 'Practice' });
  if (!Array.isArray(calendar)) throw new Error('OpenF1: practice session list is not an array.');
  const entries = calendar.map(session => ({
    session, type: practiceType(session),
    race: matchPracticeRace(session, season.races)
  })).filter(entry => entry.type && entry.race && entry.session.session_key);

  // Best effort for sessions whose older source misclassifies session_type.
  if (!entries.length && season.races.some(r => timestamp(r.date) < now)) {
    throw new Error('OpenF1: no practice sessions matched the 2026 calendar.');
  }

  const rosterCache = new Map();
  let fetched = 0, imported = 0, errors = 0;
  for (const { session, race, type } of entries.sort((a, b) =>
    timestamp(a.session.date_start) - timestamp(b.session.date_start))) {
    const start = timestamp(session.date_end) || timestamp(session.date_start);
    if (!start || now < start + 4 * 60 * 60_000) continue;
    const target = season.races.find(r => r.round === race.round);
    const existing = target.practiceSessions?.[type];
    const previousCheck = timestamp(existing?.checkedAt);
    const hasResult = Boolean(existing?.results?.length);
    const withinCorrections = now - start < 14 * DAY;
    if (hasResult && !withinCorrections) continue;
    if (previousCheck && now - previousCheck < DAY) continue;
    if (!hasResult && (existing?.attempts || 0) >= 3 && !withinCorrections) continue;
    if (fetched >= Math.max(0, maxSessions)) break;
    fetched++;

    let data;
    try {
      data = await request('session_result', { session_key: session.session_key });
    } catch (error) {
      errors++;
      console.warn('OpenF1 practice ' + season.year + '/' + race.round + '/' + type +
        ' temporarily unavailable: ' + error.message);
      continue;
    }
    if (!Array.isArray(data)) continue;
    let roster = rosterCache.get(session.meeting_key);
    if (!roster && data.length) {
      try {
        roster = await request('drivers', { meeting_key: session.meeting_key });
        if (!Array.isArray(roster)) roster = [];
        rosterCache.set(session.meeting_key, roster);
      } catch (error) {
        console.warn('OpenF1 driver lookup failed for ' + session.meeting_key + ': ' + error.message);
        roster = [];
      }
    }
    const normalized = normalizePracticeResults(data, roster || [], season.drivers);
    const next = {
      sessionKey: Number(session.session_key),
      date: session.date_start,
      source: 'OpenF1',
      results: normalized.length ? normalized : null,
      attempts: normalized.length ? 0 : (existing?.attempts || 0) + 1,
      checkedAt: new Date(now).toISOString()
    };
    if (!target.practiceSessions) target.practiceSessions = {};
    target.practiceSessions[type] = next;
    changed = true;
    if (normalized.length) imported++;
  }
  if (changed) season.updatedAt = new Date(now).toISOString();
  console.log('OpenF1 2026 practice: ' + entries.length + ' sessions in calendar; ' +
    fetched + ' checked; ' + imported + ' result sets imported; ' + errors + ' errors.');
  return changed ? season : saved;
}
