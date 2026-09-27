import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { approveCampaign } from '../src/editorial.js';
import { buildPagIntent, requestPagHandoff, reconcilePagHandoff } from '../src/handoff.js';
import { PagClient } from '../src/pag-client.js';

function approvedCampaign() {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  const result = app.ingest({
    projectId: 'bip-ai', type: 'feature', summary: 'Added PAG handoff',
    details: 'Added approval-gated publishing handoff', userVisible: true,
    nextStep: 'Dogfood handoff', occurredAt: '2026-09-27T00:00:00.000Z'
  });
  const campaign = approveCampaign(result.campaign);
  store.close();
  return campaign;
}

test('X handoff payload is exact and content-bound', () => {
  const campaign = approvedCampaign();
  const req = buildPagIntent(campaign, 'x', { connectionId: 'con_x' });
  assert.equal(req.capability, 'x.threads.create');
  assert.deepEqual(req.args.posts, campaign.drafts.x.posts);
  assert.equal(req.args.connectionId, 'con_x');
  assert.match(req.idempotencyKey, new RegExp(campaign.contentHash));
});

test('LinkedIn handoff uses the approved LinkedIn draft', () => {
  const campaign = approvedCampaign();
  const req = buildPagIntent(campaign, 'linkedin');
  assert.equal(req.capability, 'linkedin.posts.create');
  assert.equal(req.args.text, campaign.drafts.linkedin.text);
});

test('stale approval cannot request a handoff', () => {
  const campaign = approvedCampaign();
  campaign.version += 1;
  assert.throws(() => buildPagIntent(campaign, 'x'), /stale/);
});

test('PAG request stores independent platform state', async () => {
  const campaign = approvedCampaign();
  const pag = {
    async createIntent(capability, args, options) {
      assert.equal(capability, 'x.threads.create');
      assert.deepEqual(args.posts, campaign.drafts.x.posts);
      assert.ok(options.idempotencyKey);
      return {
        id: 'int_123', status: 'pending_approval', args_hash: 'hash_123',
        approval: { id: 'apr_123', args_hash: 'hash_123', state: 'pending' }
      };
    }
  };
  const { campaign: next } = await requestPagHandoff(campaign, 'x', { pag });
  assert.equal(next.platform.x.handoffStatus, 'pending_approval');
  assert.equal(next.platform.x.pagActionId, 'int_123');
  assert.equal(next.platform.linkedin.handoffStatus, 'not_requested');
  assert.equal(next.platform.x.submittedContentHash, campaign.contentHash);
});

test('deny is persisted as a denied handoff without bypass', async () => {
  const campaign = approvedCampaign();
  const pag = { async createIntent() { return { id: 'int_deny', status: 'denied', args_hash: 'denyhash', approval: null }; } };
  const { campaign: next } = await requestPagHandoff(campaign, 'linkedin', { pag });
  assert.equal(next.status, 'handoff_denied');
  assert.equal(next.platform.linkedin.handoffStatus, 'denied');
});

test('reconciliation refuses stale campaign state', async () => {
  const campaign = approvedCampaign();
  campaign.platform.x.pagActionId = 'int_123';
  campaign.platform.x.submittedVersion = campaign.version - 1;
  campaign.platform.x.submittedContentHash = campaign.contentHash;
  await assert.rejects(() => reconcilePagHandoff(campaign, 'x', { pag: { getIntent: async () => ({}) } }), /stale/);
});

test('reconciliation records successful browser handoff execution', async () => {
  const campaign = approvedCampaign();
  campaign.platform.x.pagActionId = 'int_123';
  campaign.platform.x.submittedVersion = campaign.version;
  campaign.platform.x.submittedContentHash = campaign.contentHash;
  const pag = { async getIntent() { return { id:'int_123', capability:'x.threads.create', status:'succeeded', args_hash:'h', approval:{id:'apr'}, execution:{status:'succeeded', result:{mode:'browser_handoff'}} }; } };
  const { campaign: next } = await reconcilePagHandoff(campaign, 'x', { pag });
  assert.equal(next.platform.x.handoffStatus, 'succeeded');
  assert.equal(next.status, 'handoff_succeeded');
});

test('PagClient sends actor bearer token and idempotency header', async () => {
  let seen;
  const client = new PagClient({ token: 'pag_test', baseUrl: 'http://pag.test', fetchImpl: async (url, options) => {
    seen = { url, options };
    return { ok: true, status: 201, async json() { return { id:'int_1', status:'pending_approval' }; } };
  }});
  await client.createIntent('x.threads.create', { posts:['hello'] }, { idempotencyKey:'idem-1' });
  assert.equal(seen.url, 'http://pag.test/v1/intents');
  assert.equal(seen.options.headers.authorization, 'Bearer pag_test');
  assert.equal(seen.options.headers['x-pag-idempotency-key'], 'idem-1');
});
