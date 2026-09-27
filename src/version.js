import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

export const PACKAGE_VERSION = String(packageJson.version || '0.0.0');

export function runtimeVersion(env = process.env) {
  const override = String(env.BIP_AI_VERSION || '').trim();
  return override || PACKAGE_VERSION;
}

export function runtimeRevision(env = process.env) {
  const value = String(env.BIP_AI_REVISION || '').trim();
  return value || null;
}

export function runtimeIdentity(env = process.env) {
  return {
    service: 'bip-ai',
    version: runtimeVersion(env),
    revision: runtimeRevision(env),
    node: process.versions.node
  };
}
