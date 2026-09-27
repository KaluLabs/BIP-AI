import { createCampaign, evaluatePrivacy, evaluateStoryworthiness, fingerprintEvent, normalizeProjectEvent } from './core.js';

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

    this.store.saveEvent(event, fingerprint);
    const evaluation = evaluateStoryworthiness(event, this.storyThreshold);
    const privacy = evaluatePrivacy(event);

    if (privacy.result === 'BLOCK') {
      return { accepted: true, duplicate: false, event, evaluation, privacy, campaign: null, reason: 'privacy_blocked' };
    }
    if (!evaluation.eligible) {
      return { accepted: true, duplicate: false, event, evaluation, privacy, campaign: null, reason: 'below_story_threshold' };
    }

    const campaign = createCampaign(event, evaluation, privacy);
    this.store.saveCampaign(campaign);
    return { accepted: true, duplicate: false, event, evaluation, privacy, campaign };
  }
}
