import type { APIRoute } from 'astro';
import { supabase } from '../../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // Verify webhook secret
  const webhookSecret = import.meta.env.BUTTONDOWN_WEBHOOK_SECRET;
  if (webhookSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${webhookSecret}`) {
      return new Response(null, { status: 401 });
    }
  }

  if (!supabase) {
    return new Response('Database not configured', { status: 500 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const email = body?.data?.email ?? body?.email;
  if (!email || typeof email !== 'string') {
    return new Response('Missing email', { status: 400 });
  }

  // Generate a unique tracking token
  const token = crypto.randomUUID();

  // Upsert subscriber in Supabase
  const { error: dbError } = await supabase
    .from('subscribers')
    .upsert(
      { email, token },
      { onConflict: 'email' }
    );

  if (dbError) {
    console.error('Failed to upsert subscriber:', dbError.message);
    return new Response('Database error', { status: 500 });
  }

  // Update Buttondown subscriber metadata with the tracking token
  const buttondownKey = import.meta.env.BUTTONDOWN_API_KEY;
  if (buttondownKey) {
    try {
      await fetch(`https://api.buttondown.com/v1/subscribers/${email}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Token ${buttondownKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          metadata: { tracking_token: token },
        }),
      });
    } catch (err) {
      console.error('Failed to update Buttondown metadata:', err);
    }
  }

  return new Response(null, { status: 200 });
};
