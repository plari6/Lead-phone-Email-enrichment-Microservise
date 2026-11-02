#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// .env in the current folder first, then the project's own .env (never overrides real env vars).
dotenv.config({ quiet: true });
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true });
import { Command, Option } from 'commander';
import { loadConfig } from '../src/config.js';
import { createEnricher, flattenResult } from '../src/enricher.js';
import { readLeads, writeResults } from '../src/io/files.js';
import { detectColumns } from '../src/io/columns.js';
import { startServer } from '../src/server.js';
import { createLogger } from '../src/utils/logger.js';

const program = new Command();
program
  .name('lead-enrich')
  .description('Verify lead emails (Hunter.io + Abstract API) and phone line types (Abstract API) before they enter sales campaigns.')
  .version('1.0.0')
  .option('--mock', 'use fake providers (no API calls, no credits)')
  .option('-c, --country <iso2>', 'default country for phone numbers without +code (e.g. US, GB, AE)')
  .addOption(new Option('-s, --strategy <name>', 'how to use the email providers').choices(['waterfall', 'consensus', 'hunter', 'abstract']))
  .option('--no-mx', 'skip the DNS mail-server check')
  .option('--no-cache', 'ignore and do not write the lookup cache')
  .option('--allow-risky', 'put risky (catch-all) emails into the email channel')
  .option('-q, --quiet', 'only print errors');

function buildConfig() {
  const o = program.opts();
  const overrides = {};
  if (o.mock) overrides.mode = 'mock';
  if (o.country) overrides.defaultCountry = o.country.toUpperCase();
  if (o.strategy) overrides.emailStrategy = o.strategy;
  if (o.mx === false) overrides.checkMx = false;
  if (o.cache === false) overrides.cache = { enabled: false };
  if (o.allowRisky) overrides.policy = { allowRiskyEmail: true };
  if (o.quiet) overrides.logLevel = 'error';
  return loadConfig(process.env, overrides);
}

function printProviderBanner(enricher, logger) {
  const s = enricher.status();
  const email = s.emailProviders.length ? s.emailProviders.join(' -> ') : 'none (local checks only)';
  logger.info(`mode=${s.mode} | email: ${email} [${s.emailStrategy}] | phone line type: ${s.phoneProvider || 'numbering plan only'}`);
  if (s.mode !== 'mock' && !s.emailProviders.length && !s.phoneProvider) {
    logger.warn('No API keys found. Add them to .env (see .env.example), or run with --mock to try it out.');
  }
}

program
  .command('file')
  .description('enrich a .csv / .xlsx / .json lead list and write the results')
  .argument('<input>', 'lead file')
  .option('-o, --output <file>', 'output file (.xlsx, .csv or .json)')
  .option('--email-col <name>', 'email column name (auto-detected by default)')
  .option('--phone-col <name>', 'phone column name (auto-detected by default)')
  .option('--country-col <name>', 'country column with ISO-2 codes (auto-detected by default)')
  .option('-d, --delimiter <char>', 'CSV output delimiter (use ";" for Excel in comma-decimal locales)', ',')
  .option('--only <status>', 'only write leads with this campaign status (ready, review, rejected)')
  .option('--limit <n>', 'only process the first n leads', (v) => parseInt(v, 10))
  .action(async (input, opts) => {
    const config = buildConfig();
    const logger = createLogger(config.logLevel);
    const enricher = createEnricher(config, { logger });
    printProviderBanner(enricher, logger);

    let leads = await readLeads(input);
    if (opts.limit) leads = leads.slice(0, opts.limit);
    if (!leads.length) throw new Error(`No leads found in ${input}`);

    const columns = detectColumns(Object.keys(leads[0]), { email: opts.emailCol, phone: opts.phoneCol, country: opts.countryCol });
    if (!columns.email && !columns.phone) {
      throw new Error(`Could not find an email or phone column. Headers: ${Object.keys(leads[0]).join(', ')}. Use --email-col / --phone-col.`);
    }
    logger.info(`${leads.length} leads | email column: ${columns.email ?? '-'} | phone column: ${columns.phone ?? '-'} | country column: ${columns.country ?? '-'}`);

    const started = Date.now();
    const tty = process.stderr.isTTY && !program.opts().quiet;
    const { results, summary } = await enricher.enrichMany(leads, {
      columns,
      onProgress: (done, total) => {
        if (tty) process.stderr.write(`\r  enriching ${done}/${total}`);
      },
    });
    if (tty) process.stderr.write('\n');

    let rows = results.map(flattenResult);
    let full = results;
    if (opts.only) {
      rows = rows.filter((r) => r.campaign_status === opts.only);
      full = results.filter((r) => r.decision.status === opts.only);
    }
    const output = opts.output || defaultOutput(input);
    await writeResults(output, rows, { summary, delimiter: opts.delimiter, fullResults: full });

    printSummary(summary, (Date.now() - started) / 1000);
    console.log(`\nSaved: ${path.resolve(output)}`);
  });

