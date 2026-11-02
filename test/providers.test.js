import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHunterEmailVerifier, normalizeHunterEmail } from '../src/providers/hunter.js';
import { createAbstractEmailVerifier, createAbstractPhoneVerifier, normalizeAbstractEmail, normalizeAbstractPhone } from '../src/providers/abstract.js';
import { requestJson } from '../src/utils/http.js';
import { fakeFetch, hunterPayload, abstractEmailPayload, abstractPhonePayload } from './helpers.js';

const http = { retries: 2, backoffMs: 1 };

test('Hunter statuses map to our statuses', () => {
  assert.equal(normalizeHunterEmail(hunterPayload('valid')).status, 'deliverable');
  assert.equal(normalizeHunterEmail(hunterPayload('invalid')).status, 'undeliverable');
  assert.equal(normalizeHunterEmail(hunterPayload('accept_all')).status, 'risky');
  assert.equal(normalizeHunterEmail(hunterPayload('disposable')).status, 'undeliverable');
  assert.equal(normalizeHunterEmail(hunterPayload('unknown')).status, 'unknown');
  assert.equal(normalizeHunterEmail(hunterPayload('webmail', { smtp_check: true })).status, 'deliverable');
  assert.equal(normalizeHunterEmail(hunterPayload('webmail', { smtp_check: false })).status, 'risky');
  // Older responses only had "result".
  assert.equal(normalizeHunterEmail({ data: { result: 'undeliverable' } }).status, 'undeliverable');
  const n = normalizeHunterEmail(hunterPayload('accept_all'));
  assert.equal(n.flags.catchAll, true);
  assert.equal(n.score, 60);
});

test('Abstract email response maps deliverability, catch-all and score', () => {
  assert.equal(normalizeAbstractEmail(abstractEmailPayload('DELIVERABLE')).status, 'deliverable');
  assert.equal(normalizeAbstractEmail(abstractEmailPayload('DELIVERABLE')).score, 90);
  assert.equal(normalizeAbstractEmail(abstractEmailPayload('UNDELIVERABLE')).status, 'undeliverable');
  assert.equal(normalizeAbstractEmail(abstractEmailPayload('UNKNOWN')).status, 'unknown');
  const catchAll = abstractEmailPayload('DELIVERABLE', { is_catchall_email: { value: true, text: 'TRUE' } });
  assert.equal(normalizeAbstractEmail(catchAll).status, 'risky');
  const disposable = abstractEmailPayload('DELIVERABLE', { is_disposable_email: { value: true, text: 'TRUE' } });
  assert.equal(normalizeAbstractEmail(disposable).status, 'undeliverable');
});

test('Abstract phone response maps line types and carrier', () => {
  const p = normalizeAbstractPhone(abstractPhonePayload('mobile'));
  assert.deepEqual(
    { valid: p.valid, e164: p.e164, lineType: p.lineType, carrier: p.carrier, country: p.country },
    { valid: true, e164: '+14152007986', lineType: 'mobile', carrier: 'T-Mobile USA, Inc.', country: 'US' },
  );
  assert.equal(normalizeAbstractPhone(abstractPhonePayload('Landline')).lineType, 'landline');
  assert.equal(normalizeAbstractPhone(abstractPhonePayload('toll_free')).lineType, 'toll_free');
  assert.equal(normalizeAbstractPhone(abstractPhonePayload('premium')).lineType, 'premium_rate');
  assert.equal(normalizeAbstractPhone(abstractPhonePayload('something-new')).lineType, 'unknown');
});

test('providers send the right query parameters', async () => {
  const f = fakeFetch(() => ({ body: hunterPayload('valid') }));
  await createHunterEmailVerifier({ apiKey: 'HK', fetchImpl: f, http }).verify('a@acme.com');
  const u = new URL(f.calls[0]);
  assert.equal(u.hostname, 'api.hunter.io');
  assert.equal(u.searchParams.get('email'), 'a@acme.com');
  assert.equal(u.searchParams.get('api_key'), 'HK');

  const fa = fakeFetch(() => ({ body: abstractPhonePayload('mobile') }));
  await createAbstractPhoneVerifier({ apiKey: 'AK', fetchImpl: fa, http }).lookup('+14152007986');
  const ua = new URL(fa.calls[0]);
  assert.equal(ua.hostname, 'phonevalidation.abstractapi.com');
  assert.equal(ua.searchParams.get('phone'), '14152007986');

  const fe = fakeFetch(() => ({ body: abstractEmailPayload('DELIVERABLE') }));
  await createAbstractEmailVerifier({ apiKey: 'AK', fetchImpl: fe, http }).verify('a@acme.com');
  assert.equal(new URL(fe.calls[0]).hostname, 'emailvalidation.abstractapi.com');
});

test('requestJson retries on 429/5xx then succeeds', async () => {
  const f = fakeFetch((u, n) => (n < 3 ? { status: n === 1 ? 429 : 503, body: 'slow down' } : { body: { ok: 1 } }));
  assert.deepEqual(await requestJson('https://x.test/', { fetchImpl: f, ...http }), { ok: 1 });
  assert.equal(f.calls.length, 3);
});

test('requestJson gives up after the retry limit', async () => {
  const f = fakeFetch(() => ({ status: 500, body: 'boom' }));
  await assert.rejects(requestJson('https://x.test/', { fetchImpl: f, ...http }), /HTTP 500/);
  assert.equal(f.calls.length, 3);
});

test('fatal errors (bad key / quota) are not retried and hide the key', async () => {
  const f = fakeFetch(() => ({ status: 401, body: 'invalid key for https://x?api_key=SECRET123' }));
  const err = await requestJson('https://x.test/', { fetchImpl: f, ...http }).catch((e) => e);
  assert.equal(err.fatal, true);
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(err.message, /SECRET123/);
});

test('Hunter 202 (still verifying) is retried, 429 (quota) is fatal', async () => {
  const f = fakeFetch((u, n) => (n === 1 ? { status: 202, body: {} } : { body: hunterPayload('valid') }));
  const r = await createHunterEmailVerifier({ apiKey: 'k', fetchImpl: f, http }).verify('a@acme.com');
  assert.equal(r.status, 'deliverable');
  assert.equal(f.calls.length, 2);

  const q = fakeFetch(() => ({ status: 429, body: 'usage limit' }));
  const err = await createHunterEmailVerifier({ apiKey: 'k', fetchImpl: q, http }).verify('a@acme.com').catch((e) => e);
  assert.equal(err.fatal, true);
  assert.equal(q.calls.length, 1);
});

test('network errors are retried', async () => {
  let n = 0;
  const flaky = async () => {
    n++;
    if (n === 1) throw new TypeError('fetch failed');
    return { ok: true, status: 200, json: async () => ({ fine: true }), text: async () => '' };
  };
  assert.deepEqual(await requestJson('https://x.test/', { fetchImpl: flaky, ...http }), { fine: true });
});
