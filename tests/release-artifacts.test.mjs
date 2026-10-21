import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateReleaseArtifacts, packageReleaseArtifacts, verifyRelease, inventoryFiles, validateArtifactContents, validateValidationReceipt } from '../scripts/release/artifacts.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const record = (path, bytes) => ({ path, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) });

// Harmless synthetic source and JS test packaging integrity, never a real WASM build.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'geolint-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseDir = join(root, 'release');
  const projectRoot = join(root, 'project');
  const distDir = join(root, 'dist');
  await mkdir(projectRoot); await mkdir(releaseDir); await mkdir(distDir);
  await writeFile(join(projectRoot, 'LICENSE'), 'test application license\n');
  const app = record('LICENSE', 'test application license\n');
  const engines = {
    'engine/geos.esm.js': "export { default } from './src/index.mjs';\n",
    'engine/src/index.mjs': "export { default } from '../build/package/geos.js';\n",
    'engine/build/package/geos.js': 'export default () => {};\n',
    'engine/src/allCFunctions.mjs': 'export {};\n',
    'engine/LICENSE.md': 'synthetic test only'
  };
  for (const [path, bytes] of Object.entries(engines)) {
    await mkdir(join(releaseDir, path, '..'), { recursive: true });
    await writeFile(join(releaseDir, path), bytes);
  }
  const inputs = [];
  const inputNames = { wrapper: 'wrapper.tar', geos: 'geos-3.13.0.tar.bz2', emscripten: 'emscripten.tar', emsdk: 'emsdk.tar' };
  await mkdir(join(root, 'archive/inputs'), { recursive: true });
  await mkdir(join(root, 'archive/application'));
  await writeFile(join(root, 'archive/application/LICENSE'), 'test application license\n');
  await writeFile(join(root, 'archive/REBUILD.md'), 'Test fixture only.\n');
  for (const [name, filename] of Object.entries(inputNames)) {
    const path = `inputs/${filename}`;
    const required = {
      wrapper: ['src/index.mjs', 'src/allCFunctions.mjs', 'LICENSE.md', 'Makefile', 'GEOS_EMCC_FLAGS.mk', 'package.json'],
      geos: ['geos-3.13.0/COPYING', 'geos-3.13.0/CMakeLists.txt'],
      emscripten: ['emcc.py', 'LICENSE', 'emscripten-version.txt', 'src/preamble.js', 'system/lib/test.c', 'tools/test.py'],
      emsdk: ['emsdk.py', 'emsdk_env.sh', 'emsdk_manifest.json', 'emscripten-releases-tags.json', 'LICENSE']
    }[name];
    const contents = Object.fromEntries(Object.entries(engines).map(([path, bytes]) => [path.replace('engine/', ''), bytes]));
    execFileSync('python3', ['-c', `import io,json,tarfile,sys
contents=json.loads(sys.argv[3])
with tarfile.open(sys.argv[1],"w:bz2" if sys.argv[1].endswith("bz2") else "w") as archive:
    for path in json.loads(sys.argv[2]):
        data=contents.get(path,"synthetic test only").encode()
        member=tarfile.TarInfo(path); member.size=len(data)
        archive.addfile(member,io.BytesIO(data))`, join(root, 'archive', path), JSON.stringify(required), JSON.stringify(name === 'wrapper' ? contents : {})]);
    const bytes = await readFile(join(root, 'archive', path));
    const identities = { wrapper: { version: '3.1.1', commit: '82e49f9ba1849a004bf31fc1c1be2ff918889586', tree: 'c00c2bb9cf2eec6bd8c47d6caff0e75dcf8b0241' }, geos: { version: '3.13.0' }, emscripten: { version: '3.1.73', commit: 'ac676d5e437525d15df5fd46bc2c208ec6d376a3', tree: '3f44b74492e7ff1b748ae15702328a3cb03fe1ab' }, emsdk: { commit: '6abe5123c34a7751a2d5b679e856b2591ba04145', tree: 'e41bcd780b05956b82a4eb843f0912658aa90554' } };
    inputs.push({ name, ...record(path, bytes), ...identities[name] });
  }
  await writeFile(join(root, 'archive/inputs/manifest.json'), JSON.stringify({ schemaVersion: 1, inputs }));
  execFileSync('python3', ['-c', 'import tarfile,sys; t=tarfile.open(sys.argv[2],"w:gz"); t.add(sys.argv[1],arcname=""); t.close()', join(root, 'archive'), join(root, 'source.tar.gz')]);
  const archive = await readFile(join(root, 'source.tar.gz'));
  const partPath = 'sources/engine-source.tar.gz.part001';
  await mkdir(join(releaseDir, 'sources'));
  await writeFile(join(releaseDir, partPath), archive);
  const manifest = {
    schemaVersion: 1, status: 'built',
    toolchain: { emscriptenVersion: '3.1.73', emscriptenCommit: 'ac676d5e437525d15df5fd46bc2c208ec6d376a3', emsdkCommit: '6abe5123c34a7751a2d5b679e856b2591ba04145', compilerVersion: 'emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.73' },
    engine: { entry: 'engine/geos.esm.js', files: Object.entries(engines).map(([path, bytes]) => record(path, bytes)) },
    sourceArchive: { name: 'engine-source.tar.gz', bytes: archive.length, sha256: hash(archive), parts: [record(partPath, archive)] },
    inputs, applicationFiles: [app]
  };
  const save = () => writeFile(join(releaseDir, 'manifest.json'), JSON.stringify(manifest));
  await save();
  return { root, releaseDir, projectRoot, distDir, manifest, save };
}

