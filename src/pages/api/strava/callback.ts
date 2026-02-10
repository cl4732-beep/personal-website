import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const callbackEnabled = import.meta.env.STRAVA_OAUTH_CALLBACK_ENABLED === 'true';
  if (!callbackEnabled) {
    return new Response('Not found', { status: 404 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = import.meta.env.STRAVA_OAUTH_STATE;

  if (expectedState && state !== expectedState) {
    return new Response('Invalid OAuth state.', { status: 403 });
  }

  if (!code) {
    return new Response('Missing authorization code. Visit the Strava OAuth URL to authorize.', {
      status: 400,
    });
  }

  const clientId = import.meta.env.STRAVA_CLIENT_ID;
  const clientSecret = import.meta.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response('Missing Strava client credentials in environment.', { status: 500 });
  }

  const tokenResponse = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    return new Response(`Strava token exchange failed (${tokenResponse.status}): ${errorBody}`, {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const tokens = await tokenResponse.json();

  return new Response(
    JSON.stringify(tokens, null, 2),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
};
