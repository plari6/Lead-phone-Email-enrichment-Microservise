import { loadConfig } from './config.js';
import { Cache } from './utils/cache.js';
import { createLimiter, mapConcurrent } from './utils/limiter.js';
import { createLogger } from './utils/logger.js';
import { createLocalEmailVerifier } from './providers/local.js';
import { createHunterEmailVerifier } from './providers/hunter.js';
import { createAbstractEmailVerifier, createAbstractPhoneVerifier } from './providers/abstract.js';
import { createMockEmailVerifier, createMockPhoneVerifier, mockResolveMx } from './providers/mock.js';
import { createEmailService } from './verifiers/email.js';
import { createPhoneService } from './verifiers/phone.js';
import { decide } from './decision.js';
import { detectColumns } from './io/columns.js';

/**
 * Builds the enrichment engine from config.
 * deps (for tests): fetchImpl, resolveMx, logger, cache, emailProviders, phoneProvider
 */
export function createEnricher(config = loadConfig(), deps = {}) {
  const logger = deps.logger || createLogger(config.logLevel);
  const fetchImpl = deps.fetchImpl;
  const http = config.http;
  const cache = deps.cache !== undefined
    ? deps.cache
    : config.cache.enabled
      ? new Cache({ file: config.mode === 'mock' ? null : config.cache.file, ttlHours: config.cache.ttlHours })
      : null;

  const hunterLimit = createLimiter({ concurrency: config.concurrency, minIntervalMs: config.hunter.minIntervalMs });
  const abstractEmailLimit = createLimiter({ concurrency: config.concurrency, minIntervalMs: config.abstract.minIntervalMs });
  const abstractPhoneLimit = createLimiter({ concurrency: config.concurrency, minIntervalMs: config.abstract.minIntervalMs });
  const noLimit = createLimiter({ concurrency: config.concurrency });

  let emailProviders = deps.emailProviders;
  let phoneProvider = deps.phoneProvider;
  if (!emailProviders) {
    emailProviders = [];
    if (config.mode === 'mock') {
      emailProviders.push(withLimit(createMockEmailVerifier('hunter'), noLimit));
    } else {
      if (config.hunter.apiKey) {
        emailProviders.push(withLimit(createHunterEmailVerifier({ apiKey: config.hunter.apiKey, baseUrl: config.hunter.baseUrl, fetchImpl, http }), hunterLimit));
      }
      if (config.abstract.emailApiKey) {
        emailProviders.push(withLimit(createAbstractEmailVerifier({ apiKey: config.abstract.emailApiKey, baseUrl: config.abstract.emailBaseUrl, fetchImpl, http }), abstractEmailLimit));
      }
    }
  }
  if (phoneProvider === undefined) {
    if (config.mode === 'mock') phoneProvider = withLimit(createMockPhoneVerifier(), noLimit);
    else if (config.abstract.phoneApiKey) {
      phoneProvider = withLimit(createAbstractPhoneVerifier({ apiKey: config.abstract.phoneApiKey, baseUrl: config.abstract.phoneBaseUrl, fetchImpl, http }), abstractPhoneLimit);
    } else phoneProvider = null;
  }

  const resolveMx = deps.resolveMx || (config.mode === 'mock' ? mockResolveMx : undefined);
  const emailService = createEmailService({
    local: createLocalEmailVerifier({ checkMx: config.checkMx, resolveMx }),
    providers: emailProviders,
    strategy: config.emailStrategy,
    cache,
    logger,
  });
  const phoneService = createPhoneService({ lookupProvider: phoneProvider, defaultCountry: config.defaultCountry, cache, logger });

  /** Enrich one lead. Accepts { email, phone, country } or any object with detectable columns. */
  async function enrichLead(lead = {}, opts = {}) {
    const cols = opts.columns || detectColumns(Object.keys(lead));
    const rawEmail = lead[cols.email ?? 'email'];
    const rawPhone = lead[cols.phone ?? 'phone'];
    const rowCountry = cols.country ? String(lead[cols.country] ?? '').trim().toUpperCase() : '';
    const country = /^[A-Z]{2}$/.test(rowCountry) ? rowCountry : opts.country || config.defaultCountry;

    const [email, phone] = await Promise.all([emailService.verify(rawEmail), phoneService.verify(rawPhone, country)]);
    const decision = decide(email, phone, { ...config.policy, ...opts.policy });
    return { lead, email, phone, decision, enrichedAt: new Date().toISOString() };
  }

  /** Enrich many leads in parallel (rate limits are enforced per provider). */
  async function enrichMany(leads, opts = {}) {
    const columns = opts.columns || detectColumns(Object.keys(leads[0] || {}));
    let done = 0;
    const results = await mapConcurrent(leads, config.concurrency, async (lead) => {
      const r = await enrichLead(lead, { ...opts, columns });
      done++;
      opts.onProgress?.(done, leads.length, r);
      if (done % 50 === 0) cache?.save?.();
      return r;
    });
    cache?.save?.();
    return { results, summary: summarize(results), columns };
  }

  function status() {
    return {
      mode: config.mode,
      emailStrategy: config.emailStrategy,
      emailProviders: emailService.providerNames(),
      phoneProvider: phoneService.providerName(),
      disabled: { ...emailService.disabled(), ...(phoneService.disabled() ? { phone: phoneService.disabled() } : {}) },
      mxCheck: config.checkMx,
      defaultCountry: config.defaultCountry,
      cacheEntries: cache?.size ?? 0,
    };
  }

  return { enrichLead, enrichMany, verifyEmail: emailService.verify, verifyPhone: phoneService.verify, status, saveCache: () => cache?.save?.(), config };
}

