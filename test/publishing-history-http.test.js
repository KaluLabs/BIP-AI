import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { approveCampaign } from '../src/editorial.js';
import { ProjectRegistry } from '../src/projects.js';
import { createBipServer, listenBipServer } from '../src/http-server.js';

async function fixture({ pagFactory }) {
  const root = mkdtempSync(join(tmpdir(), 'bip-publishing-http-'));
  const store = new BipStore(':memory:');
  const projects = new ProjectRegistry(join(root, 'projects.json'));
  projects.add({ id: 'bip-ai', path: root });
  const app = new BipAI({ store, storyThreshold: 1 });
  const seeded = app.ingest({
    projectId: 'bip-ai',
    type: 'feature',
    summary: 'Publishing history HTTP',
    details: 'Exercise safe publishing history APIs',
    userVisible: true,
    occurredAt: '2026-09-27T10:00:00.000Z'
  });
  const campaign = approveCampaign(seeded.campaign);
  store.updateCampaignState(campaign);
  const server = createBipServer({ store, projects, app, pagFactory, schedulePollMs: 0 });
  const listening = await listenBipServer(server, { port: 0 });
  return { store, server, base: listening.url, campaign };
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

test('manual failed handoff appears in history and safe retry is duplicate-idempotent', async () => {
  let calls = 0;
  const pagFactory = () => ({
    async createIntent(capability, args, { idempotencyKey }) {
      calls += 1;
      assert.equal(capability, 'x.threads.create');
      assert.ok(Array.isArray(args.posts));
      if (calls === 1) {
        assert.doesNotMatch(idempotencyKey, /:retry:/);
        return { id: 'int-http-fail', status: 'failed', args_hash: 'h1' };
      }
      assert.match(idempotencyKey, /:retry:/);
      return {
        id: 'int-http-ok',
        status: 'succeeded',
        args_hash: 'h2',
        execution: { status: 'succeeded', result: { mode: 'browser_handoff' } }
      };
    }
  });
  const f = await fixture({ pagFactory });
  try {
    const first = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/handoff/x`,
      mutation({ version: f.campaign.version, contentHash: f.campaign.contentHash })
    );
    assert.equal(first.response.status, 200);
    assert.equal(first.body.attempt.status, 'retryable');

    const history1 = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/publishing-history?platform=x`
    );
    assert.equal(history1.response.status, 200);
    assert.equal(history1.body.attempts.length, 1);
    assert.equal(history1.body.attempts[0].retryEligible, true);
    const priorId = history1.body.attempts[0].attemptId;

    const retryBody = {
      attemptId: priorId,
      version: f.campaign.version,
      contentHash: f.campaign.contentHash
    };
    const retry1 = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/publishing/x/retry`,
      mutation(retryBody)
    );
    assert.equal(retry1.response.status, 200);
    assert.equal(retry1.body.attempt.status, 'completed');
    assert.equal(retry1.body.reused, false);

    const retry2 = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/publishing/x/retry`,
      mutation(retryBody)
    );
    assert.equal(retry2.response.status, 200);
    assert.equal(retry2.body.reused, true);
    assert.equal(retry2.body.attempt.attemptId, retry1.body.attempt.attemptId);
    assert.equal(calls, 2);

    const history2 = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/publishing-history?platform=x`
    );
    assert.equal(history2.body.attempts.length, 2);
    assert.equal(history2.body.attempts[0].status, 'completed');
    assert.equal(history2.body.attempts[0].retryOf, priorId);
    assert.equal(history2.body.attempts[1].status, 'retryable');
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('terminal denial is visible but retry endpoint refuses it', async () => {
  const f = await fixture({
    pagFactory: () => ({
      async createIntent() {
        return { id: 'int-http-denied', status: 'denied', args_hash: 'deny' };
      }
    })
  });
  try {
    const first = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/handoff/linkedin`,
      mutation({ version: f.campaign.version, contentHash: f.campaign.contentHash })
    );
    assert.equal(first.response.status, 200);
    assert.equal(first.body.attempt.status, 'denied');

    const history = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/publishing-history?platform=linkedin`
    );
    const attempt = history.body.attempts[0];
    assert.equal(attempt.retryEligible, false);

    const retry = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/publishing/linkedin/retry`,
      mutation({
        attemptId: attempt.attemptId,
        version: f.campaign.version,
        contentHash: f.campaign.contentHash
      })
    );
    assert.equal(retry.response.status, 409);
    assert.match(retry.body.error, /denial is terminal/);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('publishing reconcile endpoint appends PAG receipt and updates current campaign', async () => {
  let getCalls = 0;
  const f = await fixture({
    pagFactory: () => ({
      async createIntent() {
        return {
          id: 'int-http-pending',
          status: 'pending_approval',
          args_hash: 'pending',
          approval: { id: 'apr-http', args_hash: 'pending' }
        };
      },
      async getIntent(id) {
        getCalls += 1;
        assert.equal(id, 'int-http-pending');
        return {
          id,
          capability: 'x.threads.create',
          status: 'succeeded',
          args_hash: 'pending',
          approval: { id: 'apr-http' },
          execution: { status: 'succeeded', result: { mode: 'browser_handoff' } }
        };
      }
    })
  });
  try {
    const first = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/handoff/x`,
      mutation({ version: f.campaign.version, contentHash: f.campaign.contentHash })
    );
    assert.equal(first.body.attempt.status, 'accepted');

    const reconcile = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/publishing/x/reconcile`,
      mutation({ attemptId: first.body.attempt.attemptId })
    );
    assert.equal(reconcile.response.status, 200);
    assert.equal(reconcile.body.attempt.status, 'completed');
    assert.equal(reconcile.body.campaignUpdated, true);
    assert.equal(getCalls, 1);

    const detail = await jsonFetch(`${f.base}/api/campaigns/${f.campaign.id}`);
    assert.equal(detail.body.campaign.platform.x.handoffStatus, 'succeeded');

    const history = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/publishing-history?platform=x`
    );
    assert.equal(history.body.attempts[0].events.at(-1).eventType, 'reconciled');
    assert.equal(history.body.attempts[0].receipt.executionStatus, 'succeeded');
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('publishing mutations require CSRF and history validates platform filter', async () => {
  const f = await fixture({
    pagFactory: () => ({
      async createIntent() { return { id: 'int-unused', status: 'failed' }; }
    })
  });
  try {
    const denied = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/handoff/x`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: f.campaign.version, contentHash: f.campaign.contentHash })
      }
    );
    assert.equal(denied.response.status, 403);

    const invalid = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/publishing-history?platform=instagram`
    );
    assert.equal(invalid.response.status, 400);
    assert.match(invalid.body.error, /platform must be x or linkedin/);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});
