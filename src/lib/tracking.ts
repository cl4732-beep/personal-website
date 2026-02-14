import { supabase } from './db';

/**
 * Record a post view from a subscriber who clicked through from email.
 * Deduplicates: one event per subscriber-post pair per calendar day.
 */
export async function recordView(token: string, slug: string): Promise<boolean> {
  if (!supabase) return false;

  // Look up subscriber by token
  const { data: subscriber, error: subError } = await supabase
    .from('subscribers')
    .select('id')
    .eq('token', token)
    .single();

  if (subError || !subscriber) return false;

  // Insert view (unique constraint on subscriber_id + post_slug + date handles dedup)
  const { error } = await supabase
    .from('post_views')
    .insert({
      subscriber_id: subscriber.id,
      post_slug: slug,
    });

  // 23505 = unique_violation (already viewed today) — not an error
  if (error && error.code !== '23505') {
    console.error('Failed to record view:', error.message);
    return false;
  }

  return true;
}

/** Get all posts a specific subscriber has viewed. */
export async function getSubscriberActivity(subscriberId: string) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('post_views')
    .select('post_slug, viewed_at')
    .eq('subscriber_id', subscriberId)
    .order('viewed_at', { ascending: false });

  if (error) {
    console.error('Failed to get subscriber activity:', error.message);
    return [];
  }

  return data ?? [];
}

/** Get all subscribers who viewed a specific post. */
export async function getPostReaders(slug: string) {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('post_views')
    .select('subscriber_id, viewed_at')
    .eq('post_slug', slug)
    .order('viewed_at', { ascending: false });

  if (error) {
    console.error('Failed to get post readers:', error.message);
    return [];
  }

  return data ?? [];
}
