import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { createEnricher } from '../src/enricher.js';
import { testConfig, quiet } from './helpers.js';

let server;
let base;

before(async () => {
  const enricher = createEnricher(testConfig({ mode: 'mock' }), quiet);
  const app = createApp(enricher, { apiKey: 'secret', maxBatch: 3 });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (path, { body, raw, key = 'secret', method = body || raw ? 'POST' : 'GET' } = {}) => fetch(base + path, {
  method,
  headers: { 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
  body: raw ?? (body ? JSON.stringify(body) : undefined),
});

test('health is public', async () => {
  const res = await call('/health', { key: null });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('v1 routes need the service key', async () => {
  assert.equal((await call('/v1/providers', { key: null })).status, 401);
  assert.equal((await call('/v1/providers', { key: 'wrong' })).status, 401);
  const res = await fetch(`${base}/v1/providers`, { headers: { authorization: 'Bearer secret' } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).mode, 'mock');
});

test('POST /v1/enrich returns verification and decision', async () => {
  const res = await call('/v1/enrich', { body: { name: 'Ana', email: 'ana@lopez.com', phone: '+33 6 12 34 56 78' } });
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.lead.name, 'Ana');
  assert.equal(r.email.status, 'deliverable');
  assert.equal(r.phone.lineType, 'mobile');
  assert.equal(r.decision.status, 'ready');
});

test('POST /v1/enrich/batch returns a summary and enforces the max size', async () => {
  const res = await call('/v1/enrich/batch', {
    body: { country: 'US', leads: [{ email: 'a@acme.com', phone: '(212) 456-7890' }, { email: 'x.bounce@acme.com', phone: '12' }] },
  });
  const r = await res.json();
  assert.equal(r.summary.total, 2);
  assert.equal(r.results[1].decision.status, 'rejected');

  const big = await call('/v1/enrich/batch', { body: { leads: [{}, {}, {}, {}] } });
  assert.equal(big.status, 413);
});

test('single verify endpoints and input errors', async () => {
  const e = await (await call('/v1/verify/email', { body: { email: 'boss.catchall@acme.com' } })).json();
  assert.equal(e.status, 'risky');
  const p = await (await call('/v1/verify/phone', { body: { phone: '07911 123456', country: 'GB' } })).json();
  assert.equal(p.lineType, 'mobile');

  assert.equal((await call('/v1/verify/email', { body: {} })).status, 400);
  assert.equal((await call('/v1/enrich/batch', { body: { leads: [] } })).status, 400);
  assert.equal((await call('/v1/enrich', { raw: '{bad json' })).status, 400);
  assert.equal((await call('/v1/nope')).status, 404);
});