const withLimit = (provider, limit) => Object.assign(provider, { limit });

export function summarize(results) {
  const count = (fn) => results.filter(fn).length;
  const tally = (pick) => results.reduce((acc, r) => {
    const k = pick(r);
    if (k) acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  return {
    total: results.length,
    ready: count((r) => r.decision.status === 'ready'),
    review: count((r) => r.decision.status === 'review'),
    rejected: count((r) => r.decision.status === 'rejected'),
    emailStatus: tally((r) => r.email.status),
    phoneStatus: tally((r) => r.phone.status),
    phoneLineType: tally((r) => r.phone.lineType),
    channels: {
      email: count((r) => r.decision.canEmail),
      sms: count((r) => r.decision.canSms),
      call: count((r) => r.decision.canCall),
    },
    cachedLookups: count((r) => r.email.cached) + count((r) => r.phone.cached),
  };
}

/** Flat row for CSV / Excel: original columns followed by enrichment columns. */
export function flattenResult(r) {
  const j = (a) => (a && a.length ? a.join('; ') : '');
  return {
    ...r.lead,
    email_normalized: r.email.email || '',
    email_status: r.email.status,
    email_score: r.email.score ?? '',
    email_reasons: j(r.email.reasons),
    email_suggestion: r.email.suggestion || '',
    email_providers: j(r.email.providers),
    phone_e164: r.phone.e164 || '',
    phone_status: r.phone.status,
    phone_line_type: r.phone.lineType || '',
    phone_line_type_source: r.phone.lineTypeSource || '',
    phone_carrier: r.phone.carrier || '',
    phone_country: r.phone.country || '',
    phone_location: r.phone.location || '',
    phone_reasons: j(r.phone.reasons),
    can_email: r.decision.canEmail ? 'yes' : 'no',
    can_sms: r.decision.canSms ? 'yes' : 'no',
    can_call: r.decision.canCall ? 'yes' : 'no',
    campaign_channels: r.decision.channels.join(', '),
    campaign_status: r.decision.status,
    lead_score: r.decision.score,
    notes: j(r.decision.notes),
    enriched_at: r.enrichedAt,
  };
}
