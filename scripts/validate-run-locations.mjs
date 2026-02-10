/**
 * Validate run locations data used by /across-the-world.
 *
 * Checks that public/data/run-locations.json exists and has the expected shape.
 *
 * Usage: node scripts/validate-run-locations.mjs
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_FILE = join(ROOT, 'public', 'data', 'run-locations.json');

function fail(message) {
  console.error(`Validation failed: ${message}`);
  process.exit(1);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateRun(run, index) {
  if (!run || typeof run !== 'object') {
    fail(`runs[${index}] is not an object`);
  }
  if (!isFiniteNumber(run.lat) || !isFiniteNumber(run.lng)) {
    fail(`runs[${index}] has invalid lat/lng`);
  }
  if (typeof run.name !== 'string') {
    fail(`runs[${index}] missing string name`);
  }
  if (!isFiniteNumber(run.distance) || !isFiniteNumber(run.moving_time)) {
    fail(`runs[${index}] has invalid distance/moving_time`);
  }
  if (!Array.isArray(run.media)) {
    fail(`runs[${index}] media must be an array`);
  }
}

function validateRoute(route, index) {
  if (!route || typeof route !== 'object') {
    fail(`routes[${index}] is not an object`);
  }
  if (typeof route.name !== 'string') {
    fail(`routes[${index}] missing string name`);
  }
  if (!Array.isArray(route.coordinates)) {
    fail(`routes[${index}] coordinates must be an array`);
  }
}

function main() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`could not read ${DATA_FILE}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    fail('root must be an object');
  }

  if (!Array.isArray(parsed.runs)) {
    fail('runs must be an array');
  }
  if (!Array.isArray(parsed.routes)) {
    fail('routes must be an array');
  }
  if (!parsed.stats || typeof parsed.stats !== 'object') {
    fail('stats must be an object');
  }

  parsed.runs.forEach(validateRun);
  parsed.routes.forEach(validateRoute);

  if (!isFiniteNumber(parsed.stats.totalRuns)) {
    fail('stats.totalRuns must be a finite number');
  }
  if (!isFiniteNumber(parsed.stats.totalDistance)) {
    fail('stats.totalDistance must be a finite number');
  }
  if (!isFiniteNumber(parsed.stats.uniqueLocations)) {
    fail('stats.uniqueLocations must be a finite number');
  }
  if (!Array.isArray(parsed.stats.dateRange)) {
    fail('stats.dateRange must be an array');
  }

  console.log(
    `Validation passed: ${parsed.runs.length} runs, ${parsed.routes.length} routes (${DATA_FILE})`
  );
}

main();
