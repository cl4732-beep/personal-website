interface RetryOptions extends RequestInit {
  retries?: number;
  timeout?: number;
}

/**
 * Fetch with an AbortController timeout.
 * Throws a descriptive error if the request exceeds timeoutMs.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request to ${new URL(url).hostname} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch with timeout + automatic retry on 5xx / network errors.
 * Does NOT retry on 4xx (client errors).
 */
export async function fetchWithRetry(
  url: string,
  options: RetryOptions = {}
): Promise<Response> {
  const { retries = 2, timeout = 10_000, ...fetchOptions } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, fetchOptions, timeout);

      // Don't retry client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      // Retry server errors (5xx)
      if (response.status >= 500 && attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(
          `[fetch-retry] ${new URL(url).hostname} returned ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < retries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(
          `[fetch-retry] ${new URL(url).hostname} failed: ${lastError.message}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error(`Request to ${url} failed after ${retries + 1} attempts`);
}
