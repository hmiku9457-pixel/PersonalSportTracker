export async function loadJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Daten konnten nicht geladen werden (${response.status}).`);
  }
  return response.json();
}
