// Pure UEFA Champions League (36-club, eight-round league phase) helpers.
// The old group-stage format (before 2024/25) is intentionally unsupported.
export const UCL_FIRST_SEASON = 2024;
export const UCL_MATCHDAYS = 8;
export const UCL_CLUBS = 36;
const KO = /(?:play[\s-]?off|play[\s-]?in|achtel|viertel|halb|final|round\s+of\s+(?:16|32)|knock[\s-]?out|k[\s.-]?o[\s.-]?phase|qualif|qualifik|vorrunde\s+der\s+qualifik)/i;
const time = m => Date.parse(m.date ?? '') || 0;

function inLeagueWindow(match, year) {
  const stamp = time(match);
  if (!stamp) return false;
  const date = new Date(stamp);
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1;
  return (y === year && m >= 9 && m <= 12) || (y === year + 1 && m === 1);
}
function stageExcluded(match) {
  return KO.test(match.groupName ?? '');
}
function validClubIds(matches) {
  const clubs = new Set();
  for (const m of matches) {
    if (m.homeTeamId) clubs.add(String(m.homeTeamId));
    if (m.awayTeamId) clubs.add(String(m.awayTeamId));
  }
  return clubs;
}
function makeGroupRounds(matches) {
  const groups = new Map();
  for (const match of matches) {
    const id = Number(match.groupOrderId || 0);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(match);
  }
  if (groups.size >= 2 && groups.size <= UCL_MATCHDAYS) {
    // OpenLigaDB group IDs are not promised to equal UEFA matchday numbers.
    // Assign MD 1–8 by first fixture date, preserving the original ID for polling.
    const ordered = [...groups.entries()].sort((a,b) =>
      Math.min(...a[1].map(time)) - Math.min(...b[1].map(time)) || a[0]-b[0]);
    const roundMap = new Map(ordered.map(([id],index)=>[id,index+1]));
    return matches.map(m=>({
      ...m, sourceGroupOrderId: Number(m.groupOrderId || 0),
      groupOrderId: roundMap.get(Number(m.groupOrderId || 0)),
      groupName: 'Ligaphase · Spieltag ' + roundMap.get(Number(m.groupOrderId || 0))
    }));
  }
  // Some providers group the entire league phase under one group ID.
  // Separate by fixture-date clusters (typically weeks apart), not by club name.
  const ordered = [...matches].sort((a,b)=>time(a)-time(b) || String(a.id).localeCompare(String(b.id)));
  let round = 0, prevDate = null;
  const output = [];
  for (const match of ordered) {
    const date = time(match);
    if (!prevDate || date-prevDate >= 5*86400000) round++;
    output.push({
      ...match, sourceGroupOrderId: Number(match.groupOrderId || 0),
      groupOrderId: round, groupName: 'Ligaphase · Spieltag ' + round
    });
    prevDate=date;
  }
  return output;
}

