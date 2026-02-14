import type { APIRoute } from 'astro';
import { supabase } from '../../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const email = formData.get('email')?.toString()?.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return redirect('/writings/?subscribe=error', 303);
  }

  const token = crypto.randomUUID();
  const buttondownKey = import.meta.env.BUTTONDOWN_API_KEY;

  // 1. Store subscriber in Supabase with tracking token
  if (supabase) {
    const { error } = await supabase
      .from('subscribers')
      .upsert(
        { email, token },
        { onConflict: 'email' }
      );

    if (error) {
      console.error('Supabase upsert failed:', error.message);
    }
  }

  // 2. Forward subscription to Buttondown
  if (buttondownKey) {
    try {
      const res = await fetch('https://api.buttondown.com/v1/subscribers', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${buttondownKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          metadata: { tracking_token: token },
        }),
      });

      // If subscriber already exists, update their metadata
      if (res.status === 409) {
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
      }
    } catch (err) {
      console.error('Buttondown API error:', err);
    }
  }

  // 3. Redirect back to site with success message
  return redirect('/writings/?subscribe=success', 303);
};
