import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { ProjectRegistry } from '../src/projects.js';
import { createBipServer, listenBipServer } from '../src/http-server.js';

function schedulerStub() {
  return {
    started: 0,
    stopped: 0,
    runningCycle: false,
    start() { this.started += 1; return true; },
    stop() { this.stopped += 1; return true; },
    status() {
      return {
        running: true,
        cycleInProgress: this.runningCycle,
        pollMs: 60000,
        sources: [{
          sourceKey: 'git:bip-ai',
          sourceType: 'git',
          projectId: 'bip-ai',
          projectName: 'bip-ai',
          path: '/tmp/project',
          cursor: { headSha: 'abc123' },
          health: { status: 'healthy', lastSuccessAt: '2026-09-27T09:00:00.000Z' }
        }]
      };
    },
    async runOnce({ projectId, force }) {
      if (this.runningCycle) return { skipped: 'cycle_already_running' };
      return {
        ranAt: '2026-09-27T09:01:00.000Z',
        projects: 1,
        attempted: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
        results: [{ projectId, attempted: true, ok: true, force }]
      };
    }
  };
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bip-capture-http-'));
  const store = new BipStore(':memory:');
  const projects = new ProjectRegistry(join(root, 'projects.json'));
  projects.add({ id: 'bip-ai', path: root });
  const app = new BipAI({ store });
  const captureScheduler = schedulerStub();
  const server = createBipServer({ store, projects, app, captureScheduler, schedulePollMs: 0 });
  const listening = await listenBipServer(server, { port: 0 });
  return { store, server, captureScheduler, base: listening.url };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

const mutation = (body = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-bipai-csrf': '1' },
  body: JSON.stringify(body)
});

test('capture scheduler starts and stops with the Control Room server', async () => {
  const f = await fixture();
  assert.equal(f.captureScheduler.started, 1);
  await new Promise((resolve) => f.server.close(resolve));
  assert.equal(f.captureScheduler.stopped, 1);
  f.store.close();
});

test('capture status endpoint exposes health and cursor without secret fields', async () => {
  const f = await fixture();
  try {
    const { response, body } = await jsonFetch(`${f.base}/api/capture/status`);
    assert.equal(response.status, 200);
    assert.equal(body.sources[0].health.status, 'healthy');
    assert.equal(body.sources[0].cursor.headSha, 'abc123');
    assert.doesNotMatch(JSON.stringify(body), /token|password|secret|credential/i);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('manual capture run requires CSRF and can target one project', async () => {
  const f = await fixture();
  try {
    const noCsrf = await jsonFetch(`${f.base}/api/capture/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'bip-ai' })
    });
    assert.equal(noCsrf.response.status, 403);

    const run = await jsonFetch(`${f.base}/api/capture/run`, mutation({ projectId: 'bip-ai' }));
    assert.equal(run.response.status, 200);
    assert.equal(run.body.succeeded, 1);
    assert.equal(run.body.results[0].projectId, 'bip-ai');
    assert.equal(run.body.results[0].force, true);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('overlapping manual capture cycle returns 409', async () => {
  const f = await fixture();
  try {
    f.captureScheduler.runningCycle = true;
    const result = await jsonFetch(`${f.base}/api/capture/run`, mutation({}));
    assert.equal(result.response.status, 409);
    assert.match(result.body.error, /already running/);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});