async function resealSource(f) {
  await writeFile(join(f.root, 'archive/inputs/manifest.json'), JSON.stringify({ schemaVersion: 1, inputs: f.manifest.inputs }));
  execFileSync('python3', ['-c', 'import tarfile,sys; t=tarfile.open(sys.argv[2],"w:gz"); t.add(sys.argv[1],arcname=""); t.close()', join(f.root, 'archive'), join(f.root, 'source.tar.gz')]);
  const bytes = await readFile(join(f.root, 'source.tar.gz'));
  const part = record('sources/engine-source.tar.gz.part001', bytes);
  await writeFile(join(f.releaseDir, part.path), bytes);
  f.manifest.sourceArchive = { name: 'engine-source.tar.gz', bytes: bytes.length, sha256: hash(bytes), parts: [part] };
  await f.save();
}

test('synthetic archive validates content integrity but cannot qualify as a pinned release', async t => {
  const f = await fixture(t);
  await validateArtifactContents(f);
  await assert.rejects(validateReleaseArtifacts(f), /incorrect geos sha256 pin/);
  await assert.rejects(packageReleaseArtifacts(f), /incorrect geos sha256 pin/);
  await assert.rejects(readFile(join(f.distDir, 'sources/manifest.json')));
});

for (const [name, mutate] of [
  ['engine tampering', async f => writeFile(join(f.releaseDir, 'engine/build/package/geos.js'), 'changed')],
  ['source part tampering', async f => writeFile(join(f.releaseDir, 'sources/engine-source.tar.gz.part001'), 'changed')],
  ['omitted engine dependency', async f => { f.manifest.engine.files.pop(); await f.save(); }],
  ['path traversal', async f => { f.manifest.engine.files[0].path = '../outside'; await f.save(); }],
  ['stale application', async f => writeFile(join(f.projectRoot, 'LICENSE'), 'changed')],
  ['symlink file', async f => { const path = join(f.releaseDir, 'engine/geos.esm.js'); await rm(path); await symlink(join(f.projectRoot, 'LICENSE'), path); }]
]) {
  test(`rejects ${name}`, async t => { const f = await fixture(t); await mutate(f); await assert.rejects(validateArtifactContents(f)); });
}

