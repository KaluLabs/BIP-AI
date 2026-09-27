import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PACKAGE_VERSION,
  runtimeIdentity,
  runtimeRevision,
  runtimeVersion
} from '../src/version.js';

test('runtime version defaults to package version', () => {
  assert.equal(runtimeVersion({}), PACKAGE_VERSION);
});

test('runtime version and revision can be supplied by packaged distribution metadata', () => {
  const env = {
    BIP_AI_VERSION: '0.2.0',
    BIP_AI_REVISION: 'abcdef123456'
  };
  assert.equal(runtimeVersion(env), '0.2.0');
  assert.equal(runtimeRevision(env), 'abcdef123456');
  assert.deepEqual(runtimeIdentity(env), {
    service: 'bip-ai',
    version: '0.2.0',
    revision: 'abcdef123456',
    node: process.versions.node
  });
});

test('blank packaged metadata falls back safely', () => {
  assert.equal(runtimeVersion({ BIP_AI_VERSION: '   ' }), PACKAGE_VERSION);
  assert.equal(runtimeRevision({ BIP_AI_REVISION: '   ' }), null);
});
