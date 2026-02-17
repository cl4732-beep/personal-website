import { requiredEnv } from './env';
import { fetchWithRetry } from './fetch';

interface VideoMetadata {
  videoId: string;
  title: string;
  description: string;
  channelName: string;
  thumbnailUrl: string;
}

interface ParsedTrack {
  position: number;
  timestamp: string;
  timestampSeconds: number;
  rawText: string;
  artist: string;
  title: string;
  notes: string;
}

/**
 * Extract a YouTube video ID from various URL formats.
 * Supports: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/live/, youtube.com/shorts/
 */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace('www.', '');

    // youtube.com/watch?v=ID
    if (hostname.includes('youtube.com') && parsed.searchParams.has('v')) {
      return parsed.searchParams.get('v');
    }

    // youtu.be/ID
    if (hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0];
      return id || null;
    }

    // youtube.com/embed/ID or youtube.com/live/ID or youtube.com/shorts/ID
    if (hostname.includes('youtube.com')) {
      const match = parsed.pathname.match(/^\/(embed|live|shorts)\/([^/?]+)/);
      if (match) return match[2];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch video metadata from the YouTube Data API v3.
 */
export async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  const apiKey = requiredEnv('YOUTUBE_API_KEY', 'YouTube tracklist extraction');

  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${apiKey}`;
  const res = await fetchWithRetry(url, { timeout: 10_000, retries: 2 });

  if (!res.ok) {
    const text = await res.text();
    console.error('YouTube API error:', res.status, text);
    throw new Error(`YouTube API request failed: ${res.status}`);
  }

  const data = await res.json();
  const items = data.items;

  if (!items || items.length === 0) {
    throw new Error('Video not found or is unavailable');
  }

  const snippet = items[0].snippet;
  const thumbnails = snippet.thumbnails;
  const thumbnailUrl =
    thumbnails.maxres?.url ||
    thumbnails.high?.url ||
    thumbnails.medium?.url ||
    thumbnails.default?.url ||
    '';

  return {
    videoId,
    title: snippet.title || '',
    description: snippet.description || '',
    channelName: snippet.channelTitle || '',
    thumbnailUrl,
  };
}

// --- Tracklist Parsing ---

// Matches timestamps: 0:00, 00:00, 1:00:00, 01:23:45, [0:00], [1:23:45]
const TIMESTAMP_RE = /\[?(\d{1,2}(?::\d{2}){1,2})\]?/;

// Lines that are clearly not track entries
const NOISE_PATTERNS = [
  /^subscribe/i,
  /^follow\s/i,
  /^tracklist\s*[:.]?\s*$/i,
  /^setlist\s*[:.]?\s*$/i,
  /^playlist\s*[:.]?\s*$/i,
  /^download/i,
  /^listen\s/i,
  /^buy\s/i,
  /^support\s/i,
  /^recorded\s/i,
  /^filmed\s/i,
  /^video\s*by/i,
  /^audio\s*by/i,
  /^camera/i,
  /^directed/i,
  /^produced/i,
  /^mixed\s*by/i,
  /^booking/i,
  /^https?:\/\//i,
  /^www\./i,
  /^#\w/,
  /^@\w/,
  /^►/,
  /^▶/,
  /facebook|instagram|twitter|soundcloud|tiktok|snapchat/i,
];

// Notes markers that indicate special track status
const NOTES_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(ID)\b/i, label: 'ID' },
  { re: /\bunreleased\b/i, label: 'unreleased' },
  { re: /\bedit\b/i, label: 'edit' },
  { re: /\bbootleg\b/i, label: 'bootleg' },
  { re: /\bVIP\b/, label: 'VIP' },
  { re: /\bw\/\s/, label: 'w/' },
  { re: /\blive\b/i, label: 'live' },
];

function isNoiseLine(text: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(text));
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function normalizeDedupKeyPart(value: string): string {
  return value.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function extractNotes(text: string): string {
  const found: string[] = [];
  for (const { re, label } of NOTES_PATTERNS) {
    if (re.test(text)) found.push(label);
  }
  return found.join(', ');
}

function parseArtistTitle(text: string): { artist: string; title: string } {
  // "Artist - Title" with various dash characters
  const dashSeparators = [' - ', ' – ', ' — ', ' -- '];
  for (const sep of dashSeparators) {
    const idx = text.indexOf(sep);
    if (idx > 0) {
      return {
        artist: text.slice(0, idx).trim(),
        title: text.slice(idx + sep.length).trim(),
      };
    }
  }

  // "Title by Artist"
  const byMatch = text.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return { artist: byMatch[2].trim(), title: byMatch[1].trim() };
  }

  // "Artist: Title" (only if colon isn't part of a URL)
  const colonIdx = text.indexOf(': ');
  if (colonIdx > 0 && colonIdx < text.length - 2 && !text.startsWith('http')) {
    return {
      artist: text.slice(0, colonIdx).trim(),
      title: text.slice(colonIdx + 2).trim(),
    };
  }

  // Cannot split — return full text as title
  return { artist: '', title: text };
}

/**
 * Parse a tracklist from a YouTube video description.
 * Looks for lines containing timestamps and extracts artist/title info.
 */
export function parseTracklist(description: string): ParsedTrack[] {
  const lines = description.split('\n');
  const tracks: ParsedTrack[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 4) continue;

    // Must contain a timestamp
    const tsMatch = trimmed.match(TIMESTAMP_RE);
    if (!tsMatch) continue;

    const timestamp = tsMatch[1];
    const timestampSeconds = parseTimestamp(timestamp);

    // Remove the timestamp (and brackets) from the line
    let remainder = trimmed.replace(TIMESTAMP_RE, '').trim();

    // Remove leading separators and track numbers
    remainder = remainder
      .replace(/^[-–—.:]\s*/, '')   // leading dash/dot/colon
      .replace(/^\d{1,3}[.)]\s*/, '') // "01. " or "1) "
      .replace(/\s*[-–—.:]\s*$/, '') // trailing separator
      .trim();

    if (!remainder || remainder.length < 2) continue;
    if (isNoiseLine(remainder)) continue;

    const notes = extractNotes(remainder);
    const { artist, title } = parseArtistTitle(remainder);

    if (title) {
      tracks.push({
        position: 0, // assigned after sorting
        timestamp,
        timestampSeconds,
        rawText: trimmed,
        artist: artist || 'Unknown Artist',
        title,
        notes,
      });
    }
  }

  // Sort by timestamp and assign positions
  tracks.sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  // Deduplicate: remove only truly duplicate entries
  // Keep same-timestamp entries when title/artist differ.
  const deduped: ParsedTrack[] = [];
  const seenKeys = new Set<string>();
  for (const track of tracks) {
    const key = [
      track.timestampSeconds,
      normalizeDedupKeyPart(track.artist),
      normalizeDedupKeyPart(track.title),
    ].join('|');
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    track.position = deduped.length + 1;
    deduped.push(track);
  }

  return deduped;
}

/**
 * Parse a tracklist from plain text lines without timestamps.
 * For comments that list tracks as "Artist - Title" without timing info.
 * Only keeps lines where parseArtistTitle() finds a valid artist-title split.
 */
function parseTracklistFromLines(text: string): ParsedTrack[] {
  const lines = text.split('\n');
  const tracks: ParsedTrack[] = [];
  const seenKeys = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 5) continue;
    if (isNoiseLine(trimmed)) continue;

    // Strip leading track numbers and timestamps
    let cleaned = trimmed
      .replace(/^\d{1,3}[.)]\s*/, '')          // "01. " or "1) "
      .replace(/^\d{1,3}\s*[-–—]\s*/, '')      // "1 -"
      .replace(TIMESTAMP_RE, '')                // strip any timestamp
      .replace(/^[-–—.:]\s*/, '')               // leading separator after timestamp
      .trim();

    if (!cleaned || cleaned.length < 5) continue;
    if (isNoiseLine(cleaned)) continue;

    const { artist, title } = parseArtistTitle(cleaned);

    // Only keep lines where a separator was found (artist non-empty)
    if (!artist) continue;

    const notes = extractNotes(cleaned);
    const key = [normalizeDedupKeyPart(artist), normalizeDedupKeyPart(title)].join('|');
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    tracks.push({
      position: tracks.length + 1,
      timestamp: '',
      timestampSeconds: 0,
      rawText: trimmed,
      artist,
      title,
      notes,
    });
  }

  return tracks;
}

// --- Comment-based tracklist fallback ---

interface CommentTracklistResult {
  tracks: ParsedTrack[];
  commentAuthor: string;
  commentLikes: number;
  commentId: string;
}

const MIN_COMMENT_TRACKS = 5;

function hasMonotonicTimestamps(tracks: ParsedTrack[]): boolean {
  if (tracks.length < 2) return false;
  let increasing = 0;
  for (let i = 1; i < tracks.length; i++) {
    if (tracks[i].timestampSeconds >= tracks[i - 1].timestampSeconds) increasing++;
  }
  return increasing / (tracks.length - 1) >= 0.8;
}

/**
 * Search video comments for a timestamped tracklist.
 * Fetches top 100 comments sorted by relevance (most-liked first),
 * parses each with parseTracklist(), and picks the best candidate.
 * Returns null if no valid tracklist comment is found or comments are disabled.
 */
export async function fetchTracklistFromComments(
  videoId: string
): Promise<CommentTracklistResult | null> {
  const apiKey = requiredEnv('YOUTUBE_API_KEY', 'YouTube comment tracklist search');

  const params = new URLSearchParams({
    part: 'snippet',
    videoId,
    maxResults: '100',
    order: 'relevance',
    textFormat: 'plainText',
    key: apiKey,
  });

  const url = `https://www.googleapis.com/youtube/v3/commentThreads?${params}`;

  let res: Response;
  try {
    res = await fetchWithRetry(url, { timeout: 10_000, retries: 1 });
  } catch {
    // Network error — comments unavailable
    return null;
  }

  if (!res.ok) {
    // 403 = comments disabled, or other API error — graceful fallback
    return null;
  }

  const data = await res.json();
  const items = data.items;
  if (!items || items.length === 0) return null;

  let bestCandidate: {
    tracks: ParsedTrack[];
    author: string;
    likes: number;
    commentId: string;
  } | null = null;

  for (const thread of items) {
    const comment = thread.snippet?.topLevelComment;
    if (!comment) continue;

    const snippet = comment.snippet;
    const text: string = snippet.textDisplay || '';
    if (!text) continue;

    const likes: number = snippet.likeCount ?? 0;

    // Strategy 1: Timestamped tracklist (original behavior)
    const timestampedTracks = parseTracklist(text);
    if (
      timestampedTracks.length >= MIN_COMMENT_TRACKS &&
      hasMonotonicTimestamps(timestampedTracks)
    ) {
      if (
        !bestCandidate ||
        timestampedTracks.length > bestCandidate.tracks.length ||
        (timestampedTracks.length === bestCandidate.tracks.length && likes > bestCandidate.likes)
      ) {
        bestCandidate = {
          tracks: timestampedTracks,
          author: snippet.authorDisplayName || 'Unknown',
          likes,
          commentId: comment.id || thread.id || '',
        };
      }
      continue; // Timestamped found for this comment; skip non-timestamped
    }

    // Strategy 2: Non-timestamped "Artist - Title" lines (fallback)
    const plainTracks = parseTracklistFromLines(text);
    if (plainTracks.length >= MIN_COMMENT_TRACKS) {
      if (
        !bestCandidate ||
        plainTracks.length > bestCandidate.tracks.length ||
        (plainTracks.length === bestCandidate.tracks.length && likes > bestCandidate.likes)
      ) {
        bestCandidate = {
          tracks: plainTracks,
          author: snippet.authorDisplayName || 'Unknown',
          likes,
          commentId: comment.id || thread.id || '',
        };
      }
    }
  }

  if (!bestCandidate) return null;

  return {
    tracks: bestCandidate.tracks,
    commentAuthor: bestCandidate.author,
    commentLikes: bestCandidate.likes,
    commentId: bestCandidate.commentId,
  };
}

export type { VideoMetadata, ParsedTrack, CommentTracklistResult };
