import { createHash, randomUUID } from 'node:crypto';
import {
  assertHandoffReady,
  buildPagIntent,
  reconcilePagHandoff,
  requestPagHandoff
} from './handoff.js';

const PLATFORM = new Set(['x', 'linkedin']);

function digest(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function nowIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('invalid publishing timestamp');
  return date.toISOString();
}

function assertPlatform(platform) {
  if (!PLATFORM.has(platform)) throw new TypeError(`unsupported platform: ${platform}`);
}

function initialAttemptId(campaign, platform) {
  return `pub_${digest(`${campaign.id}:${platform}:v${campaign.version}:${campaign.contentHash}:initial`)}`;
}

function retryAttemptId(priorAttemptId) {
  return `pub_${digest(`retry:${priorAttemptId}`)}`;
}

function retryIdempotencyKey(campaign, platform, priorAttemptId) {
  const base = buildPagIntent(campaign, platform).idempotencyKey;
  return `${base}:retry:${digest(priorAttemptId)}`;
}

function receiptFromIntent(intent) {
  const execution = intent?.execution;
  if (!execution || typeof execution !== 'object') return null;
  const result = execution.result && typeof execution.result === 'object' ? execution.result : null;
  return {
    executionStatus: execution.status || null,
    resultMode: result?.mode || null,
    externalId: result?.id || result?.postId || result?.threadId || null
  };
}

export function publishingOutcome(intent) {
  const status = String(intent?.status || 'unknown');
  if (status === 'pending_approval') return { status: 'accepted', retryable: false };
  if (['authorized', 'approved', 'executing'].includes(status)) return { status: 'handed_off', retryable: false };
  if (status === 'succeeded') return { status: 'completed', retryable: false };
  if (status === 'denied') return { status: 'denied', retryable: false };
  if (['failed', 'expired'].includes(status)) return { status: 'retryable', retryable: true };
  return { status: 'failed', retryable: false };
}

export function classifyPublishingError(error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  const retryable = status == null || status === 408 || status === 429 || status >= 500;
  return {
    status: retryable ? 'retryable' : 'failed',
    retryable,
    errorCode: status ? `pag_http_${status}` : 'pag_transport_error'
  };
}

function entryBase({
  campaign,
  platform,
  attemptId,
  attemptNumber,
  retryOf = null,
  idempotencyKey,
  createdAt
}) {
  return {
    attemptId,
    campaignId: campaign.id,
    projectId: campaign.projectId,
    platform,
    campaignVersion: campaign.version,
    contentHash: campaign.contentHash,
    attemptNumber,
    retryOf,
    idempotencyKey,
    createdAt
  };
}

function appendStarted(store, base) {
  return store.appendPublishingJournal({
    id: randomUUID(),
    ...base,
    eventType: 'attempt_started',
    status: 'requested',
    retryable: false
  });
}

function appendIntentOutcome(store, base, intent, eventType = 'pag_result') {
  const outcome = publishingOutcome(intent);
  return store.appendPublishingJournal({
    id: randomUUID(),
    ...base,
    eventType,
    status: outcome.status,
    retryable: outcome.retryable,
    pagIntentId: intent?.id || null,
    pagApprovalId: intent?.approval?.id || null,
    pagStatus: intent?.status || null,
    argsHash: intent?.args_hash || intent?.approval?.args_hash || null,
    receipt: receiptFromIntent(intent)
  });
}

function appendError(store, base, error) {
  const outcome = classifyPublishingError(error);
  return store.appendPublishingJournal({
    id: randomUUID(),
    ...base,
    eventType: 'request_failed',
    status: outcome.status,
    retryable: outcome.retryable,
    errorCode: outcome.errorCode
  });
}

export function summarizePublishingAttempts(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.attemptId)) groups.set(entry.attemptId, []);
    groups.get(entry.attemptId).push(entry);
  }

  const attempts = [];
  for (const [attemptId, group] of groups) {
    const events = [...group].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    );
    const first = events[0];
    const last = events[events.length - 1];
    attempts.push({
      attemptId,
      campaignId: first.campaignId,
      projectId: first.projectId,
      platform: first.platform,
      campaignVersion: first.campaignVersion,
      contentHash: first.contentHash,
      attemptNumber: first.attemptNumber,
      retryOf: first.retryOf || null,
      idempotencyKey: first.idempotencyKey,
      status: last.status,
      retryable: Boolean(last.retryable),
      pagIntentId: [...events].reverse().find((entry) => entry.pagIntentId)?.pagIntentId || null,
      pagApprovalId: [...events].reverse().find((entry) => entry.pagApprovalId)?.pagApprovalId || null,
      pagStatus: [...events].reverse().find((entry) => entry.pagStatus)?.pagStatus || null,
      argsHash: [...events].reverse().find((entry) => entry.argsHash)?.argsHash || null,
      receipt: [...events].reverse().find((entry) => entry.receipt)?.receipt || null,
      errorCode: last.errorCode || null,
      startedAt: first.createdAt,
      updatedAt: last.createdAt,
      events
    });
  }

  return attempts.sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt) ||
    b.attemptNumber - a.attemptNumber ||
    a.attemptId.localeCompare(b.attemptId)
  );
}

export function publishingHistory(store, { campaignId, platform = null } = {}) {
  if (!store) throw new TypeError('store is required');
  if (!campaignId) throw new TypeError('campaignId is required');
  assertPlatform(platform || 'x');
  const entries = store.listPublishingJournal({ campaignId, platform });
  return summarizePublishingAttempts(entries);
}

function exactAttempt(attempts, attemptId) {
  const attempt = attempts.find((item) => item.attemptId === attemptId);
  if (!attempt) {
    const error = new Error('publishing attempt not found');
    error.statusCode = 404;
    throw error;
  }
  return attempt;
}

