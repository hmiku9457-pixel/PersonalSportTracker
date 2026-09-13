import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchF1Competition } from './adapters/jolpica.mjs';
import { fetchFootballCompetition } from './adapters/openligadb.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dataDir = resolve(root, 'public', 'data');
const configPath = resolve(root, 'config', 'competitions.json');

await mkdir(dataDir, { recursive: true });

const config = JSON.parse(await readFile(configPath, 'utf8'));
const enabled = config.competitions
  .filter(item => item.enabled)
  .sort((a, b) => a.order - b.order);

const manifest = [];
const failures = [];

for (const competition of enabled) {
  process.stdout.write(`Updating ${competition.name}... `);

  try {
    const data = competition.source === 'jolpica'
      ? await fetchF1Competition(competition)
      : await fetchFootballCompetition(competition, config.season);

    await writeFile(
      resolve(dataDir, `${competition.id}.json`),
      `${JSON.stringify(data, null, 2)}\n`,
      'utf8'
    );

    manifest.push({
      id: competition.id,
      name: competition.name,
      sport: competition.sport,
      order: competition.order,
      file: `data/${competition.id}.json`
    });

    console.log('done');
  } catch (error) {
    failures.push({ id: competition.id, message: error.message });
    console.log(`failed: ${error.message}`);
  }
}

await writeFile(
  resolve(dataDir, 'manifest.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), competitions: manifest }, null, 2)}\n`,
  'utf8'
);

if (failures.length > 0) {
  console.error('\nOne or more competitions could not be updated:');
  for (const failure of failures) {
    console.error(`- ${failure.id}: ${failure.message}`);
  }
  process.exitCode = 1;
}
