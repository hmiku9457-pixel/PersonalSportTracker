import test from 'node:test';
import assert from 'node:assert/strict';
import { totalWeekendPoints, seriesFor, rankBounds, allDrivers } from '../public/js/f1-utils.js';
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
