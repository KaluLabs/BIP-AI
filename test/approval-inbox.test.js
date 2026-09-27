import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { applyEditorial, approveCampaign, resolvePrivacyReview } from '../src/editorial.js';
import { scheduleCampaign } from '../src/scheduling.js';
import {
  buildApprovalInbox,
  exactCampaignVersion,
  parseApprovalInboxQuery,
  queryApprovalInbox,
  staleApprovalInfo
} from '../src/approval-inbox.js';

function seed({ projectId = 'alpha', privacy = 'PASS', summary = 'Ship approval inbox' } = {}) {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store, storyThreshold: 1 });
  const result = app.ingest({
    projectId,
    type: 'feature',
    summary,
    details: `${summary} with exact approval controls`,
    source: projectId === 'alpha' ? 'github' : 'manual',
    userVisible: privacy === 'PASS',
    privacy,
    nextStep: 'Review and ship',
    occurredAt: '2026-09-27T09:00:00.000Z'
  });
  return { store, campaign: result.campaign };
}

function inbox(store, now = '2026-09-27T12:00:00.000Z') {
  const campaigns = store.listCampaigns();
  return buildApprovalInbox({
    campaigns,
    events: store.listEvents(),
    versionsByCampaign: new Map(
      campaigns.map((campaign) => [campaign.id, store.listCampaignVersions(campaign.id)])
    ),
    now
  });
}

test('new PASS draft appears once as awaiting approval and disappears after exact approval', () => {
  const { store, campaign } = seed();
  try {
    const initial = inbox(store);
    assert.equal(initial.length, 1);
    assert.equal(initial[0].category, 'awaiting_approval');
    assert.equal(initial[0].campaignVersion, campaign.version);
    assert.equal(initial[0].canApprove, true);
    assert.equal(initial[0].source, 'github');
    assert.equal(initial[0].provenance.eventId, campaign.eventId);

    const approved = approveCampaign(campaign);
    store.updateCampaignState(approved);
    assert.equal(inbox(store).length, 0);
  } finally { store.close(); }
});

test('editing an approved campaign yields one stale approval item instead of a second awaiting item', () => {
  const { store, campaign } = seed();
  try {
    const approved = approveCampaign(campaign);
    store.updateCampaignState(approved);

    const edited = applyEditorial(approved, {
      x: { posts: approved.drafts.x.posts, claims: approved.drafts.x.claims },
      linkedin: { text: approved.drafts.linkedin.text, claims: approved.drafts.linkedin.claims }
    });
    store.saveCampaignVersion(edited);

    const items = inbox(store);
    assert.deepEqual(items.map((item) => item.category), ['stale_approval']);
    assert.equal(items[0].details.approvedVersion, 1);
    assert.match(items[0].reason, /version 1/);
    assert.equal(items[0].canApprove, true);

    const info = staleApprovalInfo(edited, store.listCampaignVersions(edited.id));
    assert.equal(info.stale, true);

    store.updateCampaignState(approveCampaign(edited));
    assert.equal(inbox(store).length, 0);
  } finally { store.close(); }
});

test('privacy REVIEW is a separate queue state and unrelated editorial actions cannot turn it into PASS', () => {
  const { store, campaign } = seed({ privacy: 'REVIEW' });
  try {
    const items = inbox(store);
    assert.equal(items.length, 1);
    assert.equal(items[0].category, 'privacy_review');
    assert.equal(items[0].canApprove, false);
    assert.throws(() => approveCampaign(campaign), /privacy is REVIEW/);

    const edited = applyEditorial(campaign, {
      x: { posts: campaign.drafts.x.posts, claims: campaign.drafts.x.claims }
    });
    assert.equal(edited.privacyResult, 'REVIEW');
    assert.throws(() => approveCampaign(edited), /privacy is REVIEW/);

    const resolved = resolvePrivacyReview(campaign, {
      decision: 'PASS',
      note: 'Reviewed the captured evidence and approved it for public use.',
      reviewedAt: '2026-09-27T11:00:00.000Z'
    });
    store.saveCampaignVersion(resolved);
    assert.equal(resolved.version, 2);
    assert.equal(resolved.privacyResult, 'PASS');
    assert.equal(resolved.privacyReview.from, 'REVIEW');
    assert.equal(resolved.campaignApproval, null);

    const after = inbox(store);
    assert.equal(after.length, 1);
    assert.equal(after[0].category, 'awaiting_approval');
    assert.equal(after[0].campaignVersion, 2);
  } finally { store.close(); }
});

test('privacy BLOCK resolution removes the privacy item without creating an approval item', () => {
  const { store, campaign } = seed({ privacy: 'REVIEW' });
  try {
    const blocked = resolvePrivacyReview(campaign, {
      decision: 'BLOCK',
      note: 'Contains internal information that should not be published.',
      reviewedAt: '2026-09-27T11:00:00.000Z'
    });
    store.saveCampaignVersion(blocked);
    assert.equal(blocked.privacyResult, 'BLOCK');
    assert.deepEqual(inbox(store), []);
  } finally { store.close(); }
});

