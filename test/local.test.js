import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectEmail, inspectPhone, hasMxRecords, createLocalEmailVerifier, normalizeEmail } from '../src/providers/local.js';
import { mockResolveMx } from '../src/providers/mock.js';

test('normalizeEmail trims, lowercases and strips mailto', () => {
  assert.equal(normalizeEmail('  Mailto:John.Doe@ACME.com '), 'john.doe@acme.com');
  assert.equal(normalizeEmail('<a@b.co>'), 'a@b.co');
  assert.equal(normalizeEmail(undefined), '');
});

test('inspectEmail flags syntax, disposable, free, role and typos', () => {
  assert.equal(inspectEmail('jane@acme.com').validFormat, true);
  for (const bad of ['jane@', '@acme.com', 'jane@acme', 'ja ne@acme.com', 'jane..doe@acme.com', 'jane@-acme.com']) {
    assert.equal(inspectEmail(bad).validFormat, false, bad);
  }
  assert.equal(inspectEmail('x@mailinator.com').disposable, true);
  assert.equal(inspectEmail('x@gmail.com').free, true);
  assert.equal(inspectEmail('info@acme.com').role, true);
  assert.equal(inspectEmail('sales+eu@acme.com').role, true);
  assert.equal(inspectEmail('jane@gmial.com').suggestion, 'jane@gmail.com');
});

test('hasMxRecords: true / false / null on lookup errors', async () => {
  assert.equal(await hasMxRecords('acme.com', { resolveMx: mockResolveMx }), true);
  assert.equal(await hasMxRecords('acme-nomx.com', { resolveMx: mockResolveMx }), false);
  const broken = async () => { throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }); };
  assert.equal(await hasMxRecords('acme.com', { resolveMx: broken }), null);
});

test('local verifier: hard fails are undeliverable, the rest unknown', async () => {
  const v = createLocalEmailVerifier({ resolveMx: mockResolveMx });
  assert.equal((await v.verify('not-an-email')).status, 'undeliverable');
  assert.equal((await v.verify('a@mailinator.com')).status, 'undeliverable');
  assert.equal((await v.verify('a@acme-nomx.com')).status, 'undeliverable');
  const ok = await v.verify('a@acme.com');
  assert.equal(ok.status, 'unknown');
  assert.equal(ok.flags.mx, true);
});

test('inspectPhone parses national and international formats', () => {
  const us = inspectPhone('(212) 456-7890', 'US');
  assert.equal(us.valid, true);
  assert.equal(us.e164, '+12124567890');
  assert.equal(us.lineType, 'landline_or_mobile');

  const intl = inspectPhone('0049 30 901820', 'US'); // "00" prefix
  assert.equal(intl.e164, '+4930901820');
  assert.equal(intl.lineType, 'landline');

  assert.equal(inspectPhone('+33 6 12 34 56 78').lineType, 'mobile');
  assert.equal(inspectPhone('1-800-642-7676', 'US').lineType, 'toll_free');
  assert.equal(inspectPhone('12345', 'US').valid, false);
  assert.equal(inspectPhone('', 'US').present, false);
  assert.equal(inspectPhone('not a phone', 'US').valid, false);
});
