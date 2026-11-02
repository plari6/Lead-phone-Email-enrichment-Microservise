// Reads settings from environment variables (loaded from .env by the CLI).
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const list = (v, d) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : d);

export function loadConfig(env = process.env, overrides = {}) {
  const config = {
    // live = use the API keys that are set (local checks cover the rest)
    // mock = fake providers, no network (demos and tests)
    mode: (env.ENRICH_MODE || 'live').toLowerCase(),
    defaultCountry: (env.DEFAULT_COUNTRY || 'US').toUpperCase(),

    hunter: {
      apiKey: env.HUNTER_API_KEY || '',
      baseUrl: env.HUNTER_BASE_URL || 'https://api.hunter.io/v2/email-verifier',
      minIntervalMs: num(env.HUNTER_MIN_INTERVAL_MS, 70), // Hunter allows about 15 requests/second
    },
    abstract: {
      emailApiKey: env.ABSTRACT_EMAIL_API_KEY || '',
      phoneApiKey: env.ABSTRACT_PHONE_API_KEY || '',
      emailBaseUrl: env.ABSTRACT_EMAIL_BASE_URL || 'https://emailvalidation.abstractapi.com/v1/',
      phoneBaseUrl: env.ABSTRACT_PHONE_BASE_URL || 'https://phonevalidation.abstractapi.com/v1/',
      minIntervalMs: num(env.ABSTRACT_MIN_INTERVAL_MS, 1000), // free plan = 1 request/second
    },

    // waterfall: Hunter first, Abstract only when Hunter is unsure (saves credits)
    // consensus: ask both and combine | hunter | abstract: one provider only
    emailStrategy: (env.EMAIL_STRATEGY || 'waterfall').toLowerCase(),
    checkMx: bool(env.CHECK_MX, true),

    http: {
      timeoutMs: num(env.HTTP_TIMEOUT_MS, 15000),
      retries: num(env.HTTP_RETRIES, 3),
      backoffMs: num(env.HTTP_BACKOFF_MS, 600),
    },
    concurrency: num(env.CONCURRENCY, 5),

    cache: {
      enabled: bool(env.CACHE_ENABLED, true),
      file: env.CACHE_FILE || '.cache/enrichment-cache.json',
      ttlHours: num(env.CACHE_TTL_HOURS, 24 * 30),
    },

    policy: {
      allowRiskyEmail: bool(env.ALLOW_RISKY_EMAIL, false),
      allowFreeEmail: bool(env.ALLOW_FREE_EMAIL, true),
      allowRoleEmail: bool(env.ALLOW_ROLE_EMAIL, true),
      smsLineTypes: list(env.SMS_LINE_TYPES, ['mobile']),
      callLineTypes: list(env.CALL_LINE_TYPES, ['mobile', 'landline', 'landline_or_mobile', 'voip']),
    },

    server: {
      port: num(env.PORT, 3000),
      apiKey: env.SERVICE_API_KEY || '',
      maxBatch: num(env.MAX_BATCH_SIZE, 500),
    },
    logLevel: (env.LOG_LEVEL || 'info').toLowerCase(),
  };

  return deepMerge(config, overrides);
}

function deepMerge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      deepMerge(base[k], v);
    } else if (v !== undefined) {
      base[k] = v;
    }
  }
  return base;
}
