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

/** Qualifying includes the regular and sprint classifications. */
export function qualifyingType(session) {
  const name = String(session?.session_name || '').trim().toLowerCase();
  if (name === 'qualifying') return 'Qualifying';
  if (name === 'sprint qualifying' || name === 'sprint shootout') return 'Sprint-Qualifying';
  return null;
}
const normalizeLocation = value => String(value || '').trim().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Match a session to a Jolpica GP by date and country OR its exact venue.
 * Some 2026 meetings use a different host-country label than the calendar
 * (e.g. Bahrain GP at Kuala Lumpur); location is decisive in those cases.
 */
export function matchSessionRace(session, races) {
  const start = timestamp(session?.date_start);
  if (!start || session?.is_cancelled || (!practiceType(session) && !qualifyingType(session))) return null;
  const country = normalizedCountry(session.country_name);
  const venue = normalizeLocation(session.location);
  const candidates = (races || []).filter(race => {
    const delta = timestamp(race.date) - start;
    if (delta < -DAY || delta > 6 * DAY) return false;
    const countryMatch = country && country === normalizedCountry(race.country);
    const place = normalizeLocation(race.locality);
    const venueMatch = venue && place && (venue === place || venue.includes(place) || place.includes(venue));
    return countryMatch || venueMatch || (!country && !venue);
  }).sort((a, b) => Math.abs(timestamp(a.date) - start) - Math.abs(timestamp(b.date) - start));
  return candidates[0] || null;
}
export function matchPracticeRace(session, races) {
  return practiceType(session) ? matchSessionRace(session, races) : null;
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

function bestTime(seconds) {
  const value = Number(seconds);
  return seconds !== null && seconds !== undefined && Number.isFinite(value) && value > 0
    ? value : null;
}

export function normalizeQualifyingResults(raw, driverInfo = [], standingDrivers = []) {
  // Use the same driver-number / acronym matching as FP sessions, including
  // reserve drivers absent from the official season points standings.
  const common = normalizePracticeResults((raw || []).map(row => ({
    ...row, duration: null, gap_to_leader: null
  })), driverInfo, standingDrivers);
  const original = new Map((raw || []).map(row => [Number(row.driver_number), row]));
  return common.map(driver => {
    const item = original.get(driver.driverNumber) || {};
    const durations = Array.isArray(item.duration) ? item.duration : [item.duration];
    const gaps = Array.isArray(item.gap_to_leader)
      ? item.gap_to_leader : [item.gap_to_leader];
    return {
      ...driver,
      q1: bestTime(durations[0]),
      q2: bestTime(durations[1]),
      q3: bestTime(durations[2]),
      q1gap: typeof gaps[0] === 'number' ? gaps[0] : null,
      q2gap: typeof gaps[1] === 'number' ? gaps[1] : null,
      q3gap: typeof gaps[2] === 'number' ? gaps[2] : null,
      status: item.dsq ? 'DSQ' : item.dns ? 'DNS' : item.dnf ? 'DNF' : null
    };
  });
}

function rosterFromPractice(race) {
  const byNumber = new Map();
  for (const session of Object.values(race.practiceSessions || {})) {
    for (const driver of session.results || []) {
      if (driver.driverNumber) byNumber.set(Number(driver.driverNumber), {
        driver_number: driver.driverNumber,
        name_acronym: driver.shortName,
        full_name: driver.name,
        last_name: String(driver.name || '').split(' ').at(-1)
      });
    }
  }
  return [...byNumber.values()];
}

/**
 * Only 2026 is enabled for this first rollout. Snapshot all already completed
 * sessions once; afterwards fetch only new results and recent corrections.
 * A failed OpenF1 call never overwrites previously stored results.
 */
export async function updatePracticeSeason(saved, {
  now = Date.now(), fetchData = fetchJson, pauseMs = 2100,
  maxSessions = Number(process.env.F1_PRACTICE_BATCH ?? 85)
} = {}) {
  if (saved.year !== 2026) return saved;
  const season = structuredClone(saved);
  let changed = false;
  const request = async (resource, query) => {
    const url = BASE + '/' + resource + '?' + new URLSearchParams(query);
    for (let attempt = 0; ; attempt++) {
      if (pauseMs) await pause(pauseMs);
      try {
        return await fetchData(url);
      } catch (error) {
        // OpenF1's free tier is rate limited. Back off instead of losing an
        // entire FP result during the initial backfill; a 404 is not retried.
        if (!/\b429\b/.test(String(error.message)) || attempt >= 2) throw error;
        const delay = 30_000 * (attempt + 1);
        console.warn('OpenF1 rate limit reached; retrying in ' + delay / 1000 + 's.');
        await pause(delay);
      }
    }
  };

  const calendar = await request('sessions', { year: season.year });
  if (!Array.isArray(calendar)) throw new Error('OpenF1: session list is not an array.');
  const entries = calendar.map(session => ({
    session,
    type: practiceType(session) || qualifyingType(session),
    race: matchSessionRace(session, season.races)
  })).filter(entry => entry.type && entry.race && entry.session.session_key);

  // Best effort for sessions whose older source misclassifies session_type.
  if (!entries.length && season.races.some(r => timestamp(r.date) < now)) {
    throw new Error('OpenF1: no FP/Qualifying sessions matched the 2026 calendar.');
  }

  const rosterCache = new Map();
  let fetched = 0, imported = 0, errors = 0;
  for (const { session, race, type } of entries.sort((a, b) =>
    // Qualifying and missing old FPs first. Vegas is deliberately lower priority.
    Number(a.race.locality === 'Las Vegas') - Number(b.race.locality === 'Las Vegas') ||
    timestamp(a.session.date_start) - timestamp(b.session.date_start))) {
    const start = timestamp(session.date_end) || timestamp(session.date_start);
    if (!start || now < start + 4 * 60 * 60_000) continue;
    const target = season.races.find(r => r.round === race.round);
    const isQualifying = type === 'Qualifying' || type === 'Sprint-Qualifying';
    const key = isQualifying ? 'qualifyingSessions' : 'practiceSessions';
    const existing = target[key]?.[type];
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
      console.warn('OpenF1 session ' + season.year + '/' + race.round + '/' + type +
        ' temporarily unavailable: ' + error.message);
      continue;
    }
    if (!Array.isArray(data)) continue;
    let roster = rosterCache.get(session.meeting_key);
    if (!roster && data.length) {
      roster = rosterFromPractice(target);
      if (!roster.length || roster.length < data.length - 2) {
        try {
          const fetchedDrivers = await request('drivers', { meeting_key: session.meeting_key });
          if (Array.isArray(fetchedDrivers) && fetchedDrivers.length) roster = fetchedDrivers;
        } catch (error) {
          console.warn('OpenF1 driver lookup failed for ' + session.meeting_key + ': ' + error.message);
        }
      }
      rosterCache.set(session.meeting_key, roster);
    }
    const normalized = isQualifying
      ? normalizeQualifyingResults(data, roster || [], season.drivers)
      : normalizePracticeResults(data, roster || [], season.drivers);
    const next = {
      sessionKey: Number(session.session_key),
      date: session.date_start,
      source: 'OpenF1',
      results: normalized.length ? normalized : null,
      attempts: normalized.length ? 0 : (existing?.attempts || 0) + 1,
      checkedAt: new Date(now).toISOString()
    };
    if (!target[key]) target[key] = {};
    target[key][type] = next;
    changed = true;
    if (normalized.length) imported++;
  }
  if (changed) season.updatedAt = new Date(now).toISOString();
  console.log('OpenF1 2026 FP/Qualifying: ' + entries.length + ' sessions in calendar; ' +
    fetched + ' checked; ' + imported + ' result sets imported; ' + errors + ' errors.');
  return changed ? season : saved;
}
