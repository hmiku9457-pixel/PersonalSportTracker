const DEFAULT_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'PersonalSportTracker/0.1 (+https://github.com/hmiku9457-pixel/PersonalSportTracker)'
};

export async function fetchJson(url, options = {}) {
  const attempts = options.attempts ?? 3;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, ...(options.headers ?? {}) }
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} for ${url}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  throw lastError;
}
