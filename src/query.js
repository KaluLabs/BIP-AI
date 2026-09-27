const PRIVACY = new Set(['PASS', 'REVIEW', 'BLOCK']);
const PLATFORMS = new Set(['x', 'linkedin']);
const CAMPAIGN_STATUSES = new Set([
  'drafted', 'approved', 'planned', 'handed_off', 'published', 'failed',
  'draft_ready', 'needs_review', 'approved_for_handoff',
  'handoff_requested', 'handoff_succeeded', 'handoff_failed', 'handoff_denied', 'handoff_expired',
  'not_requested', 'pending_approval', 'authorized', 'executing', 'succeeded', 'denied', 'expired'
]);

const EVENT_PARAMS = new Set(['q', 'projectId', 'privacy', 'source', 'from', 'to', 'sort', 'order', 'page', 'pageSize']);
const CAMPAIGN_PARAMS = new Set(['q', 'projectId', 'privacy', 'source', 'platform', 'status', 'from', 'to', 'sort', 'order', 'page', 'pageSize']);

const EVENT_SORTS = new Set(['occurredAt', 'projectId', 'source', 'privacy']);
const CAMPAIGN_SORTS = new Set(['updatedAt', 'createdAt', 'scheduledAt', 'projectId', 'privacy', 'status']);

function badRequest(message) {
  const error = new TypeError(message);
  error.statusCode = 400;
  return error;
}

function clean(value) {
  const text = value == null ? '' : String(value).trim();
  return text || null;
}

function positiveInt(value, name, fallback, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw badRequest(`${name} must be a positive integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) {
    throw badRequest(`${name} must be between 1 and ${max}`);
  }
  return number;
}

function parseBoundary(value, name, endOfDay = false) {
  if (value == null || value === '') return null;
  const source = String(value).trim();
  let date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    date = new Date(`${source}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(source)) throw badRequest(`${name} must be an ISO date or timestamp`);
    date = new Date(source);
  }
  if (Number.isNaN(date.getTime())) throw badRequest(`${name} is invalid`);
  return date.toISOString();
}

function validateKnownParams(searchParams, allowed) {
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) throw badRequest(`unsupported query parameter: ${key}`);
  }
}

export function parseListQuery(searchParams, kind) {
  if (!(searchParams instanceof URLSearchParams)) throw new TypeError('searchParams must be URLSearchParams');
  const isEvent = kind === 'events';
  const isCampaign = kind === 'campaigns';
  if (!isEvent && !isCampaign) throw new TypeError(`unsupported query kind: ${kind}`);

  validateKnownParams(searchParams, isEvent ? EVENT_PARAMS : CAMPAIGN_PARAMS);

  const privacy = clean(searchParams.get('privacy'));
  if (privacy && !PRIVACY.has(privacy.toUpperCase())) throw badRequest('privacy must be PASS, REVIEW, or BLOCK');

  const platform = isCampaign ? clean(searchParams.get('platform')) : null;
  if (platform && !PLATFORMS.has(platform)) throw badRequest('platform must be x or linkedin');

  const status = isCampaign ? clean(searchParams.get('status')) : null;
  if (status && !CAMPAIGN_STATUSES.has(status)) throw badRequest(`unsupported campaign status: ${status}`);

  const sort = clean(searchParams.get('sort')) || (isEvent ? 'occurredAt' : 'updatedAt');
  const allowedSorts = isEvent ? EVENT_SORTS : CAMPAIGN_SORTS;
  if (!allowedSorts.has(sort)) throw badRequest(`unsupported ${kind} sort: ${sort}`);

  const order = (clean(searchParams.get('order')) || 'desc').toLowerCase();
  if (!['asc', 'desc'].includes(order)) throw badRequest('order must be asc or desc');

  const from = parseBoundary(searchParams.get('from'), 'from', false);
  const to = parseBoundary(searchParams.get('to'), 'to', true);
  if (from && to && from > to) throw badRequest('from must not be after to');

  return {
    q: clean(searchParams.get('q')),
    projectId: clean(searchParams.get('projectId')),
    privacy: privacy ? privacy.toUpperCase() : null,
    source: clean(searchParams.get('source')),
    platform,
    status,
    from,
    to,
    sort,
    order,
    page: positiveInt(searchParams.get('page'), 'page', 1),
    pageSize: positiveInt(searchParams.get('pageSize'), 'pageSize', 20, { max: 100 })
  };
}

function textMatch(value, needle) {
  return value != null && String(value).toLocaleLowerCase().includes(needle);
}

function eventSearchText(event) {
  return [
    event.id, event.projectId, event.type, event.summary, event.details, event.source,
    ...(event.implementation || []), ...(event.decisions || []), ...(event.lessons || []),
    ...(event.outcomes || []), event.nextStep
  ].filter(Boolean).join('\n');
}

