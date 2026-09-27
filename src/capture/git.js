import { execFileSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

function git(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
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

export function classifyCommit(summary) {
  const value = String(summary || '').trim().toLowerCase();
  if (/^(feat|feature)(\(.+\))?!?:/.test(value)) return 'feature';
  if (/^fix(\(.+\))?!?:/.test(value)) return 'fix';
  if (/^(release|chore\(release\))[:(]/.test(value)) return 'release';
  if (/^(refactor|perf)(\(.+\))?!?:/.test(value)) return 'implementation';
  if (/^(docs|test|chore|ci|build)(\(.+\))?!?:/.test(value)) return 'maintenance';
  return 'commit';
}
