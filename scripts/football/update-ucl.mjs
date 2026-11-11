import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchUclSeason, updateUclSeason, uclOverview } from './champions-league.mjs';
import { UCL_FIRST_SEASON } from '../../public/js/champions-league-utils.js';

async function readJson(path) {
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function writeIfDifferent(path,obj) {
  const text=JSON.stringify(obj,null,2)+'\n';
  const old=await readFile(path,'utf8').catch(e=>{
    if(e.code==='ENOENT')return null;throw e;
  });
  if(old===text)return false;
  await writeFile(path,text);
  return true;
}
export async function refreshUclArchive({dataDir,competition,currentYear}) {
  const folder=join(dataDir,'football','champions-league');
  await mkdir(folder,{recursive:true});
  const liveFile=join(folder,currentYear+'.json');
  const saved=await readJson(liveFile);
  let current;
  try {
    current=await updateUclSeason(saved,competition,currentYear);
    if(!current)throw new Error('Ligaphasendaten noch nicht verfügbar.');
    await writeIfDifferent(liveFile,current);
  }catch(error) {
    if(!saved)throw error;
    console.warn('UCL: keeping saved current season:',error.message);
    current=saved;
  }
  const max=Math.max(0,Math.min(4,Number(process.env.UCL_HISTORY_BATCH??2)||0));
  let count=0;
  for(let year=currentYear-1;year>=UCL_FIRST_SEASON && count<max;year--) {
    const target=join(folder,year+'.json');
    if(await readJson(target))continue;
    try {
      const data=await fetchUclSeason(competition,year,{historical:true});
      if(!data || !data.complete){
        console.warn('UCL '+year+'/'+(year+1)+': historical league phase is incomplete');
        break;
      }
      await writeIfDifferent(target,data);
      count++;
    }catch(error){
      console.warn('UCL historical season '+year+' postponed: '+error.message);
      break;
    }
  }
  const years=(await readdir(folder)).filter(name=>/^\d{4}\.json$/.test(name))
    .map(name=>Number(name.slice(0,4)))
    .filter(year=>year>=UCL_FIRST_SEASON)
    .sort((a,b)=>b-a);
  await writeIfDifferent(join(folder,'seasons.json'),{
    leagueId:competition.id, currentSeason:currentYear,
    format:'league-phase',startingSeason:UCL_FIRST_SEASON,
    available:years,
    pending:Math.max(0,currentYear-UCL_FIRST_SEASON+1-years.length)
  });
  return uclOverview(current,competition);
}
