// Shared pure calculations for the F1 detail view. No API calls in the browser.
export const asNumber = value => Number(value ?? 0);
export const totalWeekendPoints = (race, driverId) => {
  const raceResult = (race.results ?? []).find(item => item.driverId === driverId);
  const sprintResult = (race.sprintResults ?? []).find(item => item.driverId === driverId);
  if (!raceResult && !sprintResult) return null; // Did not participate
  return asNumber(raceResult?.points) + asNumber(sprintResult?.points);
};

export function allDrivers(season) {
  const byId = new Map();
  for (const driver of season.drivers ?? []) {
    byId.set(driver.driverId, { ...driver });
  }
  for (const race of season.races ?? []) {
    for (const item of [...(race.results ?? []), ...(race.sprintResults ?? [])]) {
      if (!byId.has(item.driverId)) {
        byId.set(item.driverId, {
          driverId: item.driverId, name: item.name,
          familyName: item.familyName, shortName: item.shortName,
          position: null, points: 0, constructorIds: []
        });
      }
      const driver = byId.get(item.driverId);
      if (item.constructorId) driver.currentConstructorId = item.constructorId;
    }
  }
  for (const driver of byId.values()) {
    driver.teamsThisSeason = driverTeamsByRace(season, driver.driverId);
    driver.currentConstructorId = driver.teamsThisSeason[0] ??
      driver.currentConstructorId ?? driver.constructorIds?.at(-1);
  }
  return [...byId.values()].sort((a, b) =>
    (a.position ?? 999) - (b.position ?? 999) || a.name.localeCompare(b.name, 'de'));
}

export function seriesFor(season, driverId) {
  let sum = 0;
  return (season.races ?? []).map((race, index) => {
    const points = totalWeekendPoints(race, driverId);
    if (points !== null) sum += points;
    return { round: race.round, index, points, cumulative: sum, race };
  });
}

export function remainingMaximum(season, constructor = false) {
  const raceMaximum = constructor ? 43 : 25;
  const sprintMaximum = constructor ? 15 : 8;
  return (season.races ?? []).reduce((total, race) =>
    total + (race.results?.length ? 0 : raceMaximum)
      + (!race.sprintDate || race.sprintResults?.length ? 0 : sprintMaximum), 0);
}

// These are safe outer *rank bounds*, not an exact simultaneous
// scheduling optimization. Never present them as attainable scenarios.
export function rankBounds(season, item, competitors, constructor = false) {
  const otherRows = competitors.filter(row =>
    (constructor ? row.constructorId : row.driverId) !==
    (constructor ? item.constructorId : item.driverId));
  const available = remainingMaximum(season, constructor);
  if (available === 0) return { best: Number(item.position) || null, worst: Number(item.position) || null, exact: true };
  const points = asNumber(item.points);
  const best = 1 + otherRows.filter(row => asNumber(row.points) > points + available).length;
  const worst = 1 + otherRows.filter(row => asNumber(row.points) + available >= points).length;
  return { best, worst: Math.max(best, worst), exact: false };
}

export function pointsRankAt(season, roundIndex, driverId, drivers) {
  const totals = drivers.map(driver => ({
    id: driver.driverId,
    points: seriesFor(season, driver.driverId)[roundIndex]?.cumulative ?? 0
  }));
  const own = totals.find(row => row.id === driverId)?.points ?? 0;
  return 1 + totals.filter(row => row.points > own).length;
}

/**
 * Distinct team IDs, most recent race participation first.
 * Only recorded Grand Prix / sprint-race appearances count; metadata is
 * consulted solely for drivers with no recorded race appearance this year.
 * A retirement still counts as a race start, a DNS/withdrawal does not.
 */
