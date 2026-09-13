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

export async function fetchF1Competition(competition) {
  const [driversPayload, constructorsPayload, racesPayload] = await Promise.all([
    fetchJson(`${BASE_URL}/current/driverstandings/?${JSON_QUERY}`),
    fetchJson(`${BASE_URL}/current/constructorstandings/?${JSON_QUERY}`),
    fetchJson(`${BASE_URL}/current/races/?${JSON_QUERY}`)
  ]);

  const driverList = standingsList(driversPayload).DriverStandings ?? [];
  const constructorList = standingsList(constructorsPayload).ConstructorStandings ?? [];
  const races = racesList(racesPayload);
  const now = Date.now();

  const drivers = driverList.map(entry => ({
    driverId: entry.Driver.driverId,
    name: `${entry.Driver.givenName} ${entry.Driver.familyName}`,
    shortName: entry.Driver.code ?? entry.Driver.familyName,
    position: Number(entry.position),
    points: Number(entry.points),
    wins: Number(entry.wins ?? 0),
    constructorIds: (entry.Constructors ?? []).map(item => item.constructorId)
  }));

  const constructors = constructorList.map(entry => ({
    constructorId: entry.Constructor.constructorId,
    name: entry.Constructor.name,
    position: Number(entry.position),
    points: Number(entry.points),
    wins: Number(entry.wins ?? 0)
  }));

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
    remainingEvents
  };
}
