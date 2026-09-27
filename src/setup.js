import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ProjectRegistry } from './projects.js';

export const MINIMUM_NODE_VERSION = '22.5.0';

const NUMERIC_CONFIG = new Map([
  ['BIP_AI_STORY_THRESHOLD', { min: 0 }],
  ['BIP_AI_CAPTURE_POLL_MS', { min: 1 }],
  ['BIP_AI_CAPTURE_BATCH_SIZE', { min: 1, integer: true }],
  ['BIP_AI_CAPTURE_RETRY_BASE_MS', { min: 1 }],
  ['BIP_AI_CAPTURE_RETRY_MAX_MS', { min: 1 }],
  ['BIP_AI_GITHUB_POLL_MS', { min: 1 }],
  ['BIP_AI_PORT', { min: 0, max: 65535, integer: true }],
  ['BIP_AI_SCHEDULE_POLL_MS', { min: 1 }]
]);

const SECRET_NAME = /(TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL)/i;

function parseVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

export function nodeVersionStatus(version = process.versions.node) {
  const current = parseVersion(version);
  const minimum = parseVersion(MINIMUM_NODE_VERSION);
  if (!current || !minimum) {
    return {
      ok: false,
      version: String(version || 'unknown'),
      minimum: MINIMUM_NODE_VERSION,
      message: `BIP-AI requires Node.js ${MINIMUM_NODE_VERSION}+; unable to parse current Node.js version.`
    };
  }
  const ok = current.some((part, index) => part > minimum[index] && current.slice(0, index).every((v, i) => v === minimum[i])) ||
    current.every((part, index) => part === minimum[index]);
  return {
    ok,
    version: String(version),
    minimum: MINIMUM_NODE_VERSION,
    message: ok
      ? `Node.js ${version} satisfies the BIP-AI runtime requirement.`
      : `BIP-AI requires Node.js ${MINIMUM_NODE_VERSION}+; current runtime is ${version}. Upgrade Node.js before running setup or BIP-AI commands.`
  };
}

function validateHttpUrl(name, value, errors) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      errors.push({ code: 'invalid_url_protocol', field: name, message: `${name} must use http:// or https://.` });
      return null;
    }
    if (url.username || url.password) {
      errors.push({ code: 'url_credentials_forbidden', field: name, message: `${name} must not embed credentials in the URL.` });
      return null;
    }
    return url;
  } catch {
    errors.push({ code: 'invalid_url', field: name, message: `${name} must be a valid absolute URL.` });
    return null;
  }
}

export function validateRuntimeConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const provider = String(env.BIP_AI_DRAFT_PROVIDER || 'deterministic').trim();

  if (!['deterministic', 'openai-compatible'].includes(provider)) {
    errors.push({
      code: 'unsupported_draft_provider',
      field: 'BIP_AI_DRAFT_PROVIDER',
      message: 'BIP_AI_DRAFT_PROVIDER must be deterministic or openai-compatible.'
    });
  }

  if (provider === 'openai-compatible') {
    if (!env.BIP_AI_DRAFT_BASE_URL) {
      errors.push({
        code: 'draft_base_url_missing',
        field: 'BIP_AI_DRAFT_BASE_URL',
        message: 'BIP_AI_DRAFT_BASE_URL is required when BIP_AI_DRAFT_PROVIDER=openai-compatible.'
      });
    } else {
      validateHttpUrl('BIP_AI_DRAFT_BASE_URL', env.BIP_AI_DRAFT_BASE_URL, errors);
    }
    if (!env.BIP_AI_DRAFT_API_KEY) {
      errors.push({
        code: 'draft_api_key_missing',
        field: 'BIP_AI_DRAFT_API_KEY',
        message: 'BIP_AI_DRAFT_API_KEY is required when BIP_AI_DRAFT_PROVIDER=openai-compatible.'
      });
    }
    if (!env.BIP_AI_DRAFT_MODEL) {
      errors.push({
        code: 'draft_model_missing',
        field: 'BIP_AI_DRAFT_MODEL',
        message: 'BIP_AI_DRAFT_MODEL is required when BIP_AI_DRAFT_PROVIDER=openai-compatible.'
      });
    }
  }

  validateHttpUrl('PAG_BASE_URL', env.PAG_BASE_URL || 'http://127.0.0.1:8787', errors);

  for (const [name, rule] of NUMERIC_CONFIG) {
    if (env[name] == null || env[name] === '') continue;
    const value = Number(env[name]);
    if (!Number.isFinite(value) || (rule.integer && !Number.isInteger(value)) ||
        value < rule.min || (rule.max != null && value > rule.max)) {
      const range = rule.max == null ? `>= ${rule.min}` : `between ${rule.min} and ${rule.max}`;
      errors.push({
        code: 'invalid_numeric_config',
        field: name,
        message: `${name} must be a finite ${rule.integer ? 'integer ' : ''}number ${range}.`
      });
    }
  }

  for (const name of ['BIP_AI_CAPTURE_ENABLED', 'BIP_AI_ALLOW_REMOTE']) {
    if (env[name] != null && env[name] !== '' && !['0', '1'].includes(String(env[name]))) {
      errors.push({
        code: 'invalid_boolean_config',
        field: name,
        message: `${name} must be 0 or 1.`
      });
    }
  }

  if ((env.BIP_AI_X_CONNECTION_ID || env.BIP_AI_LINKEDIN_CONNECTION_ID) && !env.PAG_ACTOR_TOKEN) {
    warnings.push({
      code: 'pag_token_missing',
      message: 'PAG connection IDs are configured but PAG_ACTOR_TOKEN is missing; publishing handoff is unavailable.'
    });
  }

  return {
    ok: errors.length === 0,
    provider,
    errors,
    warnings
  };
}

