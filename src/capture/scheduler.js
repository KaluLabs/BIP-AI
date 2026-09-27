import { existsSync } from 'node:fs';
import { scanGitIncremental } from './git.js';
import { classifyGitHubError, scanGitHubActivity } from './github.js';

export const DEFAULT_CAPTURE_POLL_MS = 60_000;
export const DEFAULT_CAPTURE_BATCH_SIZE = 50;
export const DEFAULT_CAPTURE_RETRY_BASE_MS = 5_000;
export const DEFAULT_CAPTURE_RETRY_MAX_MS = 300_000;

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('invalid capture timestamp');
  return date.toISOString();
}

function millis(value) {
  return new Date(iso(value)).getTime();
}

function sourceKeyFor(projectId, sourceType = 'git') {
  return `${sourceType}:${projectId}`;
}

function emptyHealth() {
  return {
    status: 'never_run',
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    nextAttemptAt: null,
    consecutiveFailures: 0,
    lastError: null,
    lastScan: null
  };
}

function safeGitError(error, project) {
  const message = String(error?.message || '');
  if (!existsSync(project.path)) {
    return { code: 'project_path_missing', summary: 'configured project path does not exist' };
  }
  if (/not a git repository/i.test(message)) {
    return { code: 'not_git_repository', summary: 'configured project path is not a Git repository' };
  }
  if (error?.code === 'ENOENT' || /spawn.*git.*ENOENT/i.test(message)) {
    return { code: 'git_unavailable', summary: 'Git executable is unavailable' };
  }
  if (/ambiguous argument 'HEAD'|unknown revision.*HEAD|bad revision.*HEAD/i.test(message)) {
    return { code: 'git_head_unavailable', summary: 'Git repository has no readable HEAD commit' };
  }
  return { code: 'git_scan_failed', summary: 'Git capture scan failed' };
}

function genericSourceError() {
  return { code: 'capture_failed', summary: 'capture source failed' };
}

