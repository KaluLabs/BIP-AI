import { evaluatePrivacy, evaluateStoryworthiness, sha256 } from './core.js';

export const NARRATIVE_MEMORY_SCHEMA_VERSION = 1;

const TITLES = {
  change: 'What changed',
  implementation: 'Implementation',
  decision: 'Decisions',
  lesson: 'Lessons',
  outcome: 'Outcomes',
  next_step: 'Next steps'
};

function normalizedControls(controls = []) {
  return [...controls]
    .map((item) => ({
      projectId: String(item.projectId || ''),
      entryId: String(item.entryId || ''),
      action: String(item.action || '')
    }))
    .filter((item) => item.entryId && ['archive', 'forget'].includes(item.action))
    .sort((a, b) => a.entryId.localeCompare(b.entryId));
}

function currentCampaignByEvent(campaigns) {
  const map = new Map();
  for (const campaign of campaigns || []) {
    const existing = map.get(campaign.eventId);
    if (!existing || Number(campaign.version || 0) >= Number(existing.version || 0)) {
      map.set(campaign.eventId, campaign);
    }
  }
  return map;
}

function eventItems(event) {
  const items = [];
  const add = (kind, path, text) => {
    if (typeof text !== 'string' || !text.trim()) return;
    items.push({ kind, path, text: text.trim() });
  };

  add('change', event.details ? 'event.details' : 'event.summary', event.details || event.summary);
  (event.implementation || []).forEach((text, index) => add('implementation', `event.implementation[${index}]`, text));
  (event.decisions || []).forEach((text, index) => add('decision', `event.decisions[${index}]`, text));
  (event.lessons || []).forEach((text, index) => add('lesson', `event.lessons[${index}]`, text));
  (event.outcomes || []).forEach((text, index) => add('outcome', `event.outcomes[${index}]`, text));
  add('next_step', 'event.nextStep', event.nextStep);
  return items;
}

