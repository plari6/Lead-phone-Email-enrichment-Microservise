import crypto from 'node:crypto';
import express from 'express';
import { summarize } from './enricher.js';

/**
 * REST API so CRMs, Zapier/Make/n8n or a sales-engagement tool can enrich leads
 * before adding them to a sequence.
 */
export function createApp(enricher, { apiKey = '', maxBatch = 500, logger } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  // Public: health check for load balancers / uptime monitors.
  app.get('/health', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

  // Everything under /v1 needs the service key when SERVICE_API_KEY is set.
  app.use('/v1', (req, res, next) => {
    if (!apiKey) return next();
    const given = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (given && safeEqual(given, apiKey)) return next();
    return res.status(401).json({ error: 'unauthorized', message: 'Send the service key in the x-api-key header.' });
  });

  app.get('/v1/providers', (req, res) => res.json(enricher.status()));

  app.post('/v1/verify/email', wrap(async (req, res) => {
    const email = req.body?.email;
    if (!email) return res.status(400).json({ error: 'bad_request', message: '"email" is required' });
    res.json(await enricher.verifyEmail(email));
  }));

  app.post('/v1/verify/phone', wrap(async (req, res) => {
    const { phone, country } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'bad_request', message: '"phone" is required' });
    res.json(await enricher.verifyPhone(phone, country));
  }));

  // One lead: { email, phone, country?, ...any other fields are echoed back }
  app.post('/v1/enrich', wrap(async (req, res) => {
    const lead = req.body;
    if (!lead || typeof lead !== 'object' || Array.isArray(lead)) {
      return res.status(400).json({ error: 'bad_request', message: 'Send a JSON object with "email" and/or "phone"' });
    }
    const result = await enricher.enrichLead(lead, { country: lead.country });
    enricher.saveCache();
    res.json(result);
  }));

  // Many leads: { leads: [...], country? }
  app.post('/v1/enrich/batch', wrap(async (req, res) => {
    const leads = req.body?.leads;
    if (!Array.isArray(leads) || !leads.length) {
      return res.status(400).json({ error: 'bad_request', message: '"leads" must be a non-empty array' });
    }
    if (leads.length > maxBatch) {
      return res.status(413).json({ error: 'batch_too_large', message: `Max ${maxBatch} leads per request` });
    }
    const { results } = await enricher.enrichMany(leads, { country: req.body.country });
    res.json({ summary: summarize(results), results });
  }));

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    logger?.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  });

  return app;
}

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Start listening; saves the cache and closes cleanly on Ctrl+C / SIGTERM. */
export function startServer(enricher, { port = 3000, apiKey, maxBatch, logger } = {}) {
  const app = createApp(enricher, { apiKey, maxBatch, logger });
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const shutdown = () => {
        enricher.saveCache();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      resolve(server);
    });
  });
}
