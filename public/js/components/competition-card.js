function row(cells) {
  const tr = document.createElement('tr');
  for (const value of cells) {
    const td = document.createElement('td');
    td.textContent = value;
    tr.append(td);
  }
  return tr;
}

function createTable(headers, rows) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  for (const header of headers) {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.append(th);
  }

  thead.append(headerRow);
  const tbody = document.createElement('tbody');
  rows.forEach(values => tbody.append(row(values)));
  table.append(thead, tbody);
  return table;
}

function footballContent(data) {
  return createTable(
    ['#', 'Team', 'Sp.', 'Pkt.'],
    data.standings.map(team => [team.position, team.name, team.played, team.points])
  );
}

function f1Content(data) {
  const wrapper = document.createElement('div');

  const driversHeading = document.createElement('h3');
  driversHeading.textContent = 'Fahrer-WM';
  wrapper.append(driversHeading);
  wrapper.append(createTable(
    ['#', 'Fahrer', 'Pkt.'],
    data.drivers.map(driver => [driver.position, driver.name, driver.points])
  ));

  const constructorsHeading = document.createElement('h3');
  constructorsHeading.textContent = 'Konstrukteurs-WM';
  wrapper.append(constructorsHeading);
  wrapper.append(createTable(
    ['#', 'Team', 'Pkt.'],
    data.constructors.map(team => [team.position, team.name, team.points])
  ));

  return wrapper;
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

  const tableWrap = document.createElement('div');
  tableWrap.className = 'table-wrap';
  tableWrap.append(meta.sport === 'motorsport' ? f1Content(data) : footballContent(data));
  article.append(tableWrap);

  return article;
}