function campaignSearchText(campaign, source) {
  return [
    campaign.id, campaign.projectId, source,
    campaign.storyBrief?.hook, campaign.storyBrief?.whatChanged, campaign.storyBrief?.whyItMatters,
    ...(campaign.storyBrief?.implementation || []), ...(campaign.storyBrief?.decisions || []),
    ...(campaign.storyBrief?.lessons || []), ...(campaign.storyBrief?.outcomes || []),
    campaign.storyBrief?.nextStep,
    ...(campaign.drafts?.x?.posts || []), campaign.drafts?.linkedin?.text
  ].filter(Boolean).join('\n');
}

function platformStates(campaign, platform = null) {
  const names = platform ? [platform] : ['x', 'linkedin'];
  const values = [];
  for (const name of names) {
    const target = campaign.platform?.[name];
    if (!target) continue;
    values.push(
      target.lifecycleStatus,
      target.handoffStatus,
      target.pagStatus,
      target.schedule?.status
    );
  }
  return values.filter(Boolean);
}

function campaignStatus(campaign, platform = null) {
  return [campaign.status, campaign.editorialStatus, ...platformStates(campaign, platform)].filter(Boolean);
}

function scheduledAt(campaign, platform = null) {
  const names = platform ? [platform] : ['x', 'linkedin'];
  return names
    .map((name) => campaign.platform?.[name]?.schedule?.scheduledAtUtc)
    .filter(Boolean)
    .sort()[0] || null;
}

function timestampInRange(value, from, to) {
  if (!from && !to) return true;
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const iso = date.toISOString();
  return (!from || iso >= from) && (!to || iso <= to);
}

function comparePrimitive(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

function stableSort(items, valueFor, order) {
  const direction = order === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = valueFor(a);
    const bv = valueFor(b);
    if (av == null && bv != null) return 1;
    if (av != null && bv == null) return -1;
    const primary = comparePrimitive(av, bv);
    if (primary !== 0) return primary * direction;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function paginate(items, query) {
  const total = items.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
  const start = (query.page - 1) * query.pageSize;
  const paged = start >= total ? [] : items.slice(start, start + query.pageSize);
  return {
    items: paged,
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

export function queryEvents(events, query) {
  const needle = query.q?.toLocaleLowerCase() || null;
  let items = (events || []).filter((event) => {
    if (query.projectId && event.projectId !== query.projectId) return false;
    if (query.privacy && event.privacy?.result !== query.privacy) return false;
    if (query.source && event.source !== query.source) return false;
    if (needle && !textMatch(eventSearchText(event), needle)) return false;
    if (!timestampInRange(event.occurredAt, query.from, query.to)) return false;
    return true;
  });

  const valueFor = (event) => ({
    occurredAt: event.occurredAt,
    projectId: event.projectId,
    source: event.source,
    privacy: event.privacy?.result
  })[query.sort];

  items = stableSort(items, valueFor, query.order);
  return paginate(items, query);
}

export function queryCampaigns(campaigns, query, { sourceByEventId = new Map() } = {}) {
  const needle = query.q?.toLocaleLowerCase() || null;
  let items = (campaigns || []).map((campaign) => ({
    ...campaign,
    source: sourceByEventId.get(campaign.eventId) || campaign.source || null
  })).filter((campaign) => {
    if (query.projectId && campaign.projectId !== query.projectId) return false;
    if (query.privacy && campaign.privacyResult !== query.privacy) return false;
    if (query.source && campaign.source !== query.source) return false;
    if (query.platform && !campaign.platform?.[query.platform]) return false;
    if (query.status && !campaignStatus(campaign, query.platform).includes(query.status)) return false;
    if (needle && !textMatch(campaignSearchText(campaign, campaign.source), needle)) return false;

    const dateValue = query.sort === 'scheduledAt'
      ? scheduledAt(campaign, query.platform)
      : query.sort === 'createdAt'
        ? campaign.createdAt
        : campaign.updatedAt;
    if (!timestampInRange(dateValue, query.from, query.to)) return false;
    return true;
  });

  const valueFor = (campaign) => ({
    updatedAt: campaign.updatedAt,
    createdAt: campaign.createdAt,
    scheduledAt: scheduledAt(campaign, query.platform),
    projectId: campaign.projectId,
    privacy: campaign.privacyResult,
    status: campaignStatus(campaign, query.platform)[0] || null
  })[query.sort];

  items = stableSort(items, valueFor, query.order);
  return paginate(items, query);
}

export function sourceIndex(events) {
  return new Map((events || []).map((event) => [event.id, event.source || null]));
}
