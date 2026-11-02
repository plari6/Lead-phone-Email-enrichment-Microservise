import { inspectPhone } from '../providers/local.js';

/**
 * Phone pipeline: parse and validate offline, then (if a key is set) ask the carrier
 * lookup API for the real line type. Numbers that fail offline never cost a credit.
 */
export function createPhoneService({ lookupProvider = null, defaultCountry = 'US', cache = null, logger }) {
  let disabledReason = null;
  const inFlight = new Map();

  async function lookup(e164) {
    if (!lookupProvider || disabledReason) return null;
    try {
      return await (lookupProvider.limit ? lookupProvider.limit(() => lookupProvider.lookup(e164)) : lookupProvider.lookup(e164));
    } catch (err) {
      if (err.fatal) {
        if (!disabledReason) logger?.warn(`${lookupProvider.name} phone lookup disabled for this run: ${err.message}`);
        disabledReason = err.message;
      }
      return { provider: lookupProvider.name, error: err.message };
    }
  }

  async function run(local) {
    const api = await lookup(local.e164);
    return finalizePhone(local, api);
  }

  return {
    providerName: () => (lookupProvider && !disabledReason ? lookupProvider.name : null),
    disabled: () => disabledReason,

    async verify(raw, country = defaultCountry) {
      const local = inspectPhone(raw, country || defaultCountry);
      if (!local.present) return { input: raw ?? '', status: 'missing', lineType: null, reasons: [], providers: [] };
      if (!local.valid) {
        return {
          input: raw,
          e164: local.e164 || null,
          status: 'invalid',
          lineType: null,
          reasons: [local.possible ? 'number_not_assigned' : 'invalid_number'],
          providers: ['local'],
        };
      }

      const key = `phone:${local.e164}`;
      const hit = cache?.get(key);
      if (hit) return { ...hit, input: raw, cached: true };
      if (inFlight.has(key)) return { ...(await inFlight.get(key)), input: raw };

      const job = run(local).finally(() => inFlight.delete(key));
      inFlight.set(key, job);
      const result = await job;
      if (cache && result.providers.length > 1) cache.set(key, result);
      return { ...result, input: raw };
    },
  };
}

export function finalizePhone(local, api) {
  const reasons = [];
  const ok = api && !api.error ? api : null;
  let status = 'valid';
  let lineType = local.lineType;
  let lineTypeSource = 'numbering_plan';

  if (ok) {
    if (!ok.valid) {
      status = 'invalid';
      reasons.push('carrier_lookup_rejected');
    }
    if (ok.lineType && ok.lineType !== 'unknown') {
      lineType = ok.lineType;
      lineTypeSource = 'carrier_lookup';
    }
  } else if (api?.error) {
    reasons.push('carrier_lookup_failed');
  }

  if (status === 'valid') {
    if (lineType === 'landline_or_mobile') reasons.push('line_type_ambiguous');
    if (lineType === 'premium_rate') reasons.push('premium_rate_number');
    if (lineType === 'toll_free') reasons.push('toll_free_number');
  }

  return {
    e164: local.e164,
    international: ok?.international || local.international,
    national: ok?.national || local.national,
    country: ok?.country || local.country,
    status,
    lineType: status === 'valid' ? lineType : null,
    lineTypeSource: status === 'valid' ? lineTypeSource : null,
    carrier: ok?.carrier || null,
    location: ok?.location || null,
    reasons,
    providers: ['local', ...(ok ? [ok.provider] : [])],
    errors: api?.error ? [`${api.provider}: ${api.error}`] : [],
  };
}
