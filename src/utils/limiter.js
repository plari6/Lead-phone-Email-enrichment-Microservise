import { sleep } from './http.js';

/** Limits how many jobs run at once and how often a new one may start (rate limit). */
export function createLimiter({ concurrency = Infinity, minIntervalMs = 0 } = {}) {
  let active = 0;
  let nextStart = 0;
  const queue = [];

  const pump = () => {
    while (active < concurrency && queue.length) {
      active++;
      run(queue.shift());
    }
  };

  async function run({ fn, resolve, reject }) {
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + minIntervalMs;
    try {
      if (wait) await sleep(wait);
      resolve(await fn());
    } catch (e) {
      reject(e);
    } finally {
      active--;
      pump();
    }
  }

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

/** Run fn over items with a concurrency cap, keeping input order. */
export async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
