import { classifyCommit } from './git.js';

const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function cleanText(value, max = 280) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function repositoryParts(repository) {
  const value = String(repository ?? '').trim();
  if (!GITHUB_REPOSITORY.test(value)) throw new TypeError('GitHub repository must be owner/repo');
  return value.split('/').map(encodeURIComponent);
}

function parseRetryAfter(headers) {
  const retry = Number(headers.get('retry-after'));
  if (Number.isFinite(retry) && retry >= 0) return retry * 1000;
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - Date.now());
  return null;
}

function pollIntervalMs(headers) {
  const seconds = Number(headers.get('x-poll-interval'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export class GitHubApiError extends Error {
  constructor(code, message, { status = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class GitHubActivityClient {
  constructor({
    token = null,
    baseUrl = 'https://api.github.com',
    fetchImpl = globalThis.fetch
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
    this.token = token ? String(token) : null;
    const parsedBase = new URL(String(baseUrl));
    if (!['http:', 'https:'].includes(parsedBase.protocol)) throw new TypeError('GitHub API base URL must use http or https');
    if (parsedBase.username || parsedBase.password) throw new TypeError('GitHub API base URL must not contain credentials');
    this.baseUrl = parsedBase.toString().replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  async request(path, { etag = null } = {}) {
    const headers = {
      accept: 'application/vnd.github+json',
      'user-agent': 'BIP-AI'
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (etag) headers['if-none-match'] = etag;

    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { headers });
    } catch {
      throw new GitHubApiError('github_network_error', 'GitHub API request failed');
    }

    const meta = {
      etag: response.headers.get('etag') || etag || null,
      pollIntervalMs: pollIntervalMs(response.headers)
    };

    if (response.status === 304) return { notModified: true, data: null, ...meta };

    if (!response.ok) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (response.status === 429 || (response.status === 403 && remaining === '0')) {
        throw new GitHubApiError('github_rate_limited', 'GitHub API rate limit reached', {
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers)
        });
      }
      if (response.status === 401) {
        throw new GitHubApiError('github_auth_failed', 'GitHub authentication failed', { status: 401 });
      }
      if (response.status === 403) {
        throw new GitHubApiError('github_forbidden', 'GitHub repository access is forbidden', { status: 403 });
      }
      if (response.status === 404) {
        throw new GitHubApiError('github_repository_unavailable', 'GitHub repository is unavailable', { status: 404 });
      }
      if (response.status >= 500) {
        throw new GitHubApiError('github_transient_error', 'GitHub API is temporarily unavailable', { status: response.status });
      }
      throw new GitHubApiError('github_api_error', 'GitHub API request failed', { status: response.status });
    }

    let data;
    try { data = await response.json(); }
    catch { throw new GitHubApiError('github_invalid_response', 'GitHub API returned invalid JSON', { status: response.status }); }
    return { notModified: false, data, ...meta };
  }

  async repositoryEvents(repository, { page = 1, perPage = 100, etag = null } = {}) {
    const [owner, repo] = repositoryParts(repository);
    return this.request(`/repos/${owner}/${repo}/events?per_page=${perPage}&page=${page}`, { etag });
  }

  async workflowRuns(repository, { page = 1, perPage = 100, etag = null } = {}) {
    const [owner, repo] = repositoryParts(repository);
    return this.request(`/repos/${owner}/${repo}/actions/runs?status=completed&per_page=${perPage}&page=${page}`, { etag });
  }
}

function privacyFor(visibility, publicFlag = null) {
  if (visibility !== 'public') return 'REVIEW';
  if (publicFlag === false) return 'REVIEW';
  return 'PASS';
}

function evidence({ repository, externalId, url, kind }) {
  return [{ type: 'github', kind, externalId, repository, url: url || null }];
}

function githubMetadata({ repository, externalId, eventId = null, kind, action = null, number = null, sha = null, runId = null, ref = null }) {
  return {
    externalId,
    github: {
      externalId,
      repository,
      eventId,
      kind,
      action,
      number,
      sha,
      runId,
      ref
    }
  };
}

function baseEvent({ projectId, repository, raw, kind, action = null, externalId, summary, details, type, url = null, visibility, number = null, sha = null, runId = null, ref = null, importance = 'normal', implementation = [], outcomes = [] }) {
  const privacy = privacyFor(visibility, raw?.public);
  return {
    id: `github:${externalId}`,
    projectId,
    type,
    summary: cleanText(summary),
    details: cleanText(details, 500) || null,
    source: 'github',
    occurredAt: raw?.created_at || raw?.updated_at,
    importance,
    userVisible: privacy === 'PASS',
    implementation,
    outcomes,
    evidence: evidence({ repository, externalId, url, kind }),
    privacy,
    metadata: githubMetadata({
      repository,
      externalId,
      eventId: raw?.id ? String(raw.id) : null,
      kind,
      action,
      number,
      sha,
      runId,
      ref
    })
  };
}

function mapPush(raw, context) {
  const payload = raw.payload || {};
  const ref = String(payload.ref || '').replace(/^refs\/heads\//, '');
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  if (commits.length) {
    return commits.map((commit, index) => {
      const sha = String(commit.sha || commit.id || payload.head || '');
      const message = cleanText(commit.message || `Pushed commit ${sha.slice(0, 12)}`);
      return baseEvent({
        ...context,
        raw,
        kind: 'push_commit',
        action: 'pushed',
        externalId: `${raw.id}:commit:${sha || index}`,
        summary: message,
        details: `GitHub push commit ${sha.slice(0, 12)} to ${ref || 'repository ref'}`,
        type: classifyCommit(message),
        url: sha ? `https://github.com/${context.repository}/commit/${encodeURIComponent(sha)}` : null,
        visibility: context.visibility,
        sha,
        ref,
        implementation: ref ? [`Pushed to ${ref}`] : []
      });
    });
  }

  const sha = String(payload.head || '');
  return [baseEvent({
    ...context,
    raw,
    kind: 'push',
    action: 'pushed',
    externalId: `${raw.id}:push:${sha || 'head'}`,
    summary: `Pushed changes to ${ref || 'repository ref'}`,
    details: sha ? `GitHub push advanced ${ref || 'the ref'} to ${sha.slice(0, 12)}` : `GitHub push updated ${ref || 'a repository ref'}`,
    type: 'implementation',
    url: sha ? `https://github.com/${context.repository}/commit/${encodeURIComponent(sha)}` : null,
    visibility: context.visibility,
    sha,
    ref,
    implementation: ref ? [`Pushed changes to ${ref}`] : []
  })];
}

function mapPullRequest(raw, context) {
  const payload = raw.payload || {};
  const pr = payload.pull_request || {};
  const action = payload.action;
  const number = Number(payload.number || pr.number || 0) || null;
  const title = cleanText(pr.title || `Pull request #${number}`);
  if (action === 'opened') {
    return [baseEvent({
      ...context,
      raw,
      kind: 'pull_request',
      action,
      externalId: `${raw.id}:pr:${number}:opened`,
      summary: `Opened PR #${number}: ${title}`,
      details: `GitHub pull request #${number} opened against ${pr.base?.ref || 'the target branch'}`,
      type: 'feature',
      url: pr.html_url,
      visibility: context.visibility,
      number,
      ref: pr.base?.ref || null
    })];
  }

  const merged = action === 'merged' || (action === 'closed' && pr.merged === true);
  if (merged) {
    return [baseEvent({
      ...context,
      raw,
      kind: 'pull_request',
      action: 'merged',
      externalId: `${raw.id}:pr:${number}:merged`,
      summary: `Merged PR #${number}: ${title}`,
      details: `GitHub pull request #${number} merged into ${pr.base?.ref || 'the target branch'}`,
      type: 'milestone',
      url: pr.html_url,
      visibility: context.visibility,
      number,
      sha: pr.merge_commit_sha || null,
      ref: pr.base?.ref || null,
      outcomes: ['Pull request merged']
    })];
  }
  return [];
}

function mapIssue(raw, context) {
  const payload = raw.payload || {};
  if (payload.action !== 'closed') return [];
  const issue = payload.issue || {};
  if (issue.pull_request) return [];
  const number = Number(issue.number || 0) || null;
  const title = cleanText(issue.title || `Issue #${number}`);
  return [baseEvent({
    ...context,
    raw,
    kind: 'issue',
    action: 'closed',
    externalId: `${raw.id}:issue:${number}:closed`,
    summary: `Closed issue #${number}: ${title}`,
    details: `GitHub issue #${number} was closed`,
    type: 'milestone',
    url: issue.html_url,
    visibility: context.visibility,
    number,
    outcomes: ['Issue closed']
  })];
}

function mapRelease(raw, context) {
  const payload = raw.payload || {};
  if (payload.action !== 'published') return [];
  const release = payload.release || {};
  const id = release.id ?? raw.id;
  const name = cleanText(release.name || release.tag_name || `release ${id}`);
  return [baseEvent({
    ...context,
    raw,
    kind: 'release',
    action: 'published',
    externalId: `${raw.id}:release:${id}:published`,
    summary: `Published ${name}`,
    details: release.tag_name ? `GitHub release ${release.tag_name} was published` : 'GitHub release was published',
    type: 'release',
    url: release.html_url,
    visibility: context.visibility,
    importance: 'high',
    ref: release.tag_name || null,
    outcomes: ['Release published']
  })];
}

export function mapRepositoryEvent(raw, context) {
  if (!raw || !raw.id || !raw.type) return [];
  if (raw.type === 'PushEvent') return mapPush(raw, context);
  if (raw.type === 'PullRequestEvent') return mapPullRequest(raw, context);
  if (raw.type === 'IssuesEvent') return mapIssue(raw, context);
  if (raw.type === 'ReleaseEvent') return mapRelease(raw, context);
  return [];
}

export function mapWorkflowRun(run, context) {
  if (!run || !run.id || run.status !== 'completed') return [];
  if (!['success', 'failure'].includes(run.conclusion)) return [];
  const workflow = cleanText(run.name || run.display_title || `workflow ${run.id}`);
  const successful = run.conclusion === 'success';
  const visibility = context.visibility;
  const privacy = privacyFor(visibility);
  const externalId = `workflow:${run.id}:${run.run_attempt || 1}:${run.conclusion}`;
  return [{
    id: `github:${externalId}`,
    projectId: context.projectId,
    type: 'milestone',
    summary: `${workflow} ${successful ? 'succeeded' : 'failed'}`,
    details: `GitHub Actions run #${run.run_number || run.id} ${successful ? 'completed successfully' : 'failed'} on ${run.head_branch || 'its branch'}`,
    source: 'github',
    occurredAt: run.updated_at || run.created_at,
    importance: successful ? 'normal' : 'high',
    userVisible: privacy === 'PASS',
    outcomes: [successful ? 'CI/workflow succeeded' : 'CI/workflow failed'],
    evidence: evidence({
      repository: context.repository,
      externalId,
      url: run.html_url,
      kind: 'workflow_run'
    }),
    privacy,
    metadata: githubMetadata({
      repository: context.repository,
      externalId,
      kind: 'workflow_run',
      action: run.conclusion,
      runId: run.id,
      sha: run.head_sha || null,
      ref: run.head_branch || null
    })
  }];
}

async function collectUntilCursor({
  first,
  fetchPage,
  cursorId,
  itemId,
  maxPages,
  limit,
  initialWarning
}) {
  if (first.notModified) {
    return {
      selected: [],
      cursorId,
      etag: first.etag,
      remaining: 0,
      warning: null,
      pollIntervalMs: first.pollIntervalMs
    };
  }

  let items = Array.isArray(first.data) ? first.data : [];
  let pollMs = first.pollIntervalMs;
  let foundIndex = cursorId ? items.findIndex((item) => itemId(item) === String(cursorId)) : -1;

  for (let page = 2; cursorId && foundIndex < 0 && page <= maxPages && items.length; page += 1) {
    const next = await fetchPage(page);
    const pageItems = Array.isArray(next.data) ? next.data : [];
    const base = items.length;
    items = items.concat(pageItems);
    pollMs = Math.max(pollMs || 0, next.pollIntervalMs || 0) || null;
    const local = pageItems.findIndex((item) => itemId(item) === String(cursorId));
    if (local >= 0) foundIndex = base + local;
    if (pageItems.length === 0) break;
  }

  const newestId = items[0] ? itemId(items[0]) : cursorId || null;
  if (!items.length) {
    return { selected: [], cursorId, etag: first.etag, remaining: 0, warning: null, pollIntervalMs: pollMs };
  }

  if (!cursorId) {
    const selected = items.slice(0, limit).reverse();
    return {
      selected,
      cursorId: newestId,
      etag: first.etag,
      remaining: 0,
      warning: initialWarning || null,
      pollIntervalMs: pollMs
    };
  }

  if (foundIndex >= 0) {
    const newer = items.slice(0, foundIndex);
    const chronological = [...newer].reverse();
    const selected = chronological.slice(0, limit);
    const nextId = selected.length ? itemId(selected[selected.length - 1]) : cursorId;
    const remaining = Math.max(0, chronological.length - selected.length);
    return {
      selected,
      cursorId: nextId,
      etag: remaining === 0 && nextId === newestId ? first.etag : null,
      remaining,
      warning: null,
      pollIntervalMs: pollMs
    };
  }

  const selected = items.slice(0, limit).reverse();
  return {
    selected,
    cursorId: newestId,
    etag: first.etag,
    remaining: 0,
    warning: 'cursor_gap',
    pollIntervalMs: pollMs
  };
}

export async function scanGitHubActivity({
  client,
  projectId,
  repository,
  visibility = 'private',
  cursor = null,
  limit = 50,
  pollMs = 300_000,
  maxPages = 5
} = {}) {
  if (!client) throw new TypeError('GitHub client is required');
  if (!projectId) throw new TypeError('projectId is required');
  repositoryParts(repository);
  if (!['public', 'private'].includes(visibility)) throw new TypeError('GitHub visibility must be public or private');
  if (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 1000) throw new TypeError('limit must be between 1 and 1000');

  const sameRepository = cursor?.repository === repository;
  const eventsCursor = sameRepository ? cursor?.events || {} : {};
  const workflowsCursor = sameRepository ? cursor?.workflows || {} : {};

  const eventsFirst = await client.repositoryEvents(repository, { page: 1, perPage: 100, etag: eventsCursor.etag || null });
  const eventsResult = await collectUntilCursor({
    first: eventsFirst,
    fetchPage: (page) => client.repositoryEvents(repository, { page, perPage: 100 }),
    cursorId: eventsCursor.id || null,
    itemId: (item) => String(item.id),
    maxPages,
    limit,
    initialWarning: sameRepository ? null : cursor ? 'repository_changed' : null
  });

  const workflowsFirst = await client.workflowRuns(repository, { page: 1, perPage: 100, etag: workflowsCursor.etag || null });
  const workflowData = workflowsFirst.notModified
    ? workflowsFirst
    : { ...workflowsFirst, data: Array.isArray(workflowsFirst.data?.workflow_runs) ? workflowsFirst.data.workflow_runs : [] };
  const workflowsResult = await collectUntilCursor({
    first: workflowData,
    fetchPage: async (page) => {
      const result = await client.workflowRuns(repository, { page, perPage: 100 });
      return { ...result, data: Array.isArray(result.data?.workflow_runs) ? result.data.workflow_runs : [] };
    },
    cursorId: workflowsCursor.id || null,
    itemId: (item) => String(item.id),
    maxPages,
    limit,
    initialWarning: sameRepository ? null : cursor ? 'repository_changed' : null
  });

  const context = { projectId, repository, visibility };
  const events = [];
  for (const raw of eventsResult.selected) events.push(...mapRepositoryEvent(raw, context));
  for (const run of workflowsResult.selected) events.push(...mapWorkflowRun(run, context));

  events.sort((a, b) =>
    String(a.occurredAt).localeCompare(String(b.occurredAt)) ||
    String(a.id).localeCompare(String(b.id))
  );

  const warnings = [eventsResult.warning, workflowsResult.warning].filter(Boolean);
  const nextPollMs = Math.max(
    Number(pollMs) || 0,
    eventsResult.pollIntervalMs || 0,
    workflowsResult.pollIntervalMs || 0
  );

  return {
    events,
    cursor: {
      repository,
      events: { id: eventsResult.cursorId || null, etag: eventsResult.etag || null },
      workflows: { id: workflowsResult.cursorId || null, etag: workflowsResult.etag || null }
    },
    meta: {
      remaining: eventsResult.remaining + workflowsResult.remaining,
      warning: warnings.length ? [...new Set(warnings)].join(',') : null,
      nextPollMs,
      repository
    }
  };
}

export function classifyGitHubError(error) {
  if (error instanceof GitHubApiError) {
    return {
      code: error.code,
      summary: error.message,
      retryAfterMs: Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : null
    };
  }
  return { code: 'github_capture_failed', summary: 'GitHub capture failed' };
}

export function validateGitHubRepository(value) {
  repositoryParts(value);
  return String(value).trim();
}
