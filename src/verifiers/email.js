import { normalizeEmail } from '../providers/local.js';

const HARD_STATUSES = new Set(['deliverable', 'undeliverable']);

/**
 * Email pipeline: free local checks first, then paid providers by strategy.
 * - waterfall: try providers in order, stop at the first clear answer
 * - consensus: ask every provider, combine answers
 * - hunter / abstract: only that provider
 */
export function createEmailService({ local, providers = [], strategy = 'waterfall', cache = null, logger }) {
  const disabled = new Map(); // provider name -> reason (bad key / no credits)
  const inFlight = new Map(); // same email asked twice at once -> one API call

  const available = () => {
    let list = providers.filter((p) => !disabled.has(p.name));
    if (strategy === 'hunter' || strategy === 'abstract') list = list.filter((p) => p.name === strategy);
    return list;
  };

  async function callProvider(p, email) {
    try {
      return await (p.limit ? p.limit(() => p.verify(email)) : p.verify(email));
    } catch (err) {
      if (err.fatal) {
        if (!disabled.has(p.name)) logger?.warn(`${p.name} disabled for this run: ${err.message}`);
        disabled.set(p.name, err.message);
      } else {
        logger?.debug(`${p.name} failed for ${email}: ${err.message}`);
      }
      return { provider: p.name, error: err.message };
    }
  }

  async function run(email) {
    const pre = await local.verify(email);
    // Hard fail locally (bad syntax, disposable, no mail server): don't spend credits.
    if (pre.status === 'undeliverable') return finalize(email, pre, []);

    const results = [];
    const list = available();
    if (strategy === 'consensus') {
      results.push(...(await Promise.all(list.map((p) => callProvider(p, email)))));
    } else {
      for (const p of list) {
        if (disabled.has(p.name)) continue;
        const r = await callProvider(p, email);
        results.push(r);
        if (HARD_STATUSES.has(r.status)) break;
      }
    }
    return finalize(email, pre, results);
  }

  return {
    providerNames: () => available().map((p) => p.name),
    disabled: () => Object.fromEntries(disabled),

    async verify(raw) {
      const email = normalizeEmail(raw);
      if (!email) return { input: raw ?? '', email: '', status: 'missing', score: null, reasons: [], providers: [] };

      const key = `email:${email}`;
      const hit = cache?.get(key);
      if (hit) return { ...hit, input: raw, cached: true };
      if (inFlight.has(key)) return { ...(await inFlight.get(key)), input: raw };

      const job = run(email).finally(() => inFlight.delete(key));
      inFlight.set(key, job);
      const result = await job;
      // Cache answers that came from a provider or a hard local fail. Local-only "unknown"
      // is not cached so adding an API key later re-checks those emails.
      if (cache && (result.providers.some((p) => p !== 'local') || result.status === 'undeliverable')) {
        cache.set(key, result);
      }
      return { ...result, input: raw };
    },
  };
}

export function finalize(email, pre, results) {
  const ok = results.filter((r) => !r.error);
  const errors = results.filter((r) => r.error).map((r) => `${r.provider}: ${r.error}`);
  const status = ok.length ? combineStatuses(ok.map((r) => r.status)) : pre.status;

  const flags = { ...pre.flags };
  for (const r of ok) {
    for (const [k, v] of Object.entries(r.flags || {})) {
      if (v === null || v === undefined) continue;
      // Warning flags: any provider saying true wins. Positive checks: any true wins too.
      flags[k] = flags[k] === true ? true : v;
    }
  }

  const scores = ok.map((r) => r.score).filter((s) => typeof s === 'number');
  const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : pre.score ?? null;

  return {
    email,
    status,
    score,
    flags,
    reasons: buildReasons(status, flags, ok, pre),
    suggestion: pre.suggestion || ok.find((r) => r.suggestion)?.suggestion || null,
    providers: ['local', ...ok.map((r) => r.provider)],
    providerStatuses: Object.fromEntries(ok.map((r) => [r.provider, r.rawStatus ?? r.status])),
    errors,
  };
}

/** Combine provider answers, ignoring "unknown" ones. Disagreement = risky. */
export function combineStatuses(statuses) {
  const known = statuses.filter((s) => s && s !== 'unknown');
  if (!known.length) return 'unknown';
  const has = (s) => known.includes(s);
  if (has('deliverable') && has('undeliverable')) return 'risky';
  if (has('undeliverable')) return 'undeliverable';
  if (has('risky')) return 'risky';
  return 'deliverable';
}

function buildReasons(status, flags, ok, pre) {
  const r = [];
  if (flags.validFormat === false) r.push('invalid_format');
  if (flags.disposable) r.push('disposable_domain');
  if (flags.mx === false) r.push('no_mail_server');
  if (flags.smtp === false && status === 'undeliverable') r.push('mailbox_rejected');
  if (flags.catchAll) r.push('catch_all_domain');
  if (flags.role) r.push('role_account');
  if (flags.free) r.push('free_email_provider');
  if (flags.gibberish) r.push('gibberish_address');
  if (flags.blocked) r.push('smtp_blocked');
  const statuses = new Set(ok.map((x) => x.status).filter((s) => s !== 'unknown'));
  if (statuses.has('deliverable') && statuses.has('undeliverable')) r.push('providers_disagree');
  if (!ok.length && pre.status === 'unknown') r.push('mailbox_not_verified');
  if (pre.suggestion) r.push('possible_typo');
  return r;
}
