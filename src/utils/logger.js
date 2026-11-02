const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

// Logs go to stderr so stdout stays clean for JSON output.
export function createLogger(level = 'info') {
  const max = LEVELS[level] ?? LEVELS.info;
  const log = (lvl) => (...args) => {
    if (LEVELS[lvl] <= max) console.error(`[${lvl}]`, ...args);
  };
  return { error: log('error'), warn: log('warn'), info: log('info'), debug: log('debug'), level };
}

export const silentLogger = createLogger('silent');