export function selectUclLeaguePhase(matches, year) {
  if (year < UCL_FIRST_SEASON) throw new Error('UCL-Ligaphase erst ab 2024/25 unterstützt.');
  if (!Array.isArray(matches)) throw new Error('Ungültige Champions-League-Daten.');
  const candidates=matches.filter(m=>!stageExcluded(m) &&
    (inLeagueWindow(m,year) || /(?:ligaphase|league\s+phase|league\s+stage)/i.test(m.groupName ?? '')));
  if (!candidates.length) throw new Error('Keine Ligaphasen-Spiele gefunden.');
  const league=makeGroupRounds(candidates).sort((a,b)=>
    a.groupOrderId-b.groupOrderId || time(a)-time(b) || String(a.id).localeCompare(String(b.id)));
  const clubs=validClubIds(league);
  if (clubs.size>UCL_CLUBS) throw new Error('Mehr als 36 Mannschaften in der UCL-Ligaphase.');
  const rounds=new Set(league.map(m=>m.groupOrderId));
  if (rounds.size>UCL_MATCHDAYS || [...rounds].some(n=>n<1||n>UCL_MATCHDAYS))
    throw new Error('Ungültige Zahl an Ligaspieltagen.');
  const perClub=new Map(), perRound=new Map();
  for(const match of league){
    perRound.set(match.groupOrderId,(perRound.get(match.groupOrderId)||0)+1);
    for(const id of [String(match.homeTeamId),String(match.awayTeamId)]){
      if(!id) throw new Error('Unvollständige Vereinszuordnung der UCL.');
      perClub.set(id,(perClub.get(id)||0)+1);
    }
  }
  if([...perClub.values()].some(n=>n>UCL_MATCHDAYS))
    throw new Error('Ein Team hat mehr als acht Ligaspiele.');
  if([...perRound.values()].some(n=>n>18))
    throw new Error('Mehr als 18 Spiele pro UCL-Ligaspieltag.');
  return league;
}
export function isCompleteUclLeaguePhase(matches) {
  const clubs=validClubIds(matches);
  if (clubs.size!==UCL_CLUBS || matches.length!==144) return false;
  if (!matches.every(m=>m.finished && m.result)) return false;
  const clubCount=new Map();
  for(const m of matches)
    for(const id of [String(m.homeTeamId),String(m.awayTeamId)])
      clubCount.set(id,(clubCount.get(id)||0)+1);
  return [...clubCount.values()].every(n=>n===8);
}
export function calculateUclStandings(matches, teams, throughRound = 8) {
  const byId=new Map();
  for(const t of teams)byId.set(String(t.teamId),{
    teamId:String(t.teamId),name:t.name,shortName:t.shortName||t.name,
    played:0,wins:0,draws:0,losses:0,points:0,
    goalsFor:0,goalsAgainst:0,goalDifference:0,awayGoals:0,awayWins:0,
    opponents:[]
  });
  for(const m of matches){
    if(!m.finished||!m.result||m.groupOrderId>throughRound)continue;
    const home=byId.get(String(m.homeTeamId)),away=byId.get(String(m.awayTeamId));
    if(!home||!away)continue;
    const h=Number(m.result.home),a=Number(m.result.away);
    home.played++;away.played++;
    home.goalsFor+=h;home.goalsAgainst+=a;
    away.goalsFor+=a;away.goalsAgainst+=h;away.awayGoals+=a;
    home.opponents.push(away.teamId);away.opponents.push(home.teamId);
    if(h>a){home.points+=3;home.wins++;away.losses++;}
    else if(h<a){away.points+=3;away.wins++;away.awayWins++;home.losses++;}
    else{home.points++;away.points++;home.draws++;away.draws++;}
  }
  const result=[...byId.values()];
  for(const t of result)t.goalDifference=t.goalsFor-t.goalsAgainst;
  // UEFA league-phase tie-breaks: primary criteria and collective opponent
  // stats. Fair-play points and club coefficient cannot be reconstructed.
  for(const t of result){
    t.opponentPoints=t.opponents.reduce((sum,id)=>sum+(byId.get(id)?.points??0),0);
    t.opponentGoalDifference=t.opponents.reduce((sum,id)=>
      sum+(byId.get(id)?.goalDifference??0),0);
    t.opponentGoals=t.opponents.reduce((sum,id)=>sum+(byId.get(id)?.goalsFor??0),0);
  }
  // UEFA Art. 18 / UEFA explanatory note (2026/27):
  // MD1–7: only the first five criteria; remaining ties SHARE a rank.
  // After all 144 league matches: opponent statistics also apply.
  const finalTable = throughRound >= UCL_MATCHDAYS && isCompleteUclLeaguePhase(matches);
  const primary = (a,b) =>
    b.points-a.points || b.goalDifference-a.goalDifference ||
    b.goalsFor-a.goalsFor || b.awayGoals-a.awayGoals ||
    b.wins-a.wins || b.awayWins-a.awayWins;
  const extra = (a,b) =>
    b.opponentPoints-a.opponentPoints ||
    b.opponentGoalDifference-a.opponentGoalDifference ||
    b.opponentGoals-a.opponentGoals;
  const ranked = (a,b) => primary(a,b) || (finalTable ? extra(a,b) : 0);
  result.sort((a,b)=>ranked(a,b) ||
    (a.shortName||a.name).localeCompare(b.shortName||b.name,'de'));
  result.forEach((team,index)=>{
    const previous=result[index-1];
    const isEqual = index>0 && ranked(previous,team)===0;
    team.position = !finalTable && isEqual ? previous.position : index+1;
    team.provisionalTie = !finalTable && isEqual;
    team.tieBreakUnresolved = finalTable && isEqual;
  });
  // Mark entire tied groups, especially when they span qualification boundaries.
  for(let start=0;start<result.length;){
    let end=start;
    while(end+1<result.length && ranked(result[end],result[end+1])===0)end++;
    const crossing=(start<8 && end>=8) || (start<24 && end>=24);
    if(end>start)for(let i=start;i<=end;i++){
      result[i].provisionalTie=!finalTable;
      result[i].tieBreakUnresolved=finalTable;
      result[i].tieCrossesZone=crossing;
      result[i].tiedWith=end-start+1;
    }
    start=end+1;
  }
  return result;
}
export function preferOfficialUclTable(computed, official, finalTable = false) {
  if (!Array.isArray(official) || computed.length!==UCL_CLUBS || official.length!==UCL_CLUBS)
    return { standings:computed, verified:false };
  const lookup=new Map(computed.map(t=>[String(t.teamId),t]));
  const equal=official.every(t=>{
    const x=lookup.get(String(t.teamId));
    return x && Number(t.points)===x.points && Number(t.played)===x.played &&
      Number(t.goalDifference)===x.goalDifference && Number(t.goalsFor)===x.goalsFor;
  });
  if (!equal) return { standings:computed, verified:false };
  // A provider may number two equal-rank teams consecutively in its API.
  // Preserve UEFA's shared interim ranking even when provider totals match.
  return { standings:finalTable ? official : computed, verified:true };
}

