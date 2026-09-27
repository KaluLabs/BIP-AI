import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

function git(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryGit(repoPath, args) {
  try { return { ok: true, value: git(repoPath, args) }; }
  catch (error) { return { ok: false, error }; }
}

export function inspectGitRepository(repoPath) {
  const path = resolve(repoPath);
  const topLevel = git(path, ['rev-parse', '--show-toplevel']);
  const remote = (() => {
    try { return git(path, ['config', '--get', 'remote.origin.url']) || null; }
    catch { return null; }
  })();
  return { path: topLevel, name: basename(topLevel), remote };
}

function commitEvent(repo, projectId, sha) {
  const record = git(repo.path, ['show', '-s', '--format=%H%x1f%aI%x1f%s', sha]);
  const [fullSha, occurredAt, summary] = record.split('\x1f');
  return {
    projectId,
    type: classifyCommit(summary),
    summary,
    details: `Git commit ${fullSha.slice(0, 12)} in ${repo.name}`,
    source: 'git',
    occurredAt,
    importance: 'normal',
    userVisible: false,
    evidence: [{ type: 'git-commit', sha: fullSha, repository: repo.remote ?? repo.path }],
    metadata: { git: { sha: fullSha, repository: repo.remote, path: repo.path } }
  };
}

export function scanGitActivity({ repoPath, projectId, since = null, limit = 50 }) {
  if (!projectId) throw new TypeError('projectId is required');
  const repo = inspectGitRepository(repoPath);
  const args = ['log', `--max-count=${Number(limit) || 50}`, '--format=%H%x1f%aI%x1f%s%x1e'];
  if (since) args.push(`--since=${since}`);
  const output = git(repo.path, args);
  if (!output) return [];

  return output.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [sha, occurredAt, summary] = record.split('\x1f');
    return {
      projectId,
      type: classifyCommit(summary),
      summary,
      details: `Git commit ${sha.slice(0, 12)} in ${repo.name}`,
      source: 'git',
      occurredAt,
      importance: 'normal',
      userVisible: false,
      evidence: [{ type: 'git-commit', sha, repository: repo.remote ?? repo.path }],
      metadata: { git: { sha, repository: repo.remote, path: repo.path } }
    };
  });
}

export function scanGitIncremental({ repoPath, projectId, cursor = null, limit = 50 }) {
  if (!projectId) throw new TypeError('projectId is required');
  const batchLimit = Number(limit);
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 1000) {
    throw new TypeError('limit must be an integer between 1 and 1000');
  }

  const repo = inspectGitRepository(repoPath);
  const headSha = git(repo.path, ['rev-parse', 'HEAD']);
  const previousSha = cursor?.headSha ? String(cursor.headSha) : null;

  if (previousSha === headSha) {
    return {
      events: [],
      cursor: { headSha },
      meta: { repository: repo.remote ?? repo.path, headSha, previousSha, historyRewritten: false, remaining: 0 }
    };
  }

  let historyRewritten = false;
  let shas = [];

  if (previousSha) {
    const ancestor = tryGit(repo.path, ['merge-base', '--is-ancestor', previousSha, headSha]);
    if (ancestor.ok) {
      const output = git(repo.path, ['rev-list', '--reverse', `${previousSha}..${headSha}`]);
      shas = output ? output.split('\n').filter(Boolean) : [];
    } else {
      historyRewritten = true;
      const output = git(repo.path, ['rev-list', '--reverse', headSha]);
      const all = output ? output.split('\n').filter(Boolean) : [];
      shas = all.slice(-batchLimit);
    }
  } else {
    const output = git(repo.path, ['rev-list', '--reverse', headSha]);
    const all = output ? output.split('\n').filter(Boolean) : [];
    shas = all.slice(-batchLimit);
  }

  const selected = shas.slice(0, batchLimit);
  const events = selected.map((sha) => commitEvent(repo, projectId, sha));
  const nextHeadSha = selected.length ? selected[selected.length - 1] : headSha;

  return {
    events,
    cursor: { headSha: nextHeadSha },
    meta: {
      repository: repo.remote ?? repo.path,
      headSha,
      previousSha,
      historyRewritten,
      remaining: Math.max(0, shas.length - selected.length)
    }
  };
}

export function classifyCommit(summary) {
  const value = String(summary || '').trim().toLowerCase();
  if (/^(feat|feature)(\(.+\))?!?:/.test(value)) return 'feature';
  if (/^fix(\(.+\))?!?:/.test(value)) return 'fix';
  if (/^(release|chore\(release\))[:(]/.test(value)) return 'release';
  if (/^(refactor|perf)(\(.+\))?!?:/.test(value)) return 'implementation';
  if (/^(docs|test|chore|ci|build)(\(.+\))?!?:/.test(value)) return 'maintenance';
  return 'commit';
}
