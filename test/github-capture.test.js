import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubActivityClient,
  GitHubApiError,
  classifyGitHubError,
  mapRepositoryEvent,
  mapWorkflowRun,
  scanGitHubActivity
} from '../src/capture/github.js';

const context = { projectId: 'bip-ai', repository: 'victorkay97/BIP-AI', visibility: 'public' };

function repoEvent(id, type, payload, overrides = {}) {
  return {
    id: String(id),
    type,
    public: true,
    created_at: `2026-09-27T09:${String(Number(id) % 60).padStart(2, '0')}:00.000Z`,
    payload,
    ...overrides
  };
}

test('GitHub repository events normalize supported activity deterministically', () => {
  const push = repoEvent('101', 'PushEvent', {
    ref: 'refs/heads/main',
    head: 'abc123',
    commits: [
      { sha: 'a1', message: 'feat: add capture' },
      { sha: 'b2', message: 'fix: cursor bug' }
    ]
  });
  const opened = repoEvent('102', 'PullRequestEvent', {
    action: 'opened',
    number: 7,
    pull_request: { number: 7, title: 'Add GitHub source', html_url: 'https://github.com/x/y/pull/7', base: { ref: 'main' } }
  });
  const merged = repoEvent('103', 'PullRequestEvent', {
    action: 'closed',
    number: 7,
    pull_request: { number: 7, title: 'Add GitHub source', merged: true, merge_commit_sha: 'merge7', html_url: 'https://github.com/x/y/pull/7', base: { ref: 'main' } }
  });
  const issue = repoEvent('104', 'IssuesEvent', {
    action: 'closed',
    issue: { number: 12, title: 'Capture gap', html_url: 'https://github.com/x/y/issues/12' }
  });
  const release = repoEvent('105', 'ReleaseEvent', {
    action: 'published',
    release: { id: 44, name: 'v0.2.0', tag_name: 'v0.2.0', html_url: 'https://github.com/x/y/releases/tag/v0.2.0' }
  });

  const mapped = [
    ...mapRepositoryEvent(push, context),
    ...mapRepositoryEvent(opened, context),
    ...mapRepositoryEvent(merged, context),
    ...mapRepositoryEvent(issue, context),
    ...mapRepositoryEvent(release, context)
  ];

  assert.equal(mapped.length, 6);
  assert.deepEqual(mapped.map((event) => event.type), ['feature', 'fix', 'feature', 'milestone', 'milestone', 'release']);
  assert.ok(mapped.every((event) => event.source === 'github'));
  assert.ok(mapped.every((event) => event.privacy === 'PASS'));
  assert.ok(mapped.every((event) => event.metadata.externalId));
  assert.ok(mapped.every((event) => event.evidence[0].externalId === event.metadata.externalId));
  assert.match(mapped[0].evidence[0].url, /commit\/a1$/);
});

test('completed GitHub Actions success and failure map to milestone ProjectEvents', () => {
  const success = mapWorkflowRun({
    id: 9001,
    status: 'completed',
    conclusion: 'success',
    name: 'CI',
    run_number: 38,
    run_attempt: 1,
    head_branch: 'main',
    head_sha: 'abc',
    html_url: 'https://github.com/x/y/actions/runs/9001',
    updated_at: '2026-09-27T10:00:00.000Z'
  }, context)[0];
  const failure = mapWorkflowRun({
    id: 9002,
    status: 'completed',
    conclusion: 'failure',
    name: 'Release',
    run_number: 39,
    run_attempt: 1,
    head_branch: 'main',
    head_sha: 'def',
    html_url: 'https://github.com/x/y/actions/runs/9002',
    updated_at: '2026-09-27T10:01:00.000Z'
  }, context)[0];

  assert.equal(success.type, 'milestone');
  assert.match(success.summary, /succeeded/);
  assert.equal(failure.importance, 'high');
  assert.match(failure.summary, /failed/);
  assert.equal(mapWorkflowRun({ id: 9003, status: 'completed', conclusion: 'cancelled' }, context).length, 0);
});

