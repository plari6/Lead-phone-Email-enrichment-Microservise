import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/utils/logger.js';

/** Fake fetch: routes(url) returns { status, body } or a function result. Records every URL called. */
export function fakeFetch(handler) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const out = await handler(new URL(url), calls.length);
    const status = out.status ?? 200;
    const body = out.body ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
  fn.calls = calls;
  return fn;
}

/** Config with no env leakage, no cache file, no DNS, fast retries. */
export function testConfig(overrides = {}) {
  return loadConfig({}, {
    checkMx: false,
    cache: { enabled: false },
    http: { retries: 2, backoffMs: 1, timeoutMs: 2000 },
    hunter: { minIntervalMs: 0 },
    abstract: { minIntervalMs: 0 },
    logLevel: 'silent',
    ...overrides,
  });
}

export const quiet = { logger: silentLogger };

// Sample provider payloads (shapes copied from the providers' docs).
export const hunterPayload = (status, extra = {}) => ({
  data: {
    status,
    result: { valid: 'deliverable', invalid: 'undeliverable', accept_all: 'risky' }[status] || 'risky',
    score: { valid: 95, invalid: 0, accept_all: 60 }[status] ?? 40,
    regexp: true,
    gibberish: false,
    disposable: false,
    webmail: false,
    mx_records: true,
    smtp_server: true,
    smtp_check: status === 'valid',
    accept_all: status === 'accept_all',
    block: false,
    ...extra,
  },
});

export const abstractEmailPayload = (deliverability, extra = {}) => ({
  email: 'x@y.com',
  autocorrect: '',
  deliverability,
  quality_score: deliverability === 'DELIVERABLE' ? '0.90' : '0.10',
  is_valid_format: { value: true, text: 'TRUE' },
  is_free_email: { value: false, text: 'FALSE' },
  is_disposable_email: { value: false, text: 'FALSE' },
  is_role_email: { value: false, text: 'FALSE' },
  is_catchall_email: { value: false, text: 'FALSE' },
  is_mx_found: { value: true, text: 'TRUE' },
  is_smtp_valid: { value: deliverability === 'DELIVERABLE', text: 'X' },
  ...extra,
});

export const abstractPhonePayload = (type, extra = {}) => ({
  phone: '14152007986',
  valid: true,
  format: { international: '+14152007986', local: '(415) 200-7986' },
  country: { code: 'US', name: 'United States', prefix: '+1' },
  location: 'California',
  type,
  carrier: 'T-Mobile USA, Inc.',
  ...extra,
});
