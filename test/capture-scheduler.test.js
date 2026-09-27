import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BipStore } from '../src/store.js';
import { BipAI } from '../src/pipeline.js';
import { ProjectRegistry } from '../src/projects.js';
import {
  CaptureScheduler,
  captureStatus,
  runCaptureOnce,
  runGitCaptureProject,
  runGitHubCaptureProject
} from '../src/capture/scheduler.js';
import { GitHubApiError } from '../src/capture/github.js';

function git(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim();
}

function initRepo(root) {
  const repoPath = join(root, 'repo');
  mkdirSync(repoPath, { recursive: true });
  execFileSync('git', ['init', repoPath], { stdio: 'ignore' });
  git(repoPath, ['config', 'user.email', 'bip-ai-test@example.test']);
  git(repoPath, ['config', 'user.name', 'BIP-AI Test']);
  return repoPath;
}

function commit(repoPath, message, value) {
  const file = join(repoPath, 'activity.txt');
  if (value === 1) writeFileSync(file, `${value}\n`);
  else appendFileSync(file, `${value}\n`);
  git(repoPath, ['add', 'activity.txt']);
  git(repoPath, ['commit', '-m', message]);
  return git(repoPath, ['rev-parse', 'HEAD']);
}

function event(id, occurredAt) {
  return {
    id,
    projectId: 'p',
    type: 'feature',
    summary: `Event ${id}`,
    details: `Captured event ${id}`,
    source: 'git',
    occurredAt,
    userVisible: true
  };
}

test('Git cursor survives restart and only new commits are captured afterward', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-capture-restart-'));
  const repoPath = initRepo(root);
  git(repoPath, ['remote', 'add', 'origin', 'https://user:super-secret@example.com/org/repo.git']);
  commit(repoPath, 'feat: first', 1);
  const secondSha = commit(repoPath, 'fix: second', 2);

  const db = join(root, 'state.sqlite');
  const projectsFile = join(root, 'projects.json');

  const store1 = new BipStore(db);
  const projects1 = new ProjectRegistry(projectsFile);
  projects1.add({ id: 'p', path: repoPath });
  const app1 = new BipAI({ store: store1, storyThreshold: 99 });
  const scheduler1 = new CaptureScheduler({ store: store1, app: app1, projects: projects1, pollMs: 1000 });

  const first = await scheduler1.runOnce({ force: true, now: '2026-09-27T09:00:00.000Z' });
  assert.equal(first.succeeded, 1);
  assert.equal(first.results[0].scan.scanned, 2);
  assert.equal(first.results[0].scan.accepted, 2);
  assert.equal(store1.listEvents('p').length, 2);
  assert.equal(store1.getCaptureState('git:p').cursor.headSha, secondSha);
  assert.equal(store1.listEvents('p')[0].metadata.git.repository, 'https://example.com/org/repo.git');
  assert.doesNotMatch(JSON.stringify(store1.listEvents('p')), /super-secret|user:super-secret/);
  store1.close();

  const thirdSha = commit(repoPath, 'feat: third', 3);

  const store2 = new BipStore(db);
  const projects2 = new ProjectRegistry(projectsFile);
  const app2 = new BipAI({ store: store2, storyThreshold: 99 });
  const scheduler2 = new CaptureScheduler({ store: store2, app: app2, projects: projects2, pollMs: 1000 });

  try {
    const second = await scheduler2.runOnce({ force: true, now: '2026-09-27T09:01:00.000Z' });
    assert.equal(second.results[0].scan.scanned, 1);
    assert.equal(second.results[0].scan.accepted, 1);
    assert.equal(second.results[0].scan.duplicates, 0);
    assert.equal(store2.listEvents('p').length, 3);
    assert.equal(store2.getCaptureState('git:p').cursor.headSha, thirdSha);
  } finally {
    store2.close();
  }
});

