import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, leadScore } from '../src/decision.js';

const email = (status, extra = {}) => ({ status, flags: {}, ...extra });
const phone = (lineType, status = 'valid') => ({ status, lineType });

test('deliverable email + mobile = all three channels', () => {
  const d = decide(email('deliverable'), phone('mobile'));
  assert.equal(d.status, 'ready');
  assert.deepEqual(d.channels, ['email', 'sms', 'call']);
  assert.equal(d.score, 100);
});

test('landlines are callable but never get SMS', () => {
  const d = decide(email('missing'), phone('landline'));
  assert.deepEqual(d.channels, ['call']);
  assert.equal(d.canSms, false);
});

test('unconfirmed US line type: call yes, SMS no', () => {
  const d = decide(email('deliverable'), phone('landline_or_mobile'));
  assert.deepEqual(d.channels, ['email', 'call']);
  assert.ok(d.notes.some((n) => n.includes('unconfirmed')));
});

test('risky email goes to review unless policy allows it', () => {
  assert.equal(decide(email('risky'), phone(null, 'missing')).status, 'review');
  assert.equal(decide(email('risky'), phone(null, 'missing'), { allowRiskyEmail: true }).status, 'ready');
});

test('undeliverable email + invalid phone = rejected', () => {
  const d = decide(email('undeliverable'), phone(null, 'invalid'));
  assert.equal(d.status, 'rejected');
  assert.equal(d.emailAction, 'suppress');
  assert.equal(d.score, 0);
});

test('bounce email but good mobile is still ready for SMS/call', () => {
  const d = decide(email('undeliverable'), phone('mobile'));
  assert.equal(d.status, 'ready');
  assert.deepEqual(d.channels, ['sms', 'call']);
});

test('premium / toll-free numbers go to review', () => {
  assert.equal(decide(email('missing'), phone('premium_rate')).status, 'review');
  assert.equal(decide(email('missing'), phone('toll_free')).status, 'review');
});

test('policy can block role and free emails; typos go to review', () => {
  assert.equal(decide(email('deliverable', { flags: { role: true } }), {}, { allowRoleEmail: false }).emailAction, 'review');
  assert.equal(decide(email('deliverable', { flags: { free: true } }), {}, { allowFreeEmail: false }).emailAction, 'review');
  assert.equal(decide(email('deliverable', { suggestion: 'a@gmail.com' }), {}).emailAction, 'review');
});

test('lead score weights', () => {
  assert.equal(leadScore(email('risky'), phone('landline')), 55);
  assert.equal(leadScore(email('unknown'), phone('toll_free')), 25);
});
