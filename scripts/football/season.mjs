import { fetchJson } from '../lib/http.mjs';

const BASE = 'https://api.openligadb.de';
const dayMs = 86400000;
const nowIso = () => new Date().toISOString();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function normalizeMatch(match) {
  const results = match.matchResults ?? [];
  const end = results.find(r => Number(r.resultTypeID) === 2 || r.resultTypeKind === 'After90Minutes')
    ?? [...results].sort((a, b) => Number(b.resultOrderID ?? 0) - Number(a.resultOrderID ?? 0))[0];
  const finished = Boolean(match.matchIsFinished && end);
  const safeResult = finished && end ? {
    home: Number(end.pointsTeam1), away: Number(end.pointsTeam2)
  } : null;
  return {
    id: String(match.matchID),
    groupOrderId: Number(match.group?.groupOrderID ?? 0),
    groupName: match.group?.groupName ?? null,
    date: match.matchDateTimeUTC ?? match.matchDateTime ?? null,
    updated: match.lastUpdateDateTime ?? null,
    finished: finished && Number.isFinite(safeResult.home) && Number.isFinite(safeResult.away),
    homeTeamId: String(match.team1?.teamId ?? ''),
    homeTeam: match.team1?.teamName ?? '',
    homeShortName: match.team1?.shortName ?? match.team1?.teamName ?? '',
    awayTeamId: String(match.team2?.teamId ?? ''),
    awayTeam: match.team2?.teamName ?? '',
    awayShortName: match.team2?.shortName ?? match.team2?.teamName ?? '',
    result: safeResult && Number.isFinite(safeResult.home) && Number.isFinite(safeResult.away) ? safeResult : null
  };
}
function sortedMatches(matches) {
  return [...matches].sort((a,b) =>
    a.groupOrderId - b.groupOrderId ||
    String(a.date ?? '').localeCompare(String(b.date ?? '')) ||
    a.id.localeCompare(b.id));
}
function matchFingerprint(match) {
  const { id, groupOrderId, groupName, date, finished, homeTeamId, homeTeam,
    homeShortName, awayTeamId, awayTeam, awayShortName, result } = match;
  return JSON.stringify({ id, groupOrderId, groupName, date, finished,
    homeTeamId, homeTeam, homeShortName, awayTeamId, awayTeam, awayShortName, result });
}
function mergeMatches(previous, changed, replaceAll = false) {
  const previousById = new Map(previous.map(match => [match.id, match]));
  const byId = new Map((replaceAll ? [] : previous).map(match => [match.id, match]));
  let updated = false;
  for (const match of changed) {
    const original = previousById.get(match.id);
    if (!original || matchFingerprint(original) !== matchFingerprint(match)) updated = true;
    byId.set(match.id, match);
  }
  if (replaceAll && previous.length !== byId.size) updated = true;
  return { matches: sortedMatches([...byId.values()]), changed: updated };
}
export function normalizeTable(table) {
  return (Array.isArray(table) ? table : []).map((team, index) => ({
    teamId: String(team.teamInfoId ?? team.teamId ?? ''),
    name: team.teamName ?? '',
    shortName: team.shortName ?? team.teamName ?? '',
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
}
export function fixtureTeams(matches, officialTable = []) {
  const teams = new Map();
  for (const team of officialTable) teams.set(team.teamId, {
    teamId: team.teamId, name: team.name, shortName: team.shortName ?? team.name
  });
  for (const match of matches) {
    for (const side of ['home', 'away']) {
      const id = match[side + 'TeamId'];
      if (!id) continue;
      if (!teams.has(id)) teams.set(id, {
        teamId: id, name: match[side + 'Team'], shortName: match[side + 'ShortName']
      });
    }
  }
  return [...teams.values()].sort((a,b) => a.name.localeCompare(b.name, 'de'));
}
export function summarizeMatchdays(matches) {
  const groups = new Map();
  for (const match of sortedMatches(matches)) {
    const groupId = match.groupOrderId;
    if (!groupId) continue;
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(match);
  }
  const ordered = [...groups.entries()].sort((a,b) => a[0] - b[0]);
  const completed = ordered.filter(([,items]) => items.length && items.every(m => m.finished));
  const currentIndex = ordered.findIndex(([,items]) => items.some(m => !m.finished));
  const current = currentIndex >= 0 ? ordered[currentIndex] : null;
  const next = currentIndex >= 0 ? ordered[currentIndex + 1] ?? null : null;
  const lastCompleted = completed.filter(([number]) => number < (current?.[0] ?? Infinity)).at(-1)
    ?? completed.at(-1) ?? null;
  function format(group) {
    if (!group) return null;
    return {
      groupOrderId: group[0],
      groupName: group[1][0]?.groupName ?? group[0] + '. Spieltag',
      matches: group[1]
    };
  }
  return { lastMatchday: format(lastCompleted), currentMatchday: format(current), nextMatchday: format(next) };
}
export function seasonOverview(data, competition) {
  const { lastMatchday, currentMatchday, nextMatchday } = summarizeMatchdays(data.matches);
  return {
    competition: { id: competition.id, name: competition.name, sport: 'football',
      season: data.seasonLabel, type: 'league', source: 'OpenLigaDB',
      lastUpdated: data.updatedAt },
    zones: competition.zones ?? [],
    tableHighlights: competition.tableHighlights ?? [],
    standings: data.standings,
    lastMatchday, currentMatchday, nextMatchday,
    remainingFixtures: sortedMatches(data.matches.filter(m => !m.finished))
  };
}
export function nextDayDue(date, now = Date.now()) {
  const parsed = Date.parse(date ?? '');
  if (!Number.isFinite(parsed)) return false;
  const midnight = Date.parse(new Date(parsed).toISOString().slice(0, 10) + 'T00:00:00Z');
  return now >= midnight + dayMs + 4 * 3600000;
}
export function shouldPollGroup(groupMatches, lastChecked, now = Date.now()) {
  if (lastChecked && now - Date.parse(lastChecked) < 22 * 3600000) return false;
  const dueUnfinished = groupMatches.some(m => !m.finished && nextDayDue(m.date, now));
  if (dueUnfinished) return true;
  // Short correction window for latest fixtures, including already completed matches.
  const last = Math.max(...groupMatches.filter(m => m.finished && m.date)
    .map(m => Date.parse(m.date) || 0), 0);
  return Boolean(last && now >= last && now < last + 15 * dayMs);
}
function matchdayOrder(matches) {
  return [...new Set(matches.map(m => m.groupOrderId).filter(Boolean))].sort((a,b)=>a-b);
}
export async function fetchFootballSeason(competition, year, options = {}) {
  if (options.delay) await pause(options.delay);
  const shortcut = competition.shortcut;
  const response = await fetchJson(BASE + '/getmatchdata/' + shortcut + '/' + year);
  if (!Array.isArray(response) || !response.length) return null;
  const matches = sortedMatches(response.map(normalizeMatch));
  const table = await fetchJson(BASE + '/getbltable/' + shortcut + '/' + year);
  const standings = normalizeTable(table);
  return {
    schemaVersion: 1, id: competition.id, shortcut, year,
    seasonLabel: year + '/' + String(year + 1).slice(-2),
    complete: Boolean(options.historical && matches.every(match => match.finished)),
    calendarCheckedAt: nowIso(), updatedAt: nowIso(),
    matches, standings, teams: fixtureTeams(matches, standings), groupChecks: {}
  };
}
export async function updateFootballSeason(saved, competition, year, now = Date.now()) {
  if (!saved) return fetchFootballSeason(competition, year);
  if (saved.complete) return saved;
  let data = structuredClone(saved);
  let changed = false;
  let checked = false;
  const shortcut = competition.shortcut;
  if (!data.calendarCheckedAt || now - Date.parse(data.calendarCheckedAt) > 7 * dayMs) {
    const response = await fetchJson(BASE + '/getmatchdata/' + shortcut + '/' + year);
    if (Array.isArray(response) && response.length) {
      const merged = mergeMatches(data.matches, response.map(normalizeMatch), true);
      changed ||= merged.changed;
      data.matches = merged.matches;
    }
    data.calendarCheckedAt = new Date(now).toISOString();
    checked = true;
  }
  const grouped = new Map();
  for (const m of data.matches) {
    if (!m.groupOrderId) continue;
    if (!grouped.has(m.groupOrderId)) grouped.set(m.groupOrderId, []);
    grouped.get(m.groupOrderId).push(m);
  }
  data.groupChecks ??= {};
  for (const groupId of matchdayOrder(data.matches)) {
    const members = grouped.get(groupId);
    if (!shouldPollGroup(members, data.groupChecks[groupId], now)) continue;
    // Last change date is cheaper than re-fetching the entire group after a correction.
    // The initial new result must still be fetched to avoid missed first updates.
    const force = members.some(m => !m.finished && nextDayDue(m.date, now));
    if (!force) {
      try {
        const stamp = await fetchJson(BASE + '/getlastchangedate/' + shortcut + '/' + year + '/' + groupId);
        if (stamp && String(stamp) === data.groupChanges?.[groupId]) {
          data.groupChecks[groupId] = new Date(now).toISOString();
          checked = true;
          continue;
        }
        if (stamp) {
          data.groupChanges ??= {};
          data.groupChanges[groupId] = String(stamp);
        }
      } catch {
        // A date check failure should not hide result corrections.
      }
    }
    const response = await fetchJson(BASE + '/getmatchdata/' + shortcut + '/' + year + '/' + groupId);
    if (Array.isArray(response) && response.length) {
      const merged = mergeMatches(data.matches, response.map(normalizeMatch));
      data.matches = merged.matches;
      changed ||= merged.changed;
    }
    data.groupChecks[groupId] = new Date(now).toISOString();
    checked = true;
  }
  if (changed || checked && (now - Date.parse(data.updatedAt || 0) > 7 * dayMs)) {
    const table = await fetchJson(BASE + '/getbltable/' + shortcut + '/' + year);
    if (Array.isArray(table) && table.length) {
      const standings = normalizeTable(table);
      changed ||= JSON.stringify(data.standings) !== JSON.stringify(standings);
      data.standings = standings;
    }
  }
  data.teams = fixtureTeams(data.matches, data.standings);
  if (changed) data.updatedAt = new Date(now).toISOString();
  // A season with postponed games remains open until every scheduled game is finished.
  const lastDate = Math.max(...data.matches.map(m => Date.parse(m.date) || 0), 0);
  if (lastDate && now >= lastDate + 16 * dayMs &&
      data.matches.length && data.matches.every(m => m.finished)) {
    data.complete = true;
    changed = true;
  }
  return changed || checked ? data : saved;
}
