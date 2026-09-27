import { createHash, randomUUID } from 'node:crypto';

const MEANINGFUL_TYPES = new Set([
  'milestone', 'release', 'feature', 'fix', 'decision', 'launch', 'experiment', 'learning'
]);

function normalizeStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
}

export function normalizeProjectEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('ProjectEvent must be an object');
  const projectId = String(input.projectId ?? '').trim();
  const type = String(input.type ?? '').trim().toLowerCase();
  const summary = String(input.summary ?? '').trim();
  if (!projectId) throw new TypeError('projectId is required');
  if (!type) throw new TypeError('type is required');
  if (!summary) throw new TypeError('summary is required');

  return {
    id: String(input.id ?? randomUUID()),
    projectId,
    type,
    summary,
    details: String(input.details ?? '').trim() || null,
    source: String(input.source ?? 'manual').trim() || 'manual',
    occurredAt: String(input.occurredAt ?? new Date().toISOString()),
    importance: String(input.importance ?? 'normal').trim().toLowerCase(),
    userVisible: Boolean(input.userVisible),
    implementation: normalizeStrings(input.implementation),
    decisions: normalizeStrings(input.decisions),
    lessons: normalizeStrings(input.lessons),
    outcomes: normalizeStrings(input.outcomes),
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    assets: Array.isArray(input.assets) ? input.assets : [],
    nextStep: typeof input.nextStep === 'string' && input.nextStep.trim() ? input.nextStep.trim() : null,
    privacy: String(input.privacy ?? 'PASS').trim().toUpperCase(),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}
  };
}

export function fingerprintEvent(event) {
  return sha256({
    projectId: event.projectId,
    type: event.type,
    summary: event.summary,
    details: event.details,
    source: event.source,
    occurredAt: event.occurredAt
  });
}

export function evaluateStoryworthiness(event, threshold = 3) {
  let score = 0;
  const reasons = [];

  if (MEANINGFUL_TYPES.has(event.type)) {
    score += 2;
    reasons.push('meaningful event type');
  }
  if (event.userVisible || event.outcomes.length > 0) {
    score += 2;
    reasons.push('user-visible or useful change');
  }
  if (event.importance === 'high' || event.importance === 'critical') {
    score += 1;
    reasons.push('high importance');
  }
  if (event.implementation.length || event.decisions.length || event.lessons.length) {
    score += 1;
    reasons.push('structured project context');
  }
  if (event.evidence.length) {
    score += 1;
    reasons.push('supporting evidence');
  }

  return {
    level: score >= 5 ? 'HIGH' : score >= threshold ? 'MEDIUM' : 'LOW',
    score,
    threshold,
    eligible: score >= threshold,
    reasons,
    duplicateWarning: false
  };
}

export function evaluatePrivacy(event) {
  if (event.privacy === 'BLOCK') {
    return { result: 'BLOCK', findings: ['event explicitly marked BLOCK'] };
  }
  if (event.privacy === 'REVIEW') {
    return { result: 'REVIEW', findings: ['event explicitly marked REVIEW'] };
  }

  const text = [event.summary, event.details, ...event.implementation, ...event.decisions, ...event.lessons]
    .filter(Boolean).join('\n');
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, 'possible private key'],
    [/\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*\S+/i, 'possible credential'],
    [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, 'possible GitHub token']
  ];
  const findings = patterns.filter(([regex]) => regex.test(text)).map(([, label]) => label);
  return findings.length ? { result: 'REVIEW', findings } : { result: 'PASS', findings: [] };
}

export function buildStoryBrief(event) {
  return {
    id: randomUUID(),
    project: { id: event.projectId },
    eventId: event.id,
    hook: event.summary,
    whatChanged: event.details ?? event.summary,
    whyItMatters: event.outcomes[0] ?? null,
    whyItMattersNeedsInput: event.outcomes.length === 0,
    outcomes: event.outcomes,
    implementation: event.implementation,
    decisions: event.decisions,
    challenges: [],
    lessons: event.lessons,
    nextStep: event.nextStep,
    assets: event.assets,
    evidence: event.evidence,
    needsUserInput: event.outcomes.length === 0 || !event.nextStep,
    themes: [
      { name: 'What changed', items: [{ text: event.details ?? event.summary, source: 'event.details' }] },
      { name: 'Implementation', items: event.implementation.map((text, index) => ({ text, source: `event.implementation[${index}]` })) },
      { name: 'Decisions', items: event.decisions.map((text, index) => ({ text, source: `event.decisions[${index}]` })) },
      { name: 'Lessons', items: event.lessons.map((text, index) => ({ text, source: `event.lessons[${index}]` })) }
    ].filter((theme) => theme.items.length)
  };
}

