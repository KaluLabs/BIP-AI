import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { applyEditorial, approveCampaign } from '../src/editorial.js';
import {
  publishingHistory,
  reconcilePublishingAttempt,
  requestPublishingHandoff,
  retryPublishingHandoff
} from '../src/publishing-history.js';

function seed({ filename = ':memory:' } = {}) {
  const store = new BipStore(filename);
  const app = new BipAI({ store, storyThreshold: 1 });
  const result = app.ingest({
    projectId: 'bip-ai',
    type: 'feature',
    summary: 'Ship publishing history',
    details: 'Add append-only publishing history and safe retries',
    userVisible: true,
    nextStep: 'Publish safely',
    occurredAt: '2026-09-27T10:00:00.000Z'
  });
  const approved = approveCampaign(result.campaign);
  store.updateCampaignState(approved);
  return { store, campaign: approved };
}

test('publishing journal is durable and database-enforced append-only', () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-pub-journal-'));
  const filename = join(root, 'state.sqlite');
  const { store, campaign } = seed({ filename });
  store.appendPublishingJournal({
    id: 'entry-1',
    attemptId: 'attempt-1',
    campaignId: campaign.id,
    projectId: campaign.projectId,
    platform: 'x',
    campaignVersion: campaign.version,
    contentHash: campaign.contentHash,
    attemptNumber: 1,
    eventType: 'attempt_started',
    status: 'requested',
    retryable: false,
    retryOf: null,
    idempotencyKey: 'idem-1',
    createdAt: '2026-09-27T10:01:00.000Z'
  });
  assert.throws(
    () => store.db.prepare('UPDATE publishing_journal SET status = ? WHERE id = ?').run('completed', 'entry-1'),
    /append-only/
  );
  assert.throws(
    () => store.db.prepare('DELETE FROM publishing_journal WHERE id = ?').run('entry-1'),
    /append-only/
  );
  store.close();

  const reopened = new BipStore(filename);
  try {
    const rows = reopened.listPublishingJournal({ campaignId: campaign.id });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'requested');
    assert.equal(rows[0].contentHash, campaign.contentHash);
  } finally { reopened.close(); }
});

test('every successful PAG request records requested and outcome entries with exact payload identity', async () => {
  const { store, campaign } = seed();
  try {
    const result = await requestPublishingHandoff(store, campaign, 'x', {
      pag: {
        async createIntent(capability, args, { idempotencyKey }) {
          assert.equal(capability, 'x.threads.create');
          assert.deepEqual(args.posts, campaign.drafts.x.posts);
          assert.match(idempotencyKey, new RegExp(campaign.contentHash));
          return {
            id: 'int-success',
            status: 'succeeded',
            args_hash: 'args-success',
            execution: { status: 'succeeded', result: { mode: 'browser_handoff', id: 'post-123' } }
          };
        }
      },
      now: '2026-09-27T10:02:00.000Z'
    });

    assert.equal(result.attempt.status, 'completed');
    assert.equal(result.campaign.platform.x.handoffStatus, 'succeeded');
    const rows = store.getPublishingAttempt(result.attempt.attemptId);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.eventType), ['attempt_started', 'pag_result']);
    assert.ok(rows.every((row) => row.campaignVersion === campaign.version));
    assert.ok(rows.every((row) => row.contentHash === campaign.contentHash));
    assert.equal(rows[1].receipt.executionStatus, 'succeeded');
    assert.equal(rows[1].receipt.externalId, 'post-123');
  } finally { store.close(); }
});

test('transport failure is journaled as retryable before the request error escapes', async () => {
  const { store, campaign } = seed();
  try {
    await assert.rejects(
      () => requestPublishingHandoff(store, campaign, 'x', {
        pag: {
          async createIntent() {
            const error = new Error('temporary outage');
            error.status = 503;
            throw error;
          }
        }
      }),
      /temporary outage/
    );

    const attempts = publishingHistory(store, { campaignId: campaign.id, platform: 'x' });
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].status, 'retryable');
    assert.equal(attempts[0].retryable, true);
    assert.equal(attempts[0].errorCode, 'pag_http_503');
    assert.equal(attempts[0].events.length, 2);
    assert.equal(store.getCampaign(campaign.id).platform.x.handoffStatus, 'not_requested');
  } finally { store.close(); }
});