function inputRevision({ projectId, events, campaigns, controls }) {
  return sha256({
    schemaVersion: NARRATIVE_MEMORY_SCHEMA_VERSION,
    projectId,
    events: [...events].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    campaigns: [...campaigns]
      .map((campaign) => ({
        id: campaign.id,
        eventId: campaign.eventId,
        version: campaign.version,
        contentHash: campaign.contentHash,
        privacyResult: campaign.privacyResult,
        editorialStatus: campaign.editorialStatus,
        campaignApproval: campaign.campaignApproval || null
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    controls: normalizedControls(controls)
  });
}

export function buildNarrativeMemory({ projectId, events = [], campaigns = [], controls = [] } = {}) {
  const id = String(projectId || '').trim();
  if (!id) throw new TypeError('projectId is required');

  const projectEvents = events.filter((event) => event.projectId === id);
  const projectCampaigns = campaigns.filter((campaign) => campaign.projectId === id);
  const campaignByEvent = currentCampaignByEvent(projectCampaigns);
  const controlMap = new Map(normalizedControls(controls).map((item) => [item.entryId, item.action]));
  const entries = [];
  let blockedSourceCount = 0;
  let forgottenCount = 0;

  for (const event of projectEvents) {
    const campaign = campaignByEvent.get(event.id) || null;
    const evaluatedPrivacy = evaluatePrivacy(event).result;
    const privacy = campaign?.privacyReview ? campaign.privacyResult : (campaign?.privacyResult || evaluatedPrivacy);
    if (privacy === 'BLOCK') {
      blockedSourceCount += 1;
      continue;
    }

    const meaningful = Boolean(campaign) || evaluateStoryworthiness(event).eligible;
    if (!meaningful) continue;

    for (const item of eventItems(event)) {
      const entryId = sha256({
        projectId: id,
        eventId: event.id,
        kind: item.kind,
        path: item.path,
        text: item.text
      }).slice(0, 24);
      const control = controlMap.get(entryId) || null;
      if (control === 'forget') {
        forgottenCount += 1;
        continue;
      }
      const state = control === 'archive' ? 'archived' : privacy === 'REVIEW' ? 'review' : 'active';
      entries.push({
        id: entryId,
        projectId: id,
        kind: item.kind,
        text: item.text,
        state,
        privacy,
        draftEligible: privacy === 'PASS' && state === 'active',
        occurredAt: event.occurredAt,
        eventType: event.type,
        source: event.source,
        sources: [{ type: 'event', id: event.id, path: item.path }],
        campaignRefs: campaign ? [{
          campaignId: campaign.id,
          version: campaign.version,
          contentHash: campaign.contentHash,
          editorialStatus: campaign.editorialStatus,
          approved: Boolean(campaign.campaignApproval)
        }] : []
      });
    }
  }

  entries.sort((a, b) => {
    const time = String(a.occurredAt || '').localeCompare(String(b.occurredAt || ''));
    return time || a.id.localeCompare(b.id);
  });

  const storyArcs = Object.entries(TITLES).map(([kind, title]) => {
    const matching = entries.filter((entry) => entry.kind === kind);
    return {
      kind,
      title,
      entryIds: matching.map((entry) => entry.id),
      activeCount: matching.filter((entry) => entry.state === 'active').length,
      reviewCount: matching.filter((entry) => entry.state === 'review').length,
      archivedCount: matching.filter((entry) => entry.state === 'archived').length
    };
  }).filter((arc) => arc.entryIds.length > 0);

  return {
    schemaVersion: NARRATIVE_MEMORY_SCHEMA_VERSION,
    projectId: id,
    revision: inputRevision({ projectId: id, events: projectEvents, campaigns: projectCampaigns, controls }),
    counts: {
      entries: entries.length,
      draftEligible: entries.filter((entry) => entry.draftEligible).length,
      review: entries.filter((entry) => entry.state === 'review').length,
      archived: entries.filter((entry) => entry.state === 'archived').length,
      blockedSources: blockedSourceCount,
      forgotten: forgottenCount
    },
    storyArcs,
    entries
  };
}

function projectInput(store, projectId) {
  return {
    projectId,
    events: store.listEvents(projectId),
    campaigns: store.listCampaigns(projectId),
    controls: store.listNarrativeControls(projectId)
  };
}

export function rebuildNarrativeMemory(store, projectId) {
  if (!store) throw new TypeError('store is required');
  const memory = buildNarrativeMemory(projectInput(store, projectId));
  store.saveNarrativeMemory(memory);
  return memory;
}

export function getNarrativeMemory(store, projectId) {
  if (!store) throw new TypeError('store is required');
  const candidate = buildNarrativeMemory(projectInput(store, projectId));
  const persisted = store.getNarrativeMemory(projectId);
  if (!persisted || persisted.revision !== candidate.revision) {
    store.saveNarrativeMemory(candidate);
    return { memory: candidate, rebuilt: true };
  }
  return { memory: persisted, rebuilt: false };
}

export function narrativeContextClaims(memory, { limit = 12, excludeEventId = null } = {}) {
  if (!memory) return [];
  const size = Math.max(0, Math.min(50, Number(limit) || 0));
  return memory.entries
    .filter((entry) => entry.draftEligible && (!excludeEventId || entry.sources?.[0]?.id !== excludeEventId))
    .slice()
    .sort((a, b) => {
      const time = String(b.occurredAt || '').localeCompare(String(a.occurredAt || ''));
      return time || b.id.localeCompare(a.id);
    })
    .slice(0, size)
    .map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      text: entry.text,
      occurredAt: entry.occurredAt,
      sources: structuredClone(entry.sources)
    }));
}

export function setNarrativeEntryControl(store, projectId, entryId, action) {
  if (!['archive', 'forget'].includes(action)) throw new TypeError('narrative action must be archive or forget');
  const current = getNarrativeMemory(store, projectId).memory;
  if (!current.entries.some((entry) => entry.id === entryId)) throw new Error('narrative entry not found');
  store.setNarrativeControl({ projectId, entryId, action });
  return rebuildNarrativeMemory(store, projectId);
}

export function restoreNarrativeEntry(store, projectId, entryId) {
  if (!store.getNarrativeControl(projectId, entryId)) throw new Error('narrative entry control not found');
  store.clearNarrativeControl(projectId, entryId);
  return rebuildNarrativeMemory(store, projectId);
}
