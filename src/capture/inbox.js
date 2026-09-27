import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeProjectEvent } from '../core.js';

export class FileInbox {
  constructor(root = '.bipai/events') {
    this.root = root;
    this.inboxDir = join(root, 'inbox');
    this.processedDir = join(root, 'processed');
    this.failedDir = join(root, 'failed');
    for (const dir of [this.inboxDir, this.processedDir, this.failedDir]) mkdirSync(dir, { recursive: true });
  }

  enqueue(input, filename = null) {
    const event = normalizeProjectEvent(input);
    const safeName = filename || `${event.occurredAt.replace(/[:.]/g, '-')}-${event.id || randomUUID()}.json`;
    const path = join(this.inboxDir, safeName);
    writeFileSync(path, `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' });
    return { path, event };
  }

  pendingFiles() {
    return readdirSync(this.inboxDir).filter((name) => name.endsWith('.json')).sort();
  }

  processAll(handler) {
    const results = [];
    for (const name of this.pendingFiles()) {
      const source = join(this.inboxDir, name);
      try {
        const input = JSON.parse(readFileSync(source, 'utf8'));
        const result = handler(input);
        const destination = join(this.processedDir, name);
        renameSync(source, destination);
        results.push({ file: name, status: 'processed', destination, result });
      } catch (error) {
        const destination = join(this.failedDir, name);
        renameSync(source, destination);
        const errorPath = `${destination}.error.json`;
        writeFileSync(errorPath, `${JSON.stringify({ file: basename(destination), error: error.message, failedAt: new Date().toISOString() }, null, 2)}\n`);
        results.push({ file: name, status: 'failed', destination, error: error.message, errorPath });
      }
    }
    return results;
  }
}

export function emitProjectEvent(input, { root = '.bipai/events', filename = null } = {}) {
  return new FileInbox(root).enqueue(input, filename);
}
