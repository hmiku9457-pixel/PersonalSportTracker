import { loadJson } from './data-loader.js';
import { allDrivers, seriesFor, totalWeekendPoints, rankBounds, pointsRankAt } from './f1-utils.js';

const picker = document.querySelector('#f1-season');
const info = document.querySelector('#f1-season-info');
const status = document.querySelector('#f1-status');
const content = document.querySelector('#f1-detail-content');
const dialog = document.querySelector('#f1-race-dialog');
const dialogBody = document.querySelector('#f1-dialog-body');
const dialogTitle = document.querySelector('#f1-dialog-title');
document.querySelector('#f1-dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

let season = null;
let rows = [];
let shown = new Set();
let focusId = null;
let matrixPage = 0;
let matrixPageSize = getPageSize();

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = {
  red_bull: '#4076e1', mclaren: '#fa953a', ferrari: '#e84b4b',
  mercedes: '#49c6bd', aston_martin: '#57a887', alpine: '#ee82c5',
  williams: '#66a6ee', haas: '#b7b9c3', rb: '#8597eb',
  sauber: '#6cca70', audi: '#cb636b', cadillac: '#dbc5a5',
  renault: '#edca4d', force_india: '#eb94bd', toro_rosso: '#768fdd',
  lotus_f1: '#cabd7b', brawn: '#d6d6d6'
};

function getPageSize() {
  return window.innerWidth < 620 ? 4 : window.innerWidth < 1000 ? 6 : 10;
}
function elt(tag, cls = '', text = null) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== null) node.textContent = String(text);
  return node;
}
function svgElt(tag, props = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(props)) node.setAttribute(key, String(value));
  return node;
}
function button(label, callback, extraClass = '') {
  const node = elt('button', 'f1-button ' + extraClass, label);
  node.type = 'button';
  node.addEventListener('click', callback);
  return node;
}
function card(title, className = '') {
  const section = elt('section', 'detail-card f1-detail-card ' + className);
  section.append(elt('h2', '', title));
  return section;
}
function number(value) {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(Number(value || 0));
}
function pointStatus(item) {
  if (!item) return 'Keine Teilnahme';
  return (item.positionText ? 'P' + item.positionText : '–') +
    ' · ' + number(item.points) + ' Punkte' +
    (item.status ? ' · ' + item.status : '');
}
function selectDriver(id) {
  focusId = focusId === id ? null : id;
  if (focusId) shown.add(id);
  render();
}
function addFocus(row, id) {
  row.classList.add('f1-selectable');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', 'Fahrer ' + id + ' hervorheben');
  row.addEventListener('click', () => selectDriver(id));
  row.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectDriver(id);
    }
  });
}
function teamColor(driver) {
  const id = driver.currentConstructorId ?? driver.constructorIds?.at(-1) ?? '';
  if (PALETTE[id]) return PALETTE[id];
  let h = 0;
  for (const c of id || driver.driverId) h = (h * 33 + c.charCodeAt(0)) % 360;
  return 'hsl(' + h + ' 62% 65%)';
}
function dashFor(driver) {
  const mates = rows.filter(d => d.currentConstructorId &&
    d.currentConstructorId === driver.currentConstructorId);
  return mates.findIndex(d => d.driverId === driver.driverId) > 0 ? '8 5' : null;
}
function table(headers) {
  const result = elt('table', 'f1-standings-table');
  const thead = elt('thead');
  const tr = elt('tr');
  for (const h of headers) tr.append(elt('th', '', h));
  thead.append(tr);
  result.append(thead);
  const body = elt('tbody');
  result.append(body);
  return [result, body];
}
function td(text) { return elt('td', '', text); }
function labelValue(bounds, side) {
  if (!bounds[side]) return '–';
  return 'P' + bounds[side];
}
function panelStandings(type) {
  const isTeam = type === 'constructors';
  const items = isTeam ? (season.constructors ?? []) : rows;
  const panel = card(isTeam ? 'Konstrukteurs-WM' : 'Fahrer-WM');
  if (isTeam && !items.length) {
    panel.append(elt('p', 'f1-muted', 'In dieser Saison gab es noch keine Konstrukteursweltmeisterschaft.'));
    return panel;
  }
  const [result, body] = table(['#', isTeam ? 'Team' : 'Fahrer', 'Punkte', 'Best*', 'Worst*']);
  for (const item of items) {
    const tr = elt('tr');
    if (item.position >= 1 && item.position <= 3) tr.classList.add(['zone-gold', 'zone-silver', 'zone-bronze'][item.position - 1]);
    const label = isTeam ? item.name : item.name;
    const bounds = rankBounds(season, item, items, isTeam);
    tr.append(td(item.position ?? '–'), td(label), td(number(item.points)),
      td(labelValue(bounds, 'best')), td(labelValue(bounds, 'worst')));
    if (!isTeam) {
      addFocus(tr, item.driverId);
      if (item.driverId === focusId) tr.classList.add('f1-focused');
      const namedCell = tr.children[1];
      namedCell.style.setProperty('--driver-color', teamColor(item));
      namedCell.classList.add('f1-name-with-stripe');
    }
    body.append(tr);
  }
  panel.append(result);
  const explanation = elt('p', 'f1-card-note');
  const hasRemaining = season.races.some(r => !r.results?.length || (r.sprintDate && !r.sprintResults?.length));
  explanation.textContent = hasRemaining ?
    '* Mathematische äußere Ranggrenzen, keine garantierten oder exakt erreichbaren Szenarien. Gleichstände und gleichzeitig mögliche Resultate können die tatsächlich erreichbare Spanne einschränken.' :
    'Saisonwertung: Endplatzierung. Die Tabellenwerte stammen aus der offiziellen Saisonwertung.';
  panel.append(explanation);
  return panel;
}

