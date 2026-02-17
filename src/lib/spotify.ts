import type { ParsedTrack } from './youtube';
import { fetchWithRetry } from './fetch';

interface SpotifyTokens {
  access_token: string;
  expires_at: number;
}

interface SpotifyCandidate {
  name: string;
  artist: string;
  spotifyUrl: string;
  spotifyUri: string;
  albumArt: string;
}

interface SpotifySearchQueryResult {
  available: boolean;
  reason?: 'not_configured' | 'token_unavailable' | 'api_error';
  results: SpotifyCandidate[];
}

interface SpotifyMatch {
  found: boolean;
  spotifyUrl: string;
  spotifyUri: string;
  albumArt: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  candidates: SpotifyCandidate[];
}

interface TrackWithMatches {
  position: number;
  timestamp: string;
  timestampSeconds: number;
  rawText: string;
  artist: string;
  title: string;
  notes: string;
  spotify: SpotifyMatch;
}

// --- Token Management ---

let cachedToken: SpotifyTokens | null = null;

function hasSpotifyClientCredentials(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

async function getSpotifyToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  if (cachedToken && cachedToken.expires_at > Date.now() / 1000 + 300) {
    return cachedToken.access_token;
  }

  const res = await fetchWithRetry('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    timeout: 10_000,
    retries: 2,
  });

  if (!res.ok) {
    console.error('Spotify token request failed:', res.status);
    return null;
  }

  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() / 1000 + data.expires_in,
  };

  return cachedToken.access_token;
}

// --- Rate-Limit-Aware Fetch ---

const MAX_429_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2_000;

async function spotifyFetch(url: string, token: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status !== 429 || attempt === MAX_429_RETRIES) {
      return res;
    }

    const retryAfter = res.headers.get('retry-after');
    const delayMs = retryAfter
      ? Math.min(parseInt(retryAfter, 10) * 1000, 10_000)
      : DEFAULT_RETRY_DELAY_MS * (attempt + 1);

    console.warn(`[spotify] 429 rate limited, waiting ${delayMs}ms (attempt ${attempt + 1}/${MAX_429_RETRIES})`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('Spotify rate limit retries exhausted');
}

// --- Search Cache ---

interface CacheEntry {
  candidates: SpotifyCandidate[];
  expiresAt: number;
}

const searchCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedSearch(key: string): SpotifyCandidate[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    searchCache.delete(key);
    return null;
  }
  return entry.candidates;
}

function setCachedSearch(key: string, candidates: SpotifyCandidate[]): void {
  // Evict expired entries periodically
  if (searchCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of searchCache) {
      if (v.expiresAt < now) searchCache.delete(k);
    }
  }
  searchCache.set(key, { candidates, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- Confidence Scoring ---

function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s'"-]/g, '')
    .trim();
}

function scoreMatch(
  parsedArtist: string,
  parsedTitle: string,
  spotifyArtist: string,
  spotifyTitle: string
): { confidence: 'high' | 'medium' | 'low'; score: number } {
  const nArtist = normalize(parsedArtist);
  const nTitle = normalize(parsedTitle);
  const sArtist = normalize(spotifyArtist);
  const sTitle = normalize(spotifyTitle);

  let score = 0;

  // Artist matching
  if (nArtist && sArtist) {
    if (sArtist === nArtist || sArtist.includes(nArtist) || nArtist.includes(sArtist)) {
      score += 50;
    } else {
      const parsedWords = nArtist.split(' ');
      const matchedWords = parsedWords.filter((w) => w.length > 2 && sArtist.includes(w));
      score += Math.min(30, matchedWords.length * 15);
    }
  }

  // Title matching
  if (nTitle && sTitle) {
    if (sTitle === nTitle || sTitle.includes(nTitle) || nTitle.includes(sTitle)) {
      score += 50;
    } else {
      const parsedWords = nTitle.split(' ').filter((w) => w.length > 2);
      const matchedWords = parsedWords.filter((w) => sTitle.includes(w));
      if (parsedWords.length > 0) {
        score += Math.round((matchedWords.length / parsedWords.length) * 40);
      }
    }
  }

  // Remix alignment
  const parsedHasRemix = /remix|edit|vip|bootleg/i.test(parsedTitle);
  const spotifyHasRemix = /remix|edit|vip|bootleg/i.test(spotifyTitle);
  if (parsedHasRemix !== spotifyHasRemix) {
    score -= 15;
  }

  const confidence: 'high' | 'medium' | 'low' =
    score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

  return { confidence, score: Math.max(0, Math.min(100, score)) };
}

// --- Search ---

function extractCandidates(data: any): SpotifyCandidate[] {
  const tracks = data?.tracks?.items;
  if (!tracks || tracks.length === 0) return [];

  return tracks.slice(0, 5).map((track: any) => ({
    name: track.name,
    artist: track.artists?.map((a: any) => a.name).join(', ') || '',
    spotifyUrl: track.external_urls?.spotify || '',
    spotifyUri: track.uri || '',
    albumArt:
      track.album?.images?.find((img: any) => img.width <= 64 && img.width > 0)?.url ||
      track.album?.images?.[track.album.images.length - 1]?.url ||
      '',
  }));
}

function cleanTrackTitle(title: string): string {
  return title
    .replace(/\(.*?ID.*?\)/gi, '')
    .replace(/\s*\(Out\s*now\)\s*/gi, '')
    .replace(/\s*\[(?!.*(?:remix|mix|edit|vip|bootleg))[^\]]*\]\s*/gi, '')
    .trim();
}

