import { fetchJson } from '../lib/http.mjs';

const BASE = 'https://api.jolpi.ca/ergast/f1/';
const PAGE = 100;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const iso = () => new Date().toISOString();
const day = count => count * 24 * 60 * 60 * 1000;
const number = value => Number(value ?? 0);
const person = driver => ({
  driverId: driver?.driverId ?? '',
  name: [driver?.givenName, driver?.familyName].filter(Boolean).join(' '),
  familyName: driver?.familyName ?? '',
  shortName: driver?.code ?? driver?.familyName ?? ''
});

function normalizeResult(item) {
  return {
    ...person(item.Driver),
    position: number(item.position),
    positionText: item.positionText ?? String(item.position ?? ''),
    constructorId: item.Constructor?.constructorId ?? '',
    constructorName: item.Constructor?.name ?? '',
    points: number(item.points),
    status: item.status ?? null
  };
}

function normalizeRace(item) {
  return {
    round: number(item.round),
    name: item.raceName ?? '',
    date: item.date ? item.date + 'T' + (item.time ?? '00:00:00Z') : null,
    sprintDate: item.Sprint?.date
      ? item.Sprint.date + 'T' + (item.Sprint.time ?? '00:00:00Z')
      : null,
    circuit: item.Circuit?.circuitName ?? '',
    locality: item.Circuit?.Location?.locality ?? '',
    country: item.Circuit?.Location?.country ?? '',
    results: null,
    sprintResults: null
  };
}

function extractStandings(payload, kind) {
  return payload?.MRData?.StandingsTable?.StandingsLists?.[0]?.[kind] ?? [];
}

function normalizeStandings(payload, type) {
  if (type === 'drivers') {
    return extractStandings(payload, 'DriverStandings').map(item => ({
      ...person(item.Driver),
      position: number(item.position),
      points: number(item.points),
      wins: number(item.wins),
      constructorIds: (item.Constructors ?? []).map(c => c.constructorId)
    }));
  }
  return extractStandings(payload, 'ConstructorStandings').map(item => ({
    constructorId: item.Constructor?.constructorId ?? '',
    name: item.Constructor?.name ?? '',
    position: number(item.position),
    points: number(item.points),
    wins: number(item.wins)
  }));
}

// Jolpica paginates individual driver results, not entire race weekends.
// Merge pages on the round number to avoid losing partially split races.
async function fetchResultPages(year, endpoint, pause = 0) {
  const rounds = new Map();
  for (let offset = 0; ; offset += PAGE) {
    if (pause) await sleep(pause);
    const payload = await fetchJson(BASE + year + '/' + endpoint + '/?limit=' + PAGE + '&offset=' + offset);
    const mr = payload?.MRData ?? {};
    const key = endpoint === 'sprint' ? 'SprintResults' : 'Results';
    for (const race of mr.RaceTable?.Races ?? []) {
      const round = number(race.round);
      if (!rounds.has(round)) rounds.set(round, []);
      rounds.get(round).push(...(race[key] ?? []).map(normalizeResult));
    }
    const total = number(mr.total);
    if (offset + number(mr.limit || PAGE) >= total || !total) break;
  }
  return rounds;
}

async function fetchStandings(year, pause = 0) {
  if (pause) await sleep(pause);
  const drivers = await fetchJson(BASE + year + '/driverstandings/?limit=100');
  if (pause) await sleep(pause);
  const constructors = year >= 1958
    ? await fetchJson(BASE + year + '/constructorstandings/?limit=100')
    : null;
  return {
    drivers: normalizeStandings(drivers, 'drivers'),
    constructors: constructors ? normalizeStandings(constructors, 'constructors') : []
  };
}

export async function fetchCompleteSeason(year, { pause = 0 } = {}) {
  if (pause) await sleep(pause);
  const schedule = await fetchJson(BASE + year + '/races/?limit=100');
  const races = (schedule?.MRData?.RaceTable?.Races ?? []).map(normalizeRace);
  const raceResults = await fetchResultPages(year, 'results', pause);
  const sprintResults = year >= 2021 ? await fetchResultPages(year, 'sprint', pause) : new Map();
  const table = await fetchStandings(year, pause);
  for (const race of races) {
    if (raceResults.has(race.round)) race.results = raceResults.get(race.round);
    if (sprintResults.has(race.round)) race.sprintResults = sprintResults.get(race.round);
  }
  if (!races.length) throw new Error('Kein F1-Rennkalender fuer ' + year + ' gefunden.');
  return {
    schemaVersion: 1,
    year,
    complete: year < new Date().getUTCFullYear(),
    calendarCheckedAt: iso(),
    updatedAt: iso(),
    races,
    ...table
  };
}

// The scheduled workflow runs in the early morning UTC. A Sunday race
// should be polled Monday, rather than 24 hours after the starting time.
function nextDayCheckpoint(timestamp) {
  if (!timestamp) return NaN;
  return Date.parse(timestamp.slice(0, 10) + 'T00:00:00Z') + day(1) + 4 * 60 * 60 * 1000;
}
export function eventDue(timestamp, now) {
  const checkpoint = nextDayCheckpoint(timestamp);
  return Number.isFinite(checkpoint) && now >= checkpoint;
}

export function withinCorrectionWindow(timestamp, now) {
  const checkpoint = nextDayCheckpoint(timestamp);
  return Number.isFinite(checkpoint) && now >= checkpoint && now <= checkpoint + day(14);
}

function changedResults(oldResults, newResults) {
  return JSON.stringify(oldResults) !== JSON.stringify(newResults);
}

function latestTwoCompleted(races) {
  return new Set(races.filter(r => Array.isArray(r.results) && r.results.length)
    .sort((a, b) => b.round - a.round).slice(0, 2).map(r => r.round));
}

