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

let cachedToken: SpotifyTokens | null = null;

function hasSpotifyClientCredentials(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

async function getSpotifyToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) return null;

  // Use cached token if still valid (5-min buffer)
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
    const errorBody = await res.text().catch(() => '');
    console.error('Spotify token request failed:', res.status, errorBody);
    return null;
  }

  const data = await res.json();
  console.log('Spotify token obtained, expires_in:', data.expires_in, 'token_type:', data.token_type);
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() / 1000 + data.expires_in,
  };

  return cachedToken.access_token;
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
      // Check if any word from parsed artist appears in Spotify artist
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

  // Remix alignment: if parsed title mentions "remix" and Spotify doesn't (or vice versa)
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

async function searchSpotify(
  artist: string,
  title: string,
  token: string
): Promise<{ candidates: SpotifyCandidate[] }> {
  // Remove noise that hurts Spotify search: ID markers, availability tags, record labels
  const cleanTitle = title
    .replace(/\(.*?ID.*?\)/gi, '')                                          // (Unknown ID) etc.
    .replace(/\s*\(Out\s*now\)\s*/gi, '')                                   // (Out now)
    .replace(/\s*\[(?!.*(?:remix|mix|edit|vip|bootleg))[^\]]*\]\s*/gi, '')  // [Label] but keep [Remix]
    .trim();

  // Stage 1: field-based search for precision
  const fieldQuery = encodeURIComponent(
    `track:${cleanTitle}${artist && artist !== 'Unknown Artist' ? ` artist:${artist}` : ''}`
  );
  const fieldRes = await fetchWithRetry(
    `https://api.spotify.com/v1/search?q=${fieldQuery}&type=track&limit=5`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000, retries: 1 }
  );

  if (fieldRes.ok) {
    const data = await fieldRes.json();
    const candidates = extractCandidates(data);
    if (candidates.length > 0) return { candidates };
  }

  // Stage 2: simple text search for recall
  const simpleQuery = encodeURIComponent(
    `${artist !== 'Unknown Artist' ? artist + ' ' : ''}${cleanTitle}`
  );
  const simpleRes = await fetchWithRetry(
    `https://api.spotify.com/v1/search?q=${simpleQuery}&type=track&limit=5`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000, retries: 1 }
  );

  if (simpleRes.ok) {
    const data = await simpleRes.json();
    return { candidates: extractCandidates(data) };
  }

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

  const encoded = encodeURIComponent(query);
  const res = await fetchWithRetry(
    `https://api.spotify.com/v1/search?q=${encoded}&type=track&limit=5`,
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000, retries: 1 }
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    const retryAfter = res.headers.get('retry-after');
    console.error('Spotify search failed:', res.status, errBody, 'retry-after:', retryAfter);
    return {
      available: false,
      reason: 'api_error',
      results: [],
      _debug: {
        status: res.status,
        body: errBody,
        retryAfter,
        tokenPreview: token.slice(0, 10) + '...',
        tokenLength: token.length,
      },
    } as any;
  }
  const data = await res.json();
  return { available: true, results: extractCandidates(data) };
}

/**
 * Batch-search Spotify for all parsed tracks, with confidence scoring.
 */
export async function searchTracks(tracks: ParsedTrack[]): Promise<TrackWithMatches[]> {
  const token = await getSpotifyToken();
  const results: TrackWithMatches[] = [];

  for (const track of tracks) {
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
      } else {
        spotify.candidates = [];
      }

      // Rate limit: 100ms between Spotify requests
      await new Promise((r) => setTimeout(r, 100));
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
