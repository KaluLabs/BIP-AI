import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  doctor,
  initializeSetup,
  nodeVersionStatus,
  redactSecrets,
  validateRuntimeConfig
} from '../src/setup.js';

function temp(prefix = 'bip-setup-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function baseEnv(root) {
  return {
    BIP_AI_DB: join(root, '.bipai', 'state.sqlite'),
    BIP_AI_EVENT_DIR: join(root, '.bipai', 'events'),
    BIP_AI_PROJECTS: join(root, '.bipai', 'projects.json'),
    BIP_AI_DRAFT_PROVIDER: 'deterministic',
    PAG_BASE_URL: 'http://127.0.0.1:8787'
  };
}

test('clean setup initializes local state, safe env defaults, and a project idempotently', async () => {
  const root = temp();
  const repo = join(root, 'project');
  mkdirSync(repo);
  writeFileSync(join(root, '.env.example'), 'BIP_AI_DRAFT_PROVIDER=deterministic\nPAG_ACTOR_TOKEN=\n');

  const env = baseEnv(root);
  const first = await initializeSetup({
    env,
    cwd: root,
    projectId: 'demo',
    repoPath: repo
  });

  assert.equal(first.initialized, true);
  assert.equal(first.project.status, 'created');
  assert.equal(first.drafting.mode, 'deterministic');
  assert.equal(first.envFile.created, true);
  assert.equal(first.envFile.secretsWritten, false);
  assert.ok(existsSync(env.BIP_AI_DB));
  assert.ok(existsSync(env.BIP_AI_EVENT_DIR));
  assert.ok(existsSync(env.BIP_AI_PROJECTS));

  const envFile = readFileSync(join(root, '.env'), 'utf8');
  assert.match(envFile, /BIP_AI_DRAFT_PROVIDER=deterministic/);

  const second = await initializeSetup({
    env,
    cwd: root,
    projectId: 'demo',
    repoPath: repo
  });
  assert.equal(second.project.status, 'unchanged');
  const projects = JSON.parse(readFileSync(env.BIP_AI_PROJECTS, 'utf8')).projects;
  assert.equal(projects.length, 1);
  assert.equal(projects[0].id, 'demo');
});

test('partial setup can be resumed later with project registration', async () => {
  const root = temp();
  const repo = join(root, 'project');
  mkdirSync(repo);
  const env = baseEnv(root);

  const partial = await initializeSetup({ env, cwd: root });
  assert.equal(partial.project, null);
  assert.ok(existsSync(env.BIP_AI_DB));

  const resumed = await initializeSetup({
    env,
    cwd: root,
    projectId: 'resumed',
    repoPath: repo
  });
  assert.equal(resumed.project.status, 'created');
  assert.equal(JSON.parse(readFileSync(env.BIP_AI_PROJECTS, 'utf8')).projects.length, 1);
});

test('setup refuses conflicting project paths instead of silently rewriting registration', async () => {
  const root = temp();
  const one = join(root, 'one');
  const two = join(root, 'two');
  mkdirSync(one);
  mkdirSync(two);
  const env = baseEnv(root);

  await initializeSetup({ env, cwd: root, projectId: 'demo', repoPath: one });
  await assert.rejects(
    () => initializeSetup({ env, cwd: root, projectId: 'demo', repoPath: two }),
    /already registered at a different path/
  );
});

test('runtime validation returns actionable errors for invalid external-provider config', async () => {
  const root = temp();
  const secret = 'draft-secret-value';
  const env = {
    ...baseEnv(root),
    BIP_AI_DRAFT_PROVIDER: 'openai-compatible',
    BIP_AI_DRAFT_API_KEY: secret
  };

  const validation = validateRuntimeConfig(env);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((item) => item.field === 'BIP_AI_DRAFT_BASE_URL'));
  assert.ok(validation.errors.some((item) => item.field === 'BIP_AI_DRAFT_MODEL'));
  assert.doesNotMatch(JSON.stringify(validation), new RegExp(secret));

  await assert.rejects(
    () => initializeSetup({ env, cwd: root }),
    /BIP_AI_DRAFT_BASE_URL is required/
  );
});

test('doctor validates provider config and probes PAG health with GET only', async () => {
  const root = temp();
  const env = baseEnv(root);
  await initializeSetup({ env, cwd: root });

  const calls = [];
  const report = await doctor({
    env,
    cwd: root,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    }
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.drafting.mode, 'deterministic');
  assert.equal(report.checks.pag.reachable, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/health');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.authorization, undefined);
});

test('doctor and redaction never expose configured secret values', async () => {
  const root = temp();
  const draftSecret = 'draft-super-secret';
  const pagSecret = 'pag-super-secret';
  const githubSecret = 'github-super-secret';
  const env = {
    ...baseEnv(root),
    BIP_AI_DRAFT_PROVIDER: 'openai-compatible',
    BIP_AI_DRAFT_BASE_URL: 'https://draft.example.test/v1',
    BIP_AI_DRAFT_API_KEY: draftSecret,
    BIP_AI_DRAFT_MODEL: 'example-model',
    BIP_AI_GITHUB_TOKEN: githubSecret,
    PAG_ACTOR_TOKEN: pagSecret
  };
  await initializeSetup({ env, cwd: root });

  const report = await doctor({
    env,
    cwd: root,
    fetchImpl: async () => {
      throw new Error(`connection failed: ${draftSecret} ${pagSecret} ${githubSecret}`);
    }
  });
  const serialized = JSON.stringify(report);

  assert.doesNotMatch(serialized, new RegExp(draftSecret));
  assert.doesNotMatch(serialized, new RegExp(pagSecret));
  assert.doesNotMatch(serialized, new RegExp(githubSecret));
  assert.match(serialized, /\[REDACTED\]/);
  assert.equal(report.secrets.draftApiKey, 'configured');
  assert.equal(report.secrets.githubToken, 'configured');
  assert.equal(report.secrets.pagActorToken, 'configured');
  assert.equal(report.checks.pag.status, 'warn');

  assert.equal(
    redactSecrets(`x=${draftSecret} y=${pagSecret}`, env),
    'x=[REDACTED] y=[REDACTED]'
  );
});

test('node version check gives an actionable minimum-version failure', () => {
  const old = nodeVersionStatus('22.4.9');
  assert.equal(old.ok, false);
  assert.match(old.message, /requires Node\.js 22\.5\.0\+/);

  const current = nodeVersionStatus('22.5.0');
  assert.equal(current.ok, true);
});
