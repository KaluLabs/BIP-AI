import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Control Room browser JavaScript parses successfully', () => {
  const result = spawnSync(process.execPath, ['--check', 'public/app.js'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});


test('CLI JavaScript parses successfully', () => {
  const result = spawnSync(process.execPath, ['--check', 'src/cli.js'], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
