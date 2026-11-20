import { loadJson } from './data-loader.js';
import { allDrivers, seriesFor, totalWeekendPoints, rankBounds, pointsRankAt, championshipGaps, funSessionChampionship } from './f1-utils.js';

const picker = document.querySelector('#f1-season');
const info = document.querySelector('#f1-season-info');
const status = document.querySelector('#f1-status');
const content = document.querySelector('#f1-detail-content');
const gpNavigation = document.querySelector('#f1-gp-navigation');
const dialog = document.querySelector('#f1-race-dialog');
const dialogBody = document.querySelector('#f1-dialog-body');
const dialogTitle = document.querySelector('#f1-dialog-title');
document.querySelector('#f1-dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

let season = null;
let rows = [];
let shown = new Set();
let focusId = null;
let selectedRound = null;
let seasonLoadToken = 0;
let chartZoom = 100;
let matrixScrollLeft = 0;

const NS = 'http://www.w3.org/2000/svg';
const PALETTE = {
  red_bull: '#4076e1', mclaren: '#fa953a', ferrari: '#e84b4b',
  mercedes: '#49c6bd', aston_martin: '#57a887', alpine: '#ee82c5',
  williams: '#66a6ee', haas: '#b7b9c3', rb: '#8597eb',
  sauber: '#6cca70', audi: '#cb636b', cadillac: '#dbc5a5',
  renault: '#edca4d', force_india: '#eb94bd', toro_rosso: '#768fdd',
  lotus_f1: '#cabd7b', brawn: '#d6d6d6'
};

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

const TEAM_LOGO_SLUGS = {
  ferrari: 'ferrari', mercedes: 'mercedes', mclaren: 'mclaren',
  red_bull: 'redbullracing', rb: 'racingbulls',
  aston_martin: 'astonmartin', alpine: 'alpine',
  williams: 'williams', haas: 'haasf1team',
  audi: 'audi', cadillac: 'cadillac',
  sauber: 'kicksauber', alfa: 'alfaromeo',
  alpha_tauri: 'alphatauri', alphatauri: 'alphatauri',
  toro_rosso: 'tororosso', force_india: 'forceindia',
  racing_point: 'racingpoint', renault: 'renault',
  lotus_f1: 'lotus', brawn: 'brawn', manor: 'manor',
  marussia: 'marussia', hrt: 'hrt', caterham: 'caterham'
};
function teamName(id) {
  const standing = season.constructors?.find(team => team.constructorId === id);
  if (standing?.name) return standing.name;
  for (const race of season.races ?? []) {
    const participant = [...(race.results ?? []), ...(race.sprintResults ?? [])]
      .find(item => item.constructorId === id && item.constructorName);
    if (participant) return participant.constructorName;
  }
  return id.replace(/_/g, ' ');
}
function teamBadge(id, secondary = false) {
  const name = teamName(id);
  const badge = elt('span', 'f1-team-badge' + (secondary ? ' f1-team-badge--previous' : ''));
  badge.title = name + (secondary ? ' · früheres Saisonteam' : ' · zuletzt gefahrenes Team');
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', badge.title);
  const fallback = () => {
    const words = id.split(/[_\s-]+/g);
    const abbrev = words.length > 1 ?
      words.map(part => part.slice(0, 1)).join('').slice(0, 3).toUpperCase() :
      id.slice(0, 2).toUpperCase();
    const mark = elt('span', 'f1-team-badge-fallback', abbrev);
    mark.style.setProperty('--team-logo-color', PALETTE[id] || '#64748b');
    badge.replaceChildren(mark);
  };
  const slug = TEAM_LOGO_SLUGS[id];
  if (!slug) {
    fallback();
    return badge;
  }
  const year = Number(season.year);
  // Formula1.com publishes full-colour "logo" marks from 2024 onward.
  // The original CDN endpoints do not require an image extension.
  // Earlier grids (2019–2023) used small coloured PNG marks instead.
  const oldSlugs = {
    red_bull: 'red-bull-racing', aston_martin: 'aston-martin',
    haas: 'haas-f1-team', sauber: 'alfa-romeo', alfa: 'alfa-romeo-racing',
    rb: 'alphatauri', alphatauri: 'alphatauri',
    toro_rosso: 'toro-rosso', force_india: 'force-india',
    racing_point: 'racing-point'
  };
  const oldSlug = oldSlugs[id] || slug;
  const candidates = year >= 2024
    ? [...new Set([year, 2025, 2026])].filter(y => y >= 2024).flatMap(y => {
      const currentSlug = y === 2024 && id === 'rb' ? 'rb' :
        y === 2024 && id === 'haas' ? 'haas' : slug;
      return [
        'https://media.formula1.com/image/upload/common/f1/' + y + '/' +
          currentSlug + '/' + y + currentSlug + 'logo',
        'https://media.formula1.com/image/upload/common/f1/' + y + '/' +
          currentSlug + '/' + y + currentSlug + 'logo.svg'
      ];
    })
    : year >= 2019 ? [
      'https://media.formula1.com/content/dam/fom-website/teams/' + year + '/' + oldSlug + '-logo.png'
    ] : [];
  const urls = candidates;
  const img = elt('img', 'f1-team-badge-image');
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  let attempt = 0;
  img.addEventListener('error', () => {
    attempt++;
    if (attempt < urls.length) img.src = urls[attempt];
    else fallback();
  });
  if (!urls.length) {
    fallback();
    return badge;
  }
  img.src = urls[0];
  badge.append(img);
  return badge;
}
function teamBadgeCell(item, isTeam) {
  const cell = td('');
  cell.classList.add('f1-standings-logo-cell');
  const badges = elt('div', 'f1-team-badges');
  const teams = isTeam ? [item.constructorId] : (item.teamsThisSeason ?? []);
  for (const [i, id] of teams.entries()) if (id) badges.append(teamBadge(id, i > 0));
  if (!badges.childElementCount) badges.append(elt('span', 'f1-muted', '–'));
  cell.append(badges);
  return cell;
}
function formatGap(value) {
  return value === null || value === 0 ? '–' : '−' + number(value);
}

function panelStandings(type) {
  const isTeam = type === 'constructors';
  const items = isTeam ? (season.constructors ?? []) : rows;
  const panel = card(isTeam ? 'Konstrukteurs-WM' : 'Fahrer-WM');
  if (isTeam && !items.length) {
    panel.append(elt('p', 'f1-muted', 'In dieser Saison gab es noch keine Konstrukteursweltmeisterschaft.'));
    return panel;
  }
  const [result, body] = table(['#', '', isTeam ? 'Team' : 'Fahrer', 'Pkt.',
    'Δ 1.', 'Δ davor', 'Best*', 'Worst*']);
  result.classList.add('f1-standings-table--logos');
  result.tHead.rows[0].cells[1].setAttribute('aria-label', 'Teamlogos');
  result.tHead.rows[0].cells[4].title = 'Punkterückstand auf die führende Position';
  result.tHead.rows[0].cells[5].title = 'Punkterückstand auf die Position unmittelbar davor';
  for (const [index, item] of items.entries()) {
    const tr = elt('tr');
    if (item.position >= 1 && item.position <= 3) tr.classList.add(['zone-gold', 'zone-silver', 'zone-bronze'][item.position - 1]);
    const bounds = rankBounds(season, item, items, isTeam);
    const gaps = championshipGaps(items, index);
    tr.append(td(item.position ?? '–'), teamBadgeCell(item, isTeam), td(item.name),
      td(number(item.points)), td(formatGap(gaps.leader)),
      td(formatGap(gaps.previous)), td(labelValue(bounds, 'best')),
      td(labelValue(bounds, 'worst')));
    if (isTeam) {
      tr.classList.add('f1-constructor-row');
      tr.style.setProperty('--team-row-color', PALETTE[item.constructorId] || '#64748b');
    } else {
      addFocus(tr, item.driverId);
      if (item.driverId === focusId) tr.classList.add('f1-focused');
      const color = teamColor(item);
      // The continuous accent extends across both the logo and driver name.
      for (const cell of [tr.children[1], tr.children[2]]) {
        cell.style.setProperty('--driver-color', color);
        cell.classList.add('f1-name-with-stripe');
      }
    }
    body.append(tr);
  }
  const wrap = elt('div', 'f1-standings-viewport');
  wrap.append(result);
  panel.append(wrap);
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
  const driverCommands = elt('div', 'f1-chart-driver-commands');
  driverCommands.append(button('Alle', () => { shown = new Set(rows.map(r => r.driverId)); render(); }),
    button('Keine', () => { shown.clear(); focusId = null; render(); }));
  commands.append(driverCommands);
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
  // At 100%, the complete chart fits the card. Larger percentages enable
  // horizontal scrolling; the SVG's native aspect ratio is preserved.
  svg.style.width = chartZoom + '%';
  svg.style.minWidth = '0';
  const zoomControls = elt('div', 'f1-chart-zoom-controls');
  const zoomOut = button('−', () => changeZoom(chartZoom - 25), 'f1-chart-zoom-button');
  const zoomIn = button('+', () => changeZoom(chartZoom + 25), 'f1-chart-zoom-button');
  const zoomValue = elt('output', 'f1-chart-zoom-value');
  const fit = button('Anpassen', () => changeZoom(100), 'f1-chart-zoom-fit');
  zoomOut.setAttribute('aria-label', 'Punkteverlauf verkleinern');
  zoomIn.setAttribute('aria-label', 'Punkteverlauf vergrößern');
  zoomValue.setAttribute('aria-live', 'polite');
  function changeZoom(next) {
    chartZoom = Math.max(75, Math.min(250, next));
    svg.style.width = chartZoom + '%';
    zoomValue.textContent = chartZoom + '%';
    zoomOut.disabled = chartZoom <= 75;
    zoomIn.disabled = chartZoom >= 250;
    fit.disabled = chartZoom === 100;
    if (chartZoom <= 100) graph.scrollLeft = 0;
  }
  zoomControls.append(zoomOut, zoomValue, zoomIn, fit);
  commands.append(zoomControls);
  changeZoom(chartZoom);
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
  const segment = season.races;
  const scroll = elt('div', 'f1-matrix-viewport');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Rennwochenenden horizontal durchscrollen');
  scroll.addEventListener('scroll', () => { matrixScrollLeft = scroll.scrollLeft; }, { passive: true });
  const matrix = elt('table', 'f1-matrix');
  const thead = elt('thead'), heading = elt('tr');
  heading.append(elt('th', '', 'Fahrer'));
  for (const race of segment) {
    const head = elt('th', 'f1-matrix-gp-heading');
    const gpButton = button('', () => {
      selectedRound = Number(race.round);
      updateAddress();
      render();
      window.scrollTo({ top: 0, behavior: 'auto' });
    }, 'f1-matrix-gp-button');
    gpButton.title = race.name + ' · ' + venueName(race) + (race.sprintDate ? ' (Sprint)' : '');
    gpButton.setAttribute('aria-label', 'Grand Prix öffnen: ' + gpButton.title);
    const circle = elt('span', 'f1-gp-circle');
    circle.append(flagImage(race.country));
    gpButton.append(circle, elt('span', 'f1-gp-label', venueName(race)));
    head.append(gpButton);
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
    'Horizontal scrollen für weitere Rennwochenenden. Wochenendpunkte = Grand Prix + Sprint. „–“ bedeutet keine erfasste Teilnahme. Eine Zelle öffnet die Einzelheiten.'));
  return panel;
}