async function searchSpotify(
  artist: string,
  title: string,
  token: string
): Promise<{ candidates: SpotifyCandidate[] }> {
  const cleanTitle = cleanTrackTitle(title);
  const cacheKey = `${artist}|${cleanTitle}`.toLowerCase();

  const cached = getCachedSearch(cacheKey);
  if (cached) return { candidates: cached };

  // Stage 1: field-based search for precision
  const fieldQuery = encodeURIComponent(
    `track:${cleanTitle}${artist && artist !== 'Unknown Artist' ? ` artist:${artist}` : ''}`
  );
  const fieldRes = await spotifyFetch(
    `https://api.spotify.com/v1/search?q=${fieldQuery}&type=track&limit=5`,
    token
  );

  if (fieldRes.ok) {
    const data = await fieldRes.json();
    const candidates = extractCandidates(data);
    if (candidates.length > 0) {
      setCachedSearch(cacheKey, candidates);
      return { candidates };
    }
  }

  // Stage 2: simple text search for recall
  const simpleQuery = encodeURIComponent(
    `${artist !== 'Unknown Artist' ? artist + ' ' : ''}${cleanTitle}`
  );
  const simpleRes = await spotifyFetch(
    `https://api.spotify.com/v1/search?q=${simpleQuery}&type=track&limit=5`,
    token
  );

  if (simpleRes.ok) {
    const data = await simpleRes.json();
    const candidates = extractCandidates(data);
    setCachedSearch(cacheKey, candidates);
    return { candidates };
  }

  setCachedSearch(cacheKey, []);
  return { candidates: [] };
}

/**
 * Search Spotify for a single query string (used by the inline correction endpoint).
 */
export async function searchSpotifyQuery(query: string): Promise<SpotifySearchQueryResult> {
  if (!hasSpotifyClientCredentials()) {
    return { available: false, reason: 'not_configured', results: [] };
  }

  const token = await getSpotifyToken();
  if (!token) {
    return { available: false, reason: 'token_unavailable', results: [] };
  }

  const cacheKey = `query:${query.toLowerCase()}`;
  const cached = getCachedSearch(cacheKey);
  if (cached) return { available: true, results: cached };

  const encoded = encodeURIComponent(query);
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/search?q=${encoded}&type=track&limit=5`,
    token
  );

  if (!res.ok) {
    return { available: false, reason: 'api_error', results: [] };
  }

  const data = await res.json();
  const results = extractCandidates(data);
  setCachedSearch(cacheKey, results);
  return { available: true, results };
}

// Delay between consecutive Spotify API requests (ms)
const INTER_REQUEST_DELAY_MS = 500;

/**
 * Batch-search Spotify for all parsed tracks, with confidence scoring.
 */
export async function searchTracks(tracks: ParsedTrack[]): Promise<TrackWithMatches[]> {
  const token = await getSpotifyToken();
  const results: TrackWithMatches[] = [];

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    let spotify: SpotifyMatch = {
      found: false,
      spotifyUrl: '',
      spotifyUri: '',
      albumArt: '',
      confidence: 'low',
      score: 0,
      candidates: [],
    };

    if (token) {
      const { candidates } = await searchSpotify(track.artist, track.title, token);

      if (candidates.length > 0) {
        const best = candidates[0];
        const { confidence, score } = scoreMatch(
          track.artist,
          track.title,
          best.artist,
          best.name
        );

        spotify = {
          found: true,
          spotifyUrl: best.spotifyUrl,
          spotifyUri: best.spotifyUri,
          albumArt: best.albumArt,
          confidence,
          score,
          candidates,
        };
      }

      // Delay between requests to stay within Spotify rate limits
      if (i < tracks.length - 1) {
        await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
      }
    }

    results.push({
      ...track,
      spotify,
    });
  }

  return results;
}

export type {
  SpotifyCandidate,
  SpotifyMatch,
  SpotifySearchQueryResult,
  TrackWithMatches,
};