function backoffMs(failures, baseMs, maxMs) {
  const exponent = Math.max(0, Math.min(16, failures - 1));
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

function stateFor(store, { sourceKey, projectId, sourceType }) {
  return store.getCaptureState(sourceKey) || {
    sourceKey,
    projectId,
    sourceType,
    cursor: null,
    health: emptyHealth(),
    updatedAt: null
  };
}

function shouldAttempt(state, now, force) {
  if (force) return true;
  const next = state.health?.nextAttemptAt;
  return !next || millis(next) <= millis(now);
}

function successHealth(scan, stats, now) {
  const warning = scan.meta?.warning || (scan.meta?.historyRewritten ? 'history_rewritten' : null);
  const nextPollMs = Number(scan.meta?.nextPollMs || 0);
  return {
    ...emptyHealth(),
    status: warning ? 'healthy_with_warning' : 'healthy',
    lastAttemptAt: iso(now),
    lastSuccessAt: iso(now),
    nextAttemptAt: nextPollMs > 0 ? new Date(millis(now) + nextPollMs).toISOString() : null,
    consecutiveFailures: 0,
    lastError: null,
    lastScan: {
      scanned: scan.events.length,
      accepted: stats.accepted,
      duplicates: stats.duplicates,
      campaignsCreated: stats.campaignsCreated,
      remaining: Number(scan.meta?.remaining || 0),
      warning,
      historyRewritten: Boolean(scan.meta?.historyRewritten)
    }
  };
}

function failureHealth(previous, failure, now, retryBaseMs, retryMaxMs) {
  const failures = Number(previous?.consecutiveFailures || 0) + 1;
  const requested = Number(failure?.retryAfterMs || 0);
  const delay = Math.min(retryMaxMs, Math.max(backoffMs(failures, retryBaseMs, retryMaxMs), requested));
  return {
    ...emptyHealth(),
    ...previous,
    status: 'degraded',
    lastAttemptAt: iso(now),
    lastFailureAt: iso(now),
    nextAttemptAt: new Date(millis(now) + delay).toISOString(),
    consecutiveFailures: failures,
    lastError: failure,
    retryBackoffMs: delay
  };
}

export function captureStatus(store, projects) {
  const projectList = projects.list();
  const projectById = new Map(projectList.map((project) => [project.id, project]));
  const stored = store.listCaptureStates();
  const storedByKey = new Map(stored.map((item) => [item.sourceKey, item]));
  const result = [];
  const seen = new Set();

  for (const project of projectList) {
    const key = sourceKeyFor(project.id, 'git');
    const value = storedByKey.get(key);
    seen.add(key);
    result.push({
      sourceKey: key,
      sourceType: 'git',
      projectId: project.id,
      projectName: project.name || project.id,
      path: project.path,
      cursor: value?.cursor || null,
      health: value?.health || emptyHealth(),
      updatedAt: value?.updatedAt || null
    });

    if (project.github?.repository) {
      const githubKey = sourceKeyFor(project.id, 'github');
      const githubValue = storedByKey.get(githubKey);
      seen.add(githubKey);
      result.push({
        sourceKey: githubKey,
        sourceType: 'github',
        projectId: project.id,
        projectName: project.name || project.id,
        repository: project.github.repository,
        visibility: project.github.visibility || 'private',
        cursor: githubValue?.cursor || null,
        health: githubValue?.health || emptyHealth(),
        updatedAt: githubValue?.updatedAt || null
      });
    }
  }

  for (const value of stored) {
    if (seen.has(value.sourceKey)) continue;
    const project = projectById.get(value.projectId);
    if (!project) continue;
    result.push({
      sourceKey: value.sourceKey,
      sourceType: value.sourceType,
      projectId: value.projectId,
      projectName: project.name || project.id,
      path: project.path,
      cursor: value.cursor || null,
      health: value.health || emptyHealth(),
      updatedAt: value.updatedAt || null
    });
  }

  return result.sort((a, b) =>
    a.projectId.localeCompare(b.projectId) ||
    a.sourceType.localeCompare(b.sourceType) ||
    a.sourceKey.localeCompare(b.sourceKey)
  );
}

export async function runCaptureSource({
  store,
  app,
  project,
  sourceKey,
  sourceType,
  scan,
  classifyError = genericSourceError,
  now = new Date(),
  force = false,
  batchSize = DEFAULT_CAPTURE_BATCH_SIZE,
  retryBaseMs = DEFAULT_CAPTURE_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_CAPTURE_RETRY_MAX_MS
} = {}) {
  if (!store || !app || !project || !sourceKey || !sourceType || typeof scan !== 'function') {
    throw new TypeError('store, app, project, sourceKey, sourceType, and scan are required');
  }

  const current = stateFor(store, { sourceKey, projectId: project.id, sourceType });
  if (!shouldAttempt(current, now, force)) {
    return {
      projectId: project.id,
      sourceKey: current.sourceKey,
      sourceType,
      attempted: false,
      skipped: 'backoff',
      cursor: current.cursor,
      health: current.health
    };
  }

  try {
    const scanResult = await scan({
      project,
      cursor: current.cursor,
      limit: batchSize
    });
    if (!scanResult || !Array.isArray(scanResult.events) || !Object.prototype.hasOwnProperty.call(scanResult, 'cursor')) {
      throw new TypeError('capture scanner must return { events, cursor, meta? }');
    }

    const stats = { accepted: 0, duplicates: 0, campaignsCreated: 0 };
    for (const event of scanResult.events) {
      const result = app.ingest(event);
      if (result.duplicate) stats.duplicates += 1;
      else if (result.accepted) stats.accepted += 1;
      if (result.campaign) stats.campaignsCreated += 1;
    }

    const health = successHealth(scanResult, stats, now);
    const saved = store.saveCaptureState({
      sourceKey: current.sourceKey,
      projectId: project.id,
      sourceType,
      cursor: scanResult.cursor,
      health,
      updatedAt: iso(now)
    });

    return {
      projectId: project.id,
      sourceKey: current.sourceKey,
      sourceType,
      attempted: true,
      ok: true,
      cursor: saved.cursor,
      health: saved.health,
      scan: health.lastScan
    };
  } catch (error) {
    const failure = classifyError(error, project);
    const health = failureHealth(current.health, failure, now, retryBaseMs, retryMaxMs);
    const saved = store.saveCaptureState({
      sourceKey: current.sourceKey,
      projectId: project.id,
      sourceType,
      cursor: current.cursor,
      health,
      updatedAt: iso(now)
    });

    return {
      projectId: project.id,
      sourceKey: current.sourceKey,
      sourceType,
      attempted: true,
      ok: false,
      cursor: saved.cursor,
      health: saved.health,
      error: failure
    };
  }
}

export async function runGitCaptureProject({
  store,
  app,
  project,
  scan = scanGitIncremental,
  now = new Date(),
  force = false,
  batchSize = DEFAULT_CAPTURE_BATCH_SIZE,
  retryBaseMs = DEFAULT_CAPTURE_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_CAPTURE_RETRY_MAX_MS
} = {}) {
  return runCaptureSource({
    store,
    app,
    project,
    sourceKey: sourceKeyFor(project.id, 'git'),
    sourceType: 'git',
    scan: ({ cursor, limit }) => scan({
      repoPath: project.path,
      projectId: project.id,
      cursor,
      limit
    }),
    classifyError: safeGitError,
    now,
    force,
    batchSize,
    retryBaseMs,
    retryMaxMs
  });
}

export async function runGitHubCaptureProject({
  store,
  app,
  project,
  client,
  scan = scanGitHubActivity,
  pollMs = 300_000,
  now = new Date(),
  force = false,
  batchSize = DEFAULT_CAPTURE_BATCH_SIZE,
  retryBaseMs = DEFAULT_CAPTURE_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_CAPTURE_RETRY_MAX_MS
} = {}) {
  if (!project?.github?.repository) throw new TypeError('project GitHub source is not configured');
  if (!client) throw new TypeError('GitHub client is required');
  return runCaptureSource({
    store,
    app,
    project,
    sourceKey: sourceKeyFor(project.id, 'github'),
    sourceType: 'github',
    scan: ({ cursor, limit }) => scan({
      client,
      projectId: project.id,
      repository: project.github.repository,
      visibility: project.github.visibility || 'private',
      cursor,
      limit,
      pollMs
    }),
    classifyError: classifyGitHubError,
    now,
    force,
    batchSize,
    retryBaseMs,
    retryMaxMs
  });
}

export async function runCaptureOnce({
  store,
  app,
  projects,
  projectId = null,
  scan = scanGitIncremental,
  githubClient = null,
  githubScan = scanGitHubActivity,
  githubPollMs = 300_000,
  now = new Date(),
  force = false,
  batchSize = DEFAULT_CAPTURE_BATCH_SIZE,
  retryBaseMs = DEFAULT_CAPTURE_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_CAPTURE_RETRY_MAX_MS
} = {}) {
  if (!store || !app || !projects) throw new TypeError('store, app, and projects are required');

  const targets = projectId
    ? [projects.get(projectId)].filter(Boolean)
    : projects.list();

  if (projectId && targets.length === 0) throw new Error(`project not found: ${projectId}`);

  const results = [];
  for (const project of targets) {
    results.push(await runGitCaptureProject({
      store,
      app,
      project,
      scan,
      now,
      force,
      batchSize,
      retryBaseMs,
      retryMaxMs
    }));
    if (project.github?.repository) {
      if (!githubClient) {
        results.push({
          projectId: project.id,
          sourceKey: sourceKeyFor(project.id, 'github'),
          sourceType: 'github',
          attempted: false,
          skipped: 'github_client_unavailable',
          cursor: store.getCaptureState(sourceKeyFor(project.id, 'github'))?.cursor || null,
          health: store.getCaptureState(sourceKeyFor(project.id, 'github'))?.health || emptyHealth()
        });
      } else {
        results.push(await runGitHubCaptureProject({
          store,
          app,
          project,
          client: githubClient,
          scan: githubScan,
          pollMs: githubPollMs,
          now,
          force,
          batchSize,
          retryBaseMs,
          retryMaxMs
        }));
      }
    }
  }

  return {
    ranAt: iso(now),
    projects: targets.length,
    attempted: results.filter((item) => item.attempted).length,
    succeeded: results.filter((item) => item.ok === true).length,
    failed: results.filter((item) => item.ok === false).length,
    skipped: results.filter((item) => !item.attempted).length,
    results
  };
}

export class CaptureScheduler {
  constructor({
    store,
    app,
    projects,
    pollMs = DEFAULT_CAPTURE_POLL_MS,
    batchSize = DEFAULT_CAPTURE_BATCH_SIZE,
    retryBaseMs = DEFAULT_CAPTURE_RETRY_BASE_MS,
    retryMaxMs = DEFAULT_CAPTURE_RETRY_MAX_MS,
    scan = scanGitIncremental,
    githubClient = null,
    githubScan = scanGitHubActivity,
    githubPollMs = 300_000,
    now = () => new Date()
  } = {}) {
    if (!store || !app || !projects) throw new TypeError('store, app, and projects are required');
    if (!Number.isFinite(Number(pollMs)) || Number(pollMs) < 1000) throw new TypeError('pollMs must be at least 1000');
    if (!Number.isInteger(Number(batchSize)) || Number(batchSize) < 1 || Number(batchSize) > 1000) {
      throw new TypeError('batchSize must be an integer between 1 and 1000');
    }
    if (!Number.isFinite(Number(retryBaseMs)) || Number(retryBaseMs) < 1000) {
      throw new TypeError('retryBaseMs must be at least 1000');
    }
    if (!Number.isFinite(Number(retryMaxMs)) || Number(retryMaxMs) < Number(retryBaseMs)) {
      throw new TypeError('retryMaxMs must be greater than or equal to retryBaseMs');
    }
    this.store = store;
    this.app = app;
    this.projects = projects;
    this.pollMs = Number(pollMs);
    this.batchSize = Number(batchSize);
    this.retryBaseMs = Number(retryBaseMs);
    this.retryMaxMs = Number(retryMaxMs);
    this.scan = scan;
    this.githubClient = githubClient;
    this.githubScan = githubScan;
    this.githubPollMs = Number(githubPollMs);
    if (!Number.isFinite(this.githubPollMs) || this.githubPollMs < 60_000) {
      throw new TypeError('githubPollMs must be at least 60000');
    }
    this.now = now;
    this.timer = null;
    this.running = false;
    this.lastCycle = null;
  }

  async runOnce(options = {}) {
    if (this.running) return { skipped: 'cycle_already_running', lastCycle: this.lastCycle };
    this.running = true;
    try {
      this.lastCycle = await runCaptureOnce({
        store: this.store,
        app: this.app,
        projects: this.projects,
        scan: this.scan,
        githubClient: this.githubClient,
        githubScan: this.githubScan,
        githubPollMs: this.githubPollMs,
        now: options.now || this.now(),
        force: Boolean(options.force),
        projectId: options.projectId || null,
        batchSize: this.batchSize,
        retryBaseMs: this.retryBaseMs,
        retryMaxMs: this.retryMaxMs
      });
      return this.lastCycle;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return false;
    void this.runOnce().catch(() => {});
    this.timer = setInterval(() => { void this.runOnce().catch(() => {}); }, this.pollMs);
    return true;
  }

  stop() {
    if (!this.timer) return false;
    clearInterval(this.timer);
    this.timer = null;
    return true;
  }

  status() {
    return {
      running: Boolean(this.timer),
      cycleInProgress: this.running,
      pollMs: this.pollMs,
      batchSize: this.batchSize,
      retryBaseMs: this.retryBaseMs,
      retryMaxMs: this.retryMaxMs,
      githubPollMs: this.githubPollMs,
      githubConfigured: Boolean(this.githubClient),
      lastCycle: this.lastCycle,
      sources: captureStatus(this.store, this.projects)
    };
  }
}

export { sourceKeyFor };
