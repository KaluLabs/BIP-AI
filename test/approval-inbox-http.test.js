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
  const root = mkdtempSync(join(tmpdir(), 'bip-approval-http-'));
  const store = new BipStore(':memory:');
  const projects = new ProjectRegistry(join(root, 'projects.json'));
  projects.add({ id: 'alpha', path: root });
  projects.add({ id: 'beta', path: root });
  const app = new BipAI({ store, storyThreshold: 1 });

  const pass = app.ingest({
    projectId: 'alpha',
    type: 'feature',
    summary: 'Alpha approval target',
    details: 'Alpha campaign ready for explicit approval',
    source: 'github',
    userVisible: true,
    nextStep: 'Approve it',
    occurredAt: '2026-09-27T09:00:00.000Z'
  }).campaign;

  const review = app.ingest({
    projectId: 'beta',
    type: 'feature',
    summary: 'Beta private target',
    details: 'Beta campaign requires explicit privacy review',
    source: 'github',
    privacy: 'REVIEW',
    userVisible: false,
    nextStep: 'Review privacy',
    occurredAt: '2026-09-27T09:30:00.000Z'
  }).campaign;

  const server = createBipServer({ store, projects, app, schedulePollMs: 0 });
  const listening = await listenBipServer(server, { port: 0 });
  return { store, server, base: listening.url, pass, review };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  return { response, body: await response.json() };
}

function mutation(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bipai-csrf': '1' },
    body: JSON.stringify(body)
  };
}

test('approval inbox API exposes normalized filtered actionable items with provenance', async () => {
  const f = await fixture();
  try {
    const result = await jsonFetch(
      `${f.base}/api/approval-inbox?projectId=alpha&source=github&q=Alpha&pageSize=10`
    );
    assert.equal(result.response.status, 200);
    assert.equal(result.body.items.length, 1);
    const item = result.body.items[0];
    assert.equal(item.category, 'awaiting_approval');
    assert.equal(item.projectId, 'alpha');
    assert.equal(item.campaignId, f.pass.id);
    assert.equal(item.campaignVersion, f.pass.version);
    assert.equal(item.campaignContentHash, f.pass.contentHash);
    assert.equal(item.provenance.eventId, f.pass.eventId);
    assert.equal(item.provenance.source, 'github');
    assert.equal(result.body.summary.total, 1);
    assert.equal(result.body.pagination.total, 1);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('bulk approval requires CSRF exact version/hash and resolves actionable draft', async () => {
  const f = await fixture();
  try {
    const denied = await jsonFetch(`${f.base}/api/approval-inbox/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: [] })
    });
    assert.equal(denied.response.status, 403);

    const stale = await jsonFetch(`${f.base}/api/approval-inbox/approve`, mutation({
      items: [{
        campaignId: f.pass.id,
        version: f.pass.version + 1,
        contentHash: f.pass.contentHash
      }]
    }));
    assert.equal(stale.response.status, 409);
    assert.equal(f.store.getCampaign(f.pass.id).campaignApproval, null);

    const approved = await jsonFetch(`${f.base}/api/approval-inbox/approve`, mutation({
      items: [{
        campaignId: f.pass.id,
        version: f.pass.version,
        contentHash: f.pass.contentHash
      }]
    }));
    assert.equal(approved.response.status, 200);
    assert.equal(approved.body.approved.length, 1);
    assert.equal(f.store.getCampaign(f.pass.id).campaignApproval.version, f.pass.version);

    const after = await jsonFetch(`${f.base}/api/approval-inbox?projectId=alpha`);
    assert.equal(after.body.items.length, 0);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('bulk approval prevalidates the whole request before mutating any campaign', async () => {
  const f = await fixture();
  try {
    const second = new BipAI({ store: f.store, storyThreshold: 1 }).ingest({
      projectId: 'alpha',
      type: 'feature',
      summary: 'Second approval target',
      details: 'Second campaign for atomic prevalidation',
      userVisible: true,
      occurredAt: '2026-09-27T10:00:00.000Z'
    }).campaign;

    const result = await jsonFetch(`${f.base}/api/approval-inbox/approve`, mutation({
      items: [
        { campaignId: f.pass.id, version: f.pass.version, contentHash: f.pass.contentHash },
        { campaignId: second.id, version: second.version + 1, contentHash: second.contentHash }
      ]
    }));
    assert.equal(result.response.status, 409);
    assert.equal(f.store.getCampaign(f.pass.id).campaignApproval, null);
    assert.equal(f.store.getCampaign(second.id).campaignApproval, null);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('privacy review cannot use approval endpoint and explicit PASS creates a new version', async () => {
  const f = await fixture();
  try {
    const approval = await jsonFetch(`${f.base}/api/approval-inbox/approve`, mutation({
      items: [{
        campaignId: f.review.id,
        version: f.review.version,
        contentHash: f.review.contentHash
      }]
    }));
    assert.equal(approval.response.status, 409);
    assert.equal(f.store.getCampaign(f.review.id).privacyResult, 'REVIEW');

    const missingNote = await jsonFetch(
      `${f.base}/api/approval-inbox/privacy/${encodeURIComponent(f.review.id)}`,
      mutation({
        version: f.review.version,
        contentHash: f.review.contentHash,
        decision: 'PASS',
        note: ''
      })
    );
    assert.equal(missingNote.response.status, 400);

    const resolved = await jsonFetch(
      `${f.base}/api/approval-inbox/privacy/${encodeURIComponent(f.review.id)}`,
      mutation({
        version: f.review.version,
        contentHash: f.review.contentHash,
        decision: 'PASS',
        note: 'Reviewed the evidence and confirmed it is safe to publish.'
      })
    );
    assert.equal(resolved.response.status, 200);
    assert.equal(resolved.body.campaign.version, f.review.version + 1);
    assert.equal(resolved.body.campaign.privacyResult, 'PASS');
    assert.equal(resolved.body.campaign.campaignApproval, null);

    const after = await jsonFetch(`${f.base}/api/approval-inbox?projectId=beta`);
    assert.equal(after.body.items.length, 1);
    assert.equal(after.body.items[0].category, 'awaiting_approval');
    assert.equal(after.body.items[0].campaignVersion, f.review.version + 1);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('privacy BLOCK resolves the review item without creating an approval target', async () => {
  const f = await fixture();
  try {
    const resolved = await jsonFetch(
      `${f.base}/api/approval-inbox/privacy/${encodeURIComponent(f.review.id)}`,
      mutation({
        version: f.review.version,
        contentHash: f.review.contentHash,
        decision: 'BLOCK',
        note: 'Contains internal implementation details.'
      })
    );
    assert.equal(resolved.response.status, 200);
    assert.equal(resolved.body.campaign.privacyResult, 'BLOCK');

    const after = await jsonFetch(`${f.base}/api/approval-inbox?projectId=beta`);
    assert.deepEqual(after.body.items, []);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('approval inbox collection rejects unsupported query parameters', async () => {
  const f = await fixture();
  try {
    const result = await jsonFetch(`${f.base}/api/approval-inbox?banana=yes`);
    assert.equal(result.response.status, 400);
    assert.match(result.body.error, /unsupported query parameter/);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});