// Rechecks only missing results and the last two completed weekends for up to 14 days.
// Season content is persisted in Git, so failed API requests are retried the next day.
export async function updateCurrentSeason(saved, year, now = Date.now()) {
  if (!saved) return fetchCompleteSeason(year);
  if (saved.complete) return saved;
  const season = structuredClone(saved);
  let changed = false;
  let queried = false;

  if (!season.calendarCheckedAt || now - Date.parse(season.calendarCheckedAt) >= day(7)) {
    const payload = await fetchJson(BASE + year + '/races/?limit=100');
    const revised = (payload?.MRData?.RaceTable?.Races ?? []).map(normalizeRace);
    if (revised.length) {
      const existing = new Map(season.races.map(r => [r.round, r]));
      const merged = revised.map(r => ({
        ...r,
        results: existing.get(r.round)?.results ?? null,
        sprintResults: existing.get(r.round)?.sprintResults ?? null
      }));
      changed = changedResults(season.races, merged) || changed;
      season.races = merged;
    }
    season.calendarCheckedAt = new Date(now).toISOString();
    queried = true;
  }

  const recent = latestTwoCompleted(season.races);
  for (const race of season.races) {
    const raceDue = eventDue(race.date, now);
    const sprintDue = eventDue(race.sprintDate, now);
    const checkAgain = recent.has(race.round);
    const lastRaceCheck = race.raceCheckedAt ? Date.parse(race.raceCheckedAt) : 0;
    const lastSprintCheck = race.sprintCheckedAt ? Date.parse(race.sprintCheckedAt) : 0;
    if (raceDue && now - lastRaceCheck >= day(1) &&
        (!race.results?.length || (checkAgain && withinCorrectionWindow(race.date, now)))) {
      const payload = await fetchJson(BASE + year + '/' + race.round + '/results/?limit=100');
      const updated = (payload?.MRData?.RaceTable?.Races?.[0]?.Results ?? []).map(normalizeResult);
      if (updated.length && changedResults(race.results, updated)) {
        race.results = updated;
        changed = true;
      }
      race.raceCheckedAt = new Date(now).toISOString();
      queried = true;
    }
    if (sprintDue && now - lastSprintCheck >= day(1) &&
        (!race.sprintResults?.length || (checkAgain && withinCorrectionWindow(race.sprintDate, now)))) {
      const payload = await fetchJson(BASE + year + '/' + race.round + '/sprint/?limit=100');
      const updated = (payload?.MRData?.RaceTable?.Races?.[0]?.SprintResults ?? []).map(normalizeResult);
      if (updated.length && changedResults(race.sprintResults, updated)) {
        race.sprintResults = updated;
        changed = true;
      }
      race.sprintCheckedAt = new Date(now).toISOString();
      queried = true;
    }
  }

  if (changed) {
    const table = await fetchStandings(year);
    season.drivers = table.drivers;
    season.constructors = table.constructors;
    season.updatedAt = new Date(now).toISOString();
  }

  const last = season.races.at(-1);
  if (last && now > Date.parse(last.date) + day(16) &&
      season.races.every(r => r.results?.length && (!r.sprintDate || r.sprintResults?.length))) {
    season.complete = true;
  }
  return (changed || queried || season.complete !== saved.complete) ? season : saved;
}

export function toOverview(season, competition) {
  const drivers = season.drivers ?? [];
  const lastByDriver = new Map();
  for (const race of season.races) {
    for (const result of race.results ?? []) lastByDriver.set(result.driverId, result.constructorId);
  }
  const driverRows = drivers.map(driver => ({
    ...driver,
    currentConstructorId: lastByDriver.get(driver.driverId) ?? driver.constructorIds?.at(-1) ?? null
  }));
  const constructors = (season.constructors ?? []).map(team => ({
    ...team,
    currentDrivers: driverRows.filter(d => d.currentConstructorId === team.constructorId)
      .map(d => d.familyName).slice(0, 2)
  }));
  const completed = season.races.filter(r => r.results?.length);
  const latest = completed.at(-1);
  const now = Date.now();
  const upcoming = season.races.find(r => !r.results?.length && Date.parse(r.date) > now);
  const remainingEvents = season.races.flatMap(r => [
    ...(!r.sprintResults?.length && r.sprintDate && Date.parse(r.sprintDate) > now
      ? [{ id: season.year + '-' + r.round + '-sprint', round: r.round, name: r.name + ' Sprint', type: 'sprint', date: r.sprintDate }] : []),
    ...(!r.results?.length && Date.parse(r.date) > now
      ? [{ id: season.year + '-' + r.round + '-race', round: r.round, name: r.name, type: 'race', date: r.date }] : [])
  ]).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return {
    competition: {
      id: competition.id,
      name: competition.name,
      sport: 'motorsport',
      season: season.year,
      source: 'Jolpica F1',
      lastUpdated: season.updatedAt
    },
    pointsSystem: {
      race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
      sprint: [8, 7, 6, 5, 4, 3, 2, 1]
    },
    drivers: driverRows,
    constructors,
    lastRace: latest ? { round: latest.round, name: latest.name, date: latest.date, results: latest.results.map(r => ({
      ...r, driverName: r.name
    })) } : null,
    nextRace: upcoming ? {
      id: season.year + '-' + upcoming.round,
      round: upcoming.round,
      name: upcoming.name,
      date: upcoming.date,
      circuit: upcoming.circuit,
      locality: upcoming.locality,
      country: upcoming.country,
      hasSprint: Boolean(upcoming.sprintDate),
      sprintDate: upcoming.sprintDate
    } : null,
    remainingEvents
  };
}
