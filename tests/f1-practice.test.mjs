import test from 'node:test';
import assert from 'node:assert/strict';
import {
  practiceType, qualifyingType, matchPracticeRace, matchSessionRace,
  normalizePracticeResults, normalizeQualifyingResults, updatePracticeSeason
} from '../scripts/f1/practice.mjs';

const races = [
  { round: 1, date: '2026-03-08T04:00:00Z', country: 'Australia', locality: 'Melbourne' },
  { round: 2, date: '2026-03-15T07:00:00Z', country: 'China', locality: 'Shanghai', sprintDate: '2026-03-14T03:00:00Z' },
  { round: 3, date: '2026-05-03T19:00:00Z', country: 'USA', locality: 'Miami' },
  { round: 4, date: '2026-10-18T19:00:00Z', country: 'USA', locality: 'Austin' }
];
const practice = (date, country, name = 'Practice 1', key = 100) => ({
  year: 2026, meeting_key: 6, session_key: key, date_start: date,
  date_end: date, country_name: country, session_name: name,
  session_type: 'Practice', is_cancelled: false
});

test('matches Practice 1/2/3 and excludes sprint qualifying', () => {
  assert.equal(practiceType(practice('2026-03-06T01:00:00Z', 'Australia')), 'FP1');
  assert.equal(practiceType(practice('2026-03-06T01:00:00Z', 'Australia', 'Practice 2')), 'FP2');
  assert.equal(practiceType(practice('2026-03-06T01:00:00Z', 'Australia', 'Free Practice 3')), 'FP3');
  assert.equal(practiceType(practice('2026-03-06T01:00:00Z', 'Australia', 'Sprint Qualifying')), null);
});
test('matches date and country even for three USA races in one year', () => {
  assert.equal(matchPracticeRace(practice('2026-05-01T18:00:00Z', 'United States'), races)?.round, 3);
  assert.equal(matchPracticeRace(practice('2026-10-16T18:00:00Z', 'United States'), races)?.round, 4);
  assert.equal(matchPracticeRace(practice('2026-03-06T01:00:00Z', 'Mexico'), races), null);
  assert.equal(matchPracticeRace(practice('2026-04-01T01:00:00Z', 'Australia'), races), null);
  assert.equal(matchPracticeRace({ ...practice('2026-03-06T01:00:00Z', 'Australia'), is_cancelled: true }, races), null);
});
test('normalizes official practice classification and driver identities', () => {
  const entries = normalizePracticeResults(
    [
      { driver_number: 63, position: 2, duration: 78.2, gap_to_leader: 0.635, number_of_laps: 20 },
      { driver_number: 16, position: 1, duration: 77.565, gap_to_leader: 0, number_of_laps: 19 },
      { driver_number: 7, position: null, duration: null, gap_to_leader: null, number_of_laps: 0 }
    ],
    [
      { driver_number: 63, name_acronym: 'RUS', last_name: 'Russell' },
      { driver_number: 16, name_acronym: 'LEC', last_name: 'Leclerc' },
      { driver_number: 7, name_acronym: 'NEW', full_name: 'Test Driver' }
    ],
    [
      { driverId: 'russell', name: 'George Russell', shortName: 'RUS', familyName: 'Russell' },
      { driverId: 'leclerc', name: 'Charles Leclerc', shortName: 'LEC', familyName: 'Leclerc' }
    ]
  );
  assert.equal(entries.length, 3);
  assert.equal(entries[0].driverId, 'leclerc');
  assert.equal(entries[1].driverId, 'russell');
  assert.equal(entries[1].gap, 0.635);
  assert.equal(entries[1].laps, 20);
  assert.equal(entries[2].driverId, 'openf1_7');
  assert.equal(entries[2].time, null);
});
test('2026 importer backfills available practice sessions once, but not future sessions', async () => {
  const calls = [];
  const sessions = [
    practice('2026-03-06T01:00:00Z', 'Australia', 'Practice 1', 101),
    practice('2026-03-06T04:00:00Z', 'Australia', 'Practice 2', 102),
    practice('2026-10-16T18:00:00Z', 'United States', 'Practice 1', 199)
  ];
  const fetchData = async url => {
    calls.push(url);
    if (url.includes('/sessions?')) return sessions;
    if (url.includes('/drivers?')) return [
      { driver_number: 63, name_acronym: 'RUS', full_name: 'George Russell' }
    ];
    if (url.includes('/session_result?')) return [
      { driver_number: 63, position: 1, duration: 80.3, gap_to_leader: 0, number_of_laps: 23 }
    ];
    throw new Error('Unexpected ' + url);
  };
  const sample = {
    year: 2026, updatedAt: '2026-03-01T00:00:00Z',
    drivers: [{ driverId: 'russell', name: 'George Russell', shortName: 'RUS' }],
    races
  };
  const now = Date.parse('2026-03-17T09:00:00Z');
  const first = await updatePracticeSeason(sample, { now, fetchData, pauseMs: 0 });
  assert.equal(first.races[0].practiceSessions.FP1.results[0].driverId, 'russell');
  assert.equal(first.races[0].practiceSessions.FP2.results[0].laps, 23);
  assert.equal(first.races[1].practiceSessions, undefined);
  assert.equal(first.races[3].practiceSessions, undefined);
  assert.equal(calls.filter(url => url.includes('/drivers?')).length, 1);
  const firstResultCalls = calls.filter(url => url.includes('/session_result?')).length;
  const second = await updatePracticeSeason(first, { now, fetchData, pauseMs: 0 });
  assert.equal(calls.filter(url => url.includes('/session_result?')).length, firstResultCalls);
  assert.strictEqual(second, first);
  assert.equal(sample.races[0].practiceSessions, undefined);
});
test('only 2026 practice data are enabled for the initial rollout', async () => {
  const saved = { year: 2025, races };
  assert.strictEqual(await updatePracticeSeason(saved, {
    fetchData: () => { throw new Error('should not fetch'); }
  }), saved);
});


