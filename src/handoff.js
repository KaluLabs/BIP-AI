const PLATFORM = {
  x: { capability: 'x.threads.create' },
  linkedin: { capability: 'linkedin.posts.create' }
};

function syncLifecycle(target) {
  if (!target) return;
  const status = target.handoffStatus;
  if (status === 'succeeded') {
    target.lifecycleStatus = 'published';
    if (target.schedule) target.schedule = { ...target.schedule, status: 'published', lastError: null };
    return;
  }
  if (['failed', 'denied', 'expired'].includes(status)) {
    target.lifecycleStatus = 'failed';
    if (target.schedule) target.schedule = { ...target.schedule, status: 'failed', lastError: `pag_${status}` };
    return;
  }
  if (['pending_approval', 'authorized', 'approved', 'executing'].includes(status)) {
    target.lifecycleStatus = 'handed_off';
    if (target.schedule) target.schedule = { ...target.schedule, status: 'handed_off', lastError: null };
  }
}

export function assertHandoffReady(campaign) {
  if (!campaign) throw new TypeError('campaign is required');
  if (campaign.privacyResult !== 'PASS') throw new Error(`campaign privacy is ${campaign.privacyResult}`);
  if (campaign.qualityResult && campaign.qualityResult !== 'PASS') throw new Error('campaign quality is not PASS');
  if (campaign.editorialStatus !== 'approved_for_handoff') throw new Error('campaign is not approved for handoff');
  const approval = campaign.campaignApproval;
  if (!approval) throw new Error('campaign approval is missing');
  if (approval.version !== campaign.version || approval.contentHash !== campaign.contentHash) {
    throw new Error('campaign approval is stale for the current version/content hash');
  }
  return true;
}

export function buildPagIntent(campaign, platform, { connectionId = null } = {}) {
  assertHandoffReady(campaign);
  const spec = PLATFORM[platform];
  if (!spec) throw new Error(`unsupported platform: ${platform}`);

  let args;
  if (platform === 'x') {
    args = { posts: campaign.drafts.x.posts };
  } else {
    args = { text: campaign.drafts.linkedin.text };
  }
  if (connectionId) args.connectionId = connectionId;

  return {
    capability: spec.capability,
    args,
    idempotencyKey: `bip-ai:${campaign.id}:${platform}:v${campaign.version}:${campaign.contentHash}`
  };
}

export function applyPagIntent(campaign, platform, intent, { capability = null } = {}) {
  if (!campaign) throw new TypeError('campaign is required');
  const spec = PLATFORM[platform];
  if (!spec) throw new Error(`unsupported platform: ${platform}`);
  const next = structuredClone(campaign);
  const approval = intent?.approval || null;
  const target = next.platform?.[platform];
  if (!target) throw new Error(`campaign has no ${platform} platform state`);

  target.handoffStatus = mapIntentStatus(intent?.status);
  target.pagActionId = intent?.id || target.pagActionId || null;
  target.pagApprovalId = approval?.id || target.pagApprovalId || null;
  target.submittedVersion = next.version;
  target.submittedContentHash = next.contentHash;
  target.pagArgsHash = intent?.args_hash || approval?.args_hash || target.pagArgsHash || null;
  target.pagStatus = intent?.status || null;
  if (intent?.execution) target.execution = intent.execution;
  syncLifecycle(target);

  next.pag = {
    platform,
    actionRequestId: intent?.id || target.pagActionId || null,
    approvalId: approval?.id || target.pagApprovalId || null,
    capability: capability || intent?.capability || spec.capability,
    argsHash: intent?.args_hash || approval?.args_hash || target.pagArgsHash || null,
    status: intent?.status || null
  };
  next.status = ['succeeded', 'failed', 'denied', 'expired'].includes(intent?.status)
    ? `handoff_${intent.status}`
    : 'handoff_requested';
  next.updatedAt = new Date().toISOString();
  return next;
}

export async function requestPagHandoff(campaign, platform, {
  pag,
  connectionId = null,
  idempotencyKey = null
} = {}) {
  if (!pag || typeof pag.createIntent !== 'function') throw new TypeError('PAG client is required');
  const request = buildPagIntent(campaign, platform, { connectionId });
  const effectiveIdempotencyKey = idempotencyKey || request.idempotencyKey;
  const intent = await pag.createIntent(request.capability, request.args, { idempotencyKey: effectiveIdempotencyKey });
  const next = applyPagIntent(campaign, platform, intent, { capability: request.capability });
  return {
    campaign: next,
    intent,
    request: { ...request, idempotencyKey: effectiveIdempotencyKey }
  };
}

export async function reconcilePagHandoff(campaign, platform, { pag, pagIntentId = null } = {}) {
  if (!pag || typeof pag.getIntent !== 'function') throw new TypeError('PAG client is required');
  const target = campaign?.platform?.[platform];
  const intentId = pagIntentId || target?.pagActionId;
  if (!intentId) throw new Error(`no PAG handoff exists for ${platform}`);
  if (
    target?.submittedVersion != null &&
    (target.submittedVersion !== campaign.version || target.submittedContentHash !== campaign.contentHash)
  ) {
    throw new Error('stored PAG handoff belongs to a stale campaign version/content hash');
  }

  const intent = await pag.getIntent(intentId);
  const next = applyPagIntent(campaign, platform, intent);
  return { campaign: next, intent };
}

export function mapIntentStatus(status) {
  return ({
    pending_approval: 'pending_approval',
    authorized: 'authorized',
    approved: 'approved',
    executing: 'executing',
    succeeded: 'succeeded',
    failed: 'failed',
    denied: 'denied',
    expired: 'expired'
  })[status] || 'unknown';
}