test('partial batch failure leaves cursor unchanged and replay deduplicates already persisted events', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-capture-replay-'));
  const store = new BipStore(':memory:');
  const app = new BipAI({ store, storyThreshold: 99 });
  const project = { id: 'p', name: 'p', path: root };
  const events = [
    event('e1', '2026-09-27T09:00:00.000Z'),
    event('e2', '2026-09-27T09:01:00.000Z')
  ];
  const scan = async () => ({
    events,
    cursor: { headSha: 'head-2' },
    meta: { remaining: 0, historyRewritten: false }
  });

  let calls = 0;
  const flakyApp = {
    ingest(value) {
      calls += 1;
      if (calls === 2) throw new Error('simulated ingest crash');
      return app.ingest(value);
    }
  };

  try {
    const failed = await runGitCaptureProject({
      store,
      app: flakyApp,
      project,
      scan,
      force: true,
      now: '2026-09-27T09:00:00.000Z'
    });
    assert.equal(failed.ok, false);
    assert.equal(store.getCaptureState('git:p').cursor, null);
    assert.equal(store.listEvents('p').length, 1);

    const replayed = await runGitCaptureProject({
      store,
      app,
      project,
      scan,
      force: true,
      now: '2026-09-27T09:02:00.000Z'
    });
    assert.equal(replayed.ok, true);
    assert.equal(replayed.scan.accepted, 1);
    assert.equal(replayed.scan.duplicates, 1);
    assert.equal(store.listEvents('p').length, 2);
    assert.deepEqual(store.getCaptureState('git:p').cursor, { headSha: 'head-2' });
  } finally {
    store.close();
  }
});

test('one project failure does not corrupt or block another project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-capture-isolation-'));
  const store = new BipStore(':memory:');
  const app = new BipAI({ store, storyThreshold: 99 });
  const projectList = [
    { id: 'good', name: 'good', path: root },
    { id: 'bad', name: 'bad', path: root }
  ];
  const projects = {
    list: () => projectList,
    get: (id) => projectList.find((item) => item.id === id) || null
  };
  const scan = async ({ projectId }) => {
    if (projectId === 'bad') throw new Error('simulated source failure');
    return {
      events: [{
        ...event('good-1', '2026-09-27T09:00:00.000Z'),
        projectId: 'good'
      }],
      cursor: { headSha: 'good-head' },
      meta: { remaining: 0, historyRewritten: false }
    };
  };

  try {
    const cycle = await runCaptureOnce({
      store,
      app,
      projects,
      scan,
      force: true,
      now: '2026-09-27T09:00:00.000Z'
    });
    assert.equal(cycle.succeeded, 1);
    assert.equal(cycle.failed, 1);
    assert.equal(store.getCaptureState('git:good').cursor.headSha, 'good-head');
    assert.equal(store.getCaptureState('git:good').health.status, 'healthy');
    assert.equal(store.getCaptureState('git:bad').cursor, null);
    assert.equal(store.getCaptureState('git:bad').health.status, 'degraded');
    assert.equal(store.listEvents('good').length, 1);
  } finally {
    store.close();
  }
});

test('failed capture uses bounded exponential backoff and skips early retries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-capture-backoff-'));
  const store = new BipStore(':memory:');
  const project = { id: 'p', name: 'p', path: root };
  const app = { ingest() { throw new Error('should not ingest'); } };
  const scan = async () => { throw new Error('offline'); };

  try {
    const first = await runGitCaptureProject({
      store, app, project, scan,
      now: '2026-09-27T09:00:00.000Z',
      retryBaseMs: 1000,
      retryMaxMs: 4000
    });
    assert.equal(first.ok, false);
    assert.equal(first.health.retryBackoffMs, 1000);
    assert.equal(first.health.nextAttemptAt, '2026-09-27T09:00:01.000Z');

    const skipped = await runGitCaptureProject({
      store, app, project, scan,
      now: '2026-09-27T09:00:00.500Z',
      retryBaseMs: 1000,
      retryMaxMs: 4000
    });
    assert.equal(skipped.attempted, false);
    assert.equal(skipped.skipped, 'backoff');

    const second = await runGitCaptureProject({
      store, app, project, scan,
      now: '2026-09-27T09:00:01.000Z',
      retryBaseMs: 1000,
      retryMaxMs: 4000
    });
    assert.equal(second.health.retryBackoffMs, 2000);

    const third = await runGitCaptureProject({
      store, app, project, scan,
      force: true,
      now: '2026-09-27T09:00:02.000Z',
      retryBaseMs: 1000,
      retryMaxMs: 4000
    });
    const fourth = await runGitCaptureProject({
      store, app, project, scan,
      force: true,
      now: '2026-09-27T09:00:03.000Z',
      retryBaseMs: 1000,
      retryMaxMs: 4000
    });
    assert.equal(third.health.retryBackoffMs, 4000);
    assert.equal(fourth.health.retryBackoffMs, 4000);
    assert.equal(fourth.health.consecutiveFailures, 4);
  } finally {
    store.close();
  }
});

