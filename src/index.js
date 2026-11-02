export { loadConfig } from './config.js';
export { createEnricher, flattenResult, summarize } from './enricher.js';
export { createApp, startServer } from './server.js';
export { decide, leadScore, DEFAULT_POLICY } from './decision.js';
export { inspectEmail, inspectPhone } from './providers/local.js';
export { readLeads, writeResults } from './io/files.js';
export { detectColumns } from './io/columns.js';
