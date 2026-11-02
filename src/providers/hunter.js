// Hunter.io Email Verifier: https://hunter.io/api-documentation/v2#email-verifier
import { requestJson } from '../utils/http.js';

export function createHunterEmailVerifier({ apiKey, baseUrl, fetchImpl, http = {} }) {
  return {
    name: 'hunter',
    async verify(email) {
      const url = new URL(baseUrl || 'https://api.hunter.io/v2/email-verifier');
      url.searchParams.set('email', email);
      url.searchParams.set('api_key', apiKey);
      const json = await requestJson(url, {
        ...http,
        provider: 'hunter',
        fetchImpl,
        // Hunter: 401 bad key, 429 monthly quota used up, 403 rate limited, 202 still verifying.
        fatalStatuses: [401, 429],
        retryStatuses: [202, 403, 500, 502, 503, 504],
      });
      return normalizeHunterEmail(json);
    },
  };
}

const STATUS_MAP = {
  valid: 'deliverable',
  invalid: 'undeliverable',
  disposable: 'undeliverable',
  accept_all: 'risky',
  unknown: 'unknown',
};
const RESULT_MAP = { deliverable: 'deliverable', undeliverable: 'undeliverable', risky: 'risky' };

export function normalizeHunterEmail(json) {
  const d = json?.data ?? json ?? {};
  let status = STATUS_MAP[d.status];
  if (d.status === 'webmail') status = d.smtp_check ? 'deliverable' : 'risky';
  if (!status) status = RESULT_MAP[d.result] || 'unknown';

  return {
    provider: 'hunter',
    status,
    score: typeof d.score === 'number' ? d.score : null,
    flags: {
      validFormat: d.regexp ?? null,
      gibberish: d.gibberish ?? null,
      disposable: d.disposable ?? null,
      free: d.webmail ?? null,
      mx: d.mx_records ?? null,
      smtp: d.smtp_check ?? null,
      catchAll: d.accept_all ?? null,
      blocked: d.block ?? null,
    },
    rawStatus: d.status ?? d.result ?? null,
    suggestion: null,
  };
}
