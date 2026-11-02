import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';

const formatOf = (file) => path.extname(file).slice(1).toLowerCase();

/** Read leads from .csv, .json or .xlsx into an array of plain objects. */
export async function readLeads(file) {
  if (!fs.existsSync(file)) throw new Error(`Input file not found: ${path.resolve(file)}`);
  const fmt = formatOf(file);
  if (fmt === 'json') {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rows = Array.isArray(data) ? data : data.leads;
    if (!Array.isArray(rows)) throw new Error('JSON input must be an array of leads or { "leads": [...] }');
    return rows;
  }
  if (fmt === 'xlsx') return readXlsx(file);
  if (fmt === 'csv' || fmt === 'txt' || fmt === 'tsv') {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return parse(text, {
      columns: (header) => header.map((h) => String(h).trim()),
      delimiter: sniffDelimiter(text),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  }
  throw new Error(`Unsupported input format ".${fmt}". Use .csv, .json or .xlsx`);
}

/** Excel in comma-decimal locales saves CSVs with ";" so detect it from the header line. */
export function sniffDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

async function readXlsx(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  // Our own output files start with a Summary sheet; the leads are on All Leads.
  const ws = wb.getWorksheet('All Leads') || wb.worksheets[0];
  if (!ws) return [];
  const headers = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.text ?? '').trim();
  });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj = {};
    let any = false;
    headers.forEach((h, col) => {
      if (!h) return;
      const v = row.getCell(col).text ?? '';
      obj[h] = String(v).trim();
      if (obj[h]) any = true;
    });
    if (any) rows.push(obj);
  });
  return rows;
}

/** Write flat rows to .csv, .json or .xlsx. Excel gets one sheet per campaign status. */
export async function writeResults(file, rows, { summary, delimiter = ',', fullResults } = {}) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const fmt = formatOf(file);
  if (fmt === 'json') {
    fs.writeFileSync(file, JSON.stringify({ summary, results: fullResults ?? rows }, null, 2));
  } else if (fmt === 'csv') {
    // BOM so Excel opens UTF-8 names correctly.
    fs.writeFileSync(file, `﻿${stringify(rows, { header: true, delimiter })}`);
  } else if (fmt === 'xlsx') {
    await writeXlsx(file, rows, summary);
  } else {
    throw new Error(`Unsupported output format ".${fmt}". Use .xlsx, .csv or .json`);
  }
  return file;
}

const STATUS_FILL = { ready: 'FFC6EFCE', review: 'FFFFEB9C', rejected: 'FFFFC7CE' };

async function writeXlsx(file, rows, summary) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'lead-enrichment-microservice';
  wb.created = new Date();

  if (summary) addSummarySheet(wb, summary);
  addLeadSheet(wb, 'All Leads', rows);
  for (const status of ['ready', 'review', 'rejected']) {
    addLeadSheet(wb, status[0].toUpperCase() + status.slice(1), rows.filter((r) => r.campaign_status === status));
  }
  await wb.xlsx.writeFile(file);
}

function addLeadSheet(wb, name, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  const headers = rows.length ? Object.keys(rows[0]) : ['campaign_status'];
  ws.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: Math.min(45, Math.max(12, h.length + 2, ...rows.slice(0, 200).map((r) => String(r[h] ?? '').length + 2))),
  }));
  for (const r of rows) {
    const row = ws.addRow(r);
    const fill = STATUS_FILL[r.campaign_status];
    if (fill) row.getCell('campaign_status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

function addSummarySheet(wb, s) {
  const ws = wb.addWorksheet('Summary');
  ws.columns = [{ header: 'Metric', key: 'k', width: 34 }, { header: 'Value', key: 'v', width: 14 }];
  const pct = (n) => (s.total ? n / s.total : 0);
  const lines = [
    ['Total leads', s.total],
    ['Ready for campaigns', s.ready, pct(s.ready)],
    ['Needs review', s.review, pct(s.review)],
    ['Rejected', s.rejected, pct(s.rejected)],
    [],
    ['Can email', s.channels.email],
    ['Can SMS (mobile)', s.channels.sms],
    ['Can call', s.channels.call],
    [],
    ...Object.entries(s.emailStatus).map(([k, v]) => [`Email: ${k}`, v]),
    ...Object.entries(s.phoneStatus).map(([k, v]) => [`Phone: ${k}`, v]),
    ...Object.entries(s.phoneLineType).map(([k, v]) => [`Line type: ${k}`, v]),
    [],
    ['Lookups served from cache', s.cachedLookups],
  ];
  ws.getColumn(3).width = 10;
  for (const [k, v, p] of lines) {
    const row = ws.addRow([k, v, p ?? null]);
    if (p !== undefined) row.getCell(3).numFmt = '0%';
  }
  ws.getRow(1).font = { bold: true };
}