const COUNTRY_CODES = {
  argentina: 'AR', australia: 'AU', austria: 'AT', azerbaijan: 'AZ',
  bahrain: 'BH', belgium: 'BE', brazil: 'BR', brasil: 'BR',
  canada: 'CA', china: 'CN', france: 'FR', germany: 'DE',
  hungary: 'HU', india: 'IN', italy: 'IT', japan: 'JP',
  korea: 'KR', 'south korea': 'KR', malaysia: 'MY', mexico: 'MX',
  monaco: 'MC', morocco: 'MA', netherlands: 'NL', holland: 'NL',
  portugal: 'PT', qatar: 'QA', russia: 'RU', 'saudi arabia': 'SA',
  singapore: 'SG', 'south africa': 'ZA', spain: 'ES', sweden: 'SE',
  switzerland: 'CH', turkey: 'TR', türkiye: 'TR',
  uae: 'AE', 'united arab emirates': 'AE', 'abu dhabi': 'AE',
  uk: 'GB', 'united kingdom': 'GB', 'great britain': 'GB',
  usa: 'US', us: 'US', 'united states': 'US', 'united states of america': 'US'
};
function flagImage(country) {
  const code = COUNTRY_CODES[String(country || '').trim().toLowerCase()];
  if (!code) return elt('span', 'f1-flag-fallback', '🏁');
  const image = elt('img', 'f1-gp-flag');
  image.src = 'https://flagcdn.com/w80/' + code.toLowerCase() + '.png';
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.loading = 'lazy';
  image.decoding = 'async';
  image.draggable = false;
  image.addEventListener('error', () => image.replaceWith(elt('span', 'f1-flag-fallback', '🏁')));
  return image;
}
function venueName(race) {
  return race.locality || race.circuit || race.name;
}
function updateAddress() {
  const url = new URL(location.href);
  url.searchParams.set('season', String(season.year));
  if (selectedRound !== null) url.searchParams.set('round', String(selectedRound));
  else url.searchParams.delete('round');
  history.replaceState(null, '', url);
}
function renderGPNav() {
  const previousYear = gpNavigation.dataset.season;
  const previousScroll = gpNavigation.scrollLeft;
  gpNavigation.dataset.season = String(season.year);
  const track = elt('div', 'f1-gp-track');
  function item(label, graphic, selected, onSelect, title, extraClass = '') {
    const node = button('', onSelect, 'f1-gp-button' +
      (selected ? ' f1-gp-button--selected' : '') + extraClass);
    node.setAttribute('aria-pressed', String(selected));
    node.setAttribute('aria-label', title);
    node.title = title;
    const circle = elt('span', 'f1-gp-circle');
    circle.append(typeof graphic === 'string' ? document.createTextNode(graphic) : graphic);
    node.append(circle, elt('span', 'f1-gp-label', label));
    track.append(node);
  }
  item('Season', '🏆', selectedRound === null, () => {
    selectedRound = null;
    updateAddress();
    render();
  }, 'Saisonübersicht ' + season.year, ' f1-gp-button--season');
  for (const race of season.races) {
    const round = Number(race.round);
    item(venueName(race), flagImage(race.country), selectedRound === round, () => {
      selectedRound = round;
      updateAddress();
      render();
    }, race.name + ' · ' + venueName(race) + ' · ' + season.year);
  }
  gpNavigation.replaceChildren(track);
  if (previousYear === String(season.year)) {
    gpNavigation.scrollLeft = previousScroll;
  } else {
    const activeIndex = selectedRound === null ? 0 :
      season.races.findIndex(r => Number(r.round) === selectedRound) + 1;
    const selected = track.children[activeIndex];
    gpNavigation.scrollLeft = selected ?
      Math.max(0, selected.offsetLeft + selected.offsetWidth / 2 - gpNavigation.clientWidth / 2) : 0;
  }
}
function weekendDate(date) {
  if (!date) return 'Termin noch offen';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? 'Termin noch offen' :
    parsed.toLocaleDateString('de-DE', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' });
}
function weekendParticipants(race) {
  const source = race.results?.length ? race.results :
    race.sprintResults?.length ? race.sprintResults : rows;
  const seen = new Set();
  return source.filter(driver => {
    if (!driver.driverId || seen.has(driver.driverId)) return false;
    seen.add(driver.driverId);
    return true;
  }).slice(0, 24);
}
function demoMillis(race, sessionName, position, phase = 0) {
  const base = 75500 + (Number(race.round) * 1237 % 19500);
  const session = [...sessionName].reduce((n, c) => n + c.charCodeAt(0), 0);
  return base + (session % 1100) + position * 154 +
    (position * position % 13) * 14 - phase * 810;
}
function lapTime(millis) {
  const wholeMinutes = Math.floor(millis / 60000);
  const seconds = ((millis % 60000) / 1000).toFixed(3).padStart(6, '0');
  return wholeMinutes + ':' + seconds;
}
function sessionTable(headers) {
  const [result, body] = table(headers);
  result.classList.add('f1-session-table');
  const wrap = elt('div', 'f1-session-table-wrap');
  wrap.append(result);
  return { wrap, body };
}
function sessionTitle(panel, label, demo) {
  // card() already creates an h2; add an unambiguous demo label beside it.
  const heading = elt('div', 'f1-session-heading');
  const title = panel.querySelector('h2');
  heading.append(title);
  if (demo) heading.append(elt('span', 'f1-demo-badge', 'DEMO'));
  panel.prepend(heading);
}
function resultSession(race, isSprint = false) {
  const title = isSprint ? 'Sprint-Rennen' : 'Rennen';
  const panel = card(title, 'f1-session-result');
  sessionTitle(panel, title, false);
  const items = isSprint ? race.sprintResults : race.results;
  panel.append(elt('p', 'f1-muted f1-session-meta', isSprint ?
    'Gespeichertes Sprintergebnis' : 'Gespeichertes Rennergebnis'));
  if (!items?.length) {
    panel.append(elt('p', 'f1-muted', 'Noch kein Ergebnis gespeichert.'));
    return panel;
  }
  const { wrap, body } = sessionTable(['#', 'Fahrer', 'Team', 'Pkt.']);
  for (const item of items) {
    const tr = elt('tr');
    const position = item.positionText || item.position || '–';
    tr.append(td(position), td(item.name || item.driverId), td(item.constructorName || '–'),
      td(number(item.points)));
    tr.children[1].classList.add('f1-session-name');
    tr.children[1].title = item.name || '';
    tr.children[2].classList.add('f1-session-status');
    tr.children[2].title = (item.constructorName || '') + (item.status ? ' · ' + item.status : '');
    body.append(tr);
  }
  panel.append(wrap);
  return panel;
}
function demoSession(race, name) {
  const qualifying = name === 'Qualifying' || name === 'Sprint-Qualifying';
  const panel = card(name, 'f1-demo-session');
  sessionTitle(panel, name, true);
  panel.append(elt('p', 'f1-muted f1-session-meta', 'Beispielzeiten – keine echten Session-Ergebnisse'));
  const drivers = weekendParticipants(race);
  if (!drivers.length) {
    panel.append(elt('p', 'f1-muted', 'Keine Fahrerdaten vorhanden.'));
    return panel;
  }
  // Reproducible fictitious positions and lap times; never modify real results.
  const ranked = drivers.map((d, index) => ({
    driver: d,
    order: (index * 37 + Number(race.round) * 23 +
      name.length * 17) % 997
  })).sort((a, b) => a.order - b.order);
  const shortColumn = name !== 'Qualifying' && name !== 'Sprint-Qualifying';
  const headers = qualifying ?
    ['#', 'Fahrer', name === 'Qualifying' ? 'Q1' : 'SQ1',
      name === 'Qualifying' ? 'Q2' : 'SQ2',
      name === 'Qualifying' ? 'Q3' : 'SQ3'] :
    ['#', 'Fahrer', 'Zeit', 'Abstand'];
  const { wrap, body } = sessionTable(headers);
  ranked.forEach((entry, i) => {
    const tr = elt('tr');
    const fullName = entry.driver.name || entry.driver.driverId;
    const label = shortColumn ? (entry.driver.shortName || entry.driver.familyName || fullName) :
      (entry.driver.familyName || entry.driver.name || entry.driver.driverId);
    const nameCell = td(label);
    nameCell.classList.add('f1-session-name');
    nameCell.title = fullName;
    tr.append(td(i + 1), nameCell);
    if (qualifying) {
      for (let phase = 0; phase < 3; phase++) {
        const cutoff = phase === 0 ? ranked.length : phase === 1 ? 15 : 10;
        tr.append(td(i < cutoff ? lapTime(demoMillis(race, name, i, phase)) : '–'));
      }
    } else {
      const fastest = demoMillis(race, name, 0);
      tr.append(td(lapTime(demoMillis(race, name, i))),
        td(i === 0 ? '–' : '+' + ((demoMillis(race, name, i) - fastest) / 1000).toFixed(3)));
    }
    body.append(tr);
  });
  panel.append(wrap);
  return panel;
}
function practiceSession(race, name) {
  // Initial rollout: OpenF1 practice results only for the 2026 championship.
  if (Number(season.year) !== 2026) return demoSession(race, name);
  const panel = card(name, 'f1-practice-session');
  sessionTitle(panel, name, false);
  const session = race.practiceSessions?.[name];
  if (!session?.results?.length) {
    panel.append(elt('p', 'f1-muted f1-session-meta',
      'OpenF1 · ' + (session ? 'Ergebnis noch nicht verfügbar' : 'Noch keine Trainingsdaten gespeichert')));
    return panel;
  }
  panel.append(elt('p', 'f1-muted f1-session-meta', 'OpenF1 · schnellste Runden'));
  const { wrap, body } = sessionTable(['#', 'Fahrer', 'Zeit', 'Abstand', 'Rd.']);
  for (const result of session.results) {
    const tr = elt('tr');
    const driverName = result.name || result.shortName || String(result.driverNumber);
    const short = result.shortName || driverName;
    const nameCell = td(short);
    nameCell.classList.add('f1-session-name');
    nameCell.title = driverName;
    const gap = typeof result.gap === 'number' ?
      (result.gap === 0 ? '–' : '+' + result.gap.toFixed(3)) :
      result.gap || '–';
    tr.append(td(result.position ?? '–'), nameCell,
      td(result.time > 0 ? lapTime(Math.round(result.time * 1000)) : '–'),
      td(gap), td(result.laps ?? '–'));
    body.append(tr);
  }
  panel.append(wrap);
  return panel;
}


function panelFunChampionship(type) {
  const { completed, scheduled, rows: standings } = funSessionChampionship(season, type);
  const panel = card(type + ' · Spaß-WM', 'f1-fun-championship');
  const recordedLabel = type === 'Qualifying' ? 'Qualifyings' : 'Trainings';
  panel.append(elt('p', 'f1-muted f1-fun-summary',
    completed + ' von ' + scheduled + ' ' + recordedLabel + ' gewertet'));

  if (!completed) {
    panel.append(elt('p', 'f1-muted f1-fun-empty',
      type === 'Qualifying'
        ? 'Noch keine echten Qualifying-Ergebnisse importiert. Die Wertung wird nach dem Datenimport automatisch berechnet.'
        : 'Für diese Saison liegen noch keine echten ' + type + '-Ergebnisse vor.'));
    return panel;
  }

  const [standingsTable, body] = table(['#', 'Fahrer', 'S', 'P1', 'Pkt.', 'Δ 1.']);
  standingsTable.classList.add('f1-fun-table');
  standingsTable.tHead.rows[0].cells[2].title = 'Anzahl gewerteter Session-Teilnahmen';
  standingsTable.tHead.rows[0].cells[3].title = 'Anzahl erster Plätze';
  standingsTable.tHead.rows[0].cells[5].title = 'Punkterückstand auf den Führenden';
  const currentDrivers = new Map(rows.map(d => [d.driverId, d]));

  for (const item of standings) {
    const tr = elt('tr');
    if (item.position >= 1 && item.position <= 3)
      tr.classList.add(['zone-gold', 'zone-silver', 'zone-bronze'][item.position - 1]);
    const known = currentDrivers.get(item.driverId);
    const nameCell = td('');
    const driver = elt('span', 'f1-fun-driver');
    const teamId = known?.currentConstructorId || item.currentConstructorId;
    if (teamId) {
      const badge = teamBadge(teamId);
      badge.classList.add('f1-fun-team-badge');
      driver.append(badge);
    }
    const name = elt('span', 'f1-fun-driver-name', item.name);
    name.title = item.name;
    driver.append(name);
    nameCell.append(driver);

    tr.append(td(item.position), nameCell, td(item.starts), td(item.wins),
      td(number(item.points)), td(item.gapLeader ? '−' + number(item.gapLeader) : '–'));
    if (known) {
      addFocus(tr, item.driverId);
      if (focusId === item.driverId) tr.classList.add('f1-focused');
    }
    body.append(tr);
  }
  const viewport = elt('div', 'f1-fun-table-wrap');
  viewport.append(standingsTable);
  panel.append(viewport);
  return panel;
}

function renderSeason() {
  content.className = 'f1-detail-grid f1-view-season';
  const columns = elt('div', 'f1-season-columns');
  const left = elt('div', 'f1-season-column');
  const right = elt('div', 'f1-season-column');
  left.append(panelStandings('drivers'), panelStandings('constructors'));
  right.append(panelChart(), panelMatrix());
  columns.append(left, right);
  content.append(columns,
    elt('h2', 'f1-season-extra-title', 'Spaß-Weltmeisterschaften'),
    elt('p', 'f1-muted f1-season-extra-info',
      'Separate Wertungen für FP1, FP2, FP3 und Qualifying · Punkte pro Session: 25–18–15–12–10–8–6–4–2–1 · keine offiziellen WM-Punkte.'));
  const extra = elt('div', 'f1-season-extra');
  for (const name of ['FP1', 'FP2', 'FP3', 'Qualifying'])
    extra.append(panelFunChampionship(name));
  content.append(extra);
  if (season.year <= 1990) {
    content.append(elt('p', 'f1-history-note',
      'Historische Wertungsregel: Bis 1990 konnten Streichresultate gelten. Der Linienchart zeigt aufsummierte erzielte Rennpunkte; die WM-Tabelle verwendet die offiziellen Wertungspunkte.'));
  }
}
function renderGrandPrix(race) {
  content.className = 'f1-detail-grid f1-view-grand-prix';
  const heading = elt('div', 'f1-gp-heading');
  heading.append(elt('h2', '', race.name),
    elt('p', 'f1-muted', venueName(race) + ' · ' + race.country +
      ' · ' + weekendDate(race.date) + (race.sprintDate ? ' · Sprint-Wochenende' : '')));
  const top = elt('div', 'f1-gp-top');
  top.append(resultSession(race), demoSession(race, 'Qualifying'));
  const sessions = elt('div', 'f1-gp-sessions');
  const sprint = Boolean(race.sprintDate);
  sessions.append(practiceSession(race, 'FP1'),
    sprint ? demoSession(race, 'Sprint-Qualifying') : practiceSession(race, 'FP2'),
    sprint ? resultSession(race, true) : practiceSession(race, 'FP3'));
  content.append(heading, top, sessions);
}

function render() {
  if (!season) return;
  renderGPNav();
  content.replaceChildren();
  const race = selectedRound === null ? null :
    season.races.find(r => Number(r.round) === selectedRound);
  if (race) renderGrandPrix(race);
  else renderSeason();
  // Restore the matrix position after driver selection / chart rerenders.
  const matrixViewport = content.querySelector('.f1-matrix-viewport');
  if (matrixViewport) matrixViewport.scrollLeft = matrixScrollLeft;
  status.textContent = '';
  const completed = season.races.filter(r => r.results?.length).length;
  info.textContent = completed + ' / ' + season.races.length + ' GP · ' +
    (season.complete ? 'Saison beendet' : 'laufende Saison');
}
async function loadSeason(year, requestedRound = null) {
  const token = ++seasonLoadToken;
  status.textContent = 'Saison ' + year + ' wird geladen …';
  content.replaceChildren();
  try {
    const data = await loadJson('./data/f1/' + year + '.json');
    if (token !== seasonLoadToken) return;
    if (!Array.isArray(data.races)) throw new Error('Ungültiges Datenformat.');
    season = data;
    rows = allDrivers(season);
    shown = new Set(rows.map(row => row.driverId));
    focusId = null;
    chartZoom = 100;
    matrixScrollLeft = 0;
    selectedRound = data.races.some(r => Number(r.round) === Number(requestedRound)) && requestedRound !== null ?
      Number(requestedRound) : null;
    updateAddress();
    render();
  } catch (error) {
    if (token !== seasonLoadToken) return;
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
    const roundParam = new URLSearchParams(location.search).get('round');
    await loadSeason(year, roundParam === null ? null : Number(roundParam));
  } catch (error) {
    console.error(error);
    status.textContent = 'Das Saisonverzeichnis konnte nicht geladen werden. Bitte nach dem nächsten Datenupdate erneut versuchen.';
  }
}
start();