export function renderDrafts(storyBrief) {
  const xClaims = [
    { text: storyBrief.whatChanged, source: 'storyBrief.whatChanged' },
    ...storyBrief.decisions.slice(0, 1).map((text, i) => ({ text, source: `storyBrief.decisions[${i}]` })),
    ...storyBrief.lessons.slice(0, 1).map((text, i) => ({ text, source: `storyBrief.lessons[${i}]` })),
    ...(storyBrief.nextStep ? [{ text: `Next: ${storyBrief.nextStep}`, source: 'storyBrief.nextStep' }] : [])
  ];

  const xPosts = xClaims.map((claim) => claim.text);
  const paragraphs = [
    storyBrief.whatChanged,
    storyBrief.implementation.length ? `Implementation: ${storyBrief.implementation.join('; ')}.` : null,
    storyBrief.decisions.length ? `Decision: ${storyBrief.decisions.join('; ')}.` : null,
    storyBrief.lessons.length ? `Lesson: ${storyBrief.lessons.join('; ')}.` : null,
    storyBrief.nextStep ? `Next: ${storyBrief.nextStep}` : null
  ].filter(Boolean);

  const linkedinClaims = [
    { text: storyBrief.whatChanged, source: 'storyBrief.whatChanged' },
    ...storyBrief.implementation.map((text, i) => ({ text, source: `storyBrief.implementation[${i}]` })),
    ...storyBrief.decisions.map((text, i) => ({ text, source: `storyBrief.decisions[${i}]` })),
    ...storyBrief.lessons.map((text, i) => ({ text, source: `storyBrief.lessons[${i}]` })),
    ...(storyBrief.nextStep ? [{ text: storyBrief.nextStep, source: 'storyBrief.nextStep' }] : [])
  ];

  return {
    x: { type: 'thread', posts: xPosts, claims: xClaims },
    linkedin: { type: 'professional-narrative', text: paragraphs.join('\n\n'), claims: linkedinClaims }
  };
}

export function campaignContentHash(campaign) {
  return sha256({
    id: campaign.id,
    projectId: campaign.projectId,
    eventId: campaign.eventId,
    version: campaign.version,
    storyBrief: campaign.storyBrief,
    drafts: campaign.drafts,
    privacyResult: campaign.privacyResult
  });
}

export function createCampaign(event, evaluation, privacy) {
  const storyBrief = buildStoryBrief(event);
  const drafts = renderDrafts(storyBrief);
  const now = new Date().toISOString();
  const editorialStatus = privacy.result === 'PASS' ? 'draft_ready' : 'needs_review';
  const body = {
    id: randomUUID(),
    projectId: event.projectId,
    eventId: event.id,
    version: 1,
    editorialStatus,
    status: editorialStatus,
    evaluation,
    storyBrief,
    drafts,
    structuralQuality: { x: { result: 'PASS', findings: [] }, linkedin: { result: 'PASS', findings: [] } },
    editorialQuality: { x: { result: 'PASS', findings: [] }, linkedin: { result: 'PASS', findings: [] } },
    qualityResult: 'PASS',
    privacyResult: privacy.result,
    privacy,
    platform: {
      x: { draftStatus: 'ready', handoffStatus: 'not_requested', pagActionId: null, pagApprovalId: null },
      linkedin: { draftStatus: 'ready', handoffStatus: 'not_requested', pagActionId: null, pagApprovalId: null }
    },
    campaignApproval: null,
    createdAt: now,
    updatedAt: now
  };
  return { ...body, contentHash: campaignContentHash(body) };
}
