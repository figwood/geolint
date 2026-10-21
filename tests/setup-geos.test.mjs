import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('manual GEOS setup rejects mismatches, corrupted sources and failed commands; dry run has no side effects', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./setup_geos_test.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
