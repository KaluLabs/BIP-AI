import { existsSync } from 'node:fs';
import { scanGitIncremental } from './git.js';

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

function safeError(error, project) {
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

function backoffMs(failures, baseMs, maxMs) {
  const exponent = Math.max(0, Math.min(16, failures - 1));
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

function stateFor(store, project) {
  return store.getCaptureState(sourceKeyFor(project.id)) || {
    sourceKey: sourceKeyFor(project.id),
    projectId: project.id,
    sourceType: 'git',
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

function successHealth(previous, scan, stats, now) {
  return {
    ...emptyHealth(),
    status: scan.meta?.historyRewritten ? 'healthy_with_warning' : 'healthy',
    lastAttemptAt: iso(now),
    lastSuccessAt: iso(now),
    nextAttemptAt: null,
    consecutiveFailures: 0,
    lastError: null,
    lastScan: {
      scanned: scan.events.length,
      accepted: stats.accepted,
      duplicates: stats.duplicates,
      campaignsCreated: stats.campaignsCreated,
      remaining: Number(scan.meta?.remaining || 0),
      historyRewritten: Boolean(scan.meta?.historyRewritten)
    },
    previousSuccessAt: previous?.lastSuccessAt || null
  };
}

function failureHealth(previous, failure, now, retryBaseMs, retryMaxMs) {
  const failures = Number(previous?.consecutiveFailures || 0) + 1;
  const delay = backoffMs(failures, retryBaseMs, retryMaxMs);
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
  const stored = new Map(store.listCaptureStates().map((item) => [item.sourceKey, item]));
  return projects.list().map((project) => {
    const key = sourceKeyFor(project.id);
    const value = stored.get(key);
    return {
      sourceKey: key,
      sourceType: 'git',
      projectId: project.id,
      projectName: project.name || project.id,
      path: project.path,
      cursor: value?.cursor || null,
      health: value?.health || emptyHealth(),
      updatedAt: value?.updatedAt || null
    };
  });
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
  if (!store || !app || !project) throw new TypeError('store, app, and project are required');

  const current = stateFor(store, project);
  if (!shouldAttempt(current, now, force)) {
    return {
      projectId: project.id,
      sourceKey: current.sourceKey,
      attempted: false,
      skipped: 'backoff',
      cursor: current.cursor,
      health: current.health
    };
  }

  try {
    const scanResult = await scan({
      repoPath: project.path,
      projectId: project.id,
      cursor: current.cursor,
      limit: batchSize
    });

    const stats = { accepted: 0, duplicates: 0, campaignsCreated: 0 };
    for (const event of scanResult.events) {
      const result = app.ingest(event);
      if (result.duplicate) stats.duplicates += 1;
      else if (result.accepted) stats.accepted += 1;
      if (result.campaign) stats.campaignsCreated += 1;
    }

    const health = successHealth(current.health, scanResult, stats, now);
    const saved = store.saveCaptureState({
      sourceKey: current.sourceKey,
      projectId: project.id,
      sourceType: 'git',
      cursor: scanResult.cursor,
      health,
      updatedAt: iso(now)
    });

    return {
      projectId: project.id,
      sourceKey: current.sourceKey,
      attempted: true,
      ok: true,
      cursor: saved.cursor,
      health: saved.health,
      scan: health.lastScan
    };
  } catch (error) {
    const failure = safeError(error, project);
    const health = failureHealth(current.health, failure, now, retryBaseMs, retryMaxMs);
    const saved = store.saveCaptureState({
      sourceKey: current.sourceKey,
      projectId: project.id,
      sourceType: 'git',
      cursor: current.cursor,
      health,
      updatedAt: iso(now)
    });

    return {
      projectId: project.id,
      sourceKey: current.sourceKey,
      attempted: true,
      ok: false,
      cursor: saved.cursor,
      health: saved.health,
      error: failure
    };
  }
}

export async function runCaptureOnce({
  store,
  app,
  projects,
  projectId = null,
  scan = scanGitIncremental,
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
    now = () => new Date()
  } = {}) {
    if (!store || !app || !projects) throw new TypeError('store, app, and projects are required');
    if (!Number.isFinite(Number(pollMs)) || Number(pollMs) < 1000) throw new TypeError('pollMs must be at least 1000');
    this.store = store;
    this.app = app;
    this.projects = projects;
    this.pollMs = Number(pollMs);
    this.batchSize = Number(batchSize);
    this.retryBaseMs = Number(retryBaseMs);
    this.retryMaxMs = Number(retryMaxMs);
    this.scan = scan;
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
    void this.runOnce();
    this.timer = setInterval(() => { void this.runOnce(); }, this.pollMs);
    this.timer.unref?.();
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
      lastCycle: this.lastCycle,
      sources: captureStatus(this.store, this.projects)
    };
  }
}

export { sourceKeyFor };
