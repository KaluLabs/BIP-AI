import { requestPagHandoff } from './handoff.js';

const PLATFORMS = new Set(['x', 'linkedin']);
const FAILED_HANDOFFS = new Set(['failed', 'denied', 'expired']);
const HANDED_OFF = new Set(['pending_approval', 'authorized', 'approved', 'executing']);

function nowIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw inputError('invalid timestamp');
  return date.toISOString();
}

function inputError(message) {
  const error = new TypeError(message);
  error.statusCode = 400;
  return error;
}

function assertPlatform(platform) {
  if (!PLATFORMS.has(platform)) throw inputError(`unsupported platform: ${platform}`);
}

function assertTimezone(timezone) {
  if (timezone == null || timezone === '') return null;
  const value = String(timezone).trim();
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date());
  } catch {
    throw inputError(`invalid IANA timezone: ${value}`);
  }
  return value;
}

export function parseScheduleTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) throw inputError('scheduledAt is required');
  const source = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(source)) {
    throw inputError('scheduledAt must be an RFC3339 timestamp with Z or an explicit UTC offset');
  }
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) throw inputError('scheduledAt is invalid');
  return { source, utc: date.toISOString(), epochMs: date.getTime() };
}

function approvalIsCurrent(campaign) {
  const approval = campaign?.campaignApproval;
  return Boolean(
    approval &&
    approval.version === campaign.version &&
    approval.contentHash === campaign.contentHash
  );
}

export function platformLifecycle(campaign, platform) {
  assertPlatform(platform);
  const target = campaign?.platform?.[platform] || {};
  const handoff = target.handoffStatus;
  if (handoff === 'succeeded') return 'published';
  if (FAILED_HANDOFFS.has(handoff) || target.schedule?.status === 'failed') return 'failed';
  if (HANDED_OFF.has(handoff)) return 'handed_off';
  if (target.schedule?.status === 'handed_off') return 'handed_off';
  if (target.schedule?.status === 'published') return 'published';
  if (target.schedule) return 'planned';
  if (approvalIsCurrent(campaign)) return 'approved';
  return 'drafted';
}

export function scheduleCampaign(campaign, platform, { scheduledAt, timezone = null } = {}, { now = new Date() } = {}) {
  if (!campaign) throw inputError('campaign is required');
  assertPlatform(platform);
  const parsed = parseScheduleTimestamp(scheduledAt);
  const tz = assertTimezone(timezone);
  const next = structuredClone(campaign);
  const target = next.platform?.[platform];
  if (!target) throw inputError(`campaign has no ${platform} platform state`);

  const previous = target.schedule || null;
  target.schedule = {
    scheduledAt: parsed.source,
    scheduledAtUtc: parsed.utc,
    timezone: tz,
    status: 'planned',
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: previous?.createdAt || nowIso(now),
    updatedAt: nowIso(now)
  };
  target.lifecycleStatus = 'planned';
  next.updatedAt = nowIso(now);
  return next;
}

export function clearCampaignSchedule(campaign, platform, { now = new Date() } = {}) {
  if (!campaign) throw inputError('campaign is required');
  assertPlatform(platform);
  const next = structuredClone(campaign);
  const target = next.platform?.[platform];
  if (!target) throw inputError(`campaign has no ${platform} platform state`);
  target.schedule = null;
  target.lifecycleStatus = platformLifecycle(next, platform);
  next.updatedAt = nowIso(now);
  return next;
}

export function scheduleSnapshot(campaign, platform, { at = new Date() } = {}) {
  assertPlatform(platform);
  const target = campaign?.platform?.[platform] || {};
  const schedule = target.schedule || null;
  if (!schedule) {
    return {
      campaignId: campaign?.id || null,
      projectId: campaign?.projectId || null,
      platform,
      lifecycleStatus: platformLifecycle(campaign, platform),
      schedule: null,
      due: false,
      overdueByMs: 0
    };
  }
  const atMs = new Date(nowIso(at)).getTime();
  const dueMs = new Date(schedule.scheduledAtUtc).getTime();
  const active = schedule.status === 'planned';
  const due = active && dueMs <= atMs;
  return {
    campaignId: campaign.id,
    projectId: campaign.projectId,
    platform,
    lifecycleStatus: platformLifecycle(campaign, platform),
    schedule: structuredClone(schedule),
    due,
    overdueByMs: due ? Math.max(0, atMs - dueMs) : 0
  };
}

