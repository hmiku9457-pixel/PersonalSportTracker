import { loadJson } from './data-loader.js';
import { matchdayNumbers, matchdayScore, pointsSeries, teamsForSeason,
  standingsFromMatches, rankAtMatchday, teamBounds } from './football-utils.js';
import { calculateUclStandings, calculateUclRankLimits, preferOfficialUclTable, isCompleteUclLeaguePhase } from './champions-league-utils.js';

const LEAGUES = {
  bundesliga: '1. Bundesliga',
  bundesliga2: '2. Bundesliga',
  liga3: '3. Liga',
  'champions-league': 'Champions League'
};
const leagueSelect = document.querySelector('#football-league');
const seasonSelect = document.querySelector('#football-season');
const heading = document.querySelector('#football-heading');
const status = document.querySelector('#football-status');
const info = document.querySelector('#football-info');
const output = document.querySelector('#football-content');
const dialog = document.querySelector('#football-dialog');
const dialogTitle = document.querySelector('#football-dialog-title');
const dialogBody = document.querySelector('#football-dialog-body');
document.querySelector('#football-dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

let leagueId = 'bundesliga';
let season = null;
let teams = [];
let shown = new Set();
let selectedTeam = null;
let page = 0;
let pageSize = calculatePageSize();
let requestId = 0;
const roundRankCache = new Map();
function rankFor(teamId, round) {
  if (leagueId !== 'champions-league')
    return rankAtMatchday(season, teamId, round);
  if (!roundRankCache.has(round))
    roundRankCache.set(round, calculateUclStandings(season.matches, teams, round));
  return roundRankCache.get(round)
    .find(team => String(team.teamId) === String(teamId))?.position ?? null;
}

const NS = 'http://www.w3.org/2000/svg';
const fmt = value => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
const name = team => team.shortName || team.name || team.teamId;
const shortSeason = year => year + '/' + String(Number(year)+1).slice(-2);
function calculatePageSize() {
  return innerWidth < 620 ? 4 : innerWidth < 1000 ? 7 : 12;
}
function el(tag, cls = '', content = null) {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (content !== null) element.textContent = String(content);
  return element;
}
function svgEl(tag, attributes = {}) {
  const item = document.createElementNS(NS, tag);
  for (const [key,value] of Object.entries(attributes)) item.setAttribute(key, value);
  return item;
}
function action(label, fn, css = '') {
  const result = el('button', 'f1-button ' + css, label);
  result.type = 'button';
  result.addEventListener('click', fn);
  return result;
}
function panel(title, extra = '') {
  const result = el('section', 'detail-card football-panel ' + extra);
  result.append(el('h2', '', title));
  return result;
}
function color(id) {
  // Stable across seasons and refreshes; neutral enough to distinguish clubs.
  let hash = 0;
  for (const c of String(id)) hash = (hash * 37 + c.charCodeAt(0)) % 360;
  return 'hsl(' + hash + ' 72% 66%)';
}
function chooseTeam(id) {
  selectedTeam = selectedTeam === id ? null : id;
  if (selectedTeam) shown.add(id);
  render();
}
function makeTable(headers) {
  const table = el('table', 'football-detail-table');
  const thead = el('thead');
  const head = el('tr');
  for (const h of headers) head.append(el('th', '', h));
  thead.append(head);
  const body = el('tbody');
  table.append(thead, body);
  return [table, body];
}
function highlightLeague(position, team = null) {
  if (leagueId === 'champions-league') {
    if (team?.tieCrossesZone) return ''; // Qualification boundary not resolved by UEFA interim criteria.
    if (position >= 1 && position <= 8) return 'zone-promotion';
    if (position <= 24) return 'zone-champions-league-playoff';
    if (position <= 36) return 'zone-relegation';
    return '';
  }
  if (leagueId === 'bundesliga') {
    if (position === 1) return 'zone-champion';
    if (position <= 4) return 'zone-champions-league';
    if (position === 5) return 'zone-europa-league';
    if (position === 6) return 'zone-conference-league';
    if (position === 16) return 'zone-relegation-playoff';
    if (position >= 17) return 'zone-relegation';
  } else if (leagueId === 'bundesliga2') {
    if (position <= 2) return 'zone-promotion';
    if (position === 3) return 'zone-promotion-playoff';
    if (position === 16) return 'zone-relegation-playoff';
    if (position >= 17) return 'zone-relegation';
  } else if (leagueId === 'liga3') {
    if (position <= 2) return 'zone-promotion';
    if (position === 3) return 'zone-promotion-playoff';
    if (position >= 17) return 'zone-relegation';
  }
  return '';
}
function rowSelection(tr, team) {
  tr.classList.add('football-selectable');
  tr.tabIndex = 0;
  tr.setAttribute('role', 'button');
  tr.setAttribute('aria-label', team.name + ' markieren');
  tr.addEventListener('click', () => chooseTeam(team.teamId));
  tr.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); chooseTeam(team.teamId);}
  });
  if (selectedTeam === team.teamId) tr.classList.add('football-focused');
}
function panelStandings() {
  const block = panel((leagueId === 'champions-league' ? 'Ligaphasen-Tabelle · ' : 'Tabelle · ') +
    (season.seasonLabel || shortSeason(season.year)));
  const leagueRows = season.standings?.length ? season.standings : standingsFromMatches(season);
  const [table, body] = makeTable(['#', 'Team', 'Sp.', 'Pkt.', 'TD', 'Tore',
    leagueId==='champions-league' ? 'Best ≥' : 'Best*',
    leagueId==='champions-league' ? 'Worst ≤' : 'Worst*']);
  for (const team of leagueRows) {
    const tr = el('tr', highlightLeague(team.position, team));
    const info = teams.find(item => String(item.teamId) === String(team.teamId)) || team;
    const bounds = leagueId==='champions-league' ?
      calculateUclRankLimits(season, team.teamId) : teamBounds(season, team.teamId);
    const columns = [
      (leagueId==='champions-league' && team.provisionalTie ? team.position+'=' : team.position),
      team.name, team.played, team.points,
      team.goalDifference > 0 ? '+' + team.goalDifference : team.goalDifference,
      team.goalsFor + ':' + team.goalsAgainst,
      bounds.best ? bounds.best + '.' : '–', bounds.worst ? bounds.worst + '.' : '–'
    ];
    for (const item of columns) tr.append(el('td','',item));
    tr.children[1].classList.add('football-team-stripe');
    tr.children[1].style.setProperty('--club-color', color(team.teamId));
    rowSelection(tr, info);
    body.append(tr);
  }
  block.append(table);
  const remaining = season.matches.some(m => !m.finished);
  block.append(el('p', 'f1-card-note', remaining ?
    (leagueId==='champions-league'
      ? 'Best ≥ / Worst ≤: Nachweisbare äußere Ranggrenzen, keine garantiert erreichbaren Platzierungen. '+
        'Die Gesamtpunktzahl aller ausstehenden Spiele wird berücksichtigt; genaue Restspiel-Szenarien sind noch nicht vollständig optimiert.'
      : '* Best/Worst sind mathematische äußere Platzierungsgrenzen, keine nachweislich erreichbaren Szenarien. Torgleichstände, direkte Duelle und das noch ausstehende Spielprogramm können die Spanne einschränken.') :
    'Die abgeschlossene Tabelle zeigt die Endplatzierungen. Bei fehlenden offiziellen Tabellen werden Spielresultate ausgewertet.'));
  if (leagueId === 'champions-league')
    block.append(el('p', 'f1-card-note',
      'Plätze 1–8: direktes Achtelfinale · 9–24: Playoffs · 25–36: ausgeschieden. ' +
      (season.complete
        ? 'Die endgültige Rangfolge kann bei vollständigem Gleichstand zusätzliche UEFA-Kriterien benötigen.'
        : 'Bis einschließlich Spieltag 7 zählen bei Punktgleichheit fünf UEFA-Kriterien. Bei weiterem Gleichstand steht = für den geteilten Rang; eine an der Zonengrenze offene Entscheidung bleibt ungefärbt.')+
      (season.standingsVerified ? ' Punkte und Tore wurden mit OpenLigaDB abgeglichen.' : '')));
  return block;
}
function panelChart() {
  const block = panel(leagueId === 'champions-league'
    ? 'Punkteentwicklung · Ligaphase' : 'Punkteentwicklung · Teams', 'football-wide');
  const toolbar = el('div', 'f1-chart-toolbar');
  const legend = el('div', 'f1-driver-legend');
  for (const team of teams) {
    const active = shown.has(team.teamId);
    const chip = action(name(team), () => {
      if (active) shown.delete(team.teamId);
      else shown.add(team.teamId);
      if (selectedTeam && !shown.has(selectedTeam)) selectedTeam = null;
      render();
    }, 'football-team-chip ' + (active ? '' : 'f1-driver-chip--off'));
    chip.style.setProperty('--club-color', color(team.teamId));
    chip.setAttribute('aria-pressed', String(active));
    chip.title = team.name;
    if (selectedTeam === team.teamId) chip.classList.add('f1-chip-focused');
    legend.append(chip);
  }
  const controls = el('div', 'f1-chart-commands');
  controls.append(action('Alle', () => {
    shown = new Set(teams.map(t=>t.teamId)); render();
  }), action('Keine', () => {shown.clear(); selectedTeam = null; render();}));
  if (leagueId === 'champions-league')
    controls.prepend(action('Top 8', () => {
      const cutoff=teams[7]?.position ?? 8;
      shown = new Set(teams.filter(t => Number(t.position) <= cutoff).map(t => t.teamId));
      selectedTeam = null;
      render();
    }));
  toolbar.append(legend, controls);
  block.append(toolbar);
  const rounds = matchdayNumbers(season);
  const completedRounds = rounds.filter(round => season.matches.some(m => m.groupOrderId === round && m.finished));
  if (!completedRounds.length) {
    block.append(el('p','f1-muted','Noch keine abgeschlossenen Spiele in dieser Saison.'));
    return block;
  }
  const width = Math.max(780, 95 + (completedRounds.length-1) * 34);
  const height = 338;
  const x0=46, xMax=width-22, y0=18, yMax=291;
  const series = teams.filter(t=>shown.has(t.teamId)).map(team => ({
    team,
    values: pointsSeries(season, team.teamId).filter(point=>completedRounds.includes(point.round))
  }));
  const maximum = Math.max(12, ...series.flatMap(x=>x.values.map(p=>p.total)));
  const maxY = Math.ceil(maximum/12)*12;
  const x = index => x0 + index / Math.max(1,completedRounds.length-1)*(xMax-x0);
  const y = points => yMax - points/maxY*(yMax-y0);
  const scroll = el('div','f1-chart-scroll football-chart-scroll');
  const svg = svgEl('svg', {
    viewBox: '0 0 ' + width + ' ' + height,
    role: 'img', 'aria-label':'Kumulierter Punkteverlauf der ausgewählten Fußballmannschaften'
  });
  svg.style.minWidth = width + 'px';
  svg.style.width = '100%';
  for(let n=0;n<=4;n++){
    const score=n*maxY/4;
    const yy=y(score);
    svg.append(svgEl('line',{x1:x0,x2:xMax,y1:yy,y2:yy,class:'f1-chart-grid-line'}));
    const label=svgEl('text',{x:x0-9,y:yy+4,'text-anchor':'end',class:'f1-chart-label'});
    label.textContent=fmt(score);
    svg.append(label);
  }
  completedRounds.forEach((round,index)=>{
    if(index%Math.max(1,Math.ceil(completedRounds.length/12))!==0 && index!==completedRounds.length-1) return;
    const label=svgEl('text',{x:x(index),y:yMax+25,'text-anchor':'middle',class:'f1-chart-label'});
    label.textContent='ST'+round;
    svg.append(label);
  });
  const hitGroup=svgEl('g');
  for(const {team,values} of series){
    const selected=selectedTeam===team.teamId;
    const faded=selectedTeam && !selected;
    const coords=values.map((pt,index)=>x(index)+','+y(pt.total)).join(' ');
    const line=svgEl('polyline',{
      points:coords,fill:'none',stroke:color(team.teamId),'stroke-width':selected?4:2.2,
      opacity:faded?0.16:0.95,'stroke-linejoin':'round','stroke-linecap':'round',
      class:'f1-chart-line'
    });
    svg.append(line);
    const hit=svgEl('polyline',{points:coords,fill:'none',stroke:'transparent',
      'stroke-width':13,'pointer-events':'stroke',class:'f1-chart-hit'});
    const title=svgEl('title');
    title.textContent=team.name+' – zum Hervorheben auswählen';
    hit.append(title);
    hit.addEventListener('click',()=>chooseTeam(team.teamId));
    hitGroup.append(hit);
    values.forEach((pt,index)=>{
      const dot=svgEl('circle',{cx:x(index),cy:y(pt.total),r:selected?4:2.6,
        fill:color(team.teamId),opacity:faded?0.2:1,
        tabindex:0,role:'button',class:'f1-chart-point',
        'aria-label':team.name+' nach Spieltag '+pt.round+': '+pt.total+' Punkte'});
      const tip=svgEl('title');
      tip.textContent=team.name+' · Spieltag '+pt.round+' · '+pt.total+
        ' Punkte · Tabellenrang '+rankFor(team.teamId,pt.round);
      dot.append(tip);
      dot.addEventListener('click',()=>showChartPosition(team,pt));
      dot.addEventListener('keydown',e=>{
        if(e.key==='Enter'||e.key===' '){e.preventDefault();showChartPosition(team,pt);}
      });
      hitGroup.append(dot);
    });
  }
  svg.append(hitGroup);
  scroll.append(svg);
  block.append(scroll);
  const readout=el('p','f1-chart-readout f1-muted',
    'Linie auswählen: Team hervorheben · Datenpunkt auswählen: Tabellenstand anzeigen.');
  readout.id='football-chart-readout';
  block.append(readout);
  return block;
}
function showChartPosition(team,point){
  selectedTeam=team.teamId;
  shown.add(team.teamId);
  render();
  const target=document.querySelector('#football-chart-readout');
  if(target) target.textContent=team.name+' · Spieltag '+point.round+' · '+point.total+
    ' Punkte · Tabellenrang '+rankFor(team.teamId,point.round)+
    ' (aus den bis zu diesem Spieltag erfassten Ergebnissen).';
}
function formatDate(value){
  if(!value)return 'Termin offen';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return String(value);
  return date.toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}
