function row(cells, className = '') {
  const tr = document.createElement('tr');
  if (className) tr.className = className;

  for (const value of cells) {
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(td);
  }
  return tr;
}

function createTable(headers, rows, className = '') {
  const table = document.createElement('table');
  if (className) table.className = className;

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  for (const header of headers) {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.append(th);
  }

  thead.append(headerRow);
  const tbody = document.createElement('tbody');

  for (const item of rows) {
    if (Array.isArray(item)) {
      tbody.append(row(item));
    } else {
      tbody.append(row(item.cells, item.className ?? ''));
    }
  }

  table.append(thead, tbody);
  return table;
}

function createPanel(title, content, className = '') {
  const panel = document.createElement('section');
  panel.className = `competition-panel ${className}`.trim();

  const heading = document.createElement('h3');
  heading.textContent = title;
  panel.append(heading, content);
  return panel;
}

function footballHighlightClass(data, position) {
  const highlight = (data.tableHighlights ?? []).find(item =>
    position >= Number(item.from) && position <= Number(item.to)
  );

  return highlight ? `zone-${highlight.type}` : '';
}

function f1PodiumClass(position) {
  if (position === 1) return 'zone-gold';
  if (position === 2) return 'zone-silver';
  if (position === 3) return 'zone-bronze';
  return '';
}

