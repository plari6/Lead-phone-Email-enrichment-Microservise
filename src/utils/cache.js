import fs from 'node:fs';
import path from 'node:path';

/**
 * Key/value cache with expiry, optionally saved to a JSON file so the same
 * email or phone number is never paid for twice.
 */
export class Cache {
  constructor({ file = null, ttlHours = 720 } = {}) {
    this.file = file;
    this.ttlMs = ttlHours * 3600 * 1000;
    this.map = new Map();
    this.dirty = false;
    if (file && fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [k, v] of Object.entries(data)) this.map.set(k, v);
      } catch {
        // Corrupt cache file: start fresh.
      }
    }
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.t > this.ttlMs) {
      this.map.delete(key);
      this.dirty = true;
      return undefined;
    }
    return entry.v;
  }

  set(key, value) {
    this.map.set(key, { t: Date.now(), v: value });
    this.dirty = true;
  }

  get size() {
    return this.map.size;
  }

  save() {
    if (!this.file || !this.dirty) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)));
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }
}