test('PAG denied and failed states are isolated per platform and appear exactly once', () => {
  const { store, campaign } = seed();
  try {
    const next = approveCampaign(campaign);
    next.platform.x.handoffStatus = 'denied';
    next.platform.x.pagStatus = 'denied';
    next.platform.x.pagActionId = 'x-denied';
    next.platform.linkedin.handoffStatus = 'failed';
    next.platform.linkedin.pagStatus = 'failed';
    next.platform.linkedin.pagActionId = 'li-failed';
    next.updatedAt = '2026-09-27T10:00:00.000Z';
    store.updateCampaignState(next);

    const items = inbox(store);
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((item) => [item.category, item.platform]).sort(),
      [['handoff_denied', 'x'], ['handoff_failed', 'linkedin']].sort()
    );
    assert.equal(new Set(items.map((item) => item.id)).size, 2);
  } finally { store.close(); }
});

test('scheduled content with invalidated approval gets distinct stale and platform-blocked attention', () => {
  const { store, campaign } = seed();
  try {
    const approved = approveCampaign(campaign);
    const scheduled = scheduleCampaign(approved, 'x', {
      scheduledAt: '2026-09-28T09:00:00Z',
      timezone: 'UTC'
    }, { now: '2026-09-27T09:30:00.000Z' });
    store.updateCampaignState(scheduled);

    const edited = applyEditorial(scheduled, {
      x: { posts: scheduled.drafts.x.posts, claims: scheduled.drafts.x.claims },
      linkedin: { text: scheduled.drafts.linkedin.text, claims: scheduled.drafts.linkedin.claims }
    });
    store.saveCampaignVersion(edited);

    const items = inbox(store);
    assert.deepEqual(items.map((item) => item.category), ['schedule_blocked', 'stale_approval']);
    const blocked = items.find((item) => item.category === 'schedule_blocked');
    assert.equal(blocked.platform, 'x');
    assert.equal(blocked.details.scheduledAtUtc, '2026-09-28T09:00:00.000Z');
    assert.match(blocked.reason, /approval/i);
  } finally { store.close(); }
});

test('approval inbox query composes project platform source status category search and age ordering', () => {
  const a = seed({ projectId: 'alpha', summary: 'Alpha inbox' });
  const b = seed({ projectId: 'beta', summary: 'Beta inbox' });
  try {
    let alpha = scheduleCampaign(a.campaign, 'x', {
      scheduledAt: '2026-09-28T09:00:00Z',
      timezone: 'UTC'
    }, { now: '2026-09-27T09:00:00.000Z' });
    alpha.updatedAt = '2026-09-27T09:00:00.000Z';
    a.store.updateCampaignState(alpha);

    const items = [
      ...inbox(a.store, '2026-09-27T12:00:00.000Z'),
      ...inbox(b.store, '2026-09-27T12:00:00.000Z')
    ];
    const query = parseApprovalInboxQuery(new URLSearchParams({
      q: 'Alpha',
      projectId: 'alpha',
      source: 'github',
      platform: 'x',
      status: 'planned',
      category: 'schedule_blocked',
      sort: 'age',
      order: 'desc',
      pageSize: '10'
    }));
    const result = queryApprovalInbox(items, query);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].projectId, 'alpha');
    assert.equal(result.items[0].category, 'schedule_blocked');
    assert.equal(result.summary.total, 1);
  } finally {
    a.store.close();
    b.store.close();
  }
});

test('priority sorting uses age as deterministic tie breaker', () => {
  const base = {
    projectId: 'p',
    campaignId: 'c',
    campaignVersion: 1,
    campaignContentHash: 'h',
    eventId: 'e',
    platform: null,
    privacy: 'PASS',
    source: 'manual',
    status: 'awaiting_approval',
    statuses: [],
    category: 'awaiting_approval',
    priority: 50,
    ageMs: 0,
    title: 't',
    reason: 'r',
    provenance: null
  };
  const items = [
    { ...base, id: 'newer', attentionAt: '2026-09-27T11:00:00.000Z' },
    { ...base, id: 'older', attentionAt: '2026-09-27T09:00:00.000Z' }
  ];
  const result = queryApprovalInbox(items, parseApprovalInboxQuery(new URLSearchParams()));
  assert.deepEqual(result.items.map((item) => item.id), ['older', 'newer']);
});

test('exact campaign precondition rejects stale inbox actions', () => {
  const { store, campaign } = seed();
  try {
    assert.equal(exactCampaignVersion(campaign, {
      version: campaign.version,
      contentHash: campaign.contentHash
    }), campaign);
    assert.throws(() => exactCampaignVersion(campaign, {
      version: campaign.version + 1,
      contentHash: campaign.contentHash
    }), /refresh the approval inbox/);
  } finally { store.close(); }
});
