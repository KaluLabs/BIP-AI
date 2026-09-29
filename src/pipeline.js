import { createCampaign, evaluatePrivacy, evaluateStoryworthiness, fingerprintEvent, normalizeProjectEvent } from './core.js';
import { getNarrativeMemory, narrativeContextClaims, rebuildNarrativeMemory } from './narrative-memory.js';
import { buildEditorialPreferenceProfile } from './editorial-preference-profile.js';
import { applyPreferenceHintsToCampaign } from './editorial-preference-drafts.js';

export class BipAI {
  constructor({ store, storyThreshold = 3 } = {}) {
    if (!store) throw new TypeError('store is required');
    this.store = store;
    this.storyThreshold = storyThreshold;
  }

  ingest(input) {
    const event = normalizeProjectEvent(input);
    const fingerprint = fingerprintEvent(event);
    const existing = this.store.findEventByFingerprint(fingerprint);
    if (existing) return { accepted: false, duplicate: true, event: existing, campaign: null };

    const priorMemory = getNarrativeMemory(this.store, event.projectId).memory;
    const narrativeContext = narrativeContextClaims(priorMemory);

    this.store.saveEvent(event, fingerprint);
    const evaluation = evaluateStoryworthiness(event, this.storyThreshold);
    const privacy = evaluatePrivacy(event);

    if (privacy.result === 'BLOCK') {
      rebuildNarrativeMemory(this.store, event.projectId);
      return { accepted: true, duplicate: false, event, evaluation, privacy, campaign: null, reason: 'privacy_blocked' };
    }
    if (!evaluation.eligible) {
      rebuildNarrativeMemory(this.store, event.projectId);
      return { accepted: true, duplicate: false, event, evaluation, privacy, campaign: null, reason: 'below_story_threshold' };
    }

    const preferences = buildEditorialPreferenceProfile(this.store, event.projectId);
    const campaign = applyPreferenceHintsToCampaign(
      createCampaign(event, evaluation, privacy, narrativeContext),
      preferences
    );
    this.store.saveCampaign(campaign);
    rebuildNarrativeMemory(this.store, event.projectId);
    return { accepted: true, duplicate: false, event, evaluation, privacy, campaign };
  }
}
