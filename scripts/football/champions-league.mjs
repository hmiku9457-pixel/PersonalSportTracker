import { fetchJson } from '../lib/http.mjs';
import {
  normalizeMatch, normalizeTable, fixtureTeams,
  shouldPollGroup, seasonOverview
} from './season.mjs';
import {
  UCL_FIRST_SEASON, selectUclLeaguePhase, isCompleteUclLeaguePhase,
  calculateUclStandings, preferOfficialUclTable
} from '../../public/js/champions-league-utils.js';

const BASE='https://api.openligadb.de';
const dayMs=86400000;
const stamp=now=>new Date(now).toISOString();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fetchAll(year) {
  const result=await fetchJson(BASE+'/getmatchdata/ucl/'+year);
  if(!Array.isArray(result) || !result.length) return null;
  const league=selectUclLeaguePhase(result.map(normalizeMatch),year);
  if(!league.length) return null;
  return league;
}
async function rebuildStandings(matches, year) {
  const teams=fixtureTeams(matches);
  const computed=calculateUclStandings(matches,teams);
  let official=null;
  try {
    const fetched=await fetchJson(BASE+'/getbltable/ucl/'+year);
    official=normalizeTable(fetched);
  } catch (error) {
    console.warn('UCL official table unavailable; using match-derived rankings:',error.message);
  }
  const checked=preferOfficialUclTable(computed,official);
  // Persist only fields that are used by the detail view and dashboard.
  return {
    teams, standings:checked.standings,
    standingsVerified:checked.verified
  };
}
function isSeasonClosed(matches,now) {
  if(!isCompleteUclLeaguePhase(matches))return false;
  const last=Math.max(...matches.map(m=>Date.parse(m.date)||0),0);
  return Boolean(last && now>last+16*dayMs);
}
function matchComparable(match) {
  const {id,groupOrderId,date,finished,homeTeamId,awayTeamId,result,
    homeTeam,awayTeam,homeShortName,awayShortName}=match;
  return JSON.stringify({id,groupOrderId,date,finished,homeTeamId,awayTeamId,result,
    homeTeam,awayTeam,homeShortName,awayShortName});
}
function mergeLeague(existing,newMatches) {
  const oldById=new Map(existing.map(m=>[m.id,m]));
  const result=new Map(oldById);
  let changed=false;
  for(const m of newMatches){
    const original=oldById.get(m.id);
    if(!original || matchComparable(original)!==matchComparable(m))changed=true;
    result.set(m.id,m);
  }
  return {matches:[...result.values()].sort((a,b)=>
    a.groupOrderId-b.groupOrderId||String(a.date).localeCompare(String(b.date))),
    changed};
}
export async function fetchUclSeason(competition, year, { historical=false }={}) {
  if(year<UCL_FIRST_SEASON)return null;
  const matches=await fetchAll(year);
  if(!matches)return null;
  const tables=await rebuildStandings(matches,year);
  const now=Date.now();
  return {
    schemaVersion:1, id:competition.id,shortcut:'ucl',year,
    seasonLabel:year+'/'+String(year+1).slice(-2),
    type:'league-phase',phase:'league',
    complete:historical?isCompleteUclLeaguePhase(matches):isSeasonClosed(matches,now),
    calendarCheckedAt:stamp(now),updatedAt:stamp(now),
    matches, ...tables, groupChecks:{}, groupChanges:{}
  };
}
export async function updateUclSeason(saved, competition, year, now=Date.now()) {
  if(!saved)return fetchUclSeason(competition,year);
  if(saved.complete)return saved;
  const data=structuredClone(saved);
  let changed=false,checked=false;
  if(!data.calendarCheckedAt || now-Date.parse(data.calendarCheckedAt)>=7*dayMs){
    const newer=await fetchAll(year);
    if(newer){
      const next=mergeLeague(data.matches,newer);
      // Weekly full calendar snapshots are authoritative; remove any fixtures
      // subsequently canceled or moved out of the phase.
      changed ||= next.changed || next.matches.length!==newer.length;
      data.matches=newer;
    }
    data.calendarCheckedAt=stamp(now);
    checked=true;
  }
  data.groupChecks??={};
  data.groupChanges??={};
  const byGroup=new Map();
  for(const match of data.matches) {
    const original=match.sourceGroupOrderId??match.groupOrderId;
    if(!byGroup.has(original))byGroup.set(original,[]);
    byGroup.get(original).push(match);
  }
  for(const [sourceId,group] of byGroup) {
    if(!shouldPollGroup(group,data.groupChecks[sourceId],now))continue;
    const isPending=group.some(m=>!m.finished && m.date && now>=Date.parse(m.date)+dayMs);
    try {
      if (!sourceId) throw new Error('No provider group ID for change check');
      const value=await fetchJson(BASE+'/getlastchangedate/ucl/'+year+'/'+sourceId);
      const latest=value==null?'':typeof value==='string'?value:JSON.stringify(value);
      if(latest && data.groupChanges[sourceId]===latest && !isPending){
        data.groupChecks[sourceId]=stamp(now);
        checked=true;
        continue;
      }
      if(latest)data.groupChanges[sourceId]=latest;
    }catch {
      // Keep polling when OpenLigaDB's lightweight change endpoint is absent.
    }
    let changedMatches;
    if(byGroup.size===1 || !sourceId) {
      // The provider may store all eight matchdays under one source group.
      // In this case an updated full snapshot is required to re-cluster dates.
      changedMatches=await fetchAll(year);
      if(changedMatches) {
        const next=mergeLeague(data.matches,changedMatches);
        changed ||= next.changed;
        data.matches=changedMatches;
      }
    }else {
      const response=await fetchJson(BASE+'/getmatchdata/ucl/'+year+'/'+sourceId);
      if(Array.isArray(response)&&response.length) {
        const oldGroup=new Map(group.map(m=>[m.id,m]));
        const targetRound=group[0].groupOrderId;
        changedMatches=response.map(normalizeMatch)
          .filter(m=>!m.date || (
            new Date(m.date).getUTCFullYear()===year &&
              new Date(m.date).getUTCMonth()>=8 ||
            new Date(m.date).getUTCFullYear()===year+1 &&
              new Date(m.date).getUTCMonth()===0
          ))
          .map(m=>({
            ...m,
            groupOrderId:oldGroup.get(m.id)?.groupOrderId??targetRound,
            groupName:'Ligaphase · Spieltag '+(oldGroup.get(m.id)?.groupOrderId??targetRound),
            sourceGroupOrderId:sourceId
          }));
        if(changedMatches.length){
          const next=mergeLeague(data.matches,changedMatches);
          changed ||= next.changed;
          data.matches=next.matches;
        }
      }
    }
    data.groupChecks[sourceId]=stamp(now);
    checked=true;
  }
  if(changed){
    const tables=await rebuildStandings(data.matches,year);
    Object.assign(data,tables);
    data.updatedAt=stamp(now);
  }
  if(isSeasonClosed(data.matches,now)){
    data.complete=true;
    changed=true;
  }
  return changed||checked?data:saved;
}
export function uclOverview(season,competition) {
  const result=seasonOverview(season,competition);
  result.competition.type='league-phase';
  result.competition.phase='league';
  result.competition.standingsVerified=Boolean(season.standingsVerified);
  return result;
}