function panelChart() {
  const panel = card('Punkteverlauf · Fahrer-WM', 'f1-wide');
  const toolbar = elt('div', 'f1-chart-toolbar');
  const legend = elt('div', 'f1-driver-legend');
  for (const driver of rows) {
    const active = shown.has(driver.driverId);
    const chip = button(driver.shortName || driver.familyName || driver.name, () => {
      if (active) shown.delete(driver.driverId);
      else shown.add(driver.driverId);
      if (focusId && !shown.has(focusId)) focusId = null;
      render();
    }, 'f1-driver-chip' + (active ? '' : ' f1-driver-chip--off'));
    chip.style.setProperty('--driver-color', teamColor(driver));
    chip.title = driver.name;
    chip.setAttribute('aria-pressed', String(active));
    if (focusId === driver.driverId) chip.classList.add('f1-chip-focused');
    legend.append(chip);
  }
  const commands = elt('div', 'f1-chart-commands');
  commands.append(button('Alle', () => { shown = new Set(rows.map(r => r.driverId)); render(); }),
    button('Keine', () => { shown.clear(); focusId = null; render(); }));
  toolbar.append(legend, commands);
  panel.append(toolbar);

  const plotted = season.races.filter(r => r.results?.length || r.sprintResults?.length);
  if (!plotted.length) {
    panel.append(elt('p', 'f1-muted', 'Für diese Saison sind noch keine Rennpunkte gespeichert.'));
    return panel;
  }
  const width = Math.max(760, 95 + (plotted.length - 1) * 42);
  const height = 340;
  const x1 = 48, x2 = width - 24, y1 = 20, y2 = 294;
  const visibleRows = rows.filter(d => shown.has(d.driverId));
  const traces = visibleRows.map(d => ({
    driver: d,
    points: seriesFor(season, d.driverId)
      .filter(point => point.race.results?.length || point.race.sprintResults?.length)
  }));
  const maxScore = Math.max(10, ...traces.flatMap(t => t.points.map(p => p.cumulative)));
  const maxY = Math.ceil(maxScore / 25) * 25;
  const x = index => x1 + index / Math.max(1, plotted.length - 1) * (x2 - x1);
  const y = score => y2 - score / maxY * (y2 - y1);
  const graph = elt('div', 'f1-chart-scroll');
  const svg = svgElt('svg', {
    viewBox: '0 0 ' + width + ' ' + height, role: 'img',
    'aria-label': 'Kumulierter Punkteverlauf aller eingeblendeten Fahrer'
  });
  svg.style.minWidth = width + 'px';
  svg.style.width = '100%';
  for (let tick = 0; tick <= 4; tick++) {
    const score = maxY * tick / 4;
    const yy = y(score);
    svg.append(svgElt('line', { x1, x2, y1: yy, y2: yy, class: 'f1-chart-grid-line' }));
    const axis = svgElt('text', { x: x1 - 10, y: yy + 4, class: 'f1-chart-label', 'text-anchor': 'end' });
    axis.textContent = number(score);
    svg.append(axis);
  }
  const step = Math.max(1, Math.ceil(plotted.length / 12));
  plotted.forEach((race, index) => {
    if (index % step !== 0 && index !== plotted.length - 1) return;
    const label = svgElt('text', { x: x(index), y: y2 + 23, class: 'f1-chart-label', 'text-anchor': 'middle' });
    label.textContent = 'R' + race.round;
    svg.append(label);
  });
  for (const trace of traces) {
    const driver = trace.driver;
    const color = teamColor(driver);
    const points = trace.points.map((point, i) => x(i) + ',' + y(point.cumulative)).join(' ');
    const isFocused = focusId === driver.driverId;
    const faded = focusId && !isFocused;
    const line = svgElt('polyline', {
      points, fill: 'none', stroke: color, 'stroke-width': isFocused ? 4 : 2,
      opacity: faded ? 0.18 : 0.95, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'stroke-dasharray': dashFor(driver) ?? 'none', class: 'f1-chart-line'
    });
    svg.append(line);
    // Wider, invisible hit-area for precise pointer/touch interaction.
    const hit = svgElt('polyline', {
      points, fill: 'none', stroke: 'transparent', 'stroke-width': 13,
      class: 'f1-chart-hit', 'pointer-events': 'stroke'
    });
    hit.addEventListener('click', () => selectDriver(driver.driverId));
    const title = svgElt('title');
    title.textContent = driver.name + ' – zum Hervorheben auswählen';
    hit.append(title);
    svg.append(hit);
    trace.points.forEach((point, i) => {
      const marker = svgElt('circle', {
        cx: x(i), cy: y(point.cumulative), r: isFocused ? 4 : 2.6,
        fill: color, opacity: faded ? 0.2 : 1, class: 'f1-chart-point',
        tabindex: '0', role: 'button', 'aria-label': driver.name + ', ' + point.race.name +
          ': ' + number(point.cumulative) + ' Punkte'
      });
      const tooltip = svgElt('title');
      tooltip.textContent = driver.name + ' · ' + point.race.name + ' · ' +
        number(point.cumulative) + ' Punkte · Punkte-Rang ' +
        pointsRankAt(season, point.index, driver.driverId, rows);
      marker.append(tooltip);
      marker.addEventListener('click', () => showChartReadout(driver, point));
      marker.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showChartReadout(driver, point); }
      });
      svg.append(marker);
    });
  }
  graph.append(svg);
  panel.append(graph);
  const readout = elt('p', 'f1-chart-readout f1-muted', 'Linie anklicken: Fahrer hervorheben · Punkt auswählen: Rennstand anzeigen.');
  readout.id = 'f1-chart-readout';
  panel.append(readout);
  return panel;
}
function showChartReadout(driver, point) {
  focusId = driver.driverId;
  shown.add(driver.driverId);
  render();
  const target = document.querySelector('#f1-chart-readout');
  if (target) target.textContent = driver.name + ' · ' + point.race.name +
    ' · ' + number(point.cumulative) + ' Punkte gesamt · Punkte-Rang ' +
    pointsRankAt(season, point.index, driver.driverId, rows) + ' (ohne Tie-Break).';
}

