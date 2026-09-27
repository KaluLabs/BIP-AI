import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { applyEditorial, approveCampaign } from '../src/editorial.js';
import {
  clearCampaignSchedule,
  executeScheduledHandoff,
  listDueSchedules,
  platformLifecycle,
  scheduleCampaign,
  scheduleSnapshot
} from '../src/scheduling.js';

function seed({ filename = ':memory:' } = {}) {
  const store = new BipStore(filename);
  const app = new BipAI({ store });
  const result = app.ingest({
    projectId: 'bip-ai',
    type: 'feature',
    summary: 'Added scheduling',
    details: 'Added approval-gated editorial scheduling',
    userVisible: true,
    nextStep: 'Ship scheduling',
    occurredAt: '2026-09-27T00:00:00.000Z'
  });
  const approved = approveCampaign(result.campaign);
  store.updateCampaignState(approved);
  return { store, campaign: approved };
}

test('schedule requires an explicit timezone-aware RFC3339 timestamp', () => {
  const { store, campaign } = seed();
  try {
    assert.throws(
      () => scheduleCampaign(campaign, 'x', { scheduledAt: '2026-09-28T09:30:00' }),
      /Z or an explicit UTC offset/
    );
    const scheduled = scheduleCampaign(campaign, 'x', {
      scheduledAt: '2026-09-28T09:30:00+01:00',
      timezone: 'Africa/Lagos'
    }, { now: '2026-09-27T08:00:00.000Z' });
    assert.equal(scheduled.platform.x.schedule.scheduledAt, '2026-09-28T09:30:00+01:00');
    assert.equal(scheduled.platform.x.schedule.scheduledAtUtc, '2026-09-28T08:30:00.000Z');
    assert.equal(scheduled.platform.x.schedule.timezone, 'Africa/Lagos');
    assert.equal(scheduled.platform.x.lifecycleStatus, 'planned');
  } finally { store.close(); }
});

test('rescheduling unchanged approved content preserves exact approval and content hash', () => {
  const { store, campaign } = seed();
  try {
    const first = scheduleCampaign(campaign, 'x', {
      scheduledAt: '2026-09-28T08:00:00Z',
      timezone: 'UTC'
    });
    const second = scheduleCampaign(first, 'x', {
      scheduledAt: '2026-09-29T08:00:00Z',
      timezone: 'UTC'
    });
    assert.equal(second.version, campaign.version);
    assert.equal(second.contentHash, campaign.contentHash);
    assert.deepEqual(second.campaignApproval, campaign.campaignApproval);
    assert.equal(second.platform.x.schedule.scheduledAtUtc, '2026-09-29T08:00:00.000Z');
  } finally { store.close(); }
});

test('schedule state persists across store restart without a schema migration', () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-schedule-'));
  const filename = join(root, 'state.sqlite');
  const { store, campaign } = seed({ filename });
  const scheduled = scheduleCampaign(campaign, 'linkedin', {
    scheduledAt: '2026-09-28T12:00:00+01:00',
    timezone: 'Africa/Lagos'
  });
  store.updateCampaignState(scheduled);
  store.close();

  const reopened = new BipStore(filename);
  try {
    const loaded = reopened.getCampaign(campaign.id);
    assert.equal(loaded.platform.linkedin.schedule.scheduledAtUtc, '2026-09-28T11:00:00.000Z');
    assert.equal(loaded.platform.linkedin.lifecycleStatus, 'planned');
    assert.equal(loaded.campaignApproval.contentHash, campaign.contentHash);
  } finally { reopened.close(); }
});

test('due schedules are deterministic, per-platform, and expose overdue duration', () => {
  const { store, campaign } = seed();
  try {
    let scheduled = scheduleCampaign(campaign, 'linkedin', {
      scheduledAt: '2026-09-28T09:10:00Z',
      timezone: 'UTC'
    });
    scheduled = scheduleCampaign(scheduled, 'x', {
      scheduledAt: '2026-09-28T09:00:00Z',
      timezone: 'UTC'
    });
    const due = listDueSchedules([scheduled], { at: '2026-09-28T09:15:00Z' });
    assert.deepEqual(due.map((item) => item.platform), ['x', 'linkedin']);
    assert.equal(due[0].overdueByMs, 15 * 60 * 1000);
    assert.equal(due[1].overdueByMs, 5 * 60 * 1000);
    assert.equal(scheduleSnapshot(scheduled, 'x', { at: '2026-09-28T08:59:59Z' }).due, false);
  } finally { store.close(); }
});