function score(match){
  return match.finished && match.result ? match.result.home+':'+match.result.away : 'Noch offen';
}
function showMatchday(team,round){
  const data=matchdayScore(season,team.teamId,round);
  dialogTitle.textContent='Spieltag '+round+' · '+season.seasonLabel;
  dialogBody.replaceChildren(el('p','f1-dialog-driver',team.name));
  for(const match of data.matches){
    const rival=String(match.homeTeamId)===String(team.teamId)?match.awayTeam:match.homeTeam;
    const home=String(match.homeTeamId)===String(team.teamId);
    const item=el('div','football-match-detail');
    item.append(el('h3','',home?'Heimspiel gegen '+rival:'Auswärtsspiel bei '+rival));
    item.append(el('p','',match.homeTeam+' '+score(match)+' '+match.awayTeam));
    item.append(el('p','f1-muted',formatDate(match.date)));
    const points=match.finished ? matchdayScore({matches:[match]},team.teamId,match.groupOrderId).points : null;
    item.append(el('p','',points===null?'Noch kein Ergebnis':points+' Punkte'));
    dialogBody.append(item);
  }
  dialogBody.append(el('p','f1-dialog-total',
    data.points===null?'Keine Punkte erfasst':'Spieltagspunkte: '+data.points+
    (data.status==='partial'?' (weitere Spiele offen)':'')));
  dialog.showModal();
}
function panelMatrix(){
  const block=panel('Punkte je Spieltag','football-wide');
  const rounds=matchdayNumbers(season);
  if(!rounds.length){block.append(el('p','f1-muted','Keine Spieltage vorhanden.'));return block;}
  const pages=Math.max(1,Math.ceil(rounds.length/pageSize));
  page=Math.max(0,Math.min(page,pages-1));
  const bar=el('div','f1-matrix-controls');
  const prev=action('‹ Zurück',()=>{page--;render();});
  prev.disabled=page===0;
  const next=action('Weiter ›',()=>{page++;render();});
  next.disabled=page>=pages-1;
  bar.append(prev,el('span','f1-muted','Spieltag '+rounds[page*pageSize]+
    '–'+rounds[Math.min(rounds.length-1,(page+1)*pageSize-1)]+' von '+rounds.at(-1)),next);
  block.append(bar);
  const display=rounds.slice(page*pageSize,(page+1)*pageSize);
  const viewport=el('div','f1-matrix-viewport');
  const table=el('table','f1-matrix football-matrix');
  const thead=el('thead'),head=el('tr');
  head.append(el('th','','Team'));
  for(const round of display) head.append(el('th','','ST '+round));
  thead.append(head);
  const body=el('tbody');
  for(const team of teams){
    const tr=el('tr',team.teamId===selectedTeam?'football-focused':'');
    const first=el('th','f1-matrix-driver');
    const select=action(name(team),()=>chooseTeam(team.teamId),'f1-matrix-name football-matrix-name');
    select.style.setProperty('--club-color',color(team.teamId));
    select.title=team.name;
    first.append(select);
    tr.append(first);
    for(const round of display){
      const state=matchdayScore(season,team.teamId,round);
      const td=el('td','f1-matrix-td');
      const displayPoints=state.status==='absent'?'–':state.status==='pending'?'·':fmt(state.points);
      const cell=action(displayPoints,()=>showMatchday(team,round),'f1-matrix-cell football-matrix-cell');
      cell.disabled=state.status==='absent';
      cell.classList.add(
        state.status==='absent'?'f1-heat-empty':
          state.status==='pending'?'football-heat-pending':
            state.points>=3?'f1-heat-high':state.points===1?'f1-heat-low':'f1-heat-zero');
      cell.title=team.name+' · Spieltag '+round+': '+
        (state.status==='pending'?'noch offen':state.status==='absent'?'kein Spiel':state.points+' Punkte')+
        (state.status==='partial'?' (teilweise offen)':'');
      td.append(cell);tr.append(td);
    }
    body.append(tr);
  }
  table.append(thead,body);viewport.append(table);block.append(viewport);
  block.append(el('p','f1-card-note',
    '3 = Sieg · 1 = Unentschieden · 0 = Niederlage · · = noch offen · – = kein Spiel. Ein Feld öffnet die Begegnung(en).'));
  return block;
}
function render(){
  if(!season)return;
  if(calculatePageSize()!==pageSize){page=0;pageSize=calculatePageSize();}
  output.replaceChildren(panelStandings(),panelChart(),panelMatrix());
  status.textContent='';
  if (leagueId === 'champions-league')
    output.append(el('p','f1-history-note',
      'Auswertung ausschließlich der acht Ligaspieltage; K.-o.-Spiele zählen nicht zum Punkteverlauf. ' +
      'Saisons vor 2024/25 nutzten ein anderes Gruppenformat und werden separat behandelt.'));
  const played=season.matches.filter(m=>m.finished).length;
  const utcNow=new Date();
  const currentYear=utcNow.getUTCFullYear()-(utcNow.getUTCMonth()<7?1:0);
  const seasonState=season.complete?'abgeschlossen':
    season.year<currentYear?'historische Daten teilweise unvollständig':'laufend';
  info.textContent=played+' von '+season.matches.length+' Spielen · '+seasonState+
    (leagueId==='champions-league'?' · '+teams.length+' von 36 Teams':'');
  if(leagueId==='champions-league' && teams.length!==36)
    output.append(el('p','f1-history-note',
      'Die Datenquelle enthält derzeit nicht alle 36 Vereine. Die Ligaphasen-Tabelle ist deshalb unvollständig.'));
}
async function loadSeason(year) {
  const token=++requestId;
  season=null;
  output.replaceChildren();
  status.textContent='Saison '+shortSeason(year)+' wird geladen …';
  try{
    const fetched=await loadJson('./data/football/'+leagueId+'/'+year+'.json');
    if(token!==requestId)return;
    if(!Array.isArray(fetched.matches))throw Error('Ungültiges Saisonformat');
    season=fetched;
    if (leagueId==='champions-league') {
      // Recompute even for historical/cached JSON so ranking fixes take effect
      // immediately without having to re-import entire seasons.
      const computed=calculateUclStandings(season.matches,season.teams??[]);
      const reviewed=preferOfficialUclTable(computed,season.standings??[],
        isCompleteUclLeaguePhase(season.matches));
      season.standings=reviewed.standings;
      season.standingsVerified=reviewed.verified;
    }
    teams=teamsForSeason(season);
    roundRankCache.clear();
    shown=new Set(teams.map(t=>t.teamId));
    selectedTeam=null;
    page=0;
    const url=new URL(location.href);
    url.searchParams.set('league',leagueId);
    url.searchParams.set('season',year);
    history.replaceState(null,'',url);
    render();
  }catch(error){
    if(token!==requestId)return;
    console.error(error);
    status.textContent='Saison konnte nicht geladen werden. Bitte die nächste Datenaktualisierung abwarten.';
  }
}
async function loadLeague(id,preferred=null){
  const token=++requestId;
  leagueId=id;
  season=null;
  output.replaceChildren();
  heading.textContent=LEAGUES[id]+' · Detailansicht';
  leagueSelect.value=id;
  seasonSelect.replaceChildren();
  status.textContent='Verfügbare Saisons werden geladen …';
  try{
    const catalog=await loadJson('./data/football/'+id+'/seasons.json');
    if(token!==requestId)return;
    const years=catalog.available??[];
    if(!years.length){status.textContent='Für diese Liga wurden noch keine Saisons importiert.';return;}
    for(const year of years){
      const option=el('option','',shortSeason(year));
      option.value=String(year);
      seasonSelect.append(option);
    }
    const chosen=years.includes(preferred)?preferred:years[0];
    seasonSelect.value=String(chosen);
    await loadSeason(chosen);
  }catch(error){
    if(token!==requestId)return;
    console.error(error);
    status.textContent='Das Saisonverzeichnis ist noch nicht verfügbar. Bitte nach dem nächsten GitHub-Actions-Lauf erneut versuchen.';
  }
}
leagueSelect.addEventListener('change',()=>loadLeague(leagueSelect.value));
seasonSelect.addEventListener('change',()=>loadSeason(Number(seasonSelect.value)));
window.addEventListener('resize',()=>{if(season&&calculatePageSize()!==pageSize)render();});
const params=new URLSearchParams(location.search);
const initialId=Object.hasOwn(LEAGUES,params.get('league'))?params.get('league'):'bundesliga';
const initialYear=Number(params.get('season'));
loadLeague(initialId,Number.isInteger(initialYear)?initialYear:null);