test('qualifying and sprint qualifying are separate session types', () => {
  assert.equal(qualifyingType({ session_name: 'Qualifying' }), 'Qualifying');
  assert.equal(qualifyingType({ session_name: 'Sprint Qualifying' }), 'Sprint-Qualifying');
  assert.equal(qualifyingType({ session_name: 'Sprint Shootout' }), 'Sprint-Qualifying');
  assert.equal(qualifyingType({ session_name: 'Practice 1' }), null);
});

test('matches the Malaysia-hosted Bahrain meeting by actual circuit location', () => {
  const malaysiaRace = {
    round: 16, date: '2026-10-04T07:00:00Z',
    country: 'Malaysia', locality: 'Kuala Lumpur'
  };
  const practiceSession = {
    session_name: 'Practice 1', date_start: '2026-10-02T03:00:00Z',
    country_name: 'Bahrain', location: 'Kuala Lumpur'
  };
  const qualifyingSession = { ...practiceSession, session_name: 'Qualifying' };
  assert.equal(matchPracticeRace(practiceSession, [malaysiaRace])?.round, 16);
  assert.equal(matchSessionRace(qualifyingSession, [malaysiaRace])?.round, 16);
  assert.equal(matchSessionRace({ ...qualifyingSession, location: 'Sakhir' }, [malaysiaRace]), null);
});

test('qualifying normalization keeps true Q1/Q2/Q3 durations and classification', () => {
  const results = normalizeQualifyingResults([
    { driver_number: 63, position: 2, duration: [79.201, 78.555, 78.300],
      gap_to_leader: [0.5, 0.23, 0.11], number_of_laps: 21 },
    { driver_number: 16, position: 1, duration: [78.701, 78.325, 78.190],
      gap_to_leader: [0, 0, 0], number_of_laps: 23 },
    { driver_number: 3, position: 16, duration: [81.3, null, null],
      gap_to_leader: [0.67, null, null], number_of_laps: 8 },
    { driver_number: 5, position: null, duration: [null, null, null],
      dns: true, number_of_laps: 0 }
  ], [
    { driver_number: 63, name_acronym: 'RUS', last_name: 'Russell' },
    { driver_number: 16, name_acronym: 'LEC', last_name: 'Leclerc' }
  ], [
    { driverId: 'russell', shortName: 'RUS', name: 'George Russell' },
    { driverId: 'leclerc', shortName: 'LEC', name: 'Charles Leclerc' }
  ]);
  assert.equal(results.length, 4);
  assert.deepEqual(results.slice(0, 2).map(x => x.driverId), ['leclerc', 'russell']);
  assert.deepEqual([results[0].q1, results[0].q2, results[0].q3], [78.701, 78.325, 78.19]);
  assert.deepEqual([results[2].q1, results[2].q2, results[2].q3], [81.3, null, null]);
  assert.equal(results[3].position, null);
  assert.equal(results[3].status, 'DNS');
});

test('qualifying importer stores both regular and sprint results while respecting FP data', async () => {
  const calls = [];
  const events = [
    { ...practice('2026-03-06T01:00:00Z', 'Australia', 'Practice 1', 101), meeting_key: 10 },
    { ...practice('2026-03-07T05:00:00Z', 'Australia', 'Qualifying', 110), meeting_key: 10,
      session_type: 'Qualifying' },
    { ...practice('2026-03-13T07:30:00Z', 'China', 'Sprint Qualifying', 210), meeting_key: 20,
      session_type: 'Qualifying' },
    { ...practice('2026-03-14T07:00:00Z', 'China', 'Qualifying', 220), meeting_key: 20,
      session_type: 'Qualifying' },
    { ...practice('2026-10-16T18:00:00Z', 'United States', 'Qualifying', 440), meeting_key: 40,
      session_type: 'Qualifying' }
  ];
  const mockFetch = async url => {
    calls.push(url);
    if (url.includes('/sessions?')) return events;
    if (url.includes('/drivers?')) return [
      { driver_number: 63, name_acronym: 'RUS', last_name: 'Russell' }
    ];
    if (url.includes('/session_result?')) {
      if (url.includes('session_key=101')) return [
        { driver_number: 63, position: 1, duration: 90.5, number_of_laps: 20 }
      ];
      return [{ driver_number: 63, position: 1,
        duration: [90.1, 89.5, 89.0], gap_to_leader: [0, 0, 0], number_of_laps: 18 }];
    }
    throw new Error('Unexpected URL ' + url);
  };
  const sample = {
    year: 2026, drivers: [{ driverId: 'russell', name: 'George Russell', shortName: 'RUS' }],
    races, updatedAt: '2026-03-01'
  };
  const now = Date.parse('2026-03-18T12:00:00Z');
  const saved = await updatePracticeSeason(sample, { now, fetchData: mockFetch, pauseMs: 0 });
  assert.equal(saved.races[0].qualifyingSessions.Qualifying.results[0].q3, 89);
  assert.equal(saved.races[1].qualifyingSessions['Sprint-Qualifying'].results[0].position, 1);
  assert.equal(saved.races[1].qualifyingSessions.Qualifying.results[0].q1, 90.1);
  assert.equal(saved.races[0].practiceSessions.FP1.results[0].time, 90.5);
  assert.equal(saved.races[3].qualifyingSessions, undefined);
  const count = calls.filter(x => x.includes('/session_result?')).length;
  await updatePracticeSeason(saved, { now, fetchData: mockFetch, pauseMs: 0 });
  assert.equal(calls.filter(x => x.includes('/session_result?')).length, count);
});