// Conservative proven outer limits. These are NOT exact attainable finishes.
// In particular, all opponents cannot independently win every remaining game.
// The total remaining point budget rules out some implausible worst positions.
export function calculateUclRankLimits(season, teamId) {
  const table=season.standings ?? [];
  const own=table.find(t=>String(t.teamId)===String(teamId));
  if(!own) return {best:null,worst:null,exact:false};
  const matches=season.matches ?? [];
  const unfinished=matches.filter(m=>!m.finished);
  if(!unfinished.length) return {best:Number(own.position),worst:Number(own.position),exact:!own.tieBreakUnresolved};
  const remainFor=id=>unfinished.filter(m=>
    String(m.homeTeamId)===String(id)||String(m.awayTeamId)===String(id)).length;
  const minimum=Number(own.points);
  const maximum=minimum+remainFor(teamId)*3;
  const opponents=table.filter(t=>String(t.teamId)!==String(teamId));
  const best=1+opponents.filter(t=>Number(t.points)>maximum).length;
  const deficits=opponents.filter(t=>
    Number(t.points)+remainFor(t.teamId)*3>=minimum)
    .map(t=>Math.max(0,minimum-Number(t.points)))
    .sort((a,b)=>a-b);
  const totalAdditionalPoints=unfinished.length*3;
  let required=0,numberOfPossibleOvertakes=0;
  for(const deficit of deficits){
    if(required+deficit>totalAdditionalPoints)break;
    required+=deficit;
    numberOfPossibleOvertakes++;
  }
  const worst=Math.min(table.length,Math.max(best,numberOfPossibleOvertakes+1));
  return {best,worst,exact:false};
}
export function uclZone(position) {
  if(position>=1 && position<=8)return 'direct';
  if(position>=9 && position<=24)return 'playoffs';
  if(position>=25 && position<=36)return 'out';
  return null;
}
