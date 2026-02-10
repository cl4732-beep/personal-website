/**
 * Process Strava Export Data
 *
 * Parses activities.csv, extracts GPS from FIT.gz/GPX files,
 * parses route GPX files, links media, and outputs a JSON cache.
 *
 * Usage: node scripts/process-strava-export.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import FitParser from 'fit-file-parser';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXPORT_DIR = join(ROOT, 'Strava_Export');
const CACHE_DIR = join(ROOT, '.cache');
const CACHE_FILE = join(CACHE_DIR, 'run-locations.json');
const MEDIA_OUT = join(ROOT, 'public', 'strava-media');

// ─── CSV Parser ────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);

  if (lines.length === 0) return [];

  const headers = splitCSVRow(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = splitCSVRow(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }

  return rows;
}

function splitCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);

  return fields;
}

// ─── GPX Parser ────────────────────────────────────────────────────────

function parseGPXCoordinates(gpxText) {
  const coords = [];
  const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
  let match;

  while ((match = trkptRegex.exec(gpxText)) !== null) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
      coords.push([lat, lng]);
    }
  }

  return coords;
}

function parseGPXFirstCoord(gpxText) {
  const match = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/.exec(gpxText);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

// ─── FIT Parser ────────────────────────────────────────────────────────

async function parseFITFirstCoord(filePath) {
  try {
    const compressed = readFileSync(filePath);
    const buffer = gunzipSync(compressed);

    const fitParser = new FitParser({
      force: true,
      mode: 'list',
    });

    const data = await fitParser.parseAsync(buffer);

    // In list mode, records are in data.records
    if (data.records && data.records.length > 0) {
      for (const record of data.records) {
        if (
          record.position_lat !== undefined &&
          record.position_long !== undefined &&
          record.position_lat !== null &&
          record.position_long !== null &&
          record.position_lat !== 0 &&
          record.position_long !== 0
        ) {
          return {
            lat: record.position_lat,
            lng: record.position_long,
          };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Date Parser ───────────────────────────────────────────────────────

function parseStravaDate(dateStr) {
  // "Jan 28, 2015, 12:28:25 AM" -> ISO string
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

// ─── Media Parser ──────────────────────────────────────────────────────

function parseMediaField(mediaStr) {
  if (!mediaStr || mediaStr === '""' || mediaStr === '') return [];
  // Remove surrounding quotes
  const cleaned = mediaStr.replace(/^"|"$/g, '');
  if (!cleaned) return [];
  // Pipe-delimited: media/UUID.jpg|media/UUID2.jpg
  return cleaned
    .split('|')
    .map((m) => m.trim())
    .filter((m) => m.length > 0 && m.startsWith('media/'));
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Processing Strava Export ===\n');

  // 1. Read activities.csv
  console.log('1. Reading activities.csv...');
  const csvText = readFileSync(join(EXPORT_DIR, 'activities.csv'), 'utf-8');
  const allActivities = parseCSV(csvText);
  console.log(`   Found ${allActivities.length} total activities\n`);

  // 2. Filter to runs
  const runs = allActivities.filter((a) => a['Activity Type'] === 'Run');
  console.log(`2. Filtered to ${runs.length} runs\n`);

  // 3. Extract GPS coordinates from each run's activity file
  console.log('3. Extracting GPS coordinates from activity files...');
  const runLocations = [];
  let processed = 0;
  let withGPS = 0;
  let withMedia = 0;
  let errors = 0;

  for (const run of runs) {
    processed++;
    if (processed % 200 === 0 || processed === runs.length) {
      process.stdout.write(`\r   Progress: ${processed}/${runs.length} (${withGPS} with GPS, ${errors} errors)`);
    }

    const filename = run['Filename'];
    if (!filename) {
      errors++;
      continue;
    }

    const filePath = join(EXPORT_DIR, filename);
    if (!existsSync(filePath)) {
      errors++;
      continue;
    }

    let coord = null;

    if (filename.endsWith('.gpx')) {
      const gpxText = readFileSync(filePath, 'utf-8');
      coord = parseGPXFirstCoord(gpxText);
    } else if (filename.endsWith('.fit.gz')) {
      coord = await parseFITFirstCoord(filePath);
    }

    if (!coord) {
      continue;
    }

    withGPS++;

    // Parse media
    const media = parseMediaField(run['Media']);
    if (media.length > 0) withMedia++;

    // Parse date
    const date = parseStravaDate(run['Activity Date']);

    // Parse numeric fields
    const distance = parseFloat(run['Distance']) || 0;
    // Distance in CSV is already in the second "Distance" column (meters)
    // Actually, the CSV has two Distance columns. Let's use the numeric one.
    const movingTime = parseFloat(run['Moving Time']) || 0;

    runLocations.push({
      lat: coord.lat,
      lng: coord.lng,
      name: run['Activity Name'] || 'Run',
      date: date || run['Activity Date'],
      distance: distance,
      moving_time: movingTime,
      media: media.map((m) => `strava-media/${basename(m)}`),
      gear: run['Activity Gear'] || '',
    });
  }

  console.log(`\n   Done: ${withGPS} runs with GPS, ${withMedia} with photos, ${errors} errors\n`);

  // 4. Parse route GPX files
  console.log('4. Parsing route GPX files...');
  const routesCsvText = readFileSync(join(EXPORT_DIR, 'routes.csv'), 'utf-8');
  const routeRows = parseCSV(routesCsvText);
  const routes = [];

  for (const row of routeRows) {
    const routeName = row['Route Name'];
    const routeFile = row['Route Filename'];
    if (!routeFile) continue;

    const filePath = join(EXPORT_DIR, routeFile);
    if (!existsSync(filePath)) {
      console.log(`   Skipping missing route: ${routeFile}`);
      continue;
    }

    const gpxText = readFileSync(filePath, 'utf-8');
    const coordinates = parseGPXCoordinates(gpxText);

    if (coordinates.length > 0) {
      // Simplify route for smaller JSON (keep every Nth point for long routes)
      const simplified = simplifyCoords(coordinates, 200);
      routes.push({
        name: routeName,
        coordinates: simplified,
      });
    }
  }

  console.log(`   Parsed ${routes.length} routes\n`);

  // 5. Copy media files
  console.log('5. Copying media files...');
  mkdirSync(MEDIA_OUT, { recursive: true });
  let copiedMedia = 0;

  const mediaRefs = new Set();
  for (const run of runLocations) {
    for (const m of run.media) {
      mediaRefs.add(m);
    }
  }

  for (const mediaPath of mediaRefs) {
    const filename = basename(mediaPath);
    const src = join(EXPORT_DIR, 'media', filename);
    const dest = join(MEDIA_OUT, filename);

    if (existsSync(src) && !existsSync(dest)) {
      copyFileSync(src, dest);
      copiedMedia++;
    }
  }

  console.log(`   Copied ${copiedMedia} media files to public/strava-media/\n`);

  // 6. Compute stats
  const totalDistance = runLocations.reduce((sum, r) => sum + r.distance, 0);
  const dates = runLocations
    .map((r) => new Date(r.date).getTime())
    .filter((d) => !isNaN(d));

  const uniquePlaces = new Set(
    runLocations.map(
      (r) =>
        `${(Math.round(r.lat * 10) / 10).toFixed(1)},${(Math.round(r.lng * 10) / 10).toFixed(1)}`
    )
  ).size;

  const stats = {
    totalRuns: runLocations.length,
    totalDistance: totalDistance,
    uniqueLocations: uniquePlaces,
    dateRange: dates.length > 0
      ? [new Date(Math.min(...dates)).toISOString(), new Date(Math.max(...dates)).toISOString()]
      : [],
  };

  // 7. Write cache
  console.log('6. Writing cache...');
  mkdirSync(CACHE_DIR, { recursive: true });

  const output = {
    runs: runLocations,
    routes: routes,
    stats: stats,
  };

  writeFileSync(CACHE_FILE, JSON.stringify(output));
  const sizeKB = (Buffer.byteLength(JSON.stringify(output)) / 1024).toFixed(0);
  console.log(`   Saved to ${CACHE_FILE} (${sizeKB} KB)\n`);

  // Summary
  console.log('=== Summary ===');
  console.log(`   Runs on map:      ${runLocations.length}`);
  console.log(`   Total distance:   ${(totalDistance / 1000).toFixed(0)} km`);
  console.log(`   Unique locations: ${uniquePlaces}`);
  console.log(`   Routes:           ${routes.length}`);
  console.log(`   Photos:           ${mediaRefs.size}`);
  if (stats.dateRange.length === 2) {
    console.log(`   Date range:       ${new Date(stats.dateRange[0]).getFullYear()} – ${new Date(stats.dateRange[1]).getFullYear()}`);
  }
  console.log('\nDone! Run `npm run dev` to see the map.');
}

// Simplify a coordinate array by keeping every Nth point
function simplifyCoords(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / maxPoints);
  const result = [];
  for (let i = 0; i < coords.length; i += step) {
    result.push(coords[i]);
  }
  // Always include the last point
  if (result[result.length - 1] !== coords[coords.length - 1]) {
    result.push(coords[coords.length - 1]);
  }
  return result;
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
