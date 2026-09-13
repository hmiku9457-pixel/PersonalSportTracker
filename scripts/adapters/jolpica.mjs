import { fetchJson } from '../lib/http.mjs';

const BASE_URL = 'https://api.jolpi.ca/ergast/f1';
const JSON_QUERY = 'limit=100&format=json';

function standingsList(payload) {
  return payload?.MRData?.StandingsTable?.StandingsLists?.[0] ?? {};
}

function racesList(payload) {
  return payload?.MRData?.RaceTable?.Races ?? [];
}

function eventDateTime(event) {
  if (!event?.date) return null;
  return `${event.date}T${event.time ?? '00:00:00Z'}`;
}

function driverName(driver) {
  return `${driver?.givenName ?? ''} ${driver?.familyName ?? ''}`.trim();
}

function normalizeRaceResult(result) {
  return {
    position: Number(result.position),
    driverId: result.Driver?.driverId ?? '',
    driverName: driverName(result.Driver),
    shortName: result.Driver?.code ?? result.Driver?.familyName ?? '',
    familyName: result.Driver?.familyName ?? '',
    constructorId: result.Constructor?.constructorId ?? '',
    constructorName: result.Constructor?.name ?? '',
    points: Number(result.points ?? 0),
    status: result.status ?? null
  };
}

function normalizeScheduledRace(race) {
  if (!race) return null;

  return {
    id: `${race.season}-${race.round}`,
    round: Number(race.round),
    name: race.raceName,
    date: eventDateTime(race),
    circuit: race.Circuit?.circuitName ?? null,
    locality: race.Circuit?.Location?.locality ?? null,
    country: race.Circuit?.Location?.country ?? null,
    hasSprint: Boolean(race.Sprint),
    sprintDate: race.Sprint ? eventDateTime(race.Sprint) : null
  };
}

export async function fetchF1Competition(competition) {
  const [driversPayload, constructorsPayload, racesPayload, lastResultsPayload] = await Promise.all([
    fetchJson(`${BASE_URL}/current/driverstandings/?${JSON_QUERY}`),
    fetchJson(`${BASE_URL}/current/constructorstandings/?${JSON_QUERY}`),
    fetchJson(`${BASE_URL}/current/races/?${JSON_QUERY}`),
    fetchJson(`${BASE_URL}/current/last/results/?${JSON_QUERY}`)
  ]);

  const driverList = standingsList(driversPayload).DriverStandings ?? [];
  const constructorList = standingsList(constructorsPayload).ConstructorStandings ?? [];
  const races = racesList(racesPayload);
  const lastRaceRaw = racesList(lastResultsPayload)[0] ?? null;
  const lastRaceResults = (lastRaceRaw?.Results ?? []).map(normalizeRaceResult);
  const lastCompletedRound = Number(lastRaceRaw?.round ?? 0);
  const now = Date.now();

  const currentConstructorByDriver = new Map(
    lastRaceResults.map(result => [result.driverId, result.constructorId])
  );

  const drivers = driverList.map(entry => {
    const historicalConstructorIds = (entry.Constructors ?? []).map(item => item.constructorId);
    return {
      driverId: entry.Driver.driverId,
      name: driverName(entry.Driver),
      shortName: entry.Driver.code ?? entry.Driver.familyName,
      familyName: entry.Driver.familyName,
      position: Number(entry.position),
      points: Number(entry.points),
      wins: Number(entry.wins ?? 0),
      constructorIds: historicalConstructorIds,
      currentConstructorId: currentConstructorByDriver.get(entry.Driver.driverId)
        ?? historicalConstructorIds.at(-1)
        ?? null
    };
  });

  const constructors = constructorList.map(entry => {
    const constructorId = entry.Constructor.constructorId;
    const latestRaceDrivers = lastRaceResults
      .filter(result => result.constructorId === constructorId)
      .map(result => result.familyName)
      .filter(Boolean);

    const fallbackDrivers = drivers
      .filter(driver => driver.currentConstructorId === constructorId)
      .map(driver => driver.familyName)
      .filter(Boolean);

    const currentDrivers = [...new Set([...latestRaceDrivers, ...fallbackDrivers])].slice(0, 2);

    return {
      constructorId,
      name: entry.Constructor.name,
      position: Number(entry.position),
      points: Number(entry.points),
      wins: Number(entry.wins ?? 0),
      currentDrivers
    };
  });

  const remainingEvents = [];

  for (const race of races) {
    if (race.Sprint) {
      const sprintTime = eventDateTime(race.Sprint);
      if (sprintTime && Date.parse(sprintTime) > now) {
        remainingEvents.push({
          id: `${race.season}-${race.round}-sprint`,
          round: Number(race.round),
          name: `${race.raceName} Sprint`,
          type: 'sprint',
          date: sprintTime
        });
      }
    }

    const raceTime = eventDateTime(race);
    if (raceTime && Date.parse(raceTime) > now) {
      remainingEvents.push({
        id: `${race.season}-${race.round}-race`,
        round: Number(race.round),
        name: race.raceName,
        type: 'race',
        date: raceTime
      });
    }
  }

  remainingEvents.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const nextRaceRaw = races
    .filter(race => Number(race.round) > lastCompletedRound)
    .sort((a, b) => Number(a.round) - Number(b.round))[0] ?? null;

  return {
    competition: {
      id: competition.id,
      name: competition.name,
      sport: 'motorsport',
      season: Number(races[0]?.season ?? new Date().getUTCFullYear()),
      source: 'Jolpica F1',
      lastUpdated: new Date().toISOString()
    },
    pointsSystem: {
      race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
      sprint: [8, 7, 6, 5, 4, 3, 2, 1]
    },
    drivers,
    constructors,
    lastRace: lastRaceRaw ? {
      round: Number(lastRaceRaw.round),
      name: lastRaceRaw.raceName,
      date: eventDateTime(lastRaceRaw),
      results: lastRaceResults
    } : null,
    nextRace: normalizeScheduledRace(nextRaceRaw),
    remainingEvents
  };
}
