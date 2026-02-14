import type { APIRoute } from 'astro';
import { recordView } from '../../lib/tracking';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: { token?: string; slug?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const { token, slug } = body;

  if (
    !token || typeof token !== 'string' ||
    !slug || typeof slug !== 'string'
  ) {
    return new Response(null, { status: 400 });
  }

  // Basic format validation
  if (token.length > 128 || slug.length > 256) {
    return new Response(null, { status: 400 });
  }

  await recordView(token, slug);

  return new Response(null, { status: 204 });
};
