import type { APIRoute } from 'astro';
import { extractVideoId, fetchVideoMetadata, parseTracklist, fetchTracklistFromComments } from '../../../lib/youtube';
import { searchTracks } from '../../../lib/spotify';
import { json, jsonError } from '../../../lib/http';
import { checkRateLimit, getRateLimitKey, rateLimitHeaders } from '../../../lib/rate-limit';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const rate = checkRateLimit({
    bucket: 'tracklist-extract',
    key: getRateLimitKey(request),
    windowMs: 60_000,
    limit: 15,
  });

  if (!rate.allowed) {
    return jsonError(
      'Too many extraction attempts. Please wait and try again.',
      429,
      'rate_limited',
      undefined,
      rateLimitHeaders(rate)
    );
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return jsonError('Payload too large', 413, 'payload_too_large', undefined, rateLimitHeaders(rate));
  }

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body', 400, 'invalid_request', undefined, rateLimitHeaders(rate));
  }

  const { url } = body;
  if (!url || typeof url !== 'string') {
    return jsonError('URL is required', 400, 'missing_url', undefined, rateLimitHeaders(rate));
  }

  const videoId = extractVideoId(url.trim());
  if (!videoId) {
    return jsonError(
      'Invalid YouTube URL. Please paste a link to a YouTube video.',
      400,
      'invalid_youtube_url',
      undefined,
      rateLimitHeaders(rate)
    );
  }

  try {
    const metadata = await fetchVideoMetadata(videoId);
    const tracks = parseTracklist(metadata.description);

    if (tracks.length === 0) {
      // Fallback: search comments for a tracklist
      const commentResult = await fetchTracklistFromComments(videoId);

      if (!commentResult) {
        return json({
          ok: false,
          error: 'No tracklist found in the video description or comments.',
          title: metadata.title,
          videoId: metadata.videoId,
        }, 200, rateLimitHeaders(rate));
      }

      const commentTracksWithMatches = await searchTracks(commentResult.tracks);

      return json({
        ok: true,
        title: metadata.title,
        channelName: metadata.channelName,
        thumbnailUrl: metadata.thumbnailUrl,
        videoId: metadata.videoId,
        tracks: commentTracksWithMatches,
        source: 'comment',
        commentAuthor: commentResult.commentAuthor,
        commentLikes: commentResult.commentLikes,
        commentUrl: `https://www.youtube.com/watch?v=${metadata.videoId}&lc=${commentResult.commentId}`,
      }, 200, rateLimitHeaders(rate));
    }

    const tracksWithMatches = await searchTracks(tracks);

    return json({
      ok: true,
      title: metadata.title,
      channelName: metadata.channelName,
      thumbnailUrl: metadata.thumbnailUrl,
      videoId: metadata.videoId,
      tracks: tracksWithMatches,
    }, 200, rateLimitHeaders(rate));
  } catch (err) {
    console.error('Tracklist extraction error:', err);

    const message =
      err instanceof Error && err.message.includes('not found')
        ? 'Video not found or is unavailable. It may be private or deleted.'
        : err instanceof Error && err.message.includes('YOUTUBE_API_KEY')
          ? 'Service temporarily unavailable. Please try again later.'
          : 'Failed to extract tracklist. Please try again.';

    return jsonError(message, 500, 'tracklist_extract_failed', undefined, rateLimitHeaders(rate));
  }
};
