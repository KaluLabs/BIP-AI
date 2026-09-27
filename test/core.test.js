import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePrivacy, evaluateStoryworthiness, normalizeProjectEvent, renderDrafts, buildStoryBrief } from '../src/core.js';

test('normalizes the minimum ProjectEvent', () => {
  const event = normalizeProjectEvent({ projectId: 'pag', type: 'feature', summary: 'Added approvals' });
  assert.equal(event.projectId, 'pag');
  assert.equal(event.type, 'feature');
  assert.equal(event.privacy, 'PASS');
});

test('rejects incomplete ProjectEvent objects', () => {
  assert.throws(() => normalizeProjectEvent({ type: 'feature', summary: 'x' }), /projectId/);
});

test('meaningful structured events clear the default threshold', () => {
  const event = normalizeProjectEvent({ projectId: 'pag', type: 'feature', summary: 'Added approvals', userVisible: true });
  const result = evaluateStoryworthiness(event);
  assert.equal(result.eligible, true);
  assert.equal(result.score, 4);
});

test('explicit privacy review is preserved', () => {
  const event = normalizeProjectEvent({ projectId: 'pag', type: 'feature', summary: 'Sensitive work', privacy: 'REVIEW' });
  assert.equal(evaluatePrivacy(event).result, 'REVIEW');
});

test('credential-shaped text is held for review', () => {
  const event = normalizeProjectEvent({ projectId: 'pag', type: 'feature', summary: 'Configured api_key=abcd1234' });
  assert.equal(evaluatePrivacy(event).result, 'REVIEW');
});

test('draft claims remain traceable to the story brief', () => {
  const event = normalizeProjectEvent({ projectId: 'pag', type: 'feature', summary: 'Added approvals', details: 'Added explicit approval flow', decisions: ['Keep publishing approval-gated'], nextStep: 'Dogfood it' });
  const drafts = renderDrafts(buildStoryBrief(event));
  assert.equal(drafts.x.claims[0].source, 'storyBrief.whatChanged');
  assert.ok(drafts.linkedin.claims.every((claim) => claim.source.startsWith('storyBrief.')));
});