test('duplicate retry requests reuse one deterministic child attempt and one PAG execution', async () => {
  const { store, campaign } = seed();
  try {
    const failed = await requestPublishingHandoff(store, campaign, 'x', {
      pag: { async createIntent() { return { id: 'int-fail', status: 'failed', args_hash: 'h1' }; } }
    });
    assert.equal(failed.attempt.retryable, true);

    let retryCalls = 0;
    const pag = {
      async createIntent(capability, args, { idempotencyKey }) {
        retryCalls += 1;
        assert.match(idempotencyKey, /:retry:/);
        return {
          id: 'int-retry-success',
          status: 'succeeded',
          args_hash: 'h2',
          execution: { status: 'succeeded' }
        };
      }
    };

    const current = store.getCampaign(campaign.id);
    const first = await retryPublishingHandoff(store, current, 'x', {
      pag,
      attemptId: failed.attempt.attemptId
    });
    const second = await retryPublishingHandoff(store, store.getCampaign(campaign.id), 'x', {
      pag,
      attemptId: failed.attempt.attemptId
    });

    assert.equal(retryCalls, 1);
    assert.equal(first.attempt.attemptId, second.attempt.attemptId);
    assert.equal(second.reused, true);
    assert.equal(first.attempt.retryOf, failed.attempt.attemptId);
    assert.equal(first.attempt.attemptNumber, 2);
    assert.equal(first.attempt.status, 'completed');
    assert.equal(publishingHistory(store, { campaignId: campaign.id, platform: 'x' }).length, 2);
  } finally { store.close(); }
});

test('terminal PAG denial cannot be retried', async () => {
  const { store, campaign } = seed();
  try {
    const denied = await requestPublishingHandoff(store, campaign, 'linkedin', {
      pag: { async createIntent() { return { id: 'int-denied', status: 'denied', args_hash: 'deny' }; } }
    });
    assert.equal(denied.attempt.status, 'denied');
    assert.equal(denied.attempt.retryable, false);

    await assert.rejects(
      () => retryPublishingHandoff(store, store.getCampaign(campaign.id), 'linkedin', {
        pag: { async createIntent() { throw new Error('must not be called'); } },
        attemptId: denied.attempt.attemptId
      }),
      /denial is terminal/
    );
  } finally { store.close(); }
});

test('changed content cannot reuse an old retryable attempt or old approval', async () => {
  const { store, campaign } = seed();
  try {
    const failed = await requestPublishingHandoff(store, campaign, 'x', {
      pag: { async createIntent() { return { id: 'int-old', status: 'failed', args_hash: 'old' }; } }
    });
    const current = store.getCampaign(campaign.id);
    const edited = applyEditorial(current, {
      x: { posts: current.drafts.x.posts, claims: current.drafts.x.claims },
      linkedin: { text: current.drafts.linkedin.text, claims: current.drafts.linkedin.claims }
    });
    store.saveCampaignVersion(edited);

    await assert.rejects(
      () => retryPublishingHandoff(store, edited, 'x', {
        pag: { async createIntent() { throw new Error('must not be called'); } },
        attemptId: failed.attempt.attemptId
      }),
      /campaign changed/
    );
    assert.equal(store.getCampaign(campaign.id).campaignApproval, null);
  } finally { store.close(); }
});

test('PAG receipt reconciliation survives store restart and repairs current campaign state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-pub-restart-'));
  const filename = join(root, 'state.sqlite');
  const { store, campaign } = seed({ filename });
  const pending = await requestPublishingHandoff(store, campaign, 'x', {
    pag: {
      async createIntent() {
        return {
          id: 'int-pending',
          status: 'pending_approval',
          args_hash: 'pending-hash',
          approval: { id: 'apr-pending', args_hash: 'pending-hash' }
        };
      }
    }
  });
  store.close();

  const reopened = new BipStore(filename);
  try {
    const current = reopened.getCampaign(campaign.id);
    const result = await reconcilePublishingAttempt(reopened, current, 'x', {
      attemptId: pending.attempt.attemptId,
      pag: {
        async getIntent(id) {
          assert.equal(id, 'int-pending');
          return {
            id,
            capability: 'x.threads.create',
            status: 'succeeded',
            args_hash: 'pending-hash',
            approval: { id: 'apr-pending' },
            execution: { status: 'succeeded', result: { mode: 'browser_handoff' } }
          };
        }
      }
    });

    assert.equal(result.campaignUpdated, true);
    assert.equal(result.attempt.status, 'completed');
    assert.equal(result.attempt.events.at(-1).eventType, 'reconciled');
    assert.equal(reopened.getCampaign(campaign.id).platform.x.handoffStatus, 'succeeded');
  } finally { reopened.close(); }
});