test('final verifier rejects missing, skipped, stale receipts and changed final dist', async t => {
  const f = await fixture(t);
  const result = await validateArtifactContents(f);
  await cp(join(f.releaseDir, 'engine'), join(f.distDir, 'vendor/geos'), { recursive: true });
  await cp(join(f.releaseDir, 'sources'), join(f.distDir, 'sources'), { recursive: true });
  await cp(join(f.releaseDir, 'manifest.json'), join(f.distDir, 'sources/manifest.json'));
  await writeFile(join(f.distDir, 'sources/index.html'), 'Synthetic fixture only');
  const verify = () => validateValidationReceipt({ ...f, ...result });
  await assert.rejects(verify());
  const bytes = await readFile(join(f.releaseDir, 'manifest.json'));
  const checks = [];
  await mkdir(join(f.releaseDir, 'checks'));
  for (const name of ['unit', 'types', 'build', 'engine', 'parity', 'input-parity', 'validation', 'browser']) {
    await writeFile(join(f.releaseDir, `checks/${name}.log`), `${name}: passed\n`);
    checks.push({ name, status: 'passed', command: ['test', name], log: `checks/${name}.log`, logSha256: hash(`${name}: passed\n`) });
  }
  const receipt = { schemaVersion: 1, manifestSha256: hash(bytes), checks, distFiles: await inventoryFiles(f.distDir) };
  const save = () => writeFile(join(f.releaseDir, 'validation.json'), JSON.stringify(receipt));
  await save(); await verify();
  receipt.checks[0].status = 'skipped'; await save(); await assert.rejects(verify());
  receipt.checks[0].status = 'passed'; receipt.manifestSha256 = '0'.repeat(64); await save(); await assert.rejects(verify());
  receipt.manifestSha256 = hash(bytes); await save();
  await writeFile(join(f.distDir, 'vendor/geos/geos.esm.js'), 'tamper');
  await assert.rejects(verify());
});