function raceResultLine(race, driverId, sprint = false) {
  const item = (sprint ? race.sprintResults : race.results)?.find(r => r.driverId === driverId);
  return pointStatus(item);
}
function openRaceDetail(race, driver) {
  dialogTitle.textContent = race.name + ' · ' + season.year;
  dialogBody.replaceChildren();
  const raceTitle = elt('p', 'f1-dialog-driver', driver.name);
  const raceLabel = elt('h3', '', 'Grand Prix');
  const raceValue = elt('p', '', raceResultLine(race, driver.driverId));
  dialogBody.append(raceTitle, raceLabel, raceValue);
  if (race.sprintDate) {
    dialogBody.append(elt('h3', '', 'Sprint'), elt('p', '', raceResultLine(race, driver.driverId, true)));
  }
  const total = totalWeekendPoints(race, driver.driverId);
  dialogBody.append(elt('p', 'f1-dialog-total',
    total === null ? 'Keine Teilnahme an diesem Wochenende' :
      'Wochenendpunkte: ' + number(total)));
  dialog.showModal();
}
function panelMatrix() {
  const panel = card('Punkte je Rennwochenende', 'f1-wide');
  const controls = elt('div', 'f1-matrix-controls');
  const pages = Math.max(1, Math.ceil(season.races.length / matrixPageSize));
  matrixPage = Math.min(matrixPage, pages - 1);
  const prev = button('‹ Zurück', () => { matrixPage--; render(); });
  prev.disabled = matrixPage === 0;
  const next = button('Weiter ›', () => { matrixPage++; render(); });
  next.disabled = matrixPage >= pages - 1;
  controls.append(prev, elt('span', 'f1-muted', 'Rennen ' + (matrixPage * matrixPageSize + 1) +
    '–' + Math.min(season.races.length, (matrixPage + 1) * matrixPageSize) +
    ' von ' + season.races.length), next);
  panel.append(controls);
  const segment = season.races.slice(matrixPage * matrixPageSize, (matrixPage + 1) * matrixPageSize);
  const scroll = elt('div', 'f1-matrix-viewport');
  const matrix = elt('table', 'f1-matrix');
  const thead = elt('thead'), heading = elt('tr');
  heading.append(elt('th', '', 'Fahrer'));
  for (const race of segment) {
    const head = elt('th', '', 'R' + race.round);
    head.title = race.name + (race.sprintDate ? ' (Sprint)' : '');
    heading.append(head);
  }
  thead.append(heading);
  const tbody = elt('tbody');
  for (const driver of rows) {
    const tr = elt('tr', driver.driverId === focusId ? 'f1-focused' : '');
    const first = elt('th', 'f1-matrix-driver');
    const driverButton = button(driver.shortName || driver.familyName || driver.name,
      () => selectDriver(driver.driverId), 'f1-matrix-name');
    driverButton.title = driver.name;
    driverButton.style.setProperty('--driver-color', teamColor(driver));
    first.append(driverButton);
    tr.append(first);
    for (const race of segment) {
      const entry = elt('td', 'f1-matrix-td');
      const pts = totalWeekendPoints(race, driver.driverId);
      const cell = button(pts === null ? '–' : number(pts),
        () => openRaceDetail(race, driver), 'f1-matrix-cell');
      cell.classList.add(pts === null ? 'f1-heat-empty' :
        pts === 0 ? 'f1-heat-zero' : pts >= 25 ? 'f1-heat-high' :
          pts >= 12 ? 'f1-heat-mid' : 'f1-heat-low');
      cell.title = driver.name + ' · ' + race.name + ': ' +
        (pts === null ? 'keine Teilnahme oder noch kein Ergebnis' : number(pts) + ' Punkte');
      entry.append(cell);
      tr.append(entry);
    }
    tbody.append(tr);
  }
  matrix.append(thead, tbody);
  scroll.append(matrix);
  panel.append(scroll);
  panel.append(elt('p', 'f1-card-note',
    'Wochenendpunkte = Grand Prix + Sprint. „–“ bedeutet keine erfasste Teilnahme. Eine Zelle öffnet die Einzelheiten.'));
  return panel;
}
function render() {
  if (!season) return;
  const nextPageSize = getPageSize();
  if (nextPageSize !== matrixPageSize) { matrixPage = 0; matrixPageSize = nextPageSize; }
  content.replaceChildren(panelStandings('drivers'), panelChart(), panelMatrix(), panelStandings('constructors'));
  status.textContent = '';
  const completed = season.races.filter(r => r.results?.length).length;
  info.textContent = completed + ' von ' + season.races.length + ' Grands Prix · ' +
    (season.complete ? 'abgeschlossene Saison' : 'laufende Saison');
  if (season.year <= 1990) {
    content.append(elt('p', 'f1-history-note',
      'Historische Wertungsregel: Bis 1990 konnten Streichresultate gelten. Der Linienchart zeigt aufsummierte erzielte Rennpunkte; die WM-Tabelle verwendet die offiziellen Wertungspunkte.'));
  }
}
async function loadSeason(year) {
  status.textContent = 'Saison ' + year + ' wird geladen …';
  content.replaceChildren();
  try {
    const data = await loadJson('./data/f1/' + year + '.json');
    if (!Array.isArray(data.races)) throw new Error('Ungültiges Datenformat.');
    season = data;
    rows = allDrivers(season);
    shown = new Set(rows.map(row => row.driverId));
    focusId = null;
    matrixPage = 0;
    const url = new URL(location.href);
    url.searchParams.set('season', String(year));
    history.replaceState(null, '', url);
    render();
  } catch (error) {
    console.error(error);
    status.textContent = 'Saison ' + year + ' konnte nicht geladen werden. Bitte nach dem nächsten Datenupdate erneut versuchen.';
  }
}
async function start() {
  try {
    const index = await loadJson('./data/f1/seasons.json');
    const years = index.available ?? [];
    if (!years.length) {
      status.textContent = 'Noch keine F1-Saisons importiert. Der nächste GitHub-Actions-Lauf bereitet die Daten vor.';
      return;
    }
    picker.replaceChildren(...years.map(year => {
      const option = elt('option', '', year);
      option.value = String(year);
      return option;
    }));
    const requested = Number(new URLSearchParams(location.search).get('season'));
    const year = years.includes(requested) ? requested : years[0];
    picker.value = String(year);
    picker.addEventListener('change', () => loadSeason(Number(picker.value)));
    await loadSeason(year);
  } catch (error) {
    console.error(error);
    status.textContent = 'Das Saisonverzeichnis konnte nicht geladen werden. Bitte nach dem nächsten Datenupdate erneut versuchen.';
  }
}
window.addEventListener('resize', () => {
  if (season && getPageSize() !== matrixPageSize) render();
});
start();
