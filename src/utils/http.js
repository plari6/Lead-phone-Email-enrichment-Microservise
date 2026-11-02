export class ProviderError extends Error {
  constructor(message, { provider, status = null, retryable = false, fatal = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable; // try again after a pause
    this.fatal = fatal; // bad key or out of credits: stop using this provider
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a JSON endpoint with a timeout and exponential backoff.
 * fatalStatuses / retryStatuses differ per provider (Hunter uses 429 for "quota used up").
 */
export async function requestJson(url, opts = {}) {
  const {
    provider = 'http',
    fetchImpl = globalThis.fetch,
    timeoutMs = 15000,
    retries = 3,
    backoffMs = 600,
    fatalStatuses = [401, 402],
    retryStatuses = [429, 500, 502, 503, 504],
    headers = {},
  } = opts;

  for (let attempt = 0; ; attempt++) {
    let error;
    try {
      const res = await fetchImpl(String(url), {
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok && !retryStatuses.includes(res.status)) return await res.json();

      const body = await res.text().catch(() => '');
      error = new ProviderError(`${provider} HTTP ${res.status}: ${redact(body).slice(0, 200)}`, {
        provider,
        status: res.status,
        fatal: fatalStatuses.includes(res.status),
        retryable: retryStatuses.includes(res.status),
      });
    } catch (e) {
      error = e instanceof ProviderError
        ? e
        : new ProviderError(`${provider} request failed: ${redact(e.message)}`, { provider, retryable: true });
    }
    if (!error.retryable || attempt >= retries) throw error;
    await sleep(backoffMs * 2 ** attempt + Math.random() * 100);
  }
}

// Never echo API keys into logs or error messages.
export const redact = (s) => String(s).replace(/(api_key=)[^&\s"]+/gi, '$1***');