function assertExactCurrentCampaign(campaign, attempt) {
  if (
    campaign.version !== attempt.campaignVersion ||
    campaign.contentHash !== attempt.contentHash
  ) {
    const error = new Error('campaign changed; old publishing attempt cannot be retried');
    error.statusCode = 409;
    throw error;
  }
  assertHandoffReady(campaign);
}

async function executeAttempt({
  store,
  campaign,
  platform,
  pag,
  connectionId = null,
  attemptId,
  attemptNumber,
  retryOf = null,
  idempotencyKey,
  now = new Date()
}) {
  const createdAt = nowIso(now);
  const base = entryBase({
    campaign,
    platform,
    attemptId,
    attemptNumber,
    retryOf,
    idempotencyKey,
    createdAt
  });

  const existing = summarizePublishingAttempts(store.getPublishingAttempt(attemptId));
  if (existing.length && existing[0].events.length > 1) {
    return {
      campaign,
      attempt: existing[0],
      reused: true,
      intent: null,
      request: null
    };
  }
  if (!existing.length) appendStarted(store, base);

  try {
    const result = await requestPagHandoff(campaign, platform, {
      pag,
      connectionId,
      idempotencyKey
    });
    appendIntentOutcome(store, base, result.intent);
    store.updateCampaignState(result.campaign);
    const attempt = summarizePublishingAttempts(store.getPublishingAttempt(attemptId))[0];
    return { ...result, attempt, reused: false };
  } catch (error) {
    appendError(store, base, error);
    throw error;
  }
}

export async function requestPublishingHandoff(store, campaign, platform, {
  pag,
  connectionId = null,
  now = new Date()
} = {}) {
  if (!store) throw new TypeError('store is required');
  assertPlatform(platform);
  assertHandoffReady(campaign);
  const request = buildPagIntent(campaign, platform, { connectionId });
  return executeAttempt({
    store,
    campaign,
    platform,
    pag,
    connectionId,
    attemptId: initialAttemptId(campaign, platform),
    attemptNumber: 1,
    retryOf: null,
    idempotencyKey: request.idempotencyKey,
    now
  });
}

export async function retryPublishingHandoff(store, campaign, platform, {
  pag,
  attemptId,
  connectionId = null,
  now = new Date()
} = {}) {
  if (!store) throw new TypeError('store is required');
  assertPlatform(platform);
  if (!attemptId) throw new TypeError('attemptId is required');

  const attempts = publishingHistory(store, { campaignId: campaign.id, platform });
  const prior = exactAttempt(attempts, attemptId);
  if (prior.platform !== platform) throw new TypeError('publishing attempt platform mismatch');
  if (!prior.retryable) {
    const error = new Error(prior.status === 'denied'
      ? 'PAG denial is terminal and cannot be retried'
      : 'publishing attempt is not retryable');
    error.statusCode = 409;
    throw error;
  }
  assertExactCurrentCampaign(campaign, prior);

  const childId = retryAttemptId(prior.attemptId);
  const existingChild = attempts.find((item) => item.attemptId === childId);
  if (existingChild && existingChild.events.length > 1) {
    return { campaign, attempt: existingChild, reused: true, intent: null, request: null };
  }

  return executeAttempt({
    store,
    campaign,
    platform,
    pag,
    connectionId,
    attemptId: childId,
    attemptNumber: prior.attemptNumber + 1,
    retryOf: prior.attemptId,
    idempotencyKey: retryIdempotencyKey(campaign, platform, prior.attemptId),
    now
  });
}

export async function reconcilePublishingAttempt(store, campaign, platform, {
  pag,
  attemptId,
  now = new Date()
} = {}) {
  if (!store) throw new TypeError('store is required');
  assertPlatform(platform);
  if (!attemptId) throw new TypeError('attemptId is required');
  if (!pag || typeof pag.getIntent !== 'function') throw new TypeError('PAG client is required');

  const attempts = publishingHistory(store, { campaignId: campaign.id, platform });
  const attempt = exactAttempt(attempts, attemptId);
  if (!attempt.pagIntentId) {
    const error = new Error('publishing attempt has no PAG intent to reconcile');
    error.statusCode = 409;
    throw error;
  }

  const intent = await pag.getIntent(attempt.pagIntentId);
  const base = entryBase({
    campaign: {
      ...campaign,
      version: attempt.campaignVersion,
      contentHash: attempt.contentHash
    },
    platform,
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    retryOf: attempt.retryOf,
    idempotencyKey: attempt.idempotencyKey,
    createdAt: nowIso(now)
  });
  appendIntentOutcome(store, base, intent, 'reconciled');

  let nextCampaign = campaign;
  const matchesCurrent =
    campaign.version === attempt.campaignVersion &&
    campaign.contentHash === attempt.contentHash;

  if (matchesCurrent) {
    const result = await reconcilePagHandoff(campaign, platform, {
      pag: { getIntent: async () => intent },
      pagIntentId: attempt.pagIntentId
    });
    nextCampaign = result.campaign;
    store.updateCampaignState(nextCampaign);
  }

  return {
    campaign: nextCampaign,
    intent,
    attempt: summarizePublishingAttempts(store.getPublishingAttempt(attemptId))[0],
    campaignUpdated: matchesCurrent
  };
}

export function decorateRetryEligibility(campaign, attempts = []) {
  return attempts.map((attempt) => ({
    ...attempt,
    retryEligible: Boolean(
      attempt.retryable &&
      campaign &&
      campaign.version === attempt.campaignVersion &&
      campaign.contentHash === attempt.contentHash &&
      campaign.campaignApproval?.version === campaign.version &&
      campaign.campaignApproval?.contentHash === campaign.contentHash &&
      campaign.privacyResult === 'PASS'
    )
  }));
}
