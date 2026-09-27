import { campaignContentHash } from './core.js';

function copy(value) { return structuredClone(value); }

function invalidatePublishingState(next) {
  next.campaignApproval = null;
  next.pag = null;
  const xSchedule = next.platform.x?.schedule?.status === 'planned' ? next.platform.x.schedule : null;
  const linkedinSchedule = next.platform.linkedin?.schedule?.status === 'planned' ? next.platform.linkedin.schedule : null;
  next.platform = {
    x: {
      ...next.platform.x,
      schedule: xSchedule,
      lifecycleStatus: xSchedule ? 'planned' : 'drafted',
      handoffStatus: 'not_requested',
      pagActionId: null,
      pagApprovalId: null,
      submittedVersion: null,
      submittedContentHash: null,
      pagArgsHash: null,
      pagStatus: null
    },
    linkedin: {
      ...next.platform.linkedin,
      schedule: linkedinSchedule,
      lifecycleStatus: linkedinSchedule ? 'planned' : 'drafted',
      handoffStatus: 'not_requested',
      pagActionId: null,
      pagApprovalId: null,
      submittedVersion: null,
      submittedContentHash: null,
      pagArgsHash: null,
      pagStatus: null
    }
  };
}


function allowedClaimMap(storyBrief) {
  const entries = [['storyBrief.whatChanged', storyBrief.whatChanged]];
  storyBrief.implementation.forEach((text, i) => entries.push([`storyBrief.implementation[${i}]`, text]));
  storyBrief.decisions.forEach((text, i) => entries.push([`storyBrief.decisions[${i}]`, text]));
  storyBrief.lessons.forEach((text, i) => entries.push([`storyBrief.lessons[${i}]`, text]));
  storyBrief.outcomes.forEach((text, i) => entries.push([`storyBrief.outcomes[${i}]`, text]));
  if (storyBrief.nextStep) entries.push(['storyBrief.nextStep', storyBrief.nextStep]);
  return new Map(entries.filter(([, text]) => typeof text === 'string' && text.trim()));
}

function inferClaims(text, storyBrief, platform) {
  const claims = [];
  for (const [source, value] of allowedClaimMap(storyBrief)) {
    const candidates = source === 'storyBrief.nextStep' ? [value, `Next: ${value}`] : [value];
    const matched = candidates.find((candidate) => text.includes(candidate));
    if (matched) claims.push({ text: matched, source, confidence: 'exact-match' });
  }
  if (!claims.length && text.trim()) {
    claims.push({ text: text.trim(), source: null, confidence: 'unsupported' });
  }
  return claims.map((claim) => ({ ...claim, platform }));
}

export function validateStructure(drafts) {
  const xFindings = [];
  const posts = drafts?.x?.posts;
  if (!Array.isArray(posts) || posts.length === 0) xFindings.push('X thread must contain at least one post');
  else posts.forEach((post, index) => {
    if (typeof post !== 'string' || !post.trim()) xFindings.push(`X post ${index + 1} is empty`);
    else if (post.length > 280) xFindings.push(`X post ${index + 1} exceeds 280 characters`);
  });

  const linkedinFindings = [];
  const linkedin = drafts?.linkedin?.text;
  if (typeof linkedin !== 'string' || !linkedin.trim()) linkedinFindings.push('LinkedIn draft is empty');
  else if (linkedin.length > 3000) linkedinFindings.push('LinkedIn draft exceeds 3000 characters');

  return {
    x: { result: xFindings.length ? 'FAIL' : 'PASS', findings: xFindings },
    linkedin: { result: linkedinFindings.length ? 'FAIL' : 'PASS', findings: linkedinFindings }
  };
}

export function validateClaims(drafts, storyBrief) {
  const allowed = allowedClaimMap(storyBrief);
  const validate = (claims, outputText) => {
    const findings = [];
    if (!Array.isArray(claims) || !claims.length) findings.push('draft has no source claims');
    for (const claim of claims || []) {
      const expected = claim.source ? allowed.get(claim.source) : null;
      if (!expected) {
        findings.push(`unsupported claim source: ${claim.source ?? 'none'}`);
        continue;
      }
      const permitted = claim.source === 'storyBrief.nextStep' ? [expected, `Next: ${expected}`] : [expected];
      if (!permitted.includes(claim.text)) findings.push(`claim text does not match source: ${claim.source}`);
      if (!outputText.includes(claim.text)) findings.push(`claim not present in draft: ${claim.source}`);
    }
    return { result: findings.length ? 'REVIEW' : 'PASS', findings };
  };

  return {
    x: validate(drafts?.x?.claims, Array.isArray(drafts?.x?.posts) ? drafts.x.posts.join('\n') : ''),
    linkedin: validate(drafts?.linkedin?.claims, typeof drafts?.linkedin?.text === 'string' ? drafts.linkedin.text : '')
  };
}

export const contentHashFor = campaignContentHash;