program
  .command('email')
  .description('verify one email address')
  .argument('<address>')
  .action(async (address) => {
    const enricher = createEnricher(buildConfig(), { logger: createLogger('error') });
    const result = await enricher.verifyEmail(address);
    enricher.saveCache();
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('phone')
  .description('validate one phone number and find its line type')
  .argument('<number>')
  .action(async (number) => {
    const config = buildConfig();
    const enricher = createEnricher(config, { logger: createLogger('error') });
    const result = await enricher.verifyPhone(number, config.defaultCountry);
    enricher.saveCache();
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('lead')
  .description('enrich one lead and show the campaign decision')
  .option('-e, --email <address>')
  .option('-p, --phone <number>')
  .action(async (opts) => {
    if (!opts.email && !opts.phone) throw new Error('Give --email and/or --phone');
    const enricher = createEnricher(buildConfig(), { logger: createLogger('error') });
    const result = await enricher.enrichLead({ email: opts.email || '', phone: opts.phone || '' });
    enricher.saveCache();
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('serve')
  .description('start the REST microservice')
  .option('-p, --port <port>', 'port to listen on', (v) => parseInt(v, 10))
  .action(async (opts) => {
    const config = buildConfig();
    const logger = createLogger(config.logLevel);
    const enricher = createEnricher(config, { logger });
    printProviderBanner(enricher, logger);
    const port = opts.port || config.server.port;
    await startServer(enricher, { port, apiKey: config.server.apiKey, maxBatch: config.server.maxBatch, logger });
    logger.info(`Lead enrichment API listening on http://localhost:${port}${config.server.apiKey ? ' (x-api-key required)' : ''}`);
  });

program
  .command('providers')
  .description('show which providers are configured')
  .action(() => {
    const enricher = createEnricher(buildConfig(), { logger: createLogger('error') });
    console.log(JSON.stringify(enricher.status(), null, 2));
  });

function defaultOutput(input) {
  const base = path.basename(input, path.extname(input));
  return path.join('output', `${base}-enriched.xlsx`);
}

function printSummary(s, seconds) {
  const pct = (n) => (s.total ? `${Math.round((n / s.total) * 100)}%` : '0%');
  console.log(`\nEnriched ${s.total} leads in ${seconds.toFixed(1)}s`);
  console.table({
    ready: { leads: s.ready, share: pct(s.ready) },
    review: { leads: s.review, share: pct(s.review) },
    rejected: { leads: s.rejected, share: pct(s.rejected) },
  });
  console.log(`Channels  email: ${s.channels.email} | sms: ${s.channels.sms} | call: ${s.channels.call}`);
  console.log(`Email     ${fmt(s.emailStatus)}`);
  console.log(`Phone     ${fmt(s.phoneStatus)}`);
  console.log(`Line type ${fmt(s.phoneLineType)}`);
  if (s.cachedLookups) console.log(`Cache     ${s.cachedLookups} lookups reused (no credits spent)`);
}
const fmt = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(' | ') || '-';

program.parseAsync().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