test('private or non-public repository events default to privacy REVIEW', () => {
  const privateContext = { ...context, visibility: 'private' };
  const raw = repoEvent('201', 'IssuesEvent', {
    action: 'closed',
    issue: { number: 1, title: 'Internal launch', html_url: 'https://github.com/x/y/issues/1' }
  });
  const privateEvent = mapRepositoryEvent(raw, privateContext)[0];
  assert.equal(privateEvent.privacy, 'REVIEW');
  assert.equal(privateEvent.userVisible, false);

  const hiddenRaw = { ...raw, id: '202', public: false };
  const hiddenEvent = mapRepositoryEvent(hiddenRaw, context)[0];
  assert.equal(hiddenEvent.privacy, 'REVIEW');
});

test('GitHub activity scan combines repository and workflow cursors and is replay-safe', async () => {
  const eventFeed = [
    repoEvent('303', 'ReleaseEvent', { action: 'published', release: { id: 3, tag_name: 'v3', html_url: 'https://github.com/x/y/releases/3' } }),
    repoEvent('302', 'IssuesEvent', { action: 'closed', issue: { number: 2, title: 'Second', html_url: 'https://github.com/x/y/issues/2' } }),
    repoEvent('301', 'IssuesEvent', { action: 'closed', issue: { number: 1, title: 'First', html_url: 'https://github.com/x/y/issues/1' } })
  ];
  const runs = [
    { id: 503, status: 'completed', conclusion: 'failure', name: 'CI', run_number: 3, run_attempt: 1, head_branch: 'main', html_url: 'https://github.com/x/y/actions/503', updated_at: '2026-09-27T10:03:00.000Z' },
    { id: 502, status: 'completed', conclusion: 'success', name: 'CI', run_number: 2, run_attempt: 1, head_branch: 'main', html_url: 'https://github.com/x/y/actions/502', updated_at: '2026-09-27T10:02:00.000Z' },
    { id: 501, status: 'completed', conclusion: 'success', name: 'CI', run_number: 1, run_attempt: 1, head_branch: 'main', html_url: 'https://github.com/x/y/actions/501', updated_at: '2026-09-27T10:01:00.000Z' }
  ];
  const client = {
    async repositoryEvents() { return { notModified: false, data: eventFeed, etag: '"events-v1"', pollIntervalMs: 90_000 }; },
    async workflowRuns() { return { notModified: false, data: { workflow_runs: runs }, etag: '"runs-v1"', pollIntervalMs: 120_000 }; }
  };

  const first = await scanGitHubActivity({
    client,
    projectId: 'bip-ai',
    repository: 'victorkay97/BIP-AI',
    visibility: 'public',
    limit: 2,
    pollMs: 300_000
  });

  assert.equal(first.events.length, 4);
  assert.equal(first.cursor.events.id, '303');
  assert.match(first.cursor.workflows.key, /^503:1:/);
  assert.equal(first.cursor.repository, 'victorkay97/BIP-AI');
  assert.equal(first.meta.nextPollMs, 300_000);

  const unchangedClient = {
    async repositoryEvents(repository, { etag }) {
      assert.equal(etag, '"events-v1"');
      return { notModified: true, data: null, etag, pollIntervalMs: 90_000 };
    },
    async workflowRuns(repository, { etag }) {
      assert.equal(etag, '"runs-v1"');
      return { notModified: true, data: null, etag, pollIntervalMs: 120_000 };
    }
  };
  const second = await scanGitHubActivity({
    client: unchangedClient,
    projectId: 'bip-ai',
    repository: 'victorkay97/BIP-AI',
    visibility: 'public',
    cursor: first.cursor,
    limit: 2,
    pollMs: 300_000
  });
  assert.deepEqual(second.events, []);
  assert.deepEqual(second.cursor, first.cursor);
});

