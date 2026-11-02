// Free checks that run before any paid API call.
import { promises as dns } from 'node:dns';
import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { DISPOSABLE_DOMAINS, FREE_EMAIL_DOMAINS, ROLE_PREFIXES, DOMAIN_TYPOS } from '../data/domains.js';

const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeEmail(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^<|>$/g, '')
    .toLowerCase();
}

/** Syntax and list checks. No network. */
export function inspectEmail(raw) {
  const email = normalizeEmail(raw);
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : '';
  const domain = at > 0 ? email.slice(at + 1) : '';
  const fixedDomain = DOMAIN_TYPOS[domain];
  return {
    email,
    local,
    domain,
    validFormat: email.length <= 254 && local.length <= 64 && EMAIL_RE.test(email),
    disposable: DISPOSABLE_DOMAINS.has(domain),
    free: FREE_EMAIL_DOMAINS.has(domain),
    role: ROLE_PREFIXES.has(local.split('+')[0]),
    suggestion: fixedDomain ? `${local}@${fixedDomain}` : null,
  };
}

/**
 * true = domain has mail servers, false = it definitely has none,
 * null = lookup failed (network problem), so we don't punish the lead.
 */
export async function hasMxRecords(domain, { resolveMx = dns.resolveMx, timeoutMs = 5000 } = {}) {
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), timeoutMs).unref?.()),
    ]);
    return Array.isArray(records) && records.length > 0;
  } catch (e) {
    if (['ENOTFOUND', 'ENODATA', 'NXDOMAIN'].includes(e.code)) return false;
    return null;
  }
}

/** Local email verifier: returns the same shape as the paid providers. */
export function createLocalEmailVerifier({ checkMx = true, resolveMx } = {}) {
  return {
    name: 'local',
    async verify(raw) {
      const info = inspectEmail(raw);
      const flags = {
        validFormat: info.validFormat,
        disposable: info.disposable,
        free: info.free,
        role: info.role,
        mx: null,
      };
      if (!info.validFormat) return { provider: 'local', status: 'undeliverable', score: 0, flags, suggestion: info.suggestion };
      if (info.disposable) return { provider: 'local', status: 'undeliverable', score: 5, flags, suggestion: null };
      if (checkMx) {
        flags.mx = await hasMxRecords(info.domain, resolveMx ? { resolveMx } : undefined);
        if (flags.mx === false) return { provider: 'local', status: 'undeliverable', score: 0, flags, suggestion: info.suggestion };
      }
      // Passed every free check, but only an SMTP check can confirm the mailbox exists.
      return { provider: 'local', status: 'unknown', score: null, flags, suggestion: info.suggestion };
    },
  };
}

// libphonenumber types -> our line types
const LIB_TYPES = {
  MOBILE: 'mobile',
  FIXED_LINE: 'landline',
  FIXED_LINE_OR_MOBILE: 'landline_or_mobile', // US/CA numbers: needs a carrier lookup to know
  VOIP: 'voip',
  TOLL_FREE: 'toll_free',
  PREMIUM_RATE: 'premium_rate',
  SHARED_COST: 'shared_cost',
  PERSONAL_NUMBER: 'personal',
  PAGER: 'pager',
  UAN: 'uan',
  VOICEMAIL: 'voicemail',
};

/** Parse and classify a phone number offline using Google's numbering-plan data. */
export function inspectPhone(raw, defaultCountry = 'US') {
  const input = String(raw ?? '').trim();
  if (!input) return { present: false };
  // Turn "00" international prefix into "+".
  const cleaned = input.replace(/^00(?=[1-9])/, '+');
  const country = /^[A-Z]{2}$/i.test(defaultCountry || '') ? defaultCountry.toUpperCase() : undefined;
  let parsed;
  try {
    parsed = parsePhoneNumberFromString(cleaned, country);
  } catch {
    parsed = undefined;
  }
  if (!parsed) return { present: true, input, valid: false, possible: false };
  return {
    present: true,
    input,
    valid: parsed.isValid(),
    possible: parsed.isPossible(),
    e164: parsed.number,
    international: parsed.formatInternational(),
    national: parsed.formatNational(),
    country: parsed.country || null,
    lineType: LIB_TYPES[parsed.getType()] || 'unknown',
  };
}
