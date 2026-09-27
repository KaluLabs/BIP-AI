import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { FileInbox, emitProjectEvent } from '../src/capture/inbox.js';
import { classifyCommit, scanGitActivity } from '../src/capture/git.js';
import { ProjectRegistry } from '../src/projects.js';

function temp(prefix) { return mkdtempSync(join(tmpdir(), prefix)); }
function git(path, args) { return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim(); }

test('portable producer enqueues a normalized ProjectEvent', () => {
  const root = temp('bip-inbox-');
  const result = emitProjectEvent({ projectId: 'bip-ai', type: 'feature', summary: 'Added capture' }, { root, filename: 'event.json' });
  const saved = JSON.parse(readFileSync(result.path, 'utf8'));
  assert.equal(saved.projectId, 'bip-ai');
  assert.equal(saved.source, 'manual');
});

test('filesystem inbox moves successful events to processed', () => {
  const root = temp('bip-inbox-');
  const inbox = new FileInbox(root);
  inbox.enqueue({ projectId: 'bip-ai', type: 'feature', summary: 'Added capture' }, 'good.json');
  const results = inbox.processAll((event) => ({ accepted: event.projectId === 'bip-ai' }));
  assert.equal(results[0].status, 'processed');
  assert.equal(inbox.pendingFiles().length, 0);
});

test('filesystem inbox moves malformed JSON to failed with an error sidecar', () => {
  const root = temp('bip-inbox-');
  const inbox = new FileInbox(root);
  writeFileSync(join(inbox.inboxDir, 'bad.json'), '{not json');
  const results = inbox.processAll(() => { throw new Error('should not run'); });
  assert.equal(results[0].status, 'failed');
  assert.match(readFileSync(results[0].errorPath, 'utf8'), /Unexpected|JSON/);
});

test('project registry persists local paths and optional GitHub source config without credentials', () => {
  const root = temp('bip-projects-');
  const registry = new ProjectRegistry(join(root, 'projects.json'));
  const project = registry.add({
    id: 'bip-ai',
    path: root,
    githubRepository: 'victorkay97/BIP-AI',
    githubVisibility: 'private',
    token: 'must-not-persist'
  });
  assert.equal(registry.get('bip-ai').path, project.path);
  assert.deepEqual(registry.get('bip-ai').github, {
    repository: 'victorkay97/BIP-AI',
    visibility: 'private'
  });
  assert.doesNotMatch(readFileSync(join(root, 'projects.json'), 'utf8'), /must-not-persist|token/i);

  registry.setGithub('bip-ai', { repository: 'victorkay97/BIP-AI', visibility: 'public' });
  assert.equal(registry.get('bip-ai').github.visibility, 'public');
  registry.clearGithub('bip-ai');
  assert.equal(registry.get('bip-ai').github, undefined);
});

test('conventional commit classifier maps useful commit types', () => {
  assert.equal(classifyCommit('feat(core): add inbox'), 'feature');
  assert.equal(classifyCommit('fix: dedupe events'), 'fix');
  assert.equal(classifyCommit('docs: update README'), 'maintenance');
});

test('local Git scanner emits structured ProjectEvents', () => {
  const repo = temp('bip-git-');
  mkdirSync(join(repo, 'src'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'bip-ai@example.test']);
  git(repo, ['config', 'user.name', 'BIP AI Test']);
  writeFileSync(join(repo, 'src', 'x.txt'), 'hello\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'feat(core): add local scanner']);
  const events = scanGitActivity({ repoPath: repo, projectId: 'bip-ai' });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'feature');
  assert.equal(events[0].source, 'git');
  assert.equal(events[0].evidence[0].type, 'git-commit');
});
