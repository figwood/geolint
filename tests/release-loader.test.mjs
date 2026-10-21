import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const hook = fileURLToPath(new URL('../scripts/release/engine-loader.mjs', import.meta.url));

test('release checks load the selected engine rather than the npm engine', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'geolint selected engine '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'engine'));
  await writeFile(join(directory, 'engine/geos.esm.js'), 'export default () => "selected-engine";\n');
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
  const result = spawnSync(process.execPath, ['--import', hook, '--input-type=module', '-e',
    'import engine from "geos-wasm"; import {sep} from "node:path"; console.log(engine()); if (!sep) process.exit(2);'], {
    encoding: 'utf8', env: { ...process.env, GEOLINT_RELEASE_DIR: directory },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'selected-engine');
});

test('release engine selection fails rather than falling back when the engine is missing', () => {
  const result = spawnSync(process.execPath, ['--import', hook, '--input-type=module', '-e', 'import "geos-wasm";'], {
    encoding: 'utf8', env: { ...process.env, GEOLINT_RELEASE_DIR: '/nonexistent-geolint-release-engine' },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release engine entry does not exist/);
});
