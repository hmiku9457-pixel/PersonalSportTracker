import test from 'node:test';
import assert from 'node:assert/strict';
import {
  practiceType, matchPracticeRace, normalizePracticeResults, updatePracticeSeason
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
