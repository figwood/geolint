import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/release/check.mjs', import.meta.url));

test('release validation help is available without sources or a compiler', () => {
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /release-dir/);
});

test('an invalid release candidate cannot retain an old passing validation receipt', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'geolint release validation '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'manifest.json'), '{}\n');
  await writeFile(join(directory, 'validation.json'), '{"schemaVersion":1,"checks":[{"name":"engine","status":"passed"}]}\n');
  const result = spawnSync(process.execPath, [script, '--release-dir', directory], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release validation failed/);
  await assert.rejects(readFile(join(directory, 'validation.json')), { code: 'ENOENT' });
});
