import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLeads } from '../src/io/files.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'lead-enrich.js');
// Clean env so a developer's real .env keys are never used by tests.
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ENRICH_MODE: 'mock', CACHE_ENABLED: 'false', LOG_LEVEL: 'error' };
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: os.tmpdir(), env, encoding: 'utf8' });

test('file command enriches the sample list to csv', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'out.csv');
  const stdout = run('file', path.join(root, 'samples', 'leads.csv'), '-o', out);
  assert.match(stdout, /Enriched 17 leads/);

  const rows = await readLeads(out);
  assert.equal(rows.length, 17);
  const by = (email) => rows.find((r) => r['Work Email'] === email);
  assert.equal(by('ana@mailinator.com').email_status, 'undeliverable');
  assert.equal(by('nora.patel@patelpharmacy').campaign_status, 'rejected');
  assert.equal(by('grace.kim@gmial.com').email_suggestion, 'grace.kim@gmail.com');
  assert.equal(by('mike.catchall@turnerhvac.com').phone_line_type, 'toll_free');
  assert.equal(by('info@kellerbau.de').can_sms, 'no');
});

test('file command --only ready writes xlsx', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'ready.xlsx');
  run('file', path.join(root, 'samples', 'leads.csv'), '-o', out, '--only', 'ready');
  const rows = await readLeads(out); // reads the All Leads sheet
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.campaign_status === 'ready'));
});

test('email, phone and lead commands print JSON', () => {
  assert.equal(JSON.parse(run('email', 'jane.bounce@acme.com')).status, 'undeliverable');
  assert.equal(JSON.parse(run('phone', '+44 7911 123456')).lineType, 'mobile');
  const lead = JSON.parse(run('lead', '-e', 'jane@acme.com', '-p', '+44 20 7946 0958'));
  assert.deepEqual(lead.decision.channels, ['email', 'call']);
});

test('missing file gives a clean error and exit code 1', () => {
  assert.throws(() => run('file', 'does-not-exist.csv'), (err) => err.status === 1 && /Input file not found/.test(err.stderr));
});
