import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectUclLeaguePhase, isCompleteUclLeaguePhase,
  calculateUclStandings, preferOfficialUclTable, uclZone, calculateUclRankLimits
} from '../public/js/champions-league-utils.js';
import { matchdayScore, pointsSeries, teamBounds } from '../public/js/football-utils.js';

const matchdates=['2026-09-09','2026-10-14','2026-10-21','2026-11-04',
  '2026-11-25','2026-12-09','2027-01-20','2027-01-27'];
const clubs=Array.from({length:36},(_,index)=>({
  teamId:String(index+1),name:'Verein '+String(index+1).padStart(2,'0')
}));
function fixtures() {
  const result=[];
  for(let round=0;round<8;round++){
    // Circle-method pairings: exactly 18 fixtures per round, one per club.
    const rotated=[0,...Array.from({length:35},(_,i)=>(i+round)%35+1)];
    for(let index=0;index<18;index++) {
      result.push({
        id:'md'+round+'-'+index,
        groupOrderId:17+round,
        groupName:'Ligaphase · Spieltag '+(round+1),
        date:matchdates[round]+'T20:00:00Z',
        homeTeamId:clubs[rotated[index]].teamId,
        awayTeamId:clubs[rotated[35-index]].teamId,
        homeTeam:clubs[rotated[index]].name,
        awayTeam:clubs[rotated[35-index]].name,
        finished:true,result:{home:1,away:0}
      });
    }
  }
  return result;
}
const all=fixtures();
const knockout={...all[0],id:'ko',groupOrderId:31,groupName:'Playoffs',
  date:'2027-02-18T20:00:00Z',result:{home:5,away:0}};
const qualifying={...all[1],id:'qual',groupOrderId:1,groupName:'Qualifikation',
  date:'2026-08-12T20:00:00Z',result:{home:2,away:2}};

test('supports league-phase format only from 2024/25',()=>{
  assert.throws(()=>selectUclLeaguePhase(all,2023),/2024/);
});
test('isolates the 144 league matches from qualifying and knockout',()=>{
  const filtered=selectUclLeaguePhase([...all,knockout,qualifying],2026);
  assert.equal(filtered.length,144);
  assert.equal(filtered.some(m=>m.id==='ko'||m.id==='qual'),false);
  assert.deepEqual([...new Set(filtered.map(m=>m.groupOrderId))],[1,2,3,4,5,6,7,8]);
  assert.equal(new Set(filtered.flatMap(m=>[m.homeTeamId,m.awayTeamId])).size,36);
  assert.ok(filtered.every(m=>m.sourceGroupOrderId>=17));
  assert.equal(isCompleteUclLeaguePhase(filtered),true);
});
test('supports provider with a single group for all eight matchdays',()=>{
  const merged=all.map(m=>({...m,groupOrderId:1,groupName:'Ligaphase'}));
  const filtered=selectUclLeaguePhase(merged,2026);
  assert.equal(new Set(filtered.map(m=>m.groupOrderId)).size,8);
  assert.equal(isCompleteUclLeaguePhase(filtered),true);
});
test('rejects more than eight league fixtures for a club',()=>{
  const ninth={...all[0],id:'extra',groupOrderId:17};
  assert.throws(()=>selectUclLeaguePhase([...all,ninth],2026),/acht Ligaspiele|18 Spiele/);
});
test('calculated league standings contain 36 clubs and 3/1/0 points',()=>{
  const matches=selectUclLeaguePhase(all,2026);
  const table=calculateUclStandings(matches,clubs);
  assert.equal(table.length,36);
  assert.equal(table.reduce((sum,t)=>sum+t.played,0),288);
  assert.ok(table.every(t=>t.played===8));
  const season={matches,teams:clubs,standings:table};
  const own=matches[0].homeTeamId;
  assert.equal(matchdayScore(season,own,1).points,3);
  assert.equal(pointsSeries(season,own).length,8);
  assert.equal(teamBounds(season,own).exact,true);
});
test('an official table is used only when phase-only match statistics match',()=>{
  const computed=calculateUclStandings(selectUclLeaguePhase(all,2026),clubs);
  assert.equal(preferOfficialUclTable(computed,computed).verified,true);
  assert.equal(preferOfficialUclTable(computed,
    computed.map((r,i)=>i===0?{...r,points:r.points+3}:r)).verified,false);
});
test('UEFA qualification zones have exact rank boundaries',()=>{
  assert.deepEqual([1,8,9,24,25,36,37].map(uclZone),
    ['direct','direct','playoffs','playoffs','out','out',null]);
});

test('incomplete league phase uses only UEFA criteria 1–5 and shares equal ranks',()=>{
  const members=[
    {teamId:'a',name:'Alpha'}, {teamId:'b',name:'Beta'},
    {teamId:'c',name:'Gamma'}, {teamId:'d',name:'Delta'},
    {teamId:'e',name:'Epsilon'}
  ];
  const games=[
    {homeTeamId:'a',awayTeamId:'c',groupOrderId:1,finished:true,result:{home:1,away:0}},
    {homeTeamId:'b',awayTeamId:'d',groupOrderId:1,finished:true,result:{home:1,away:0}},
    {homeTeamId:'c',awayTeamId:'e',groupOrderId:2,finished:true,result:{home:2,away:0}}
  ];
  const ranking=calculateUclStandings(games,members);
  const alpha=ranking.find(x=>x.teamId==='a'), beta=ranking.find(x=>x.teamId==='b');
  assert.equal(alpha.position,2);
  assert.equal(beta.position,2);
  assert.equal(alpha.provisionalTie,true);
  assert.equal(beta.provisionalTie,true);
  assert.notEqual(alpha.opponentPoints,beta.opponentPoints);
});
test('UCL rank limits respect the single global points budget',()=>{
  const standing=[
    {teamId:'t',name:'Target',position:1,points:3},
    {teamId:'a',name:'Alpha',position:2,points:3},
    {teamId:'b',name:'Beta',position:3,points:0},
    {teamId:'c',name:'Gamma',position:4,points:0}
  ];
  const season={
    standings:standing,
    matches:[{homeTeamId:'b',awayTeamId:'c',finished:false,date:'2027-01-20T20:00:00Z'}]
  };
  assert.deepEqual(calculateUclRankLimits(season,'t'),{
    best:1,worst:3,exact:false
  });
  // Two clubs cannot both gain three points from their single mutual match.
});
test('complete UCL season has fixed rank limits',()=>{
  const matches=selectUclLeaguePhase(all,2026);
  const standings=calculateUclStandings(matches,clubs);
  const limits=calculateUclRankLimits({matches,standings},standings[0].teamId);
  assert.equal(limits.best,standings[0].position);
  assert.equal(limits.worst,standings[0].position);
  assert.equal(limits.exact,true);
});
test('provider totals can be verified without overriding UEFA provisional ties',()=>{
  const matches=selectUclLeaguePhase(all,2026);
  const interrupted=matches.map(m=>({...m,finished:m.groupOrderId<=4,result:m.groupOrderId<=4?m.result:null}));
  const computed=calculateUclStandings(interrupted,clubs);
  // Some result providers enumerate ties instead of giving joint ranks.
  const sequential=computed.map((r,i)=>({...r,position:i+1}));
  const reviewed=preferOfficialUclTable(computed,sequential,false);
  assert.equal(reviewed.verified,true);
  assert.deepEqual(reviewed.standings.map(t=>t.position),
    computed.map(t=>t.position));
});