function statePath(cwd, value, fallback) {
  const selected = value || fallback;
  return selected === ':memory:' ? selected : resolve(cwd, selected);
}

export function resolveSetupPaths({ env = process.env, cwd = process.cwd() } = {}) {
  return {
    database: statePath(cwd, env.BIP_AI_DB, '.bipai/bip-ai.sqlite'),
    eventDir: statePath(cwd, env.BIP_AI_EVENT_DIR, '.bipai/events'),
    projects: statePath(cwd, env.BIP_AI_PROJECTS, '.bipai/projects.json'),
    envFile: resolve(cwd, '.env'),
    envExample: resolve(cwd, '.env.example')
  };
}

function ensureWritableDirectory(path) {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function projectRegistryDiagnostic(path, env) {
  if (!existsSync(path)) {
    return {
      status: 'warn',
      initialized: false,
      count: 0,
      message: 'Project registry is not initialized. Run `bip-ai setup`.'
    };
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(value.projects)) throw new TypeError('projects must be an array');
    return {
      status: 'pass',
      initialized: true,
      count: value.projects.length,
      message: value.projects.length
        ? `${value.projects.length} project(s) registered.`
        : 'Project registry is initialized but no projects are registered yet.'
    };
  } catch (error) {
    return {
      status: 'fail',
      initialized: true,
      count: null,
      message: `Project registry is invalid: ${redactSecrets(error?.message || error, env)}`
    };
  }
}

function localStateDiagnostic(paths) {
  const databaseInitialized = paths.database === ':memory:' ? true : existsSync(paths.database);
  const eventDirInitialized = existsSync(paths.eventDir);
  const projectsParent = dirname(paths.projects);
  const dbParent = paths.database === ':memory:' ? null : dirname(paths.database);
  const writable = [
    ...(dbParent && existsSync(dbParent) ? [ensureWritableDirectory(dbParent)] : []),
    ...(existsSync(projectsParent) ? [ensureWritableDirectory(projectsParent)] : []),
    ...(eventDirInitialized ? [ensureWritableDirectory(paths.eventDir)] : [])
  ];
  const writableOk = writable.every(Boolean);
  const initialized = databaseInitialized && eventDirInitialized && existsSync(paths.projects);
  return {
    status: writableOk ? (initialized ? 'pass' : 'warn') : 'fail',
    initialized,
    databaseInitialized,
    eventDirInitialized,
    writable: writableOk,
    message: writableOk
      ? (initialized ? 'Local state is initialized.' : 'Local state is only partially initialized; run `bip-ai setup`.')
      : 'A BIP-AI local-state directory is not writable.'
  };
}

