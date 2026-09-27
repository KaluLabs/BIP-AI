const CATEGORIES = new Set([
  'privacy_review',
  'stale_approval',
  'awaiting_approval',
  'handoff_denied',
  'handoff_failed',
  'schedule_blocked'
]);

const PRIORITY = {
  privacy_review: 100,
  handoff_failed: 90,
  handoff_denied: 90,
  schedule_blocked: 80,
  stale_approval: 70,
  awaiting_approval: 50
};

const PLATFORM = new Set(['x', 'linkedin']);
const PRIVACY = new Set(['PASS', 'REVIEW', 'BLOCK']);
const PARAMS = new Set([
  'q', 'projectId', 'privacy', 'source', 'platform', 'status', 'category',
  'from', 'to', 'sort', 'order', 'page', 'pageSize'
]);
const SORTS = new Set(['priority', 'age', 'attentionAt', 'projectId', 'platform', 'status', 'category']);

function badRequest(message) {
  const error = new TypeError(message);
  error.statusCode = 400;
  return error;
}

function clean(value) {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function positiveInt(value, name, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw badRequest(`${name} must be a positive integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw badRequest(`${name} must be between 1 and ${max}`);
  }
  return number;
}

function boundary(value, name, end = false) {
  if (value == null || value === '') return null;
  const source = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(source)
    ? new Date(`${source}T${end ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(source);
  if (Number.isNaN(date.getTime())) throw badRequest(`${name} is invalid`);
  return date.toISOString();
}

function asIso(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function currentApproval(campaign) {
  const approval = campaign?.campaignApproval;
  return Boolean(
    approval &&
    approval.version === campaign.version &&
    approval.contentHash === campaign.contentHash
  );
}

function previousApproval(campaign, versions = []) {
  const approved = [...versions]
    .filter((version) => {
      const approval = version?.campaignApproval;
      return Boolean(
        approval &&
        approval.version === version.version &&
        approval.contentHash === version.contentHash &&
        version.version < campaign.version
      );
    })
    .sort((a, b) => b.version - a.version)[0];
  return approved?.campaignApproval || null;
}

export function staleApprovalInfo(campaign, versions = []) {
  const approval = campaign?.campaignApproval;
  if (approval && !currentApproval(campaign)) {
    const reasons = [];
    if (approval.version !== campaign.version) reasons.push('campaign version changed');
    if (approval.contentHash !== campaign.contentHash) reasons.push('content hash changed');
    return {
      stale: true,
      approvedVersion: approval.version,
      approvedContentHash: approval.contentHash,
      reason: reasons.join(' and ') || 'approval no longer matches current campaign'
    };
  }

  if (!approval) {
    const previous = previousApproval(campaign, versions);
    if (previous) {
      return {
        stale: true,
        approvedVersion: previous.version,
        approvedContentHash: previous.contentHash,
        reason: `campaign changed after approval of version ${previous.version}`
      };
    }
  }

  return { stale: false, approvedVersion: null, approvedContentHash: null, reason: null };
}

function approvalBlockers(campaign) {
  const blockers = [];
  if (campaign.privacyResult !== 'PASS') blockers.push(`privacy is ${campaign.privacyResult}`);
  if (campaign.qualityResult && campaign.qualityResult !== 'PASS') blockers.push('quality review is required');
  if (Object.values(campaign.structuralQuality || {}).some((item) => item.result !== 'PASS')) {
    blockers.push('structural validation is not PASS');
  }
  if (Object.values(campaign.editorialQuality || {}).some((item) => item.result !== 'PASS')) {
    blockers.push('editorial claim validation is not PASS');
  }
  return blockers;
}

function campaignStatuses(campaign, platform = null) {
  const values = [campaign.status, campaign.editorialStatus];
  for (const name of platform ? [platform] : ['x', 'linkedin']) {
    const target = campaign.platform?.[name];
    if (!target) continue;
    values.push(target.lifecycleStatus, target.handoffStatus, target.pagStatus, target.schedule?.status);
  }
  return [...new Set(values.filter(Boolean))];
}

function provenance(event) {
  if (!event) return null;
  return {
    eventId: event.id,
    source: event.source || 'manual',
    type: event.type || null,
    summary: event.summary || null,
    occurredAt: event.occurredAt || null,
    evidence: Array.isArray(event.evidence) ? event.evidence.slice(0, 3) : []
  };
}

function attentionItem({
  campaign,
  event,
  category,
  platform = null,
  attentionAt = null,
  title,
  reason,
  details = null,
  now
}) {
  const at = asIso(attentionAt, asIso(campaign.updatedAt, asIso(campaign.createdAt, now.toISOString())));
  return {
    id: `attention:${campaign.id}:${category}:${platform || 'campaign'}:v${campaign.version}`,
    category,
    priority: PRIORITY[category],
    status: ({
      privacy_review: 'review',
      stale_approval: 'approval_stale',
      awaiting_approval: 'awaiting_approval',
      handoff_denied: 'denied',
      handoff_failed: 'failed',
      schedule_blocked: 'blocked'
    })[category],
    projectId: campaign.projectId,
    campaignId: campaign.id,
    campaignVersion: campaign.version,
    campaignContentHash: campaign.contentHash,
    eventId: campaign.eventId,
    platform,
    privacy: campaign.privacyResult,
    source: event?.source || null,
    attentionAt: at,
    ageMs: Math.max(0, now.getTime() - new Date(at).getTime()),
    title,
    reason,
    details,
    campaignStatus: campaign.status,
    statuses: campaignStatuses(campaign, platform),
    canApprove: false,
    approvalBlockers: approvalBlockers(campaign),
    provenance: provenance(event),
    navigation: {
      campaignId: campaign.id,
      version: campaign.version,
      eventId: campaign.eventId
    }
  };
}

export function buildApprovalInbox({
  campaigns = [],
  events = [],
  versionsByCampaign = new Map(),
  now = new Date()
} = {}) {
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime())) throw new TypeError('invalid inbox time');
  const eventById = new Map(events.map((event) => [event.id, event]));
  const items = [];
  const seen = new Set();

  const add = (item) => {
    const key = `${item.campaignId}:${item.category}:${item.platform || 'campaign'}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  for (const campaign of campaigns) {
    const event = eventById.get(campaign.eventId) || null;
    const versions = versionsByCampaign.get(campaign.id) || [];
    const approvalIsCurrent = currentApproval(campaign);
    const stale = staleApprovalInfo(campaign, versions);

    if (campaign.privacyResult === 'REVIEW') {
      add(attentionItem({
        campaign,
        event,
        category: 'privacy_review',
        attentionAt: campaign.updatedAt || campaign.createdAt,
        title: 'Privacy review required',
        reason: 'This campaign is explicitly held for human privacy review before approval.',
        details: { findings: campaign.privacy?.findings || [] },
        now: at
      }));
    }

    if (campaign.privacyResult === 'PASS' && !approvalIsCurrent) {
      if (stale.stale) {
        const item = attentionItem({
          campaign,
          event,
          category: 'stale_approval',
          attentionAt: campaign.updatedAt,
          title: 'Approval is stale',
          reason: stale.reason,
          details: {
            approvedVersion: stale.approvedVersion,
            approvedContentHash: stale.approvedContentHash
          },
          now: at
        });
        item.canApprove = item.approvalBlockers.length === 0;
        add(item);
      } else {
        const item = attentionItem({
          campaign,
          event,
          category: 'awaiting_approval',
          attentionAt: campaign.updatedAt || campaign.createdAt,
          title: 'Draft awaiting approval',
          reason: 'The current campaign version has not received explicit campaign approval.',
          now: at
        });
        item.canApprove = item.approvalBlockers.length === 0;
        add(item);
      }
    }

    for (const platform of ['x', 'linkedin']) {
      const target = campaign.platform?.[platform];
      if (!target) continue;

      if (target.handoffStatus === 'denied') {
        add(attentionItem({
          campaign,
          event,
          category: 'handoff_denied',
          platform,
          attentionAt: campaign.updatedAt,
          title: `${platform === 'x' ? 'X' : 'LinkedIn'} handoff denied`,
          reason: 'PAG denied this publishing handoff. Review the current campaign and PAG decision before taking another action.',
          details: {
            pagActionId: target.pagActionId || null,
            pagApprovalId: target.pagApprovalId || null,
            pagStatus: target.pagStatus || 'denied'
          },
          now: at
        }));
      }

      if (target.handoffStatus === 'failed') {
        add(attentionItem({
          campaign,
          event,
          category: 'handoff_failed',
          platform,
          attentionAt: campaign.updatedAt,
          title: `${platform === 'x' ? 'X' : 'LinkedIn'} handoff failed`,
          reason: 'The publishing handoff failed and needs operator review before any retry.',
          details: {
            pagActionId: target.pagActionId || null,
            pagApprovalId: target.pagApprovalId || null,
            pagStatus: target.pagStatus || 'failed',
            execution: target.execution?.status || null
          },
          now: at
        }));
      }

      const schedule = target.schedule;
      if (
        schedule &&
        campaign.privacyResult !== 'BLOCK' &&
        !approvalIsCurrent &&
        ['planned', 'failed'].includes(schedule.status)
      ) {
        const explicitlyApprovalBlocked =
          schedule.status === 'planned' ||
          ['approval_missing', 'approval_stale'].includes(schedule.lastError) ||
          stale.stale;
        if (explicitlyApprovalBlocked) {
          add(attentionItem({
            campaign,
            event,
            category: 'schedule_blocked',
            platform,
            attentionAt: schedule.updatedAt || schedule.createdAt || campaign.updatedAt,
            title: `${platform === 'x' ? 'X' : 'LinkedIn'} schedule blocked`,
            reason: stale.stale
              ? `Scheduled publishing is blocked because ${stale.reason}.`
              : 'Scheduled publishing is blocked because the current campaign version is not approved.',
            details: {
              scheduledAtUtc: schedule.scheduledAtUtc || null,
              timezone: schedule.timezone || null,
              scheduleStatus: schedule.status,
              lastError: schedule.lastError || null
            },
            now: at
          }));
        }
      }
    }
  }

  return items.sort((a, b) =>
    b.priority - a.priority ||
    a.attentionAt.localeCompare(b.attentionAt) ||
    a.id.localeCompare(b.id)
  );
}

export function approvalInboxSummary(items = []) {
  const byCategory = {};
  const byPriority = {};
  for (const item of items) {
    byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
  }
  return { total: items.length, byCategory, byPriority };
}

export function parseApprovalInboxQuery(searchParams) {
  if (!(searchParams instanceof URLSearchParams)) throw new TypeError('searchParams must be URLSearchParams');
  for (const key of searchParams.keys()) {
    if (!PARAMS.has(key)) throw badRequest(`unsupported query parameter: ${key}`);
  }

  const privacy = clean(searchParams.get('privacy'));
  if (privacy && !PRIVACY.has(privacy.toUpperCase())) throw badRequest('privacy must be PASS, REVIEW, or BLOCK');

  const platform = clean(searchParams.get('platform'));
  if (platform && !PLATFORM.has(platform)) throw badRequest('platform must be x or linkedin');

  const category = clean(searchParams.get('category'));
  if (category && !CATEGORIES.has(category)) throw badRequest(`unsupported approval category: ${category}`);

  const sort = clean(searchParams.get('sort')) || 'priority';
  if (!SORTS.has(sort)) throw badRequest(`unsupported approval inbox sort: ${sort}`);

  const order = (clean(searchParams.get('order')) || 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(order)) throw badRequest('order must be asc or desc');

  const from = boundary(searchParams.get('from'), 'from', false);
  const to = boundary(searchParams.get('to'), 'to', true);
  if (from && to && from > to) throw badRequest('from must not be after to');

  return {
    q: clean(searchParams.get('q')),
    projectId: clean(searchParams.get('projectId')),
    privacy: privacy ? privacy.toUpperCase() : null,
    source: clean(searchParams.get('source')),
    platform,
    status: clean(searchParams.get('status')),
    category,
    from,
    to,
    sort,
    order,
    page: positiveInt(searchParams.get('page'), 'page', 1),
    pageSize: positiveInt(searchParams.get('pageSize'), 'pageSize', 20, 100)
  };
}

function contains(value, needle) {
  return value != null && String(value).toLocaleLowerCase().includes(needle);
}

function inRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;
  return (!from || value >= from) && (!to || value <= to);
}

export function queryApprovalInbox(items, query) {
  const needle = query.q?.toLocaleLowerCase() || null;
  let filtered = (items || []).filter((item) => {
    if (query.projectId && item.projectId !== query.projectId) return false;
    if (query.privacy && item.privacy !== query.privacy) return false;
    if (query.source && item.source !== query.source) return false;
    if (query.platform && item.platform !== query.platform) return false;
    if (query.category && item.category !== query.category) return false;
    if (query.status && !item.statuses.includes(query.status) && item.status !== query.status) return false;
    if (!inRange(item.attentionAt, query.from, query.to)) return false;
    if (needle) {
      const searchable = [
        item.id, item.category, item.status, item.projectId, item.campaignId, item.platform,
        item.title, item.reason, item.source, item.provenance?.summary
      ];
      if (!searchable.some((value) => contains(value, needle))) return false;
    }
    return true;
  });

  const direction = query.order === 'asc' ? 1 : -1;
  filtered = [...filtered].sort((a, b) => {
    let av;
    let bv;
    if (query.sort === 'priority') {
      av = a.priority; bv = b.priority;
    } else if (query.sort === 'age') {
      av = a.ageMs; bv = b.ageMs;
    } else {
      av = a[query.sort]; bv = b[query.sort];
    }

    if (av == null && bv != null) return 1;
    if (av != null && bv == null) return -1;
    let primary = 0;
    if (typeof av === 'string' && typeof bv === 'string') primary = av.localeCompare(bv);
    else primary = av < bv ? -1 : av > bv ? 1 : 0;
    if (primary !== 0) return primary * direction;

    if (query.sort === 'priority' && a.attentionAt !== b.attentionAt) {
      return a.attentionAt.localeCompare(b.attentionAt);
    }
    return a.id.localeCompare(b.id);
  });

  const total = filtered.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
  const start = (query.page - 1) * query.pageSize;
  const pageItems = start >= total ? [] : filtered.slice(start, start + query.pageSize);
  return {
    items: pageItems,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
      hasPrevious: query.page > 1 && total > 0,
      hasNext: query.page < totalPages
    }
  };
}

export function exactCampaignVersion(campaign, { version, contentHash } = {}) {
  if (!campaign) {
    const error = new Error('campaign not found');
    error.statusCode = 404;
    throw error;
  }
  if (!Number.isInteger(Number(version)) || !contentHash) throw badRequest('version and contentHash are required');
  if (campaign.version !== Number(version) || campaign.contentHash !== String(contentHash)) {
    const error = new Error('campaign changed; refresh the approval inbox before acting');
    error.statusCode = 409;
    throw error;
  }
  return campaign;
}

export { CATEGORIES as APPROVAL_INBOX_CATEGORIES };
