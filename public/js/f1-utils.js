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