test('cursor batching catches up oldest-first without skipping new activity', async () => {
  const feed = [
    repoEvent('405', 'IssuesEvent', { action: 'closed', issue: { number: 5, title: 'Five', html_url: 'u5' } }),
    repoEvent('404', 'IssuesEvent', { action: 'closed', issue: { number: 4, title: 'Four', html_url: 'u4' } }),
    repoEvent('403', 'IssuesEvent', { action: 'closed', issue: { number: 3, title: 'Three', html_url: 'u3' } }),
    repoEvent('402', 'IssuesEvent', { action: 'closed', issue: { number: 2, title: 'Two', html_url: 'u2' } }),
    repoEvent('401', 'IssuesEvent', { action: 'closed', issue: { number: 1, title: 'One', html_url: 'u1' } })
  ];
  const client = {
    async repositoryEvents() { return { notModified: false, data: feed, etag: '"e2"', pollIntervalMs: 60_000 }; },
    async workflowRuns() { return { notModified: false, data: { workflow_runs: [] }, etag: '"w2"', pollIntervalMs: 60_000 }; }
  };
  const cursor = {
    repository: 'victorkay97/BIP-AI',
    events: { id: '401', etag: null },
    workflows: { key: null, etag: null }
  };
  const first = await scanGitHubActivity({
    client, projectId: 'p', repository: 'victorkay97/BIP-AI', visibility: 'public', cursor, limit: 2
  });
  assert.deepEqual(first.events.map((event) => event.metadata.github.number), [2, 3]);
  assert.equal(first.cursor.events.id, '403');
  assert.equal(first.cursor.events.etag, null);
  assert.equal(first.meta.remaining, 2);
});

test('GitHub client sends token only as request header and classifies rate limiting', async () => {
  let observed;
  const fetchImpl = async (url, options) => {
    observed = { url, headers: options.headers };
    return new Response(JSON.stringify({ message: 'rate limit' }), {
      status: 429,
      headers: { 'retry-after': '30', 'content-type': 'application/json' }
    });
  };
  const client = new GitHubActivityClient({ token: 'test-secret-token', fetchImpl });

  await assert.rejects(
    () => client.repositoryEvents('victorkay97/BIP-AI'),
    (error) => {
      assert.ok(error instanceof GitHubApiError);
      assert.equal(error.code, 'github_rate_limited');
      assert.equal(error.retryAfterMs, 30_000);
      return true;
    }
  );

  assert.equal(observed.headers.authorization, 'Bearer test-secret-token');
  assert.doesNotMatch(observed.url, /test-secret-token/);
  const safe = classifyGitHubError(new GitHubApiError('github_transient_error', 'GitHub API is temporarily unavailable', { status: 503 }));
  assert.deepEqual(safe, { code: 'github_transient_error', summary: 'GitHub API is temporarily unavailable', retryAfterMs: null });
});


test('workflow rerun changes the attempt-aware cursor and emits a new milestone', async () => {
  const firstRun = {
    id: 700,
    status: 'completed',
    conclusion: 'failure',
    name: 'CI',
    run_number: 7,
    run_attempt: 1,
    head_branch: 'main',
    html_url: 'https://github.com/x/y/actions/700',
    updated_at: '2026-09-27T11:00:00.000Z'
  };
  const firstClient = {
    async repositoryEvents() { return { notModified: false, data: [], etag: '"e"', pollIntervalMs: 60000 }; },
    async workflowRuns() { return { notModified: false, data: { workflow_runs: [firstRun] }, etag: '"w1"', pollIntervalMs: 60000 }; }
  };
  const first = await scanGitHubActivity({
    client: firstClient,
    projectId: 'p',
    repository: 'victorkay97/BIP-AI',
    visibility: 'public'
  });
  assert.equal(first.events.length, 1);

  const rerun = {
    ...firstRun,
    conclusion: 'success',
    run_attempt: 2,
    updated_at: '2026-09-27T11:05:00.000Z'
  };
  const secondClient = {
    async repositoryEvents(repository, { etag }) {
      return { notModified: true, data: null, etag, pollIntervalMs: 60000 };
    },
    async workflowRuns() {
      return { notModified: false, data: { workflow_runs: [rerun] }, etag: '"w2"', pollIntervalMs: 60000 };
    }
  };
  const second = await scanGitHubActivity({
    client: secondClient,
    projectId: 'p',
    repository: 'victorkay97/BIP-AI',
    visibility: 'public',
    cursor: first.cursor
  });
  assert.equal(second.events.length, 1);
  assert.match(second.events[0].summary, /succeeded/);
  assert.notEqual(second.cursor.workflows.key, first.cursor.workflows.key);
});

test('GitHub API base URL rejects embedded credentials', () => {
  assert.throws(
    () => new GitHubActivityClient({ baseUrl: 'https://user:secret@api.github.com' }),
    /must not contain credentials/
  );
});
