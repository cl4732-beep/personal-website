import type { APIRoute } from 'astro';
import { searchSpotifyQuery } from '../../../lib/spotify';
import { json, jsonError } from '../../../lib/http';
import { checkRateLimit, getRateLimitKey, rateLimitHeaders } from '../../../lib/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const rate = checkRateLimit({
    bucket: 'tracklist-search',
    key: getRateLimitKey(request),
    windowMs: 60_000,
    limit: 60,
  });

  if (!rate.allowed) {
    return jsonError(
      'Too many search requests. Please wait and try again.',
      429,
      'rate_limited',
      undefined,
      rateLimitHeaders(rate)
    );
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return jsonError('Payload too large', 413, 'payload_too_large', undefined, rateLimitHeaders(rate));
  }

  let body: { query?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body', 400, 'invalid_request', undefined, rateLimitHeaders(rate));
  }

  const { query } = body;
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return jsonError(
      'Search query is required (at least 2 characters)',
      400,
      'invalid_query',
      undefined,
      rateLimitHeaders(rate)
    );
  }

  try {
    const result = await searchSpotifyQuery(query.trim());
    return json({ ok: true, ...result }, 200, rateLimitHeaders(rate));
  } catch (err) {
    console.error('Spotify search error:', err);
    return jsonError('Search failed. Please try again.', 500, 'search_failed', undefined, rateLimitHeaders(rate));
  }
};
