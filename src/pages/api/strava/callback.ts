import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Missing authorization code. Visit the Strava OAuth URL to authorize.', {
      status: 400,
    });
  }

  const tokenResponse = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: import.meta.env.STRAVA_CLIENT_ID,
      client_secret: import.meta.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });

  const tokens = await tokenResponse.json();

  return new Response(
    JSON.stringify(tokens, null, 2),
    { headers: { 'Content-Type': 'application/json' } }
  );
};