test('capture status reports never-run and persisted source health without credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-capture-status-'));
  const store = new BipStore(':memory:');
  const projects = {
    list: () => [{
      id: 'p',
      name: 'Project P',
      path: root,
      github: { repository: 'victorkay97/BIP-AI', visibility: 'private' }
    }],
    get: () => null
  };

  try {
    const initial = captureStatus(store, projects);
    assert.equal(initial.length, 2);
    assert.ok(initial.every((item) => item.health.status === 'never_run'));
    assert.equal(initial.find((item) => item.sourceType === 'github').repository, 'victorkay97/BIP-AI');

    store.saveCaptureState({
      sourceKey: 'git:p',
      projectId: 'p',
      sourceType: 'git',
      cursor: { headSha: 'abc123' },
      health: { status: 'healthy', lastSuccessAt: '2026-09-27T09:00:00.000Z' }
    });
    store.saveCaptureState({
      sourceKey: 'github:p',
      projectId: 'p',
      sourceType: 'github',
      cursor: { eventId: 'evt-1' },
      health: { status: 'healthy', lastSuccessAt: '2026-09-27T09:01:00.000Z' }
    });
    const persisted = captureStatus(store, projects);
    assert.equal(persisted.length, 2);
    assert.equal(persisted.find((item) => item.sourceType === 'git').cursor.headSha, 'abc123');
    assert.equal(persisted.find((item) => item.sourceType === 'github').cursor.eventId, 'evt-1');
    assert.ok(persisted.every((item) => item.health.status === 'healthy'));
    assert.doesNotMatch(JSON.stringify(persisted), /token|password|credential|secret/i);
  } finally {
    store.close();
  }
});


test('rewritten Git history recovers through bounded replay and reports a warning', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-capture-rewrite-'));
  const repoPath = initRepo(root);
  commit(repoPath, 'feat: base', 1);
  commit(repoPath, 'feat: old tip', 2);

  const store = new BipStore(':memory:');
  const projectsFile = join(root, 'projects.json');
  const projects = new ProjectRegistry(projectsFile);
  projects.add({ id: 'p', path: repoPath });
  const app = new BipAI({ store, storyThreshold: 99 });
  const scheduler = new CaptureScheduler({ store, app, projects, pollMs: 1000, batchSize: 50 });

  try {
    const initial = await scheduler.runOnce({ force: true, now: '2026-09-27T09:00:00.000Z' });
    assert.equal(initial.results[0].health.status, 'healthy');
    const oldCursor = store.getCaptureState('git:p').cursor.headSha;

    git(repoPath, ['reset', '--hard', 'HEAD~1']);
    const replacement = commit(repoPath, 'fix: replacement tip', 3);
    assert.notEqual(replacement, oldCursor);

    const recovered = await scheduler.runOnce({ force: true, now: '2026-09-27T09:01:00.000Z' });
    assert.equal(recovered.results[0].ok, true);
    assert.equal(recovered.results[0].health.status, 'healthy_with_warning');
    assert.equal(recovered.results[0].scan.historyRewritten, true);
    assert.equal(store.getCaptureState('git:p').cursor.headSha, replacement);
    assert.equal(store.listEvents('p').length, 3);
  } finally {
    store.close();
  }
});


