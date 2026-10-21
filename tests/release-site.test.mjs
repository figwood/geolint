import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanSiteOutput } from '../scripts/release/site.mjs';

test('release build removes stale pages and compiled modules while preserving sources', async t => {
  const root = await mkdtemp(join(tmpdir(), 'geolint clean release '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist/core'), { recursive: true });
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'dist/removed-page.html'), 'stale page');
  await writeFile(join(root, 'dist/core/removed-module.js'), 'stale code');
  await writeFile(join(root, 'src/current.ts'), 'source');
  await cleanSiteOutput(root, join(root, '.cache/release-engine'));
  await assert.rejects(access(join(root, 'dist')), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'src/current.ts'), 'utf8'), 'source');
});

test('release build refuses an engine candidate inside the output it would remove', async t => {
  const root = await mkdtemp(join(tmpdir(), 'geolint protected candidate '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist/candidate'), { recursive: true });
  await writeFile(join(root, 'dist/candidate/manifest.json'), 'candidate');
  await assert.rejects(cleanSiteOutput(root, join(root, 'dist/candidate')), /outside dist/);
  assert.equal(await readFile(join(root, 'dist/candidate/manifest.json'), 'utf8'), 'candidate');
});