test('reconciling an old attempt after campaign changes records history without mutating the newer campaign', async () => {
  const { store, campaign } = seed();
  try {
    const pending = await requestPublishingHandoff(store, campaign, 'x', {
      pag: { async createIntent() { return { id: 'int-old-pending', status: 'pending_approval', args_hash: 'h' }; } }
    });
    const current = store.getCampaign(campaign.id);
    const edited = applyEditorial(current, {
      x: { posts: current.drafts.x.posts, claims: current.drafts.x.claims },
      linkedin: { text: current.drafts.linkedin.text, claims: current.drafts.linkedin.claims }
    });
    store.saveCampaignVersion(edited);

    const result = await reconcilePublishingAttempt(store, edited, 'x', {
      attemptId: pending.attempt.attemptId,
      pag: {
        async getIntent() {
          return { id: 'int-old-pending', status: 'succeeded', args_hash: 'h', execution: { status: 'succeeded' } };
        }
      }
    });
    assert.equal(result.campaignUpdated, false);
    assert.equal(result.attempt.status, 'completed');
    assert.equal(store.getCampaign(campaign.id).version, edited.version);
    assert.equal(store.getCampaign(campaign.id).campaignApproval, null);
  } finally { store.close(); }
});

test('mixed platform outcomes stay independent across retry', async () => {
  const { store, campaign } = seed();
  try {
    await requestPublishingHandoff(store, campaign, 'x', {
      pag: { async createIntent() { return { id: 'x-ok', status: 'succeeded', args_hash: 'x' }; } }
    });
    const afterX = store.getCampaign(campaign.id);
    const linkedIn = await requestPublishingHandoff(store, afterX, 'linkedin', {
      pag: { async createIntent() { return { id: 'li-fail', status: 'failed', args_hash: 'li1' }; } }
    });
    assert.equal(store.getCampaign(campaign.id).platform.x.handoffStatus, 'succeeded');
    assert.equal(store.getCampaign(campaign.id).platform.linkedin.handoffStatus, 'failed');

    await retryPublishingHandoff(store, store.getCampaign(campaign.id), 'linkedin', {
      attemptId: linkedIn.attempt.attemptId,
      pag: { async createIntent() { return { id: 'li-ok', status: 'succeeded', args_hash: 'li2' }; } }
    });
    const final = store.getCampaign(campaign.id);
    assert.equal(final.platform.x.handoffStatus, 'succeeded');
    assert.equal(final.platform.linkedin.handoffStatus, 'succeeded');
    assert.equal(publishingHistory(store, { campaignId: campaign.id, platform: 'x' }).length, 1);
    assert.equal(publishingHistory(store, { campaignId: campaign.id, platform: 'linkedin' }).length, 2);
  } finally { store.close(); }
});


test('reconciling an older attempt cannot regress a newer successful retry on the same payload', async () => {
  const { store, campaign } = seed();
  try {
    const failed = await requestPublishingHandoff(store, campaign, 'x', {
      pag: { async createIntent() { return { id: 'int-old-failed', status: 'failed', args_hash: 'old' }; } }
    });
    const retried = await retryPublishingHandoff(store, store.getCampaign(campaign.id), 'x', {
      attemptId: failed.attempt.attemptId,
      pag: {
        async createIntent() {
          return {
            id: 'int-new-success',
            status: 'succeeded',
            args_hash: 'new',
            execution: { status: 'succeeded' }
          };
        }
      }
    });
    assert.equal(retried.campaign.platform.x.pagActionId, 'int-new-success');
    assert.equal(store.getCampaign(campaign.id).platform.x.handoffStatus, 'succeeded');

    const oldReceipt = await reconcilePublishingAttempt(store, store.getCampaign(campaign.id), 'x', {
      attemptId: failed.attempt.attemptId,
      pag: {
        async getIntent(id) {
          assert.equal(id, 'int-old-failed');
          return { id, status: 'failed', args_hash: 'old' };
        }
      }
    });

    assert.equal(oldReceipt.campaignUpdated, false);
    assert.equal(oldReceipt.attempt.status, 'retryable');
    const current = store.getCampaign(campaign.id);
    assert.equal(current.platform.x.handoffStatus, 'succeeded');
    assert.equal(current.platform.x.pagActionId, 'int-new-success');
  } finally { store.close(); }
});