test('editing scheduled content invalidates approval while keeping the future plan visible', () => {
  const { store, campaign } = seed();
  try {
    const scheduled = scheduleCampaign(campaign, 'x', {
      scheduledAt: '2026-09-28T09:00:00Z',
      timezone: 'UTC'
    });
    const edited = applyEditorial(scheduled, {
      x: { posts: scheduled.drafts.x.posts, claims: scheduled.drafts.x.claims },
      linkedin: { text: scheduled.drafts.linkedin.text, claims: scheduled.drafts.linkedin.claims }
    });
    assert.equal(edited.campaignApproval, null);
    assert.equal(edited.platform.x.schedule.scheduledAtUtc, '2026-09-28T09:00:00.000Z');
    assert.equal(edited.platform.x.lifecycleStatus, 'planned');
  } finally { store.close(); }
});

test('due scheduled execution fails closed when approval is stale or missing', async () => {
  const { store, campaign } = seed();
  try {
    const scheduled = scheduleCampaign(campaign, 'x', {
      scheduledAt: '2026-09-28T09:00:00Z',
      timezone: 'UTC'
    });
    const stale = structuredClone(scheduled);
    stale.campaignApproval = null;
    let called = false;
    const result = await executeScheduledHandoff(stale, 'x', {
      now: '2026-09-28T09:00:00Z',
      pag: { async createIntent() { called = true; return {}; } }
    });
    assert.equal(called, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureCode, 'approval_missing');
    assert.equal(result.campaign.platform.x.lifecycleStatus, 'failed');
    assert.equal(result.campaign.platform.x.schedule.status, 'failed');
  } finally { store.close(); }
});

test('scheduled PAG execution updates only the targeted platform lifecycle', async () => {
  const { store, campaign } = seed();
  try {
    let scheduled = scheduleCampaign(campaign, 'x', {
      scheduledAt: '2026-09-28T09:00:00Z',
      timezone: 'UTC'
    });
    scheduled = scheduleCampaign(scheduled, 'linkedin', {
      scheduledAt: '2026-09-29T09:00:00Z',
      timezone: 'UTC'
    });
    const result = await executeScheduledHandoff(scheduled, 'x', {
      now: '2026-09-28T09:00:00Z',
      pag: {
        async createIntent(capability) {
          assert.equal(capability, 'x.threads.create');
          return { id: 'int_schedule', status: 'succeeded', args_hash: 'hash_schedule', execution: { status: 'succeeded' } };
        }
      }
    });
    assert.equal(result.executed, true);
    assert.equal(result.campaign.platform.x.lifecycleStatus, 'published');
    assert.equal(result.campaign.platform.x.schedule.status, 'published');
    assert.equal(result.campaign.platform.linkedin.lifecycleStatus, 'planned');
    assert.equal(result.campaign.platform.linkedin.schedule.status, 'planned');
  } finally { store.close(); }
});

test('clearing a planned schedule restores approved lifecycle without changing approval', () => {
  const { store, campaign } = seed();
  try {
    const scheduled = scheduleCampaign(campaign, 'linkedin', {
      scheduledAt: '2026-09-28T09:00:00Z',
      timezone: 'UTC'
    });
    const cleared = clearCampaignSchedule(scheduled, 'linkedin');
    assert.equal(cleared.platform.linkedin.schedule, null);
    assert.equal(cleared.platform.linkedin.lifecycleStatus, 'approved');
    assert.equal(platformLifecycle(cleared, 'linkedin'), 'approved');
    assert.equal(cleared.contentHash, campaign.contentHash);
    assert.deepEqual(cleared.campaignApproval, campaign.campaignApproval);
  } finally { store.close(); }
});
