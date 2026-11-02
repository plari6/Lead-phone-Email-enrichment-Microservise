// Abstract API Email Validation + Phone Validation.
// https://docs.abstractapi.com/email-validation  https://docs.abstractapi.com/phone-validation
import { requestJson } from '../utils/http.js';

// Abstract: 401 bad key, 422 quota reached, 429 rate limited.
const ABSTRACT_HTTP = { fatalStatuses: [401, 402, 422], retryStatuses: [429, 500, 502, 503, 504] };

export function createAbstractEmailVerifier({ apiKey, baseUrl, fetchImpl, http = {} }) {
  return {
    name: 'abstract',
    async verify(email) {
      const url = new URL(baseUrl || 'https://emailvalidation.abstractapi.com/v1/');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('email', email);
      const json = await requestJson(url, { ...http, ...ABSTRACT_HTTP, provider: 'abstract', fetchImpl });
      return normalizeAbstractEmail(json);
    },
  };
}

export function createAbstractPhoneVerifier({ apiKey, baseUrl, fetchImpl, http = {} }) {
  return {
    name: 'abstract',
    async lookup(e164) {
      const url = new URL(baseUrl || 'https://phonevalidation.abstractapi.com/v1/');
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('phone', e164.replace(/^\+/, ''));
      const json = await requestJson(url, { ...http, ...ABSTRACT_HTTP, provider: 'abstract', fetchImpl });
      return normalizeAbstractPhone(json);
    },
  };
}

// Abstract wraps booleans as { value: true, text: "TRUE" }.
const flag = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v ?? null);

export function normalizeAbstractEmail(d = {}) {
  const deliverability = String(d.deliverability || '').toUpperCase();
  const flags = {
    validFormat: flag(d.is_valid_format),
    free: flag(d.is_free_email),
    disposable: flag(d.is_disposable_email),
    role: flag(d.is_role_email),
    catchAll: flag(d.is_catchall_email),
    mx: flag(d.is_mx_found),
    smtp: flag(d.is_smtp_valid),
  };
  let status = deliverability === 'DELIVERABLE' ? 'deliverable' : deliverability === 'UNDELIVERABLE' ? 'undeliverable' : 'unknown';
  if (flags.disposable === true) status = 'undeliverable';
  else if (status === 'deliverable' && flags.catchAll === true) status = 'risky'; // catch-all accepts anything

  const q = d.quality_score === undefined || d.quality_score === null || d.quality_score === '' ? null : Number(d.quality_score);
  return {
    provider: 'abstract',
    status,
    score: q === null || Number.isNaN(q) ? null : Math.round(q * 100),
    flags,
    rawStatus: d.deliverability ?? null,
    suggestion: d.autocorrect || null,
  };
}

const PHONE_TYPES = {
  mobile: 'mobile',
  landline: 'landline',
  voip: 'voip',
  toll_free: 'toll_free',
  'toll-free': 'toll_free',
  tollfree: 'toll_free',
  premium: 'premium_rate',
  premium_rate: 'premium_rate',
  satellite: 'satellite',
  paging: 'pager',
  pager: 'pager',
  special: 'special',
  special_services: 'special',
  unknown: 'unknown',
};

export function normalizeAbstractPhone(d = {}) {
  const type = String(d.type || 'unknown').toLowerCase().replace(/\s+/g, '_');
  const digits = d.phone ? String(d.phone).replace(/\D/g, '') : '';
  return {
    provider: 'abstract',
    valid: d.valid === true || d.valid === 'true',
    e164: digits ? `+${digits}` : null,
    international: d.format?.international ?? null,
    national: d.format?.local ?? null,
    country: d.country?.code ?? null,
    countryName: d.country?.name ?? null,
    location: d.location || null,
    carrier: d.carrier || null,
    lineType: PHONE_TYPES[type] || 'unknown',
  };
}
