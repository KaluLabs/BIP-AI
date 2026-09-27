import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';

function createApp() {
  const store = new BipStore(':memory:');
  return { store, app: new BipAI({ store }) };
}

test('eligible event creates a campaign', () => {
  const { store, app } = createApp();
  const result = app.ingest({ projectId: 'bip-ai', type: 'feature', summary: 'Added ProjectEvent ingestion', userVisible: true, occurredAt: '2026-09-27T00:00:00.000Z' });
  assert.equal(result.accepted, true);
  assert.ok(result.campaign);
  assert.equal(result.campaign.platform.x.handoffStatus, 'not_requested');
  store.close();
});

test('duplicate event does not create another campaign', () => {
  const { store, app } = createApp();
  const event = { projectId: 'bip-ai', type: 'feature', summary: 'Added ProjectEvent ingestion', userVisible: true, occurredAt: '2026-09-27T00:00:00.000Z' };
  app.ingest(event);
  const second = app.ingest(event);
  assert.equal(second.duplicate, true);
  assert.equal(store.listCampaigns().length, 1);
  store.close();
});

test('low-storyworthiness event is stored without a campaign', () => {
  const { store, app } = createApp();
  const result = app.ingest({ projectId: 'bip-ai', type: 'note', summary: 'Renamed a local variable', occurredAt: '2026-09-27T00:00:00.000Z' });
  assert.equal(result.reason, 'below_story_threshold');
  assert.equal(store.listEvents().length, 1);
  assert.equal(store.listCampaigns().length, 0);
  store.close();
});

test('BLOCK privacy prevents draft generation', () => {
  const { store, app } = createApp();
  const result = app.ingest({ projectId: 'bip-ai', type: 'feature', summary: 'Private feature', userVisible: true, privacy: 'BLOCK', occurredAt: '2026-09-27T00:00:00.000Z' });
  assert.equal(result.reason, 'privacy_blocked');
  assert.equal(store.listCampaigns().length, 0);
  store.close();
});

test('REVIEW privacy creates a campaign that cannot be treated as ready', () => {
  const { store, app } = createApp();
  const result = app.ingest({ projectId: 'bip-ai', type: 'feature', summary: 'Needs human review', userVisible: true, privacy: 'REVIEW', occurredAt: '2026-09-27T00:00:00.000Z' });
  assert.equal(result.campaign.editorialStatus, 'needs_review');
  assert.equal(result.campaign.privacyResult, 'REVIEW');
  store.close();
});


test('stable external source ID deduplicates replay even if display text changes', () => {
  const { store, app } = createApp();
  const base = {
    projectId: 'bip-ai',
    type: 'milestone',
    source: 'github',
    occurredAt: '2026-09-27T10:00:00.000Z',
    metadata: { externalId: 'github-event-123' },
    userVisible: true
  };
  const first = app.ingest({ ...base, summary: 'Merged PR #7: old title' });
  const second = app.ingest({ ...base, summary: 'Merged PR #7: edited title' });
  assert.equal(first.accepted, true);
  assert.equal(second.duplicate, true);
  assert.equal(store.listEvents().length, 1);
  store.close();
});
