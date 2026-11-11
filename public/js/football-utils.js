// Bundesliga detail calculations: pure, browser and test friendly.
export function matchdayNumbers(season) {
  return [...new Set((season.matches ?? []).map(match => Number(match.groupOrderId))
    .filter(number => Number.isInteger(number) && number > 0))].sort((a,b)=>a-b);
}
export function teamMatches(season, teamId, round = null) {
  return (season.matches ?? []).filter(match =>
    (round === null || Number(match.groupOrderId) === Number(round)) &&
    (String(match.homeTeamId) === String(teamId) || String(match.awayTeamId) === String(teamId)));
}
export function gamePoints(match, teamId) {
  if (!match.finished || !match.result) return null;
  const home = String(match.homeTeamId) === String(teamId);
  const away = String(match.awayTeamId) === String(teamId);
  if (!home && !away) return null;
  const ours = home ? Number(match.result.home) : Number(match.result.away);
  const theirs = home ? Number(match.result.away) : Number(match.result.home);
  return ours > theirs ? 3 : ours === theirs ? 1 : 0;
}
// null => no fixture, pending => fixture scheduled but not yet played.
export function matchdayScore(season, teamId, round) {
  const games = teamMatches(season, teamId, round);
  if (!games.length) return { status: 'absent', points: null, matches: [] };
  const finished = games.filter(g => g.finished && g.result);
  if (!finished.length) return { status: 'pending', points: null, matches: games };
  const total = finished.reduce((sum,match)=>sum + gamePoints(match,teamId),0);
  return {
    status: finished.length === games.length ? 'complete' : 'partial',
    points: total, matches: games
  };
}
export function pointsSeries(season, teamId) {
  let sum = 0;
  return matchdayNumbers(season).map(round => {
    const score = matchdayScore(season, teamId, round);
    sum += score.points ?? 0;
    return { round, total: sum, points: score.points, status: score.status };
  });
}
export function teamsForSeason(season) {
  const map = new Map((season.teams ?? []).map(t => [String(t.teamId), { ...t }]));
  for (const standing of season.standings ?? []) {
    map.set(String(standing.teamId), { ...map.get(String(standing.teamId)), ...standing });
  }
  for (const match of season.matches ?? []) {
    for (const side of ['home','away']) {
      const teamId = String(match[side+'TeamId']);
      if (!teamId || map.has(teamId)) continue;
      map.set(teamId, {
        teamId, name: match[side+'Team'], shortName: match[side+'ShortName'] || match[side+'Team']
      });
    }
  }
  return [...map.values()].sort((a,b) =>
    Number(a.position ?? 999) - Number(b.position ?? 999) ||
    a.name.localeCompare(b.name, 'de'));
}
export function standingsFromMatches(season, throughRound = Infinity) {
  const teams = teamsForSeason(season).map(t => ({
    teamId: String(t.teamId), name: t.name, shortName: t.shortName,
    played:0, wins:0, draws:0, losses:0, points:0,
    goalsFor:0, goalsAgainst:0, goalDifference:0
  }));
  const map = new Map(teams.map(t=>[t.teamId,t]));
  for (const match of season.matches ?? []) {
    if (!match.finished || !match.result || Number(match.groupOrderId) > throughRound) continue;
    const home = map.get(String(match.homeTeamId));
    const away = map.get(String(match.awayTeamId));
    if (!home || !away) continue;
    const h = Number(match.result.home), a = Number(match.result.away);
    home.played++;away.played++;
    home.goalsFor+=h;home.goalsAgainst+=a;
    away.goalsFor+=a;away.goalsAgainst+=h;
    if(h>a){home.points+=3;home.wins++;away.losses++;}
    else if(h<a){away.points+=3;away.wins++;home.losses++;}
    else{home.points++;away.points++;home.draws++;away.draws++;}
  }
  for (const team of teams) team.goalDifference=team.goalsFor-team.goalsAgainst;
  teams.sort((a,b)=>b.points-a.points || b.goalDifference-a.goalDifference ||
    b.goalsFor-a.goalsFor || a.name.localeCompare(b.name,'de'));
  teams.forEach((t,index)=>{ t.position=index+1; });
  return teams;
}
export function rankAtMatchday(season, teamId, round) {
  return standingsFromMatches(season, round).find(t=>t.teamId===String(teamId))?.position ?? null;
}
// Safe loose rank bounds; they are not proof of reachable combinations.
export function teamBounds(season, teamId) {
  const official = (season.standings ?? []).find(x=>String(x.teamId)===String(teamId));
  const calculated = standingsFromMatches(season);
  const base = official ? season.standings : calculated;
  const row = base.find(x=>String(x.teamId)===String(teamId));
  if (!row) return { best: null, worst: null, exact: false };
  const possibleTeams = teamsForSeason(season);
  const outstanding = id => teamMatches(season,id).filter(m=>!m.finished).length;
  const remaining = outstanding(teamId);
  if (!remaining && possibleTeams.every(t=>outstanding(t.teamId)===0))
    return { best: Number(row.position), worst: Number(row.position), exact: true };
  const ownMax = Number(row.points)+remaining*3;
  const best = 1 + base.filter(t=>String(t.teamId)!==String(teamId) &&
    Number(t.points)>ownMax).length;
  const worst = 1 + base.filter(t=>String(t.teamId)!==String(teamId) &&
    Number(t.points)+outstanding(t.teamId)*3 >= Number(row.points)).length;
  return { best, worst: Math.max(best,worst), exact: false };
}
