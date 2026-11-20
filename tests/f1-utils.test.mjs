import test from 'node:test';
import assert from 'node:assert/strict';
import { totalWeekendPoints, seriesFor, rankBounds, allDrivers, driverTeamsByRace, championshipGaps, FUN_SESSION_POINTS, funSessionChampionship, sessionResultsFor } from '../public/js/f1-utils.js';
import { eventDue, withinCorrectionWindow } from '../scripts/f1/season.mjs';

const drivers = [
  { driverId: 'a', name: 'A', position: 1, points: 33 },
  { driverId: 'b', name: 'B', position: 2, points: 25 }
];
const completed = {
  round: 1, name: 'Grand Prix 1', date: '2026-11-15T15:00:00Z',
  sprintDate: '2026-11-14T14:00:00Z',
  results: [{ driverId: 'a', points: 25 }, { driverId: 'b', points: 18 }],
  sprintResults: [{ driverId: 'a', points: 8 }, { driverId: 'b', points: 7 }]
};
const upcoming = {
  round: 2, name: 'Grand Prix 2', date: '2026-11-22T15:00:00Z',
  results: null, sprintResults: null, sprintDate: null
};
const season = { year: 2026, drivers, constructors: [], races: [completed, upcoming] };

test('sums Grand Prix and sprint points, preserving zero and absence', () => {
  assert.equal(totalWeekendPoints(completed, 'a'), 33);
  assert.equal(totalWeekendPoints(completed, 'b'), 25);
  assert.equal(totalWeekendPoints(completed, 'nobody'), null);
  assert.equal(totalWeekendPoints({ ...completed, results: [{ driverId: 'a', points: 0 }], sprintResults: [] }, 'a'), 0);
});
test('cumulative points and current championship runners', () => {
  assert.deepEqual(seriesFor(season, 'a').map(item => item.cumulative), [33, 33]);
  assert.equal(allDrivers(season).length, 2);
});
test('upper and lower rank limits are not claimed to be exact', () => {
  const ranks = rankBounds(season, drivers[1], drivers);
  assert.deepEqual(ranks, { best: 1, worst: 2, exact: false });
  const done = { ...season, races: [completed] };
  assert.deepEqual(rankBounds(done, drivers[0], drivers),
    { best: 1, worst: 1, exact: true });
});
test('Sunday Grand Prix is polled on Monday morning, not 24 hours later', () => {
  assert.equal(eventDue(completed.date, Date.parse('2026-11-16T03:59:59Z')), false);
  assert.equal(eventDue(completed.date, Date.parse('2026-11-16T05:17:00Z')), true);
});
test('result corrections are eligible for a limited window', () => {
  assert.equal(withinCorrectionWindow(completed.date, Date.parse('2026-11-17T05:17:00Z')), true);
  assert.equal(withinCorrectionWindow(completed.date, Date.parse('2026-12-03T05:17:00Z')), false);
});

test('driver team logos use last started race; historical teams remain distinct', () => {
  const calendar = {
    drivers: [{ driverId: 'a', name: 'Driver A', position: 1, points: 35, constructorIds: ['old', 'new'] }],
    races: [
      { round: 1, results: [{ driverId: 'a', constructorId: 'old', positionText: '4', status: 'Finished' }] },
      { round: 2, sprintResults: [{ driverId: 'a', constructorId: 'new', positionText: 'R', status: 'Retired' }],
        results: [{ driverId: 'a', constructorId: 'new', positionText: '2', status: 'Finished' }] },
      { round: 3, results: [{ driverId: 'a', constructorId: 'old', positionText: 'W', status: 'Did not start' }] },
      { round: 4, results: null }
    ]
  };
  assert.deepEqual(driverTeamsByRace(calendar, 'a'), ['new', 'old']);
  const [driver] = allDrivers(calendar);
  assert.equal(driver.currentConstructorId, 'new');
  assert.deepEqual(driver.teamsThisSeason, ['new', 'old']);
});
test('team history fallback only applies before recorded race starts', () => {
  const noRaces = { drivers: [{ driverId: 'a', constructorIds: ['old', 'new'] }], races: [] };
  assert.deepEqual(driverTeamsByRace(noRaces, 'a'), ['new', 'old']);
  assert.deepEqual(driverTeamsByRace(noRaces, 'unknown'), []);
});
test('standings gaps use official points; tied predecessor displays zero gap', () => {
  const table = [
    { points: 100 }, { points: 90 }, { points: 90 }, { points: 75 }
  ];
  assert.deepEqual(championshipGaps(table, 0), { leader: null, previous: null });
  assert.deepEqual(championshipGaps(table, 1), { leader: 10, previous: 10 });
  assert.deepEqual(championshipGaps(table, 2), { leader: 10, previous: 0 });
  assert.deepEqual(championshipGaps(table, 3), { leader: 25, previous: 15 });
});