export function applyEditorial(campaign, editorial) {
  if (!campaign) throw new TypeError('campaign is required');
  if (!editorial || typeof editorial !== 'object') throw new TypeError('editorial payload is required');

  const next = copy(campaign);
  next.version += 1;

  if (editorial.x) {
    if (!Array.isArray(editorial.x.posts)) throw new TypeError('editorial.x.posts must be an array');
    next.drafts.x.posts = editorial.x.posts.map(String);
    next.drafts.x.claims = Array.isArray(editorial.x.claims)
      ? editorial.x.claims
      : inferClaims(next.drafts.x.posts.join('\n'), next.storyBrief, 'x');
  }
  if (editorial.linkedin) {
    if (typeof editorial.linkedin.text !== 'string') throw new TypeError('editorial.linkedin.text must be a string');
    next.drafts.linkedin.text = editorial.linkedin.text;
    next.drafts.linkedin.claims = Array.isArray(editorial.linkedin.claims)
      ? editorial.linkedin.claims
      : inferClaims(next.drafts.linkedin.text, next.storyBrief, 'linkedin');
  }

  next.structuralQuality = validateStructure(next.drafts);
  next.editorialQuality = validateClaims(next.drafts, next.storyBrief);
  next.qualityResult = Object.values(next.structuralQuality).every((x) => x.result === 'PASS') &&
    Object.values(next.editorialQuality).every((x) => x.result === 'PASS') ? 'PASS' : 'REVIEW';
  next.editorialStatus = 'needs_review';
  next.status = 'needs_review';
  invalidatePublishingState(next);
  next.updatedAt = new Date().toISOString();
  next.contentHash = contentHashFor(next);
  return next;
}


export function resolvePrivacyReview(campaign, { decision, note, reviewedAt = new Date().toISOString() } = {}) {
  if (!campaign) throw new TypeError('campaign is required');
  if (campaign.privacyResult !== 'REVIEW') throw new Error('campaign is not awaiting privacy review');

  const normalizedDecision = String(decision || '').trim().toUpperCase();
  if (!['PASS', 'BLOCK'].includes(normalizedDecision)) {
    throw new TypeError('privacy decision must be PASS or BLOCK');
  }
  const normalizedNote = String(note || '').trim();
  if (!normalizedNote) throw new TypeError('privacy review note is required');

  const date = new Date(reviewedAt);
  if (Number.isNaN(date.getTime())) throw new TypeError('invalid privacy review timestamp');

  const next = copy(campaign);
  next.version += 1;
  next.privacyReview = {
    from: 'REVIEW',
    decision: normalizedDecision,
    note: normalizedNote,
    reviewedAt: date.toISOString()
  };
  next.privacyResult = normalizedDecision;
  next.privacy = {
    ...(next.privacy || {}),
    result: normalizedDecision,
    reviewed: true
  };
  next.editorialStatus = 'needs_review';
  next.status = 'needs_review';
  invalidatePublishingState(next);
  next.updatedAt = date.toISOString();
  next.contentHash = contentHashFor(next);
  return next;
}

export function approveCampaign(campaign) {
  if (!campaign) throw new TypeError('campaign is required');
  if (campaign.privacyResult !== 'PASS') throw new Error(`campaign privacy is ${campaign.privacyResult}`);
  if (campaign.qualityResult && campaign.qualityResult !== 'PASS') throw new Error('campaign quality is not PASS');
  if (Object.values(campaign.structuralQuality || {}).some((x) => x.result !== 'PASS')) throw new Error('campaign structure is not PASS');
  if (Object.values(campaign.editorialQuality || {}).some((x) => x.result !== 'PASS')) throw new Error('campaign editorial quality is not PASS');

  const next = copy(campaign);
  next.editorialStatus = 'approved_for_handoff';
  next.status = 'approved_for_handoff';
  next.campaignApproval = {
    version: next.version,
    contentHash: next.contentHash,
    approvedAt: new Date().toISOString()
  };
  for (const platform of ['x', 'linkedin']) {
    const target = next.platform?.[platform];
    if (target) target.lifecycleStatus = target.schedule ? 'planned' : 'approved';
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function exportEditorial(campaign) {
  if (!campaign) throw new TypeError('campaign is required');
  return {
    campaignId: campaign.id,
    version: campaign.version,
    contentHash: campaign.contentHash,
    project: campaign.projectId,
    storyBrief: campaign.storyBrief,
    x: { type: 'thread', posts: campaign.drafts.x.posts, claims: campaign.drafts.x.claims },
    linkedin: { text: campaign.drafts.linkedin.text, claims: campaign.drafts.linkedin.claims },
    desiredFormats: { x: 'thread', linkedin: 'professional-narrative' },
    toneConstraints: ['factual', 'no invented claims', 'no credentials or PAG internals'],
    privacyConstraints: ['respect PASS/REVIEW/BLOCK', 'do not expose secrets']
  };
}
