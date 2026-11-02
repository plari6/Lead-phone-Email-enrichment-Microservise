import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnricher, flattenResult } from '../src/enricher.js';
import { combineStatuses } from '../src/verifiers/email.js';
import { Cache } from '../src/utils/cache.js';
import { mockResolveMx } from '../src/providers/mock.js';
import { fakeFetch, testConfig, quiet, hunterPayload, abstractEmailPayload, abstractPhonePayload } from './helpers.js';

const keys = { hunter: { apiKey: 'HK', minIntervalMs: 0 }, abstract: { emailApiKey: 'AE', phoneApiKey: 'AP', minIntervalMs: 0 } };

/** Fake for all three APIs. hunter / abstractEmail / phone map an email or number to a response. */
function apis({ hunter = () => hunterPayload('valid'), abstractEmail = () => abstractEmailPayload('DELIVERABLE'), phone = () => abstractPhonePayload('mobile') } = {}) {
  return fakeFetch((u) => {
    if (u.hostname === 'api.hunter.io') return wrap(hunter(u.searchParams.get('email')));
    if (u.hostname.startsWith('emailvalidation')) return wrap(abstractEmail(u.searchParams.get('email')));
    if (u.hostname.startsWith('phonevalidation')) return wrap(phone(u.searchParams.get('phone')));
    return { status: 404 };
  });
}
const wrap = (r) => (r && r.status && !r.data && !r.deliverability && !r.phone ? r : { body: r });
const hosts = (f) => f.calls.map((c) => new URL(c).hostname.split('.')[0]);

test('combineStatuses: unknowns ignored, disagreement is risky', () => {
  assert.equal(combineStatuses(['unknown', 'deliverable']), 'deliverable');
  assert.equal(combineStatuses(['deliverable', 'undeliverable']), 'risky');
  assert.equal(combineStatuses(['risky', 'deliverable']), 'risky');
  assert.equal(combineStatuses(['undeliverable', 'risky']), 'undeliverable');
  assert.equal(combineStatuses(['unknown']), 'unknown');
});

test('waterfall: Abstract is only called when Hunter is unsure', async () => {
  const f = apis({ hunter: (e) => hunterPayload(e.startsWith('sure') ? 'valid' : 'accept_all') });
  const e = createEnricher(testConfig(keys), { ...quiet, fetchImpl: f });

  const sure = await e.verifyEmail('sure@acme.com');
  assert.equal(sure.status, 'deliverable');
  assert.deepEqual(hosts(f), ['api']);

  const unsure = await e.verifyEmail('maybe@acme.com');
  assert.deepEqual(hosts(f), ['api', 'api', 'emailvalidation']);
  // Hunter says catch-all, Abstract says deliverable: still risky.
  assert.equal(unsure.status, 'risky');
  assert.deepEqual(unsure.providers, ['local', 'hunter', 'abstract']);
});

test('consensus: both providers are asked; disagreement is risky', async () => {
  const f = apis({ hunter: () => hunterPayload('invalid') });
  const e = createEnricher(testConfig({ ...keys, emailStrategy: 'consensus' }), { ...quiet, fetchImpl: f });
  const r = await e.verifyEmail('a@acme.com');
  assert.equal(f.calls.length, 2);
  assert.equal(r.status, 'risky');
  assert.ok(r.reasons.includes('providers_disagree'));
});

test('local hard fails never spend API credits', async () => {
  const f = apis();
  const e = createEnricher(testConfig({ ...keys, checkMx: true }), { ...quiet, fetchImpl: f, resolveMx: mockResolveMx });
  for (const bad of ['nope', 'x@mailinator.com', 'x@company-nomx.com']) {
    assert.equal((await e.verifyEmail(bad)).status, 'undeliverable', bad);
  }
  assert.equal((await e.verifyPhone('12345', 'US')).status, 'invalid');
  assert.equal(f.calls.length, 0);
});

test('a bad Hunter key disables Hunter and falls through to Abstract', async () => {
  const f = apis({ hunter: () => ({ status: 401, body: 'bad key' }) });
  const e = createEnricher(testConfig(keys), { ...quiet, fetchImpl: f });
  const a = await e.verifyEmail('a@acme.com');
  const b = await e.verifyEmail('b@acme.com');
  assert.equal(a.status, 'deliverable');
  assert.equal(b.status, 'deliverable');
  assert.deepEqual(hosts(f), ['api', 'emailvalidation', 'emailvalidation']);
  assert.deepEqual(e.status().emailProviders, ['abstract']);
  assert.ok(e.status().disabled.hunter);
});

