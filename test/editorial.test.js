import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { applyEditorial, approveCampaign, exportEditorial } from '../src/editorial.js';

function seed() {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  const result = app.ingest({
    projectId: 'bip-ai', type: 'feature', summary: 'Added editorial workflow',
    details: 'Added campaign versioning and review', userVisible: true,
    decisions: ['Keep approvals content-bound'], lessons: ['Editing must invalidate approval'],
    nextStep: 'Add PAG handoff', occurredAt: '2026-09-27T00:00:00.000Z'
  });
  return { store, campaign: result.campaign };
}

test('editorial import creates a new immutable campaign version', () => {
  const { store, campaign } = seed();
  const editorial = exportEditorial(campaign);
  const next = applyEditorial(campaign, { x: editorial.x, linkedin: editorial.linkedin });
  store.saveCampaignVersion(next);
  const versions = store.listCampaignVersions(campaign.id);
  assert.deepEqual(versions.map((v) => v.version), [1, 2]);
  assert.notEqual(versions[0].contentHash, versions[1].contentHash);
  store.close();
});

test('campaign approval binds version and content hash', () => {
  const { store, campaign } = seed();
  const approved = approveCampaign(campaign);
  store.updateCampaignState(approved);
  assert.equal(approved.campaignApproval.version, campaign.version);
  assert.equal(approved.campaignApproval.contentHash, campaign.contentHash);
  store.close();
});

test('editing an approved campaign invalidates approval and handoff state', () => {
  const { store, campaign } = seed();
  const approved = approveCampaign(campaign);
  const edited = applyEditorial(approved, {
    x: { posts: approved.drafts.x.posts, claims: approved.drafts.x.claims },
    linkedin: { text: approved.drafts.linkedin.text, claims: approved.drafts.linkedin.claims }
  });
  assert.equal(edited.version, 2);
  assert.equal(edited.campaignApproval, null);
  assert.equal(edited.platform.x.handoffStatus, 'not_requested');
  store.close();
});

test('oversized X post fails structural quality', () => {
  const { store, campaign } = seed();
  const edited = applyEditorial(campaign, { x: { posts: ['x'.repeat(281)] } });
  assert.equal(edited.structuralQuality.x.result, 'FAIL');
  assert.throws(() => approveCampaign(edited), /quality|structure/);
  store.close();
});

test('unsupported editorial claims are held for review', () => {
  const { store, campaign } = seed();
  const edited = applyEditorial(campaign, {
    x: { posts: ['We hit one million users.'], claims: [{ text: 'We hit one million users.', source: null }] }
  });
  assert.equal(edited.editorialQuality.x.result, 'REVIEW');
  assert.equal(edited.qualityResult, 'REVIEW');
  store.close();
});
