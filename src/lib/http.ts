export interface ApiErrorShape {
  ok: false;
  error: string;
  errorCode: string;
  errorDetails: {
    code: string;
    message: string;
  };
}

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
  });
}

export function jsonError(
  message: string,
  status = 400,
  code = 'bad_request',
  extra?: Record<string, unknown>,
  headers?: HeadersInit
): Response {
  const payload: ApiErrorShape & Record<string, unknown> = {
    ok: false,
    error: message,
    errorCode: code,
    errorDetails: { code, message },
    message,
  };

  if (extra) {
    Object.assign(payload, extra);
  }

  return json(payload, status, headers);
}

export function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return {};

  const cookies: Record<string, string> = {};
  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!name) continue;

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }

  return cookies;
}

export function expireCookie(name: string, path = '/'): string {
  return `${name}=; Max-Age=0; Path=${path}; SameSite=Lax`;
}

export function getRequestOrigin(request: Request): string | null {
  const directOrigin = request.headers.get('origin');
  if (directOrigin) return directOrigin;

  const referer = request.headers.get('referer');
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
