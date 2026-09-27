import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListQuery, queryCampaigns, queryEvents, sourceIndex } from '../src/query.js';

function event(id, overrides = {}) {
  return {
    id,
    projectId: 'bip-ai',
    type: 'feature',
    summary: `Summary ${id}`,
    details: `Details ${id}`,
    source: 'manual',
    occurredAt: '2026-09-27T10:00:00.000Z',
    implementation: [],
    decisions: [],
    lessons: [],
    outcomes: [],
    nextStep: null,
    privacy: { result: 'PASS', findings: [] },
    ...overrides
  };
}

function campaign(id, eventId, overrides = {}) {
  return {
    id,
    eventId,
    projectId: 'bip-ai',
    status: 'draft_ready',
    editorialStatus: 'draft_ready',
    privacyResult: 'PASS',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
    storyBrief: {
      hook: `Hook ${id}`,
      whatChanged: `Changed ${id}`,
      implementation: [],
      decisions: [],
      lessons: [],
      outcomes: [],
      nextStep: null
    },
    drafts: { x: { posts: [`X ${id}`] }, linkedin: { text: `LinkedIn ${id}` } },
    platform: {
      x: { lifecycleStatus: 'drafted', handoffStatus: 'not_requested', schedule: null },
      linkedin: { lifecycleStatus: 'drafted', handoffStatus: 'not_requested', schedule: null }
    },
    ...overrides
  };
}

test('event query combines project privacy source search and date filters', () => {
  const events = [
    event('a', { summary: 'Launch alpha', source: 'git', occurredAt: '2026-09-26T09:00:00.000Z' }),
    event('b', { summary: 'Launch beta', source: 'git', occurredAt: '2026-09-27T09:00:00.000Z' }),
    event('c', { projectId: 'other', summary: 'Launch gamma', source: 'git', occurredAt: '2026-09-27T11:00:00.000Z' }),
    event('d', { summary: 'Private launch', source: 'manual', occurredAt: '2026-09-27T12:00:00.000Z', privacy: { result: 'REVIEW' } })
  ];
  const query = parseListQuery(new URLSearchParams({
    q: 'launch',
    projectId: 'bip-ai',
    privacy: 'PASS',
    source: 'git',
    from: '2026-09-27',
    to: '2026-09-27',
    sort: 'occurredAt',
    order: 'asc'
  }), 'events');

  const result = queryEvents(events, query);
  assert.deepEqual(result.items.map((item) => item.id), ['b']);
  assert.equal(result.pagination.total, 1);
});

test('pagination is stable and uses id as deterministic tie breaker', () => {
  const events = ['d', 'b', 'c', 'a'].map((id) => event(id));
  const page1 = queryEvents(events, parseListQuery(new URLSearchParams({
    sort: 'occurredAt', order: 'desc', page: '1', pageSize: '2'
  }), 'events'));
  const page2 = queryEvents(events, parseListQuery(new URLSearchParams({
    sort: 'occurredAt', order: 'desc', page: '2', pageSize: '2'
  }), 'events'));

  assert.deepEqual(page1.items.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(page2.items.map((item) => item.id), ['c', 'd']);
  assert.equal(new Set([...page1.items, ...page2.items].map((item) => item.id)).size, 4);
  assert.equal(page1.pagination.hasNext, true);
  assert.equal(page2.pagination.hasNext, false);
});

test('campaign source status platform and scheduled range filters compose', () => {
  const events = [
    event('e1', { source: 'github' }),
    event('e2', { source: 'manual' })
  ];
  const campaigns = [
    campaign('c1', 'e1', {
      platform: {
        x: {
          lifecycleStatus: 'planned',
          handoffStatus: 'not_requested',
          schedule: { status: 'planned', scheduledAtUtc: '2026-09-29T08:00:00.000Z' }
        },
        linkedin: { lifecycleStatus: 'drafted', handoffStatus: 'not_requested', schedule: null }
      }
    }),
    campaign('c2', 'e2', {
      platform: {
        x: {
          lifecycleStatus: 'planned',
          handoffStatus: 'not_requested',
          schedule: { status: 'planned', scheduledAtUtc: '2026-09-29T09:00:00.000Z' }
        },
        linkedin: { lifecycleStatus: 'drafted', handoffStatus: 'not_requested', schedule: null }
      }
    })
  ];

  const query = parseListQuery(new URLSearchParams({
    source: 'github',
    platform: 'x',
    status: 'planned',
    sort: 'scheduledAt',
    from: '2026-09-29',
    to: '2026-09-29'
  }), 'campaigns');

  const result = queryCampaigns(campaigns, query, { sourceByEventId: sourceIndex(events) });
  assert.deepEqual(result.items.map((item) => item.id), ['c1']);
  assert.equal(result.items[0].source, 'github');
});

test('unscheduled campaigns stay after scheduled campaigns in both sort directions', () => {
  const campaigns = [
    campaign('scheduled', 'e1', {
      platform: {
        x: {
          lifecycleStatus: 'planned',
          handoffStatus: 'not_requested',
          schedule: { status: 'planned', scheduledAtUtc: '2026-09-29T08:00:00.000Z' }
        },
        linkedin: { lifecycleStatus: 'drafted', handoffStatus: 'not_requested', schedule: null }
      }
    }),
    campaign('unscheduled', 'e2')
  ];

  for (const order of ['asc', 'desc']) {
    const result = queryCampaigns(campaigns, parseListQuery(new URLSearchParams({
      platform: 'x', sort: 'scheduledAt', order
    }), 'campaigns'));
    assert.equal(result.items[0].id, 'scheduled');
    assert.equal(result.items[1].id, 'unscheduled');
  }
});

test('query parser rejects unknown parameters invalid enums sorts and pagination', () => {
  assert.throws(
    () => parseListQuery(new URLSearchParams({ nope: '1' }), 'events'),
    /unsupported query parameter/
  );
  assert.throws(
    () => parseListQuery(new URLSearchParams({ privacy: 'MAYBE' }), 'events'),
    /privacy/
  );
  assert.throws(
    () => parseListQuery(new URLSearchParams({ platform: 'instagram' }), 'campaigns'),
    /platform/
  );
  assert.throws(
    () => parseListQuery(new URLSearchParams({ sort: 'banana' }), 'campaigns'),
    /sort/
  );
  assert.throws(
    () => parseListQuery(new URLSearchParams({ pageSize: '101' }), 'events'),
    /pageSize/
  );
  assert.throws(
    () => parseListQuery(new URLSearchParams({ from: '2026-09-29', to: '2026-09-28' }), 'events'),
    /from must not be after to/
  );
});