export function listDueSchedules(campaigns, { at = new Date() } = {}) {
  const items = [];
  for (const campaign of campaigns || []) {
    for (const platform of PLATFORMS) {
      const snapshot = scheduleSnapshot(campaign, platform, { at });
      if (snapshot.due) items.push(snapshot);
    }
  }
  return items.sort((a, b) =>
    a.schedule.scheduledAtUtc.localeCompare(b.schedule.scheduledAtUtc) ||
    a.campaignId.localeCompare(b.campaignId) ||
    a.platform.localeCompare(b.platform)
  );
}

function safeFailureCode(error) {
  const message = String(error?.message || '');
  if (/privacy is/i.test(message)) return 'privacy_not_pass';
  if (/quality is not PASS|structure is not PASS|editorial quality is not PASS/i.test(message)) return 'quality_not_pass';
  if (/not approved for handoff|approval is missing/i.test(message)) return 'approval_missing';
  if (/approval is stale/i.test(message)) return 'approval_stale';
  if (/PAG client is required/i.test(message)) return 'pag_unavailable';
  if (Number.isInteger(error?.status)) return `pag_http_${error.status}`;
  return 'handoff_failed';
}

function markScheduleFailed(campaign, platform, code, { now = new Date() } = {}) {
  const next = structuredClone(campaign);
  const target = next.platform[platform];
  if (!target.schedule) throw inputError(`no schedule exists for ${platform}`);
  target.schedule = {
    ...target.schedule,
    status: 'failed',
    attemptCount: Number(target.schedule.attemptCount || 0) + 1,
    lastAttemptAt: nowIso(now),
    lastError: code,
    updatedAt: nowIso(now)
  };
  target.lifecycleStatus = 'failed';
  next.updatedAt = nowIso(now);
  return next;
}

export async function executeScheduledHandoff(campaign, platform, {
  pag,
  connectionId = null,
  now = new Date(),
  handoff = requestPagHandoff
} = {}) {
  if (!campaign) throw inputError('campaign is required');
  assertPlatform(platform);
  const snapshot = scheduleSnapshot(campaign, platform, { at: now });
  if (!snapshot.schedule) throw inputError(`no schedule exists for ${platform}`);
  if (!snapshot.due) throw inputError(`schedule for ${platform} is not due`);

  try {
    if (!pag) throw new TypeError('PAG client is required');
    const result = await handoff(campaign, platform, { pag, connectionId, now });
    const next = result.campaign;
    const target = next.platform[platform];
    const handoffStatus = target.handoffStatus;
    const failed = FAILED_HANDOFFS.has(handoffStatus);
    target.schedule = {
      ...target.schedule,
      status: handoffStatus === 'succeeded' ? 'published' : failed ? 'failed' : 'handed_off',
      attemptCount: Number(target.schedule?.attemptCount || 0) + 1,
      lastAttemptAt: nowIso(now),
      lastError: failed ? `pag_${handoffStatus}` : null,
      updatedAt: nowIso(now)
    };
    target.lifecycleStatus = handoffStatus === 'succeeded' ? 'published' : failed ? 'failed' : 'handed_off';
    next.updatedAt = nowIso(now);
    return { ...result, campaign: next, executed: true, failureCode: target.schedule.lastError };
  } catch (error) {
    const failureCode = safeFailureCode(error);
    return {
      campaign: markScheduleFailed(campaign, platform, failureCode, { now }),
      intent: null,
      request: null,
      executed: false,
      failureCode
    };
  }
}

export async function runDueSchedules(store, {
  pagFactory,
  connections = {},
  at = new Date(),
  handoff = null
} = {}) {
  if (!store) throw new TypeError('store is required');
  const due = listDueSchedules(store.listCampaigns(), { at });
  const results = [];

  for (const item of due) {
    const current = store.getCampaign(item.campaignId);
    if (!current) continue;
    let pag = null;
    try { pag = typeof pagFactory === 'function' ? pagFactory() : null; }
    catch { pag = null; }
    const result = await executeScheduledHandoff(current, item.platform, {
      pag,
      connectionId: connections[item.platform] || null,
      now: at,
      ...(handoff ? { handoff } : {})
    });
    store.updateCampaignState(result.campaign);
    results.push({
      campaignId: item.campaignId,
      platform: item.platform,
      executed: result.executed,
      failureCode: result.failureCode || null,
      lifecycleStatus: result.campaign.platform[item.platform].lifecycleStatus,
      handoffStatus: result.campaign.platform[item.platform].handoffStatus
    });
  }

  return { at: nowIso(at), due: due.length, results };
}
