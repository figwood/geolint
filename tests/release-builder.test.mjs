import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('release builder packages real source inputs, hashes bounded parts and fails closed', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./python/test_release_builder.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
