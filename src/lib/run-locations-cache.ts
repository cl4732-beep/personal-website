import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface RunLocation {
  lat: number;
  lng: number;
  name: string;
  date: string;
  distance: number;
  moving_time: number;
  media: string[];
  gear: string;
}

interface Route {
  name: string;
  coordinates: [number, number][];
}

interface RunLocationsStats {
  totalRuns: number;
  totalDistance: number;
  uniqueLocations: number;
  dateRange: string[];
}

interface RunLocationsCache {
  runs: RunLocation[];
  routes: Route[];
  stats: RunLocationsStats;
}

interface CacheReadResult {
  data: RunLocationsCache;
  error: string | null;
  source: string | null;
}

const EMPTY_CACHE: RunLocationsCache = {
  runs: [],
  routes: [],
  stats: {
    totalRuns: 0,
    totalDistance: 0,
    uniqueLocations: 0,
    dateRange: [],
  },
};

function safeNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function sanitizeMediaPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return null;
  if (!/^strava-media\/[A-Za-z0-9._/-]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeRun(raw: unknown): RunLocation | null {
  if (!raw || typeof raw !== 'object') return null;

  const run = raw as Record<string, unknown>;
  const lat = safeNumber(run.lat, NaN);
  const lng = safeNumber(run.lng, NaN);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const media = Array.isArray(run.media)
    ? run.media.map(sanitizeMediaPath).filter((m): m is string => m !== null)
    : [];

  return {
    lat,
    lng,
    name: safeString(run.name, 'Run').trim() || 'Run',
    date: safeString(run.date),
    distance: Math.max(0, safeNumber(run.distance)),
    moving_time: Math.max(0, safeNumber(run.moving_time)),
    media,
    gear: safeString(run.gear).trim(),
  };
}

function normalizeRoute(raw: unknown): Route | null {
  if (!raw || typeof raw !== 'object') return null;

  const route = raw as Record<string, unknown>;
  if (!Array.isArray(route.coordinates)) return null;

  const coordinates = route.coordinates
    .map((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) return null;
      const lat = safeNumber(coord[0], NaN);
      const lng = safeNumber(coord[1], NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lat, lng] as [number, number];
    })
    .filter((coord): coord is [number, number] => coord !== null);

  if (coordinates.length < 2) return null;

  return {
    name: safeString(route.name, 'Route').trim() || 'Route',
    coordinates,
  };
}

function getDateRange(runs: RunLocation[]): string[] {
  const timestamps = runs
    .map((run) => new Date(run.date).getTime())
    .filter((time) => Number.isFinite(time));

  if (timestamps.length === 0) return [];

  return [
    new Date(Math.min(...timestamps)).toISOString(),
    new Date(Math.max(...timestamps)).toISOString(),
  ];
}

function getUniqueLocations(runs: RunLocation[]): number {
  return new Set(
    runs.map(
      (run) =>
        `${(Math.round(run.lat * 10) / 10).toFixed(1)},${(Math.round(run.lng * 10) / 10).toFixed(1)}`
    )
  ).size;
}

function normalizeStats(rawStats: unknown, runs: RunLocation[]): RunLocationsStats {
  const computedDistance = runs.reduce((sum, run) => sum + run.distance, 0);
  const computedDateRange = getDateRange(runs);

  const stats = rawStats && typeof rawStats === 'object'
    ? (rawStats as Record<string, unknown>)
    : {};

  const rawDateRange = Array.isArray(stats.dateRange)
    ? stats.dateRange.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];

  return {
    totalRuns: runs.length,
    totalDistance: computedDistance,
    uniqueLocations: getUniqueLocations(runs),
    dateRange: rawDateRange.length >= 2 ? rawDateRange.slice(0, 2) : computedDateRange,
  };
}

function normalizeCache(raw: unknown): RunLocationsCache {
  // Backward compatibility: legacy cache can be a raw array of runs.
  if (Array.isArray(raw)) {
    const runs = raw.map(normalizeRun).filter((run): run is RunLocation => run !== null);
    return {
      runs,
      routes: [],
      stats: normalizeStats(null, runs),
    };
  }

  if (!raw || typeof raw !== 'object') return EMPTY_CACHE;

  const cache = raw as Record<string, unknown>;
  const runs = Array.isArray(cache.runs)
    ? cache.runs.map(normalizeRun).filter((run): run is RunLocation => run !== null)
    : [];

  const routes = Array.isArray(cache.routes)
    ? cache.routes.map(normalizeRoute).filter((route): route is Route => route !== null)
    : [];

  return {
    runs,
    routes,
    stats: normalizeStats(cache.stats, runs),
  };
}

function getDefaultPaths(): string[] {
  return [
    join(process.cwd(), '.cache', 'run-locations.json'),
    join(process.cwd(), 'public', 'data', 'run-locations.json'),
  ];
}

export function readRunLocationsCache(paths = getDefaultPaths()): CacheReadResult {
  const errors: string[] = [];

  for (const path of paths) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      return { data: normalizeCache(raw), error: null, source: path };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown cache read error';
      errors.push(`${path}: ${message}`);
    }
  }

  return {
    data: EMPTY_CACHE,
    error: errors.join(' | ') || 'No run locations data file found',
    source: null,
  };
}

export type { RunLocation, Route, RunLocationsStats, RunLocationsCache };
