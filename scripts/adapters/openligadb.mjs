import { fetchJson } from '../lib/http.mjs';

const BASE_URL = 'https://api.openligadb.de';

function normalizeTeamId(team) {
  return String(team.teamInfoId ?? team.teamId ?? team.team?.teamId ?? '');
}

function finalResult(match) {
  const results = match.matchResults ?? [];
  return results.find(result => Number(result.resultTypeID) === 2 || result.resultTypeKind === 'After90Minutes')
    ?? [...results].sort((a, b) => Number(b.resultOrderID ?? 0) - Number(a.resultOrderID ?? 0))[0]
    ?? null;
}

function normalizeMatch(match) {
  const result = finalResult(match);

  return {
    id: String(match.matchID),
    groupOrderId: Number(match.group?.groupOrderID ?? 0),
    groupName: match.group?.groupName ?? null,
    date: match.matchDateTimeUTC ?? match.matchDateTime ?? null,
    finished: Boolean(match.matchIsFinished),
    homeTeamId: String(match.team1?.teamId ?? ''),
    homeTeam: match.team1?.teamName ?? '',
    homeShortName: match.team1?.shortName ?? match.team1?.teamName ?? '',
    awayTeamId: String(match.team2?.teamId ?? ''),
    awayTeam: match.team2?.teamName ?? '',
    awayShortName: match.team2?.shortName ?? match.team2?.teamName ?? '',
    result: result ? {
      home: Number(result.pointsTeam1),
      away: Number(result.pointsTeam2)
    } : null
  };
}

function matchdaySummary(matches) {
  const groups = new Map();

  for (const match of matches) {
    const order = Number(match.group?.groupOrderID ?? 0);
    if (!order) continue;
    if (!groups.has(order)) groups.set(order, []);
    groups.get(order).push(match);
  }

  const ordered = [...groups.entries()].sort((a, b) => a[0] - b[0]);
  const completed = ordered.filter(([, groupMatches]) =>
    groupMatches.length > 0 && groupMatches.every(match => match.matchIsFinished)
  );

  const lastCompleted = completed.at(-1) ?? null;
  const nextOpen = ordered.find(([, groupMatches]) =>
    groupMatches.some(match => !match.matchIsFinished)
  ) ?? null;

  const toSummary = groupEntry => {
    if (!groupEntry) return null;
    const [groupOrderId, groupMatches] = groupEntry;
    const normalized = groupMatches
      .map(normalizeMatch)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return {
      groupOrderId,
      groupName: normalized[0]?.groupName ?? `${groupOrderId}. Spieltag`,
      matches: normalized
    };
  };

  return {
    lastMatchday: toSummary(lastCompleted),
    nextMatchday: toSummary(nextOpen)
  };
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

  const normalizedMatches = matches.map(normalizeMatch);
  const remainingFixtures = normalizedMatches
    .filter(match => !match.finished)
    .sort((a, b) => {
      if (a.groupOrderId !== b.groupOrderId) return a.groupOrderId - b.groupOrderId;
      return String(a.date).localeCompare(String(b.date));
    });

  const { lastMatchday, nextMatchday } = matchdaySummary(matches);

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
    tableHighlights: competition.tableHighlights ?? [],
    standings,
    lastMatchday,
    nextMatchday,
    remainingFixtures
  };
}
