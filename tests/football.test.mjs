import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchdayScore, pointsSeries, standingsFromMatches, teamBounds,
  rankAtMatchday, teamsForSeason
} from '../public/js/football-utils.js';
import { normalizeMatch, summarizeMatchdays, shouldPollGroup, nextDayDue } from '../scripts/football/season.mjs';

const teams = [
  {teamId:'a',name:'Alpha',shortName:'A'},
  {teamId:'b',name:'Beta',shortName:'B'},
  {teamId:'c',name:'Gamma',shortName:'C'},
  {teamId:'d',name:'Delta',shortName:'D'}
];
function fixture(id, groupOrderId, homeTeamId, awayTeamId, result, day = 9) {
  const match = {
    id:String(id),groupOrderId,groupName:groupOrderId+'. Spieltag',
    date:'2026-11-'+String(day).padStart(2,'0')+'T18:00:00Z',
    homeTeamId,awayTeamId,homeTeam:homeTeamId,awayTeam:awayTeamId,
    finished: result !== null, result
  };
  return match;
}
const matches = [
  fixture(1,1,'a','b',{home:2,away:0}),
  fixture(2,1,'c','d',{home:1,away:1}),
  fixture(3,2,'b','a',{home:3,away:1}),
  fixture(4,2,'d','c',null,12)
];
const season = { year:2026, matches, teams, standings:[] };

test('normalize API scores and group identifiers',()=>{
  const raw = {
    matchID:103, matchDateTimeUTC:'2026-11-09T17:00:00Z',
    matchIsFinished:true,group:{groupOrderID:5,groupName:'5. Spieltag'},
    team1:{teamId:77,teamName:'A',shortName:'A'},
    team2:{teamId:78,teamName:'B',shortName:'B'},
    matchResults:[{resultTypeID:1,pointsTeam1:0,pointsTeam2:0},
                  {resultTypeID:2,pointsTeam1:3,pointsTeam2:1}]
  };
  const normalized=normalizeMatch(raw);
  assert.equal(normalized.groupOrderId,5);
  assert.deepEqual(normalized.result,{home:3,away:1});
  assert.equal(normalized.finished,true);
});
test('points per Spieltag distinguish wins, draws, losses and open fixtures',()=>{
  assert.deepEqual(
    [matchdayScore(season,'a',1).points,matchdayScore(season,'a',2).points,
     matchdayScore(season,'c',1).points,matchdayScore(season,'c',2).points],
    [3,0,1,null]);
  assert.equal(matchdayScore(season,'c',2).status,'pending');
  assert.equal(matchdayScore(season,'x',1).status,'absent');
});
test('cumulative points and rankings are derived from results',()=>{
  assert.deepEqual(pointsSeries(season,'a').map(x=>x.total),[3,3]);
  assert.deepEqual(pointsSeries(season,'b').map(x=>x.total),[0,3]);
  assert.equal(standingsFromMatches(season).find(t=>t.teamId==='a').points,3);
  assert.equal(rankAtMatchday(season,'a',1),1);
  assert.equal(teamsForSeason(season).length,4);
});
test('rank limits are labelled as bounds until all games are finished',()=>{
  const live=teamBounds(season,'a');
  assert.equal(live.exact,false);
  assert.ok(live.worst>=live.best);
  const allFinished={...season,matches:[...matches.slice(0,3),
    {...matches[3],finished:true,result:{home:1,away:2}}]};
  assert.equal(teamBounds(allFinished,'a').exact,true);
});
test('poll only after the matchday and during the correction window',()=>{
  const monday=Date.parse('2026-11-10T05:20:00Z');
  assert.equal(nextDayDue(matches[0].date,Date.parse('2026-11-10T03:00:00Z')),false);
  assert.equal(nextDayDue(matches[0].date,monday),true);
  assert.equal(shouldPollGroup([matches[0]],null,monday),true);
  assert.equal(shouldPollGroup([matches[0]],new Date(monday-3600000).toISOString(),monday),false);
  assert.equal(shouldPollGroup([matches[0]],null,Date.parse('2026-12-15T05:20:00Z')),false);
});
test('matchday overview includes unfinished group and following group',()=>{
  const group=summarizeMatchdays(matches);
  assert.equal(group.lastMatchday.groupOrderId,1);
  assert.equal(group.currentMatchday.groupOrderId,2);
});