export function redactSecrets(value, env = process.env) {
  let text = String(value ?? '');
  for (const [name, secret] of Object.entries(env || {})) {
    if (!SECRET_NAME.test(name) || !secret) continue;
    text = text.split(String(secret)).join('[REDACTED]');
  }
  return text;
}

async function checkPagConnectivity({ env, fetchImpl, timeoutMs }) {
  const baseUrl = String(env.PAG_BASE_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
  const configured = Boolean(env.PAG_ACTOR_TOKEN);
  if (typeof fetchImpl !== 'function') {
    return {
      status: 'warn',
      configured,
      reachable: false,
      message: 'PAG connectivity was not checked because fetch is unavailable.'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    return {
      status: response.ok ? 'pass' : 'warn',
      configured,
      reachable: response.ok,
      httpStatus: Number(response.status),
      message: response.ok
        ? (configured
          ? 'PAG is reachable and an actor token is configured.'
          : 'PAG is reachable, but PAG_ACTOR_TOKEN is not configured; publishing remains disabled.')
        : `PAG health check returned HTTP ${response.status}; no publishing request was made.`
    };
  } catch (error) {
    return {
      status: 'warn',
      configured,
      reachable: false,
      error: redactSecrets(error?.name === 'AbortError' ? 'PAG health check timed out.' : error?.message || error, env),
      message: configured
        ? 'PAG is configured but its /health endpoint is not reachable.'
        : 'PAG is optional and is not currently reachable; local capture, drafting, review, and Control Room features still work.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function doctor({
  env = process.env,
  cwd = process.cwd(),
  nodeVersion = process.versions.node,
  fetchImpl = globalThis.fetch,
  pagTimeoutMs = 1500
} = {}) {
  const node = nodeVersionStatus(nodeVersion);
  const config = validateRuntimeConfig(env);
  const paths = resolveSetupPaths({ env, cwd });
  const localState = localStateDiagnostic(paths);
  const projects = projectRegistryDiagnostic(paths.projects, env);
  const pag = await checkPagConnectivity({ env, fetchImpl, timeoutMs: pagTimeoutMs });

  const provider = config.provider;
  const providerReady = provider === 'deterministic' ||
    (provider === 'openai-compatible' &&
      Boolean(env.BIP_AI_DRAFT_BASE_URL && env.BIP_AI_DRAFT_API_KEY && env.BIP_AI_DRAFT_MODEL) &&
      !config.errors.some((item) => item.field?.startsWith('BIP_AI_DRAFT_')));

  const drafting = {
    status: providerReady ? 'pass' : 'fail',
    mode: provider,
    configured: providerReady,
    apiKeyConfigured: Boolean(env.BIP_AI_DRAFT_API_KEY),
    modelConfigured: Boolean(env.BIP_AI_DRAFT_MODEL),
    message: provider === 'deterministic'
      ? 'Deterministic drafting is ready and needs no external provider or API key.'
      : (providerReady
        ? 'External drafting provider configuration is complete. Secret values are not displayed.'
        : 'External drafting provider configuration is incomplete or invalid.')
  };

  const criticalFailure = !node.ok || !config.ok || localState.status === 'fail' || projects.status === 'fail';
  const warnings = [
    ...config.warnings.map((item) => item.message),
    ...(localState.status === 'warn' ? [localState.message] : []),
    ...(projects.status === 'warn' ? [projects.message] : []),
    ...(pag.status === 'warn' ? [pag.message] : [])
  ];

  return {
    ok: !criticalFailure,
    status: criticalFailure ? 'fail' : (warnings.length ? 'warn' : 'pass'),
    checks: {
      node: { status: node.ok ? 'pass' : 'fail', ...node },
      config: {
        status: config.ok ? 'pass' : 'fail',
        errors: config.errors.map((item) => ({ ...item, message: redactSecrets(item.message, env) })),
        warnings: config.warnings.map((item) => ({ ...item, message: redactSecrets(item.message, env) }))
      },
      localState,
      projects,
      drafting,
      pag
    },
    features: {
      localCapture: 'available',
      deterministicDrafting: 'available',
      controlRoom: 'available',
      externalDrafting: provider === 'openai-compatible' && providerReady ? 'available' : 'optional_not_configured',
      pagPublishing: pag.configured && pag.reachable ? 'available' : 'optional_not_configured'
    },
    secrets: {
      draftApiKey: env.BIP_AI_DRAFT_API_KEY ? 'configured' : 'not_configured',
      githubToken: env.BIP_AI_GITHUB_TOKEN ? 'configured' : 'not_configured',
      pagActorToken: env.PAG_ACTOR_TOKEN ? 'configured' : 'not_configured'
    },
    warnings: warnings.map((value) => redactSecrets(value, env))
  };
}

function initializeEnvFile(paths) {
  if (existsSync(paths.envFile)) return { created: false, path: paths.envFile };
  if (!existsSync(paths.envExample)) return { created: false, path: paths.envFile, exampleMissing: true };
  writeFileSync(paths.envFile, readFileSync(paths.envExample, 'utf8'), { mode: 0o600, flag: 'wx' });
  return { created: true, path: paths.envFile };
}

function validateProjectPath(repoPath) {
  const resolved = resolve(repoPath);
  if (!existsSync(resolved)) throw new Error(`project path does not exist: ${resolved}`);
  if (!statSync(resolved).isDirectory()) throw new Error(`project path is not a directory: ${resolved}`);
  return resolved;
}

export async function initializeSetup({
  env = process.env,
  cwd = process.cwd(),
  nodeVersion = process.versions.node,
  projectId = null,
  repoPath = null,
  projectName = null
} = {}) {
  const node = nodeVersionStatus(nodeVersion);
  if (!node.ok) throw new Error(node.message);

  const config = validateRuntimeConfig(env);
  if (!config.ok) {
    throw new Error(`Invalid BIP-AI configuration:\n- ${config.errors.map((item) => item.message).join('\n- ')}`);
  }

  if (Boolean(projectId) !== Boolean(repoPath)) {
    throw new Error('setup project registration requires both <projectId> and <repoPath>.');
  }

  const paths = resolveSetupPaths({ env, cwd });
  const envFile = initializeEnvFile(paths);

  if (paths.database !== ':memory:') mkdirSync(dirname(paths.database), { recursive: true });
  mkdirSync(paths.eventDir, { recursive: true });
  mkdirSync(dirname(paths.projects), { recursive: true });

  const { BipStore } = await import('./store.js');
  const store = new BipStore(paths.database);
  store.close();

  const registry = new ProjectRegistry(paths.projects);
  let project = null;
  if (projectId && repoPath) {
    const id = String(projectId).trim();
    if (!id) throw new Error('project id is required');
    const path = validateProjectPath(resolve(cwd, repoPath));
    const existing = registry.get(id);
    if (existing) {
      if (resolve(existing.path) !== path) {
        throw new Error(`project ${id} is already registered at a different path: ${existing.path}`);
      }
      project = { status: 'unchanged', project: existing };
    } else {
      project = {
        status: 'created',
        project: registry.add({ id, path, name: projectName || id })
      };
    }
  }

  return {
    initialized: true,
    paths: {
      database: paths.database,
      eventDir: paths.eventDir,
      projects: paths.projects
    },
    envFile: {
      path: envFile.path,
      created: envFile.created,
      secretsWritten: false,
      note: envFile.created
        ? 'Created from .env.example with safe defaults; no secret values were generated or persisted.'
        : 'Existing .env was preserved; setup never prints secret values.'
    },
    drafting: {
      mode: config.provider,
      deterministicReady: true,
      externalProviderConfigured: config.provider === 'openai-compatible'
    },
    project,
    restartable: true
  };
}

export async function promptSetupProject({
  cwd = process.cwd(),
  input = process.stdin,
  output = process.stdout
} = {}) {
  const defaultPath = resolve(cwd);
  const defaultId = basename(defaultPath) || 'project';
  const rl = createInterface({ input, output });
  try {
    const idAnswer = (await rl.question(`Project id [${defaultId}]: `)).trim();
    const pathAnswer = (await rl.question(`Project path [${defaultPath}]: `)).trim();
    return {
      projectId: idAnswer || defaultId,
      repoPath: pathAnswer || defaultPath
    };
  } finally {
    rl.close();
  }
}