test('no API keys: local checks only, emails need review', async () => {
  const e = createEnricher(testConfig(), quiet);
  const r = await e.enrichLead({ email: 'jane@acme.com', phone: '+33 6 12 34 56 78' });
  assert.equal(r.email.status, 'unknown');
  assert.ok(r.email.reasons.includes('mailbox_not_verified'));
  assert.equal(r.phone.lineType, 'mobile');
  assert.equal(r.phone.lineTypeSource, 'numbering_plan');
  assert.deepEqual(r.decision.channels, ['sms', 'call']);
});

test('carrier lookup resolves US landline-or-mobile numbers', async () => {
  const f = apis({ phone: () => abstractPhonePayload('landline', { carrier: 'Lumen' }) });
  const e = createEnricher(testConfig(keys), { ...quiet, fetchImpl: f });
  const r = await e.verifyPhone('(415) 200-7986', 'US');
  assert.equal(r.status, 'valid');
  assert.equal(r.lineType, 'landline');
  assert.equal(r.lineTypeSource, 'carrier_lookup');
  assert.equal(r.carrier, 'Lumen');
  assert.equal(new URL(f.calls[0]).searchParams.get('phone'), '14152007986');
});

test('phone lookup failure keeps the offline result', async () => {
  const f = apis({ phone: () => ({ status: 500, body: 'down' }) });
  const e = createEnricher(testConfig(keys), { ...quiet, fetchImpl: f });
  const r = await e.verifyPhone('+33 6 12 34 56 78');
  assert.equal(r.status, 'valid');
  assert.equal(r.lineType, 'mobile');
  assert.ok(r.reasons.includes('carrier_lookup_failed'));
});

test('duplicates are looked up once (cache + in-flight dedupe)', async () => {
  const f = apis();
  const e = createEnricher(testConfig(keys), { ...quiet, fetchImpl: f, cache: new Cache() });
  const leads = [
    { email: 'Jane@Acme.com', phone: '(415) 200-7986' },
    { email: 'jane@acme.com ', phone: '+1 415-200-7986' },
    { email: 'JANE@ACME.COM', phone: '4152007986' },
  ];
  const { results, summary } = await e.enrichMany(leads);
  assert.equal(f.calls.length, 2); // one Hunter call + one phone lookup
  assert.ok(results.every((r) => r.decision.status === 'ready'));
  assert.equal(summary.total, 3);
});

test('cache survives restarts via the cache file', async (t) => {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cache.json');

  const f1 = apis();
  const e1 = createEnricher(testConfig(keys), { ...quiet, fetchImpl: f1, cache: new Cache({ file }) });
  await e1.verifyEmail('jane@acme.com');
  e1.saveCache();

  const f2 = apis();
  const e2 = createEnricher(testConfig(keys), { ...quiet, fetchImpl: f2, cache: new Cache({ file }) });
  const r = await e2.verifyEmail('jane@acme.com');
  assert.equal(r.cached, true);
  assert.equal(f2.calls.length, 0);
});

test('enrichMany detects CRM column names and per-row country', async () => {
  const e = createEnricher(testConfig({ mode: 'mock' }), quiet);
  const { results, columns } = await e.enrichMany([
    { 'Work Email': 'ana@lopez.com', 'Mobile Phone': '06 12 34 56 78', Country: 'FR' },
  ]);
  assert.deepEqual(columns, { email: 'Work Email', phone: 'Mobile Phone', country: 'Country' });
  assert.equal(results[0].phone.e164, '+33612345678');
  assert.equal(results[0].phone.lineType, 'mobile');
});

test('flattenResult keeps original columns and adds enrichment columns', async () => {
  const e = createEnricher(testConfig({ mode: 'mock' }), quiet);
  const r = await e.enrichLead({ name: 'Ana', email: 'ana@lopez.com', phone: '+33 6 12 34 56 78' });
  const row = flattenResult(r);
  assert.equal(row.name, 'Ana');
  assert.equal(row.email_status, 'deliverable');
  assert.equal(row.phone_line_type, 'mobile');
  assert.equal(row.campaign_status, 'ready');
  assert.equal(row.campaign_channels, 'email, sms, call');
  assert.equal(row.lead_score, 100);
});
