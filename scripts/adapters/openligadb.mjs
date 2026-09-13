import { fetchJson } from '../lib/http.mjs';

const BASE_URL = 'https://api.openligadb.de';

function normalizeTeamId(team) {
  return String(team.teamInfoId ?? team.teamId ?? team.team?.teamId ?? '');
}

export async function fetchFootballCompetition(competition, season) {
  const shortcut = competition.shortcut;
  const [table, matches] = await Promise.all([
    fetchJson(`${BASE_URL}/getbltable/${shortcut}/${season}`),
    fetchJson(`${BASE_URL}/getmatchdata/${shortcut}/${season}`)
  ]);

  const standings = table.map((team, index) => ({
    teamId: normalizeTeamId(team),
    name: team.teamName,
    shortName: team.shortName ?? team.teamName,
    position: index + 1,
    played: Number(team.matches ?? 0),
    wins: Number(team.won ?? 0),
    draws: Number(team.draw ?? 0),
    losses: Number(team.lost ?? 0),
    goalsFor: Number(team.goals ?? 0),
    goalsAgainst: Number(team.opponentGoals ?? 0),
    goalDifference: Number(team.goalDiff ?? 0),
    points: Number(team.points ?? 0)
  }));

  const remainingFixtures = matches
    .filter(match => !match.matchIsFinished)
    .map(match => ({
      id: String(match.matchID),
      groupOrderId: Number(match.group?.groupOrderID ?? 0),
      groupName: match.group?.groupName ?? null,
      date: match.matchDateTimeUTC ?? match.matchDateTime ?? null,
      homeTeamId: String(match.team1?.teamId ?? ''),
      homeTeam: match.team1?.teamName ?? '',
      awayTeamId: String(match.team2?.teamId ?? ''),
      awayTeam: match.team2?.teamName ?? ''
    }))
    .sort((a, b) => {
      if (a.groupOrderId !== b.groupOrderId) return a.groupOrderId - b.groupOrderId;
      return String(a.date).localeCompare(String(b.date));
    });

  return {
    competition: {
      id: competition.id,
      name: competition.name,
      sport: 'football',
      season: `${season}/${String(season + 1).slice(-2)}`,
      type: competition.id === 'champions-league' ? 'league-phase' : 'league',
      source: 'OpenLigaDB',
      lastUpdated: new Date().toISOString()
    },
    zones: competition.zones ?? [],
    standings,
    remainingFixtures
  };
}
