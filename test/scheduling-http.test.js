import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { ProjectRegistry } from '../src/projects.js';
import { approveCampaign } from '../src/editorial.js';
import { createBipServer, listenBipServer } from '../src/http-server.js';

async function fixture({ pagFactory = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bip-scheduling-http-'));
  const store = new BipStore(':memory:');
  const projects = new ProjectRegistry(join(root, 'projects.json'));
  projects.add({ id: 'bip-ai', path: root });
  const app = new BipAI({ store });
  const seeded = app.ingest({
    projectId: 'bip-ai',
    type: 'feature',
    summary: 'Scheduling API',
    details: 'Added editorial scheduling API',
    userVisible: true,
    nextStep: 'Use the calendar',
    occurredAt: '2026-09-27T00:00:00.000Z'
  });
  const approved = approveCampaign(seeded.campaign);
  store.updateCampaignState(approved);
  const server = createBipServer({ store, projects, app, pagFactory, schedulePollMs: 0 });
  const listening = await listenBipServer(server, { port: 0 });
  return { root, store, projects, campaign: approved, server, base: listening.url };
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

test('schedule API preserves approval and exposes due item deterministically', async () => {
  const f = await fixture();
  try {
    const scheduled = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/schedule/x`,
      mutation({ scheduledAt: '2026-09-28T09:00:00+01:00', timezone: 'Africa/Lagos' })
    );
    assert.equal(scheduled.response.status, 200);
    assert.equal(scheduled.body.campaign.version, f.campaign.version);
    assert.equal(scheduled.body.campaign.contentHash, f.campaign.contentHash);
    assert.deepEqual(scheduled.body.campaign.campaignApproval, f.campaign.campaignApproval);

    const due = await jsonFetch(`${f.base}/api/schedules/due?at=2026-09-28T08%3A15%3A00.000Z`);
    assert.equal(due.response.status, 200);
    assert.equal(due.body.items.length, 1);
    assert.equal(due.body.items[0].platform, 'x');
    assert.equal(due.body.items[0].overdueByMs, 15 * 60 * 1000);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('schedule API rejects naive timestamps without a timezone offset', async () => {
  const f = await fixture();
  try {
    const result = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/schedule/linkedin`,
      mutation({ scheduledAt: '2026-09-28T09:00:00', timezone: 'Africa/Lagos' })
    );
    assert.equal(result.response.status, 400);
    assert.match(result.body.error, /UTC offset|RFC3339/);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('schedule can be cleared without invalidating unchanged approval', async () => {
  const f = await fixture();
  try {
    await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/schedule/linkedin`,
      mutation({ scheduledAt: '2026-09-28T12:00:00Z', timezone: 'UTC' })
    );
    const cleared = await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/schedule/linkedin/clear`,
      mutation({})
    );
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.body.campaign.platform.linkedin.schedule, null);
    assert.equal(cleared.body.campaign.platform.linkedin.lifecycleStatus, 'approved');
    assert.equal(cleared.body.campaign.campaignApproval.contentHash, f.campaign.contentHash);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});

test('run-due API performs an approval-gated PAG handoff and persists publication state', async () => {
  const pagFactory = () => ({
    async createIntent(capability, args) {
      assert.equal(capability, 'x.threads.create');
      assert.ok(Array.isArray(args.posts));
      return {
        id: 'int_http_schedule',
        status: 'succeeded',
        args_hash: 'hash_http_schedule',
        execution: { status: 'succeeded' }
      };
    }
  });
  const f = await fixture({ pagFactory });
  try {
    await jsonFetch(
      `${f.base}/api/campaigns/${f.campaign.id}/schedule/x`,
      mutation({ scheduledAt: '2026-09-28T09:00:00Z', timezone: 'UTC' })
    );
    const run = await jsonFetch(
      `${f.base}/api/schedules/run-due`,
      mutation({ at: '2026-09-28T09:00:00Z' })
    );
    assert.equal(run.response.status, 200);
    assert.equal(run.body.due, 1);
    assert.equal(run.body.results[0].executed, true);
    assert.equal(run.body.results[0].lifecycleStatus, 'published');

    const detail = await jsonFetch(`${f.base}/api/campaigns/${f.campaign.id}`);
    assert.equal(detail.body.campaign.platform.x.lifecycleStatus, 'published');
    assert.equal(detail.body.campaign.platform.x.schedule.status, 'published');
    assert.equal(detail.body.campaign.platform.linkedin.lifecycleStatus, 'approved');

    const history = await jsonFetch(`${f.base}/api/campaigns/${f.campaign.id}/publishing-history?platform=x`);
    assert.equal(history.response.status, 200);
    assert.equal(history.body.attempts.length, 1);
    assert.equal(history.body.attempts[0].platform, 'x');
    assert.equal(history.body.attempts[0].status, 'completed');
    assert.equal(history.body.attempts[0].campaignVersion, f.campaign.version);
    assert.equal(history.body.attempts[0].contentHash, f.campaign.contentHash);
  } finally {
    await new Promise((resolve) => f.server.close(resolve));
    f.store.close();
  }
});