test('fun championships use normal GP points without altering official WM', () => {
  assert.deepEqual(FUN_SESSION_POINTS, [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
  const sample = {
    drivers: [
      { driverId: 'a', name: 'Anna', points: 123 },
      { driverId: 'b', name: 'Berta', points: 99 }
    ],
    races: [{
      round: 1, sprintDate: null,
      practiceSessions: {
        FP1: { results: [
          { driverId: 'a', name: 'Anna', position: 1 },
          { driverId: 'b', name: 'Berta', position: 2 },
          { driverId: 'reserve', name: 'Reserve Driver', position: 3 },
          { driverId: 'eleven', name: 'Eleventh', position: 11 },
          { driverId: 'no_time', name: 'No lap', position: null }
        ] },
        FP2: { results: [{ driverId: 'b', position: 1 }] }
      }
    }]
  };
  const before = structuredClone(sample);
  const fp1 = funSessionChampionship(sample, 'FP1');
  assert.equal(fp1.completed, 1);
  assert.equal(fp1.scheduled, 1);
  assert.deepEqual(fp1.rows.slice(0, 3).map(d => [d.driverId, d.points]), [
    ['a', 25], ['b', 18], ['reserve', 15]
  ]);
  assert.equal(fp1.rows.find(d => d.driverId === 'eleven').points, 0);
  assert.equal(fp1.rows.find(d => d.driverId === 'no_time').points, 0);
  assert.equal(fp1.rows[1].gapLeader, 7);
  assert.equal(fp1.rows[1].gapPrevious, 7);
  assert.equal(funSessionChampionship(sample, 'FP2').rows[0].points, 25);
  assert.deepEqual(sample, before);
});

test('FP1/FP2/FP3 are independent; sprint weekends have only FP1', () => {
  const sample = {
    drivers: [],
    races: [
      { round: 1, sprintDate: null, practiceSessions: {
        FP1: { results: [{ driverId: 'a', name: 'A', position: 1 }] },
        FP2: { results: [{ driverId: 'b', name: 'B', position: 1 }] },
        FP3: { results: [{ driverId: 'c', name: 'C', position: 1 }] }
      }},
      { round: 2, sprintDate: '2026-04-04', practiceSessions: {
        FP1: { results: [{ driverId: 'b', name: 'B', position: 1 }] },
        FP2: { results: [{ driverId: 'b', name: 'B', position: 1 }] }, // invalid in sprint week
        FP3: { results: [{ driverId: 'b', name: 'B', position: 1 }] }
      }},
      { round: 3, sprintDate: null }
    ]
  };
  assert.equal(funSessionChampionship(sample, 'FP1').completed, 2);
  assert.equal(funSessionChampionship(sample, 'FP1').scheduled, 3);
  assert.equal(funSessionChampionship(sample, 'FP2').scheduled, 2);
  assert.equal(funSessionChampionship(sample, 'FP2').completed, 1);
  assert.equal(funSessionChampionship(sample, 'FP3').completed, 1);
  assert.deepEqual(funSessionChampionship(sample, 'FP2').rows.map(r => r.driverId), ['b']);
  assert.deepEqual(funSessionChampionship(sample, 'FP3').rows.map(r => r.driverId), ['c']);
  assert.equal(sessionResultsFor(sample.races[1], 'FP2'), null);
});

test('equal fun points use higher finishing-position counts as tiebreak', () => {
  const sample = { drivers: [], races: [
    { round: 1, practiceSessions: { FP1: { results: [
      { driverId: 'a', name: 'A', position: 1 },
      { driverId: 'b', name: 'B', position: 2 }
    ]}}},
    { round: 2, practiceSessions: { FP1: { results: [
      { driverId: 'a', name: 'A', position: 10 },
      { driverId: 'b', name: 'B', position: 6 }
    ]}}}
  ]};
  const ranking = funSessionChampionship(sample, 'FP1');
  assert.deepEqual(ranking.rows.map(r => [r.driverId, r.points, r.wins]), [
    ['a', 26, 1], ['b', 26, 0]
  ]);
  assert.equal(ranking.rows[1].gapLeader, 0);
});

test('qualifying fun standings require imported classifications; no dummy points', () => {
  const sample = { drivers: [], races: [
    { round: 1, results: [{ driverId: 'a', points: 25 }] },
    { round: 2, sprintDate: '2026-07-19', qualifyingSessions: { Qualifying: { results: [
      { driverId: 'b', name: 'B', position: 1 },
      { driverId: 'a', name: 'A', position: 2 }
    ]}}}
  ]};
  let table = funSessionChampionship(sample, 'Qualifying');
  assert.equal(table.completed, 1);
  assert.equal(table.scheduled, 2);
  assert.deepEqual(table.rows.map(d => [d.driverId, d.points]), [['b', 25], ['a', 18]]);
  table = funSessionChampionship({ drivers: [], races: sample.races.slice(0, 1) }, 'Qualifying');
  assert.deepEqual(table.rows, []);
  assert.equal(table.completed, 0);
  assert.equal(table.scheduled, 1);
});
