import type { APIRoute } from 'astro';
import { fetchWithTimeout } from '../../../lib/fetch';
import { json, jsonError, parseCookies, getRequestOrigin, expireCookie } from '../../../lib/http';
import { checkRateLimit, getRateLimitKey, rateLimitHeaders } from '../../../lib/rate-limit';
import { getAllowedTracklistOrigins, isOriginAllowed } from '../../../lib/origin';
import { requiredEnv } from '../../../lib/env';

export const prerender = false;

const OAUTH_STATE_COOKIE = 'tracklist_oauth_state';
const CLEAR_OAUTH_STATE_COOKIE = expireCookie(OAUTH_STATE_COOKIE, '/');

function mergeHeaders(...headerSets: Array<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const set of headerSets) {
    if (!set) continue;
    const headers = new Headers(set);
    headers.forEach((value, key) => {
      merged.set(key, value);
    });
  }
  return merged;
}

function makeHeaders(rateHeaders: HeadersInit, extra?: HeadersInit): Headers {
  return mergeHeaders(rateHeaders, extra, { 'Set-Cookie': CLEAR_OAUTH_STATE_COOKIE });
}

export const POST: APIRoute = async ({ request }) => {
  const rate = checkRateLimit({
    bucket: 'tracklist-export',
    key: getRateLimitKey(request),
    windowMs: 60_000,
    limit: 10,
  });

  if (!rate.allowed) {
    return jsonError(
      'Too many playlist exports. Please wait and try again.',
      429,
      'rate_limited',
      undefined,
      makeHeaders(rateLimitHeaders(rate))
    );
  }

  let body: {
    code?: string;
    codeVerifier?: string;
    state?: string;
    playlistName?: string;
    playlistDescription?: string;
    uris?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return jsonError(
      'Invalid request body',
      400,
      'invalid_request',
      undefined,
      makeHeaders(rateLimitHeaders(rate))
    );
  }

  const { code, codeVerifier, state, playlistName, playlistDescription, uris } = body;

  if (!code || !codeVerifier || !state) {
    return jsonError(
      'Missing required OAuth fields',
      400,
      'missing_oauth_fields',
      undefined,
      makeHeaders(rateLimitHeaders(rate))
    );
  }

  const origin = getRequestOrigin(request);
  if (!origin) {
    return jsonError(
      'Could not validate request origin',
      403,
      'missing_origin',
      undefined,
      makeHeaders(rateLimitHeaders(rate))
    );
  }

  const normalizedOrigin = origin.replace(/\/+$/, '');
  const allowedOrigins = getAllowedTracklistOrigins();
  if (!isOriginAllowed(normalizedOrigin, allowedOrigins)) {
    return jsonError(
      'Origin not allowed for playlist export',
      403,
      'origin_not_allowed',
      undefined,
      makeHeaders(rateLimitHeaders(rate))
    );
  }

  const cookies = parseCookies(request);
  const cookieState = cookies[OAUTH_STATE_COOKIE];

  if (!cookieState || cookieState !== state) {
    return jsonError(
      'Invalid OAuth state',
      403,
      'invalid_oauth_state',
      undefined,
      makeHeaders(rateLimitHeaders(rate))
    );
  }

  const redirectUri = `${normalizedOrigin}/projects/tracklist`;

  const clientId = requiredEnv('SPOTIFY_CLIENT_ID', 'tracklist export');

  try {
    const tokenRes = await fetchWithTimeout(
      'https://accounts.spotify.com/api/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          client_id: clientId,
        }),
      },
      15_000
    );

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => '');
      console.error('Spotify token exchange failed:', tokenRes.status, errBody);
      return jsonError(
        `Token exchange failed (${tokenRes.status})`,
        500,
        'spotify_token_exchange_failed',
        undefined,
        makeHeaders(rateLimitHeaders(rate))
      );
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const meRes = await fetchWithTimeout(
      'https://api.spotify.com/v1/me',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      15_000
    );

    if (!meRes.ok) {
      const errBody = await meRes.text().catch(() => '');
      console.error('Spotify /me failed:', meRes.status, errBody);
      return jsonError(
        `Failed to get user profile (${meRes.status})`,
        500,
        'spotify_profile_fetch_failed',
        undefined,
        makeHeaders(rateLimitHeaders(rate))
      );
    }

    const me = await meRes.json();

    if (me.product && me.product !== 'premium') {
      return jsonError(
        `Spotify Premium is required to create playlists via development mode apps. Your account type: ${me.product || 'unknown'}.`,
        403,
        'premium_required',
        undefined,
        makeHeaders(rateLimitHeaders(rate))
      );
    }

    const createRes = await fetchWithTimeout(
      'https://api.spotify.com/v1/me/playlists',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: playlistName || 'DJ Set Tracklist',
          description: playlistDescription || '',
          public: false,
        }),
      },
      15_000
    );

    if (!createRes.ok) {
      const errBody = await createRes.text().catch(() => '');
      console.error('Spotify playlist creation failed:', createRes.status, errBody);

      if (createRes.status === 403) {
        return jsonError(
          'Spotify rejected playlist creation. Your Spotify account needs to be added as an approved user in the app\'s Developer Dashboard (Settings → User Management).',
          403,
          'spotify_user_not_approved',
          undefined,
          makeHeaders(rateLimitHeaders(rate))
        );
      }

      return jsonError(
        `Failed to create playlist (${createRes.status})`,
        500,
        'spotify_playlist_create_failed',
        { details: errBody.slice(0, 500) },
        makeHeaders(rateLimitHeaders(rate))
      );
    }

    const playlist = await createRes.json();

    const trackUris = Array.isArray(uris)
      ? uris.filter((uri): uri is string => typeof uri === 'string' && uri.startsWith('spotify:track:'))
      : [];

    let addedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < trackUris.length; i += 100) {
      const batch = trackUris.slice(i, i + 100);
      const addRes = await fetchWithTimeout(
        `https://api.spotify.com/v1/playlists/${playlist.id}/items`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: batch }),
        },
        15_000
      );

      if (addRes.ok) {
        addedCount += batch.length;
      } else {
        const errBody = await addRes.text().catch(() => '');
        console.error(`Failed to add batch ${i / 100 + 1}:`, addRes.status, errBody);
        failedCount += batch.length;
      }
    }

    // Save tracks to Liked Songs (user-library-modify scope)
    let likedCount = 0;
    let likedFailed = 0;

    const trackIds = trackUris.map((uri) => uri.replace('spotify:track:', ''));

    for (let i = 0; i < trackIds.length; i += 50) {
      const batch = trackIds.slice(i, i + 50);
      const likeRes = await fetchWithTimeout(
        'https://api.spotify.com/v1/me/tracks',
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids: batch }),
        },
        15_000
      );

      if (likeRes.ok) {
        likedCount += batch.length;
      } else {
        const errBody = await likeRes.text().catch(() => '');
        console.error(`Failed to save batch ${i / 50 + 1} to Liked Songs:`, likeRes.status, errBody);
        likedFailed += batch.length;
      }
    }

    return json(
      {
        ok: true,
        playlistUrl: playlist.external_urls?.spotify || '#',
        addedCount,
        failedCount,
        likedCount,
        likedFailed,
        selectedCount: trackUris.length,
      },
      200,
      makeHeaders(rateLimitHeaders(rate))
    );
  } catch (err) {
    console.error('Spotify export error:', err);
    return jsonError(
      'Export failed unexpectedly',
      500,
      'spotify_export_failed',
      undefined,
      makeHeaders(rateLimitHeaders(rate))
    );
  }
};