export function driverTeamsByRace(season, driverId) {
  const teams = [];
  const didStart = item => item?.constructorId &&
    !['W', 'D', 'F'].includes(String(item.positionText ?? '').toUpperCase()) &&
    !/did not start|did not qualify|not qualified|withdrawn|withdrew|failed to qualify|did not practice/i
      .test(String(item.status ?? ''));
  const record = item => {
    if (!didStart(item)) return;
    const index = teams.indexOf(item.constructorId);
    if (index !== -1) teams.splice(index, 1);
    teams.unshift(item.constructorId);
  };
  const races = [...(season.races ?? [])].sort((a, b) => Number(a.round) - Number(b.round));
  for (const race of races) {
    record(race.sprintResults?.find(item => item.driverId === driverId));
    record(race.results?.find(item => item.driverId === driverId));
  }
  if (teams.length) return teams;
  const driver = (season.drivers ?? []).find(item => item.driverId === driverId);
  return [...new Set(driver?.constructorIds ?? [])].reverse();
}

/** Championship gaps in points, independent of the ranking's tie-breaks. */
export function championshipGaps(items, index) {
  const points = asNumber(items[index]?.points);
  return {
    leader: index === 0 ? null : Math.max(0, asNumber(items[0]?.points) - points),
    previous: index === 0 ? null : Math.max(0, asNumber(items[index - 1]?.points) - points)
  };
}


/** Fictional session championships; this does not change official F1 points. */
export const FUN_SESSION_POINTS = Object.freeze([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
export const FUN_SESSION_TYPES = Object.freeze(['FP1', 'FP2', 'FP3', 'Qualifying']);

export function sessionResultsFor(race, type) {
  if (!FUN_SESSION_TYPES.includes(type)) return null;
  if (type === 'Qualifying') {
    // The Qualifying importer will populate this key in a later step.
    return race.qualifyingSessions?.Qualifying?.results ?? null;
  }
  // There is no second or third free practice during sprint weekends.
  if ((type === 'FP2' || type === 'FP3') && race.sprintDate) return null;
  return race.practiceSessions?.[type]?.results ?? null;
}

/**
 * Sum the usual GP points independently for each free-practice or qualifying
 * classification. Only imported, real sessions count; no synthetic times
 * and no points for absent participants. FP-only reserve drivers are included.
 * Ties are resolved by number of better session finishes, then by name.
 */
export function funSessionChampionship(season, type) {
  if (!FUN_SESSION_TYPES.includes(type)) throw new Error('Unknown F1 session: ' + type);
  const names = new Map((season.drivers ?? []).map(d => [d.driverId, d]));
  const byDriver = new Map();
  let completed = 0;
  let scheduled = 0;

  for (const race of season.races ?? []) {
    if (race.sprintDate && (type === 'FP2' || type === 'FP3')) continue;
    scheduled++;
    const results = sessionResultsFor(race, type);
    if (!Array.isArray(results) || !results.length) continue;
    completed++;
    const seen = new Set();

    for (const entry of results) {
      const id = String(entry.driverId ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const official = names.get(id);
      const position = Number(entry.position);
      const classified = Number.isInteger(position) && position > 0 ? position : null;
      const points = classified ? (FUN_SESSION_POINTS[classified - 1] ?? 0) : 0;
      if (!byDriver.has(id)) {
        byDriver.set(id, {
          driverId: id,
          name: official?.name || entry.name || id,
          shortName: official?.shortName || entry.shortName || '',
          currentConstructorId: official?.currentConstructorId ?? official?.constructorIds?.at(-1) ?? null,
          points: 0,
          starts: 0,
          wins: 0,
          finishes: []
        });
      }
      const driver = byDriver.get(id);
      driver.points += points;
      driver.starts++;
      if (classified === 1) driver.wins++;
      if (classified) driver.finishes[classified] = (driver.finishes[classified] || 0) + 1;
    }
  }

  const rows = [...byDriver.values()].sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    const positions = Math.max(a.finishes.length, b.finishes.length);
    for (let position = 1; position < positions; position++) {
      const delta = (b.finishes[position] || 0) - (a.finishes[position] || 0);
      if (delta) return delta;
    }
    return a.name.localeCompare(b.name, 'de');
  }).map((driver, index) => ({
    ...driver,
    position: index + 1,
    gapLeader: 0,
    gapPrevious: 0
  }));
  const leader = rows[0]?.points ?? 0;
  rows.forEach((driver, index) => {
    driver.gapLeader = leader - driver.points;
    driver.gapPrevious = index ? rows[index - 1].points - driver.points : 0;
  });
  return { type, scheduled, completed, rows };
}