test('configured GitHub source persists its own cursor and respects source poll cadence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-github-scheduler-'));
  const store = new BipStore(':memory:');
  const app = new BipAI({ store, storyThreshold: 99 });
  const project = {
    id: 'p',
    name: 'Project P',
    path: root,
    github: { repository: 'victorkay97/BIP-AI', visibility: 'private' }
  };
  const projects = {
    list: () => [project],
    get: (id) => id === 'p' ? project : null
  };
  const localScan = async () => ({
    events: [],
    cursor: { headSha: 'local-head' },
    meta: { remaining: 0, historyRewritten: false }
  });
  let githubCalls = 0;
  const githubScan = async () => {
    githubCalls += 1;
    return {
      events: [{
        id: 'github:evt-1',
        projectId: 'p',
        type: 'milestone',
        summary: 'Merged PR #1',
        details: 'GitHub pull request #1 merged',
        source: 'github',
        occurredAt: '2026-09-27T10:00:00.000Z',
        privacy: 'REVIEW',
        metadata: { externalId: 'evt-1' }
      }],
      cursor: {
        repository: 'victorkay97/BIP-AI',
        events: { id: '10', etag: '"e"' },
        workflows: { key: '20:1:2026-09-27T10:00:00.000Z', etag: '"w"' }
      },
      meta: { remaining: 0, nextPollMs: 300000 }
    };
  };
  const scheduler = new CaptureScheduler({
    store,
    app,
    projects,
    pollMs: 60000,
    scan: localScan,
    githubClient: { token: 'super-secret-github-token' },
    githubScan,
    githubPollMs: 300000
  });

  try {
    const first = await scheduler.runOnce({ force: false, now: '2026-09-27T10:00:00.000Z' });
    assert.equal(first.results.length, 2);
    assert.equal(first.succeeded, 2);
    assert.equal(githubCalls, 1);
    assert.equal(store.getCaptureState('git:p').cursor.headSha, 'local-head');
    assert.equal(store.getCaptureState('github:p').cursor.events.id, '10');
    assert.match(store.getCaptureState('github:p').cursor.workflows.key, /^20:1:/);
    assert.equal(store.getCaptureState('github:p').health.nextAttemptAt, '2026-09-27T10:05:00.000Z');
    assert.doesNotMatch(JSON.stringify(store.listCaptureStates()), /super-secret-github-token/);

    const second = await scheduler.runOnce({ force: false, now: '2026-09-27T10:01:00.000Z' });
    const githubResult = second.results.find((item) => item.sourceType === 'github');
    assert.equal(githubResult.attempted, false);
    assert.equal(githubResult.skipped, 'cadence');
    assert.equal(githubCalls, 1);
  } finally {
    store.close();
  }
});

test('GitHub rate-limit hint feeds the bounded shared backoff state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bip-github-rate-'));
  const store = new BipStore(':memory:');
  const app = new BipAI({ store, storyThreshold: 99 });
  const project = {
    id: 'p',
    name: 'p',
    path: root,
    github: { repository: 'victorkay97/BIP-AI', visibility: 'private' }
  };
  const scan = async () => {
    throw new GitHubApiError('github_rate_limited', 'GitHub API rate limit reached', { status: 429, retryAfterMs: 120000 });
  };

  try {
    const result = await runGitHubCaptureProject({
      store,
      app,
      project,
      client: {},
      scan,
      now: '2026-09-27T10:00:00.000Z',
      retryBaseMs: 5000,
      retryMaxMs: 300000
    });
    assert.equal(result.ok, false);
    assert.equal(result.health.lastError.code, 'github_rate_limited');
    assert.equal(result.health.retryBackoffMs, 120000);
    assert.equal(result.health.nextAttemptAt, '2026-09-27T10:02:00.000Z');
    assert.equal(store.getCaptureState('github:p').cursor, null);
  } finally {
    store.close();
  }
});