function formatDateTime(value) {
  if (!value) return 'Termin offen';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(value) {
  if (!value) return 'Termin offen';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function placeholder(text) {
  const p = document.createElement('p');
  p.className = 'panel-placeholder';
  p.textContent = text;
  return p;
}

function createMatchday(matchday, { showResult = false, emptyText = 'Kein Spieltag vorhanden.' } = {}) {
  if (!matchday?.matches?.length) {
    return placeholder(emptyText);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'fixture-list';

  const name = document.createElement('p');
  name.className = 'matchday-name';
  name.textContent = matchday.groupName ?? `${matchday.groupOrderId}. Spieltag`;
  wrapper.append(name);

  for (const match of matchday.matches) {
    const item = document.createElement('div');
    item.className = 'fixture-item';

    const teams = document.createElement('div');
    teams.className = 'fixture-teams';

    const home = document.createElement('span');
    home.className = 'fixture-team fixture-team--home';
    home.textContent = match.homeShortName || match.homeTeam;
    home.title = match.homeTeam || home.textContent;

    const middle = document.createElement('strong');
    middle.className = 'fixture-score';
    if (match.finished && match.result) {
      middle.textContent = `${match.result.home}:${match.result.away}`;
    } else {
      middle.textContent = '–';
    }

    const away = document.createElement('span');
    away.className = 'fixture-team';
    away.textContent = match.awayShortName || match.awayTeam;
    away.title = match.awayTeam || away.textContent;

    teams.append(home, middle, away);

    const time = document.createElement('time');
    time.className = 'fixture-time';
    time.dateTime = match.date ?? '';
    time.textContent = showResult ? formatDate(match.date) : formatDateTime(match.date);

    item.append(teams, time);
    wrapper.append(item);
  }

  return wrapper;
}

function footballContent(data) {
  const layout = document.createElement('div');
  layout.className = 'competition-layout competition-layout--football';

  const standings = createTable(
    ['#', 'Team', 'Sp.', 'Pkt.'],
    data.standings.map(team => ({
      cells: [team.position, team.name, team.played, team.points],
      className: footballHighlightClass(data, team.position)
    }))
  );

  layout.append(
    createPanel('Tabelle', standings, 'competition-panel--standings'),
    createPanel(
      'Letzter Spieltag',
      createMatchday(data.lastMatchday, {
        showResult: true,
        emptyText: 'Noch kein abgeschlossener Spieltag.'
      }),
      'competition-panel--matchday'
    ),
    createPanel(
      'Aktueller Spieltag',
      createMatchday(data.currentMatchday, {
        showResult: false,
        emptyText: 'Aktuell ist kein Spieltag angesetzt.'
      }),
      'competition-panel--matchday'
    ),
    createPanel(
      'Nächster Spieltag',
      createMatchday(data.nextMatchday, {
        showResult: false,
        emptyText: 'Kein weiterer Spieltag vorhanden.'
      }),
      'competition-panel--matchday'
    )
  );

  return layout;
}

function f1DriversStandings(data) {
  return createTable(
    ['#', 'Fahrer', 'Pkt.'],
    data.drivers.map(driver => ({
      cells: [driver.position, driver.name, driver.points],
      className: f1PodiumClass(driver.position)
    }))
  );
}

function f1ConstructorsStandings(data) {
  return createTable(
    ['#', 'Team', 'Pkt.'],
    data.constructors.map(team => {
      const drivers = team.currentDrivers?.length ? ` (${team.currentDrivers.join(', ')})` : '';
      return {
        cells: [team.position, `${team.name}${drivers}`, team.points],
        className: f1PodiumClass(team.position)
      };
    })
  );
}

function f1LastRace(data) {
  if (!data.lastRace) return placeholder('Noch kein Rennergebnis vorhanden.');

  const wrapper = document.createElement('div');
  wrapper.className = 'race-summary';

  const meta = document.createElement('p');
  meta.className = 'event-name';
  meta.textContent = `${data.lastRace.name} · ${formatDate(data.lastRace.date)}`;
  wrapper.append(meta);

  wrapper.append(createTable(
    ['#', 'Fahrer', 'Team'],
    data.lastRace.results.map(result => ({
      cells: [result.position, result.driverName, result.constructorName],
      className: f1PodiumClass(result.position)
    })),
    'race-results-table'
  ));

  return wrapper;
}

function f1NextRace(data) {
  if (!data.nextRace) return placeholder('Kein weiteres Rennen in dieser Saison.');

  const wrapper = document.createElement('div');
  wrapper.className = 'next-event';

  const name = document.createElement('p');
  name.className = 'event-name';
  name.textContent = data.nextRace.name;

  const date = document.createElement('p');
  date.className = 'event-detail';
  date.textContent = formatDateTime(data.nextRace.date);

  const location = document.createElement('p');
  location.className = 'event-detail';
  location.textContent = [data.nextRace.circuit, data.nextRace.locality, data.nextRace.country]
    .filter(Boolean)
    .join(' · ');

  wrapper.append(name, date);
  if (location.textContent) wrapper.append(location);

  if (data.nextRace.hasSprint) {
    const sprint = document.createElement('p');
    sprint.className = 'event-badge';
    sprint.textContent = data.nextRace.sprintDate
      ? `Sprint · ${formatDateTime(data.nextRace.sprintDate)}`
      : 'Sprint-Wochenende';
    wrapper.append(sprint);
  }

  return wrapper;
}

function f1Content(data) {
  const layout = document.createElement('div');
  layout.className = 'competition-layout competition-layout--f1';

  layout.append(
    createPanel('Fahrer-WM', f1DriversStandings(data), 'competition-panel--f1-drivers'),
    createPanel('Letztes Rennen', f1LastRace(data), 'competition-panel--f1-last-race'),
    createPanel('Nächstes Rennen', f1NextRace(data), 'competition-panel--f1-next-race'),
    createPanel('Konstrukteurs-WM', f1ConstructorsStandings(data), 'competition-panel--f1-constructors')
  );

  return layout;
}

export function createCompetitionCard(meta, data) {
  const article = document.createElement('article');
  article.className = 'competition-card';

  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = meta.name;

  const source = document.createElement('p');
  source.className = 'card-meta';
  const updated = data.competition?.lastUpdated
    ? new Date(data.competition.lastUpdated).toLocaleString('de-DE')
    : 'unbekannt';
  source.textContent = `Stand: ${updated}`;

  header.append(title, source);
  article.append(header);

  const content = document.createElement('div');
  content.className = 'table-wrap';
  content.append(meta.sport === 'motorsport' ? f1Content(data) : footballContent(data));
  article.append(content);

  return article;
}
