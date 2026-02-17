const OAUTH_STATE_COOKIE = 'tracklist_oauth_state';

export function generateRandomString(length: number): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => possible[v % possible.length]).join('');
}

export async function sha256Base64url(plain: string): Promise<string> {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function setOAuthStateCookie(state: string) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}; Max-Age=900; Path=/; SameSite=Lax${secure}`;
}

export function clearOAuthStateCookie() {
  document.cookie = `${OAUTH_STATE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}
