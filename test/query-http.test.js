import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { ProjectRegistry } from '../src/projects.js';
import { createBipServer, listenBipServer } from '../src/http-server.js';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bip-query-http-'));
  const store = new BipStore(':memory:');
  const projects = new ProjectRegistry(join(root, 'projects.json'));
  projects.add({ id: 'alpha', path: root });
  projects.add({ id: 'beta', path: root });
  const app = new BipAI({ store, storyThreshold: 1 });

  app.ingest({
    projectId: 'alpha',
    type: 'feature',
    summary: 'Alpha search target',
    source: 'github',
    userVisible: true,
    occurredAt: '2026-09-27T08:00:00.000Z'
  });
  app.ingest({
    projectId: 'beta',
    type: 'feature',
    summary: 'Beta search target',
    source: 'manual',
    userVisible: true,
    occurredAt: '2026-09-27T09:00:00.000Z'
  });
  app.ingest({
    projectId: 'alpha',
    type: 'feature',
    summary: 'Alpha later target',
    source: 'github',
    userVisible: true,
    occurredAt: '2026-09-27T10:00:00.000Z'
  });

  const server = createBipServer({ store, projects, app, schedulePollMs: 0 });
  const listening = await listenBipServer(server, { port: 0 });
  return { store, server, base: listening.url };
}

async function getJson(url) {
  const response = await fetch(url);
  return { response, body: await response.json() };
}

test('event API returns normalized query and pagination metadata', async () => {
  const f = await fixture();
  try {
    const { response, body } = await getJson(
      `${f.base}/api/events?projectId=alpha&source=github&q=target&sort=occurredAt&order=asc&page=1&pageSize=1`
    );
    assert.equal(response.status, 200);
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].projectId, 'alpha');
    assert.equal(body.events[0].source, 'github');
    assert.equal(body.pagination.total, 2);
    assert.equal(body.pagination.totalPages, 2);
    assert.equal(body.pagination.hasNext, true);
    assert.equal(body.query.pageSize, 1);
    assert.equal(body.query.order, 'asc');
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('campaign API includes source inherited from originating event', async () => {
  const f = await fixture();
  try {
    const { response, body } = await getJson(
      `${f.base}/api/campaigns?projectId=alpha&source=github&pageSize=10`
    );
    assert.equal(response.status, 200);
    assert.equal(body.campaigns.length, 2);
    assert.ok(body.campaigns.every((item) => item.source === 'github'));
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('collection APIs reject unsupported parameters and sorts with 400', async () => {
  const f = await fixture();
  try {
    const invalidParam = await getJson(`${f.base}/api/events?platform=x`);
    assert.equal(invalidParam.response.status, 400);
    assert.match(invalidParam.body.error, /unsupported query parameter/);

    const invalidSort = await getJson(`${f.base}/api/campaigns?sort=banana`);
    assert.equal(invalidSort.response.status, 400);
    assert.match(invalidSort.body.error, /unsupported campaigns sort/);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('page beyond the end is empty without duplicating the last page', async () => {
  const f = await fixture();
  try {
    const { response, body } = await getJson(
      `${f.base}/api/events?projectId=alpha&sort=occurredAt&order=asc&page=3&pageSize=1`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(body.events, []);
    assert.equal(body.pagination.total, 2);
    assert.equal(body.pagination.totalPages, 2);
    assert.equal(body.pagination.hasNext, false);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});
