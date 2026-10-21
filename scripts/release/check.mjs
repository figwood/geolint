#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { open, readFile, writeFile, mkdir, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inventoryFiles, validateReleaseArtifacts, verifyRelease } from './artifacts.mjs';
import { cleanSiteOutput } from './site.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function execute(command, cwd, env, log) {
  const output = await open(log, 'a');
  try {
    await output.write(`${JSON.stringify(command)}\n`);
    await new Promise((accept, reject) => {
      const child = spawn(command[0], command.slice(1), {
        cwd, env, stdio: ['ignore', output.fd, output.fd], timeout: 40 * 60 * 1000,
      });
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) accept();
        else reject(new Error(`${command.join(' ')} failed (${signal ?? code}). See ${log}`));
      });
    });
  } finally { await output.close(); }
}

async function main() {
  const { values } = parseArgs({ options: {
    'release-dir': { type: 'string', default: '.cache/release-engine' },
    help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/release/check.mjs [--release-dir PATH]');
    console.log('Requires a built engine/source candidate, matching native GEOS baseline, compatible QGIS and Chromium.');
    console.log('Runs all release checks against the selected engine; seals validation.json only after they pass.');
    return;
  }
  const releaseDir = resolve(values['release-dir']);
  const distDir = join(projectRoot, 'dist');
  const receiptPath = join(releaseDir, 'validation.json');
  const stat = await lstat(releaseDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Release directory must be a real directory.');
  await rm(receiptPath, { force: true });
  const before = await validateReleaseArtifacts({ releaseDir, projectRoot });
  const runDir = `checks/run-${Date.now()}-${process.pid}`;
  await mkdir(join(releaseDir, runDir), { recursive: true });
  const hook = new URL('./engine-loader.mjs', import.meta.url).href;
  const env = {
    ...process.env,
    GEOLINT_RELEASE_DIR: releaseDir,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${hook}`].filter(Boolean).join(' '),
  };
  const commands = [
    ['unit', [['npm', 'test']]],
    ['types', [['npm', 'run', 'typecheck']]],
    ['build', [['npm', 'run', 'build:core'], [process.execPath, 'scripts/package-site.mjs', '--release-dir', releaseDir]]],
    ['engine', [['npm', 'run', 'test:engine']]],
    ['parity', [['npm', 'run', 'test:parity']]],
    ['input-parity', [['npm', 'run', 'test:input-parity']]],
    ['validation', [['bash', 'validation/test-all.sh', '--output', join(releaseDir, runDir, 'qgis')]]],
    ['browser', [['npm', 'run', 'test:e2e']]],
  ];
  const checks = [];
  for (const [name, steps] of commands) {
    console.log(`[release] ${name}`);
    if (name === 'build') await cleanSiteOutput(projectRoot, releaseDir);
    const log = `${runDir}/${name}.log`;
    for (const command of steps) await execute(command, projectRoot, env, join(releaseDir, log));
    checks.push({ name, status: 'passed', command: steps[0], commands: steps, log, logSha256: hash(await readFile(join(releaseDir, log))) });
  }
  const after = await validateReleaseArtifacts({ releaseDir, projectRoot });
  if (after.manifestSha256 !== before.manifestSha256) throw new Error('Candidate changed during validation.');
  const receipt = {
    schemaVersion: 1,
    manifestSha256: after.manifestSha256,
    checks,
    distFiles: await inventoryFiles(distDir),
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  try { await verifyRelease({ releaseDir, projectRoot, distDir }); }
  catch (error) { await rm(receiptPath, { force: true }); throw error; }
  console.log('[release] All required checks passed; dist/ and its same-origin source materials are verified.');
}

main().catch(error => {
  console.error(`Release validation failed: ${error.message}`);
  process.exitCode = 1;
});
