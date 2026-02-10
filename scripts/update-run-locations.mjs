/**
 * Update Run Locations via Strava API
 *
 * Fetches new runs since the latest date in the cache and merges them in.
 * Run weekly before deploy: npm run update:locations
 *
 * Usage: node scripts/update-run-locations.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ENV_FILE = join(ROOT, '.env');
const CACHE_DIR = join(ROOT, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'run-locations.json');
const PUBLIC_DATA_DIR = join(ROOT, 'public', 'data');
const PUBLIC_DATA_FILE = join(PUBLIC_DATA_DIR, 'run-locations.json');

// Parse .env file
const env = {};
readFileSync(ENV_FILE, 'utf-8').split('\n').forEach((line) => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim();
});

async function getAccessToken() {
  const res = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token: env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function fetchActivitiesAfter(token, afterTimestamp) {
  const all = [];
  let page = 1;

  while (true) {
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterTimestamp}&page=${page}&per_page=200`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const usage = res.headers.get('x-ratelimit-usage');
      throw new Error(
        `Activities fetch failed: ${res.status}` +
        (usage ? ` (rate limit usage: ${usage})` : '')
      );
    }

    const activities = await res.json();
    if (activities.length === 0) break;

    all.push(...activities);
    page++;
  }

  return all;
}

async function main() {
  // 1. Read existing cache
  let cache;
  const cacheInputCandidates = [CACHE_FILE, PUBLIC_DATA_FILE];
  let loadedFrom = null;
  for (const candidate of cacheInputCandidates) {
    try {
      cache = JSON.parse(readFileSync(candidate, 'utf-8'));
      loadedFrom = candidate;
      break;
    } catch {
      // Try next location
    }
  }

  if (!cache || !Array.isArray(cache.runs)) {
    console.error('No valid run locations cache found.');
    console.error('Checked:', cacheInputCandidates.join(', '));
    console.error('Run `npm run seed:locations` first to process the Strava export.');
    process.exit(1);
  }
  console.log(`Loaded cache from ${loadedFrom}`);

  // 2. Find the latest date in the cache
  const dates = cache.runs.map((r) => new Date(r.date).getTime()).filter((d) => !isNaN(d));
  const latestDate = Math.max(...dates);
  const latestTimestamp = Math.floor(latestDate / 1000);
  const latestDateStr = new Date(latestDate).toISOString().split('T')[0];

  console.log(`Cache has ${cache.runs.length} runs, latest: ${latestDateStr}`);
  console.log(`Fetching activities after ${latestDateStr}...\n`);

  // 3. Fetch new activities from API
  const token = await getAccessToken();
  const newActivities = await fetchActivitiesAfter(token, latestTimestamp);

  console.log(`Fetched ${newActivities.length} new activities from Strava API`);

  // 4. Filter to runs with GPS
  const newRuns = newActivities.filter(
    (a) =>
      a.type === 'Run' &&
      a.start_latlng &&
      a.start_latlng.length === 2 &&
      a.start_latlng[0] !== 0
  );

  console.log(`Found ${newRuns.length} new runs with GPS data`);

  if (newRuns.length === 0) {
    console.log('\nNo new runs to add. Cache is up to date.');
    return;
  }

  // 5. Convert to cache format and deduplicate
  const existingDates = new Set(cache.runs.map((r) => r.date));

  const runsToAdd = newRuns
    .map((a) => ({
      lat: a.start_latlng[0],
      lng: a.start_latlng[1],
      name: a.name,
      date: a.start_date_local || a.start_date,
      distance: a.distance,
      moving_time: a.moving_time,
      media: [],
      gear: a.gear?.name || '',
    }))
    .filter((r) => !existingDates.has(r.date));

  console.log(`Adding ${runsToAdd.length} new runs (${newRuns.length - runsToAdd.length} duplicates skipped)`);

  // 6. Merge into cache
  cache.runs.push(...runsToAdd);

  // 7. Recompute stats
  const totalDistance = cache.runs.reduce((sum, r) => sum + r.distance, 0);
  const allDates = cache.runs.map((r) => new Date(r.date).getTime()).filter((d) => !isNaN(d));

  const uniquePlaces = new Set(
    cache.runs.map(
      (r) =>
        `${(Math.round(r.lat * 10) / 10).toFixed(1)},${(Math.round(r.lng * 10) / 10).toFixed(1)}`
    )
  ).size;

  cache.stats = {
    totalRuns: cache.runs.length,
    totalDistance: totalDistance,
    uniqueLocations: uniquePlaces,
    dateRange: allDates.length > 0
      ? [new Date(Math.min(...allDates)).toISOString(), new Date(Math.max(...allDates)).toISOString()]
      : [],
  };

  // 8. Write updated cache
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(PUBLIC_DATA_DIR, { recursive: true });
  const serialized = JSON.stringify(cache);
  writeFileSync(CACHE_FILE, serialized);
  writeFileSync(PUBLIC_DATA_FILE, serialized);

  console.log(`\nUpdated cache: ${cache.runs.length} total runs, ${(totalDistance / 1000).toFixed(0)} km`);
  console.log(`Wrote ${CACHE_FILE} and ${PUBLIC_DATA_FILE}`);
  console.log('Done!');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
