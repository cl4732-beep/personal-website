const STORAGE_KEY = 'tracklist_library_v1';

// --- Types ---

interface SavedTrackSpotify {
  found: boolean;
  spotifyUrl: string;
  spotifyUri: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
}

interface SavedTrack {
  position: number;
  timestamp: string;
  timestampSeconds: number;
  artist: string;
  title: string;
  notes: string;
  rawText: string;
  spotify: SavedTrackSpotify;
}

interface ExportRecord {
  exportedAt: string;
  playlistUrl: string;
  addedCount: number;
  likedCount: number;
  failedCount: number;
  exportedUris: string[];
}

interface SavedSet {
  videoId: string;
  videoUrl: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  extractedAt: string;
  updatedAt: string;
  source?: 'comment';
  commentAuthor?: string;
  commentUrl?: string;
  tracks: SavedTrack[];
  exportHistory: ExportRecord[];
}

interface LibraryStore {
  version: 1;
  sets: SavedSet[];
}

// --- Storage helpers ---

function readStore(): LibraryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, sets: [] };
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.sets)) {
      return parsed as LibraryStore;
    }
    return { version: 1, sets: [] };
  } catch {
    return { version: 1, sets: [] };
  }
}

function writeStore(store: LibraryStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

// --- Conversion: API response → SavedTrack ---

function toSavedTrack(apiTrack: any): SavedTrack {
  const sp = apiTrack.spotify || {};
  return {
    position: apiTrack.position ?? 0,
    timestamp: apiTrack.timestamp ?? '',
    timestampSeconds: apiTrack.timestampSeconds ?? 0,
    artist: apiTrack.artist ?? '',
    title: apiTrack.title ?? '',
    notes: apiTrack.notes ?? '',
    rawText: apiTrack.rawText ?? '',
    spotify: {
      found: !!sp.found,
      spotifyUrl: sp.spotifyUrl ?? '',
      spotifyUri: sp.spotifyUri ?? '',
      confidence: sp.confidence ?? 'low',
      score: sp.score ?? 0,
    },
  };
}

// --- Public API ---

/**
 * Save or update a set from an API extraction response.
 * If videoId already exists: updates tracks only if the new extraction has more,
 * preserves exportHistory, keeps original extractedAt, updates updatedAt.
 */
export function saveSet(apiResponse: any, videoUrl: string): void {
  const store = readStore();
  const now = new Date().toISOString();
  const videoId: string = apiResponse.videoId;

  const newTracks = (apiResponse.tracks || []).map(toSavedTrack);

  const existingIdx = store.sets.findIndex((s) => s.videoId === videoId);

  if (existingIdx !== -1) {
    const existing = store.sets[existingIdx];
    if (newTracks.length >= existing.tracks.length) {
      existing.tracks = newTracks;
    }
    existing.title = apiResponse.title || existing.title;
    existing.channelName = apiResponse.channelName || existing.channelName;
    existing.thumbnailUrl = apiResponse.thumbnailUrl || existing.thumbnailUrl;
    existing.videoUrl = videoUrl || existing.videoUrl;
    existing.updatedAt = now;
    if (apiResponse.source === 'comment') {
      existing.source = 'comment';
      existing.commentAuthor = apiResponse.commentAuthor;
      existing.commentUrl = apiResponse.commentUrl;
    }
  } else {
    const newSet: SavedSet = {
      videoId,
      videoUrl,
      title: apiResponse.title || '',
      channelName: apiResponse.channelName || '',
      thumbnailUrl: apiResponse.thumbnailUrl || '',
      extractedAt: now,
      updatedAt: now,
      tracks: newTracks,
      exportHistory: [],
    };
    if (apiResponse.source === 'comment') {
      newSet.source = 'comment';
      newSet.commentAuthor = apiResponse.commentAuthor;
      newSet.commentUrl = apiResponse.commentUrl;
    }
    store.sets.unshift(newSet);
  }

  // Keep sorted by extractedAt desc
  store.sets.sort((a, b) => new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime());
  writeStore(store);
}

/**
 * Record an export event for a set.
 */
export function updateSetExport(videoId: string, exportInfo: ExportRecord): void {
  const store = readStore();
  const set = store.sets.find((s) => s.videoId === videoId);
  if (!set) return;
  set.exportHistory.push(exportInfo);
  set.updatedAt = new Date().toISOString();
  writeStore(store);
}

/**
 * Load all saved sets, sorted by extractedAt desc.
 */
export function loadLibrary(): SavedSet[] {
  return readStore().sets;
}

/**
 * Load a single saved set by videoId.
 */
export function loadSet(videoId: string): SavedSet | null {
  return readStore().sets.find((s) => s.videoId === videoId) ?? null;
}

/**
 * Delete a set from the library.
 */
export function deleteSet(videoId: string): void {
  const store = readStore();
  store.sets = store.sets.filter((s) => s.videoId !== videoId);
  writeStore(store);
}

/**
 * Quick count without parsing full sets.
 */
export function getLibraryCount(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.sets) ? parsed.sets.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Search library by query — case-insensitive substring match
 * across set title, channelName, and all track artist/title fields.
 */
export function searchLibrary(query: string): SavedSet[] {
  if (!query.trim()) return loadLibrary();

  const q = query.toLowerCase();
  return loadLibrary().filter((set) => {
    if (set.title.toLowerCase().includes(q)) return true;
    if (set.channelName.toLowerCase().includes(q)) return true;
    return set.tracks.some(
      (t) => t.artist.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
    );
  });
}

/**
 * Convert a SavedSet back to the shape renderIPodPlaylist() and
 * renderDetailTracklist() expect (same as extract API response).
 */
export function toTracklistData(set: SavedSet): any {
  const data: any = {
    ok: true,
    title: set.title,
    channelName: set.channelName,
    thumbnailUrl: set.thumbnailUrl,
    videoId: set.videoId,
    tracks: set.tracks.map((t) => ({
      ...t,
      spotify: {
        ...t.spotify,
        albumArt: '',
        candidates: [],
      },
    })),
  };

  if (set.source === 'comment') {
    data.source = 'comment';
    data.commentAuthor = set.commentAuthor;
    data.commentUrl = set.commentUrl;
  }

  return data;
}

/**
 * Collect all exported Spotify URIs across all export records for a set.
 * Used for truthful per-track "EXPORTED" badges.
 */
export function getExportedUrisForSet(set: SavedSet): Set<string> {
  const uris = new Set<string>();
  for (const record of set.exportHistory) {
    for (const uri of record.exportedUris) {
      uris.add(uri);
    }
  }
  return uris;
}

export type { SavedSet, SavedTrack, ExportRecord, SavedTrackSpotify };