test('release notices identify replacement binary, pinned SDK and local sources without old npm provenance', async () => {
  const { renderReleaseNotices } = await import('../scripts/release/artifacts.mjs');
  const baseline = await readFile('public/licenses/THIRD-PARTY-NOTICES.md', 'utf8');
  const updated = renderReleaseNotices(baseline, { engine: { files: [{ path: 'engine/geos.esm.js', bytes: 41, sha256: 'a'.repeat(64) }, { path: 'engine/build/package/geos.js', bytes: 99, sha256: 'b'.repeat(64) }] }, toolchain: { emscriptenVersion: '3.1.73', emscriptenCommit: 'ac676d5e437525d15df5fd46bc2c208ec6d376a3', emsdkCommit: '6abe5123c34a7751a2d5b679e856b2591ba04145', compilerVersion: 'emcc 3.1.73' } });
  assert.match(updated, /\.\.\/sources\//);
  assert.match(updated, /bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/);
  assert.match(updated, /LGPL-3.0-or-later.*LICENSE.md/s);
  assert.match(updated, /GEOS-COPYING.txt/);
  assert.match(updated, /fflate 0.8.3/);
  assert.doesNotMatch(updated, /b04ef48ab717|3e114eb4af4585|2,578,331|does not currently contain/);
});

for (const [name, mutate] of [
  ['required rebuild instructions', async f => rm(join(f.root, 'archive/REBUILD.md'))],
  ['source snapshot matching the application', async f => writeFile(join(f.root, 'archive/application/LICENSE'), 'altered application')],
  ['required wrapper sources', async f => {
    const path = join(f.root, 'archive/inputs/wrapper.tar');
    execFileSync('python3', ['-c', 'import tarfile,sys; tarfile.open(sys.argv[1],"w").close()', path]);
    Object.assign(f.manifest.inputs[0], record('inputs/wrapper.tar', await readFile(path)));
  }],
  ['safe outer archive members', async f => symlink('/etc/passwd', join(f.root, 'archive/escape'))],
  ['only declared source files', async f => writeFile(join(f.root, 'archive/application/secret.env'), 'must not ship')]
]) {
  test(`requires ${name} even when an attacker recomputes archive hashes`, async t => {
    const f = await fixture(t); await mutate(f); await resealSource(f);
    await assert.rejects(validateArtifactContents(f), /source archive rejected/);
  });
}

test('preserves safe nested upstream source links and rejects links that escape the source root', async t => {
  const f = await fixture(t);
  const path = join(f.root, 'archive/inputs/wrapper.tar');
  const appendLink = target => execFileSync('python3', ['-c', 'import tarfile,sys; t=tarfile.open(sys.argv[1],"a"); n=tarfile.TarInfo("src/link.mjs"); n.type=tarfile.SYMTYPE; n.linkname=sys.argv[2]; t.addfile(n); t.close()', path, target]);
  appendLink('index.mjs');
  const linkedBytes = await readFile(join(f.releaseDir, 'engine/src/index.mjs'));
  await writeFile(join(f.releaseDir, 'engine/src/link.mjs'), linkedBytes);
  f.manifest.engine.files.push(record('engine/src/link.mjs', linkedBytes));
  Object.assign(f.manifest.inputs[0], record('inputs/wrapper.tar', await readFile(path)));
  await resealSource(f);
  await validateArtifactContents(f);
  // Replace the input rather than introduce a duplicate link, so escape itself is tested.
  execFileSync('python3', ['-c', 'import tarfile,sys; old=tarfile.open(sys.argv[1]); members=[(n,old.extractfile(n).read() if n.isfile() else None) for n in old if n.name!="src/link.mjs"]; old.close(); import io; t=tarfile.open(sys.argv[1],"w"); [t.addfile(n,io.BytesIO(b) if b is not None else None) for n,b in members]; t.close()', path]);
  appendLink('../../outside');
  Object.assign(f.manifest.inputs[0], record('inputs/wrapper.tar', await readFile(path)));
  await resealSource(f);
  await assert.rejects(validateArtifactContents(f), /source archive rejected/);
});

test('release application inventory rejects files omitted from both archive and manifest', async t => {
  const { validateApplicationInventory } = await import('../scripts/release/artifacts.mjs');
  const f = await fixture(t);
  for (const [path, bytes] of Object.entries({ 'package.json': '{}', 'src/engine/geos.ts': 'export {};', 'scripts/release/build-engine.py': '# selected source' })) {
    await mkdir(join(f.projectRoot, path, '..'), { recursive: true });
    await writeFile(join(f.projectRoot, path), bytes);
    f.manifest.applicationFiles.push(record(path, bytes));
  }
  await validateApplicationInventory(f.projectRoot, f.manifest.applicationFiles);
  await writeFile(join(f.projectRoot, 'src/engine/forgotten.ts'), 'export {};');
  await assert.rejects(validateApplicationInventory(f.projectRoot, f.manifest.applicationFiles), /application inventory/);
});

test('delivered wrapper must match every archived original source and legal file', async t => {
  const f = await fixture(t);
  await rm(join(f.releaseDir, 'engine/src/allCFunctions.mjs'));
  f.manifest.engine.files = f.manifest.engine.files.filter(file => file.path !== 'engine/src/allCFunctions.mjs');
  await f.save();
  await assert.rejects(validateArtifactContents(f), /missing delivered wrapper source/);
});

test('full release verifier rejects synthetic source snapshots claiming the fixed Git trees', async t => {
  const f = await fixture(t);
  await assert.rejects(validateArtifactContents(f, { pinnedTrees: true }), /pinned Git source tree mismatch/);
});

test('release metadata requires the exact pinned Emscripten test submodule references', async t => {
  const f = await fixture(t);
  f.manifest.inputs.find(input => input.name === 'geos').sha256 = '47ec83ff334d672b9e4426695f15da6e6368244214971fabf386ff8ef6df39e4';
  const input = f.manifest.inputs.find(input => input.name === 'emscripten');
  await f.save();
  await assert.rejects(validateReleaseArtifacts(f), /emscripten gitlinks pin/);
  input.gitlinks = {
    'test/third_party/googletest': '4fb7039fda3f6588c7ca9664176f8c9e0a023b4a',
    'test/third_party/posixtestsuite': '869e266b090a8d44e51bb040904c942556b1e4ab',
    'test/third_party/wasi-test-suite': 'ac9371207fc61972a21d7d086074ca690a99d14d'
  };
  await f.save();
  await assert.rejects(validateReleaseArtifacts(f), /emscripten gitlinkRepositories pin/);
  input.gitlinkRepositories = {
    'test/third_party/googletest': 'https://github.com/google/googletest',
    'test/third_party/posixtestsuite': 'https://github.com/emscripten-core/posixtestsuite',
    'test/third_party/wasi-test-suite': 'https://github.com/khronosproject/wasi-test-suite'
  };
  await f.save();
  // Valid metadata proceeds to real source verification, which rejects synthetic inputs.
  await assert.rejects(validateReleaseArtifacts(f), /pinned Git source tree mismatch/);
  input.gitlinkRepositories['test/third_party/googletest'] = 'https://invalid.example/source';
  await f.save();
  await assert.rejects(validateReleaseArtifacts(f), /emscripten gitlinkRepositories pin/);
  input.gitlinkRepositories['test/third_party/googletest'] = 'https://github.com/google/googletest';
  input.gitlinks['test/third_party/googletest'] = '0'.repeat(40);
  await f.save();
  await assert.rejects(validateReleaseArtifacts(f), /emscripten gitlinks pin/);
});
