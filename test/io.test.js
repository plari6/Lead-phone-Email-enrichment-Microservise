import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { readLeads, writeResults, sniffDelimiter } from '../src/io/files.js';
import { detectColumns } from '../src/io/columns.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-io-'));

test('sniffDelimiter handles comma, semicolon and tab files', () => {
  assert.equal(sniffDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(sniffDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(sniffDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(sniffDelimiter('email'), ',');
});

test('detectColumns finds common CRM headers', () => {
  assert.deepEqual(detectColumns(['First Name', 'E-mail Address', 'Cell Phone', 'Country Code']), {
    email: 'E-mail Address', phone: 'Cell Phone', country: 'Country Code',
  });
  assert.deepEqual(detectColumns(['Name', 'Business Email', 'Direct Phone']), { email: 'Business Email', phone: 'Direct Phone', country: null });
  assert.equal(detectColumns(['x', 'y'], { email: 'x' }).email, 'x');
});

test('reads semicolon CSV with a BOM, JSON and XLSX', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const csv = path.join(dir, 'leads.csv');
  fs.writeFileSync(csv, '﻿Name;Email;Phone\nJosé;jose@acme.com;+34 612 345 678\n');
  assert.deepEqual(await readLeads(csv), [{ Name: 'José', Email: 'jose@acme.com', Phone: '+34 612 345 678' }]);

  const json = path.join(dir, 'leads.json');
  fs.writeFileSync(json, JSON.stringify({ leads: [{ email: 'a@b.co' }] }));
  assert.deepEqual(await readLeads(json), [{ email: 'a@b.co' }]);

  const xlsx = path.join(dir, 'leads.xlsx');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');
  ws.addRow(['Email', 'Phone']);
  ws.addRow(['a@acme.com', '+1 212 456 7890']);
  ws.addRow([]);
  await wb.xlsx.writeFile(xlsx);
  assert.deepEqual(await readLeads(xlsx), [{ Email: 'a@acme.com', Phone: '+1 212 456 7890' }]);

  fs.writeFileSync(path.join(dir, 'x.pdf'), '');
  await assert.rejects(readLeads(path.join(dir, 'x.pdf')), /Unsupported input/);
  await assert.rejects(readLeads(path.join(dir, 'missing.csv')), /not found/);
});

test('writes xlsx with summary and one sheet per status', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rows = [
    { email: 'a@x.com', campaign_status: 'ready' },
    { email: 'b@x.com', campaign_status: 'review' },
    { email: 'c@x.com', campaign_status: 'rejected' },
    { email: 'd@x.com', campaign_status: 'ready' },
  ];
  const summary = { total: 4, ready: 2, review: 1, rejected: 1, channels: { email: 2, sms: 0, call: 0 }, emailStatus: {}, phoneStatus: {}, phoneLineType: {}, cachedLookups: 0 };
  const file = path.join(dir, 'out', 'result.xlsx');
  await writeResults(file, rows, { summary });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Summary', 'All Leads', 'Ready', 'Review', 'Rejected']);
  assert.equal(wb.getWorksheet('All Leads').rowCount, 5);
  assert.equal(wb.getWorksheet('Ready').rowCount, 3);
});

test('writes csv with chosen delimiter', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'r.csv');
  await writeResults(file, [{ a: 1, b: 'x;y' }], { delimiter: ';' });
  assert.equal(fs.readFileSync(file, 'utf8'), '﻿a;b\n1;"x;y"\n');
});
