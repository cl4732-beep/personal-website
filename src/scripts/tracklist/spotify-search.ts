/**
 * Client-side Spotify search — uses the user's PKCE token so each user
 * gets their own rate-limit allocation (avoids server-side 429 blocks).
 */

export interface SpotifyCandidate {
  name: string;
  artist: string;
  spotifyUrl: string;
  spotifyUri: string;
  albumArt: string;
}

export interface SpotifyMatch {
  found: boolean;
  spotifyUrl: string;
  spotifyUri: string;
  albumArt: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  candidates: SpotifyCandidate[];
}

export interface ParsedTrack {
  position: number;
  timestamp: string;
  timestampSeconds: number;
  rawText: string;
  artist: string;
  title: string;
  notes: string;
}

export interface TrackWithMatch extends ParsedTrack {
  spotify: SpotifyMatch;
}

// --- Scoring ---

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

  if (nArtist && sArtist) {
    if (sArtist === nArtist || sArtist.includes(nArtist) || nArtist.includes(sArtist)) {
      score += 50;
    } else {
      const parsedWords = nArtist.split(' ');
      const matchedWords = parsedWords.filter((w) => w.length > 2 && sArtist.includes(w));
      score += Math.min(30, matchedWords.length * 15);
    }
  }

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

  const parsedHasRemix = /remix|edit|vip|bootleg/i.test(parsedTitle);
  const spotifyHasRemix = /remix|edit|vip|bootleg/i.test(spotifyTitle);
  if (parsedHasRemix !== spotifyHasRemix) {
    score -= 15;
  }

  const confidence: 'high' | 'medium' | 'low' =
    score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

  return { confidence, score: Math.max(0, Math.min(100, score)) };
}

// --- Candidate extraction ---

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

// --- Rate-limit-aware fetch ---

const MAX_429_RETRIES = 3;

async function spotifyFetch(url: string, token: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status !== 429 || attempt === MAX_429_RETRIES) {
      return res;
    }

    const retryAfter = res.headers.get('retry-after');
    const delayMs = retryAfter
      ? Math.min(parseInt(retryAfter, 10) * 1000, 10_000)
      : 2_000 * (attempt + 1);

    await new Promise((r) => setTimeout(r, delayMs));
  }

  throw new Error('Spotify rate limit retries exhausted');
}

// --- Search ---

function cleanTitle(title: string): string {
  return title
    .replace(/\(.*?ID.*?\)/gi, '')
    .replace(/\s*\(Out\s*now\)\s*/gi, '')
    .replace(/\s*\[(?!.*(?:remix|mix|edit|vip|bootleg))[^\]]*\]\s*/gi, '')
    .trim();
}

async function searchOneTrack(
  artist: string,
  title: string,
  token: string
): Promise<SpotifyCandidate[]> {
  const clean = cleanTitle(title);

  // Stage 1: field-based search
  const fieldQuery = encodeURIComponent(
    `track:${clean}${artist && artist !== 'Unknown Artist' ? ` artist:${artist}` : ''}`
  );
  const fieldRes = await spotifyFetch(
    `https://api.spotify.com/v1/search?q=${fieldQuery}&type=track&limit=5`,
    token
  );

  if (fieldRes.ok) {
    const data = await fieldRes.json();
    const candidates = extractCandidates(data);
    if (candidates.length > 0) return candidates;
  }

  // Stage 2: simple text search
  const simpleQuery = encodeURIComponent(
    `${artist !== 'Unknown Artist' ? artist + ' ' : ''}${clean}`
  );
  const simpleRes = await spotifyFetch(
    `https://api.spotify.com/v1/search?q=${simpleQuery}&type=track&limit=5`,
    token
  );

  if (simpleRes.ok) {
    const data = await simpleRes.json();
    return extractCandidates(data);
  }

  return [];
}

const NO_MATCH: SpotifyMatch = {
  found: false,
  spotifyUrl: '',
  spotifyUri: '',
  albumArt: '',
  confidence: 'low',
  score: 0,
  candidates: [],
};

const INTER_REQUEST_DELAY_MS = 500;

/**
 * Search Spotify for all tracks using the user's access token.
 * Calls `onTrackMatched(index, match)` progressively as each result arrives.
 */
export async function searchAllTracks(
  tracks: ParsedTrack[],
  accessToken: string,
  onTrackMatched: (index: number, match: SpotifyMatch) => void
): Promise<TrackWithMatch[]> {
  const results: TrackWithMatch[] = tracks.map((t) => ({ ...t, spotify: { ...NO_MATCH } }));

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    let match: SpotifyMatch = { ...NO_MATCH };

    try {
      const candidates = await searchOneTrack(track.artist, track.title, accessToken);

      if (candidates.length > 0) {
        const best = candidates[0];
        const { confidence, score } = scoreMatch(
          track.artist,
          track.title,
          best.artist,
          best.name
        );

        match = {
          found: true,
          spotifyUrl: best.spotifyUrl,
          spotifyUri: best.spotifyUri,
          albumArt: best.albumArt,
          confidence,
          score,
          candidates,
        };
      }
    } catch {
      // Rate limit exhausted or network error — stop searching
      break;
    }

    results[i] = { ...track, spotify: match };
    onTrackMatched(i, match);

    // Delay between requests
    if (i < tracks.length - 1) {
      await new Promise((r) => setTimeout(r, INTER_REQUEST_DELAY_MS));
    }
  }

  return results;
}

/**
 * Search Spotify for a single query (used by inline correction).
 */
export async function searchQuery(
  query: string,
  accessToken: string
): Promise<SpotifyCandidate[]> {
  const encoded = encodeURIComponent(query);
  const res = await spotifyFetch(
    `https://api.spotify.com/v1/search?q=${encoded}&type=track&limit=5`,
    accessToken
  );

  if (!res.ok) return [];

  const data = await res.json();
  return extractCandidates(data);
}
