const PLATFORM = {
  x: { capability: 'x.threads.create' },
  linkedin: { capability: 'linkedin.posts.create' }
};

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

export async function requestPagHandoff(campaign, platform, { pag, connectionId = null } = {}) {
  if (!pag || typeof pag.createIntent !== 'function') throw new TypeError('PAG client is required');
  const request = buildPagIntent(campaign, platform, { connectionId });
  const intent = await pag.createIntent(request.capability, request.args, { idempotencyKey: request.idempotencyKey });

  const next = structuredClone(campaign);
  const approval = intent.approval || null;
  const target = next.platform[platform];
  target.handoffStatus = mapIntentStatus(intent.status);
  target.pagActionId = intent.id || null;
  target.pagApprovalId = approval?.id || null;
  target.submittedVersion = next.version;
  target.submittedContentHash = next.contentHash;
  target.pagArgsHash = intent.args_hash || approval?.args_hash || null;
  target.pagStatus = intent.status || null;
  next.pag = {
    platform,
    actionRequestId: intent.id || null,
    approvalId: approval?.id || null,
    capability: request.capability,
    argsHash: intent.args_hash || approval?.args_hash || null,
    status: intent.status || null
  };
  next.status = ['succeeded', 'failed', 'denied', 'expired'].includes(intent.status)
    ? `handoff_${intent.status}`
    : 'handoff_requested';
  next.updatedAt = new Date().toISOString();
  return { campaign: next, intent, request };
}

export async function reconcilePagHandoff(campaign, platform, { pag } = {}) {
  if (!pag || typeof pag.getIntent !== 'function') throw new TypeError('PAG client is required');
  const target = campaign?.platform?.[platform];
  if (!target?.pagActionId) throw new Error(`no PAG handoff exists for ${platform}`);
  if (target.submittedVersion !== campaign.version || target.submittedContentHash !== campaign.contentHash) {
    throw new Error('stored PAG handoff belongs to a stale campaign version/content hash');
  }

  const intent = await pag.getIntent(target.pagActionId);
  const next = structuredClone(campaign);
  const updated = next.platform[platform];
  updated.handoffStatus = mapIntentStatus(intent.status);
  updated.pagApprovalId = intent.approval?.id || updated.pagApprovalId || null;
  updated.pagArgsHash = intent.args_hash || updated.pagArgsHash || null;
  updated.pagStatus = intent.status || null;
  if (intent.execution) updated.execution = intent.execution;
  next.pag = {
    platform,
    actionRequestId: intent.id || target.pagActionId,
    approvalId: intent.approval?.id || updated.pagApprovalId || null,
    capability: intent.capability || null,
    argsHash: intent.args_hash || updated.pagArgsHash || null,
    status: intent.status || null
  };
  next.status = ['succeeded', 'failed', 'denied', 'expired'].includes(intent.status)
    ? `handoff_${intent.status}`
    : 'handoff_requested';
  next.updatedAt = new Date().toISOString();
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
