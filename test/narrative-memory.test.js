import test from 'node:test';
import assert from 'node:assert/strict';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import {
  getNarrativeMemory,
  narrativeContextClaims,
  rebuildNarrativeMemory,
  restoreNarrativeEntry,
  setNarrativeEntryControl
} from '../src/narrative-memory.js';
import { resolvePrivacyReview, validateClaims } from '../src/editorial.js';
import { allowedStoryClaims } from '../src/drafting.js';

function feature(projectId, summary, extra = {}) {
  return {
    projectId,
    type: 'feature',
    summary,
    details: extra.details || summary,
    userVisible: true,
    occurredAt: extra.occurredAt || '2026-09-27T00:00:00.000Z',
    decisions: extra.decisions || [],
    lessons: extra.lessons || [],
    outcomes: extra.outcomes || [],
    nextStep: extra.nextStep || null,
    privacy: extra.privacy || 'PASS'
  };
}

test('narrative memory is project-isolated and every entry is event-source-addressable', () => {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  try {
    const a = app.ingest(feature('alpha', 'Built alpha', { decisions: ['Use SQLite'] }));
    const b = app.ingest(feature('beta', 'Built beta'));

    const alpha = getNarrativeMemory(store, 'alpha').memory;
    const beta = getNarrativeMemory(store, 'beta').memory;

    assert.ok(alpha.entries.length >= 2);
    assert.ok(beta.entries.length >= 1);
    assert.ok(alpha.entries.every((entry) => entry.projectId === 'alpha'));
    assert.ok(beta.entries.every((entry) => entry.projectId === 'beta'));
    assert.ok(alpha.entries.every((entry) => entry.sources.length === 1 && entry.sources[0].id === a.event.id));
    assert.ok(beta.entries.every((entry) => entry.sources.length === 1 && entry.sources[0].id === b.event.id));
    assert.ok(alpha.entries.every((entry) => entry.sources[0].path.startsWith('event.')));
  } finally {
    store.close();
  }
});

test('privacy REVIEW stays non-draftable and BLOCK is omitted from narrative memory', () => {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  try {
    const review = app.ingest(feature('privacy', 'Needs privacy review', { privacy: 'REVIEW' }));
    app.ingest(feature('privacy', 'Must stay blocked', {
      privacy: 'BLOCK',
      occurredAt: '2026-09-27T01:00:00.000Z'
    }));

    const memory = getNarrativeMemory(store, 'privacy').memory;
    const reviewEntries = memory.entries.filter((entry) => entry.sources[0].id === review.event.id);

    assert.ok(reviewEntries.length > 0);
    assert.ok(reviewEntries.every((entry) => entry.state === 'review'));
    assert.ok(reviewEntries.every((entry) => entry.draftEligible === false));
    assert.equal(memory.counts.blockedSources, 1);
    assert.doesNotMatch(JSON.stringify(memory), /Must stay blocked/);
  } finally {
    store.close();
  }
});

test('explicit privacy PASS resolution invalidates stale memory and makes reviewed evidence eligible', () => {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  try {
    const seeded = app.ingest(feature('review-pass', 'Reviewed milestone', { privacy: 'REVIEW' }));
    const before = getNarrativeMemory(store, 'review-pass').memory;
    assert.equal(before.counts.draftEligible, 0);

    const resolved = resolvePrivacyReview(seeded.campaign, {
      decision: 'PASS',
      note: 'Reviewed for public use',
      reviewedAt: '2026-09-27T02:00:00.000Z'
    });
    store.saveCampaignVersion(resolved);

    const after = getNarrativeMemory(store, 'review-pass');
    assert.equal(after.rebuilt, true);
    assert.notEqual(after.memory.revision, before.revision);
    assert.ok(after.memory.entries.every((entry) => entry.privacy === 'PASS'));
    assert.ok(after.memory.entries.every((entry) => entry.draftEligible));
  } finally {
    store.close();
  }
});

test('narrative rebuild is deterministic for unchanged project state', () => {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  try {
    app.ingest(feature('stable', 'Stable memory', {
      decisions: ['Keep evidence bound'],
      lessons: ['Rebuild from source state'],
      outcomes: ['Deterministic output']
    }));
    const first = rebuildNarrativeMemory(store, 'stable');
    const second = rebuildNarrativeMemory(store, 'stable');
    assert.deepEqual(second, first);
  } finally {
    store.close();
  }
});

test('archive, forget, and restore controls are project-scoped', () => {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  try {
    app.ingest(feature('controls', 'Controllable memory'));
    const original = getNarrativeMemory(store, 'controls').memory;
    const entry = original.entries[0];

    const archived = setNarrativeEntryControl(store, 'controls', entry.id, 'archive');
    const archivedEntry = archived.entries.find((item) => item.id === entry.id);
    assert.equal(archivedEntry.state, 'archived');
    assert.equal(archivedEntry.draftEligible, false);

    const forgotten = setNarrativeEntryControl(store, 'controls', entry.id, 'forget');
    assert.equal(forgotten.entries.some((item) => item.id === entry.id), false);
    assert.equal(forgotten.counts.forgotten, 1);

    const restored = restoreNarrativeEntry(store, 'controls', entry.id);
    const restoredEntry = restored.entries.find((item) => item.id === entry.id);
    assert.equal(restoredEntry.state, 'active');
    assert.equal(restoredEntry.draftEligible, true);
  } finally {
    store.close();
  }
});

test('new campaigns receive prior narrative context without copying the current event into context', () => {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  try {
    const first = app.ingest(feature('context', 'Built the foundation', {
      decisions: ['Keep approvals exact'],
      occurredAt: '2026-09-27T00:00:00.000Z'
    }));
    const second = app.ingest(feature('context', 'Added the next capability', {
      occurredAt: '2026-09-27T03:00:00.000Z'
    }));

    const context = second.campaign.storyBrief.narrativeContext;
    assert.ok(context.length > 0);
    assert.ok(context.every((item) => item.sources[0].id === first.event.id));
    assert.ok(context.every((item) => item.sources[0].id !== second.event.id));
    assert.ok(second.campaign.drafts.linkedin.claims.some((claim) => claim.source === 'storyBrief.narrativeContext[0]'));
    assert.equal(validateClaims(second.campaign.drafts, second.campaign.storyBrief).linkedin.result, 'PASS');
  } finally {
    store.close();
  }
});

test('provider allow-list includes only active draft-eligible narrative context', () => {
  const store = new BipStore(':memory:');
  const app = new BipAI({ store });
  try {
    app.ingest(feature('provider-context', 'Earlier evidence'));
    const memory = getNarrativeMemory(store, 'provider-context').memory;
    const context = narrativeContextClaims(memory);
    const next = app.ingest(feature('provider-context', 'Current evidence', {
      occurredAt: '2026-09-27T04:00:00.000Z'
    }));
    const claims = allowedStoryClaims(next.campaign.storyBrief);
    assert.ok(context.length > 0);
    assert.ok(claims.some((claim) => claim.source.startsWith('storyBrief.narrativeContext[')));
  } finally {
    store.close();
  }
});
