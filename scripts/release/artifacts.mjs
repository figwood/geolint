import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const requiredChecks = ['unit', 'types', 'build', 'engine', 'parity', 'input-parity', 'validation', 'browser'];
const pins = {
  wrapper: { commit: '82e49f9ba1849a004bf31fc1c1be2ff918889586', version: '3.1.1', tree: 'c00c2bb9cf2eec6bd8c47d6caff0e75dcf8b0241' },
  geos: { version: '3.13.0', sha256: '47ec83ff334d672b9e4426695f15da6e6368244214971fabf386ff8ef6df39e4' },
  emscripten: { version: '3.1.73', commit: 'ac676d5e437525d15df5fd46bc2c208ec6d376a3', tree: '3f44b74492e7ff1b748ae15702328a3cb03fe1ab', gitlinks: {
    'test/third_party/googletest': '4fb7039fda3f6588c7ca9664176f8c9e0a023b4a',
    'test/third_party/posixtestsuite': '869e266b090a8d44e51bb040904c942556b1e4ab',
    'test/third_party/wasi-test-suite': 'ac9371207fc61972a21d7d086074ca690a99d14d'
  }, gitlinkRepositories: {
    'test/third_party/googletest': 'https://github.com/google/googletest',
    'test/third_party/posixtestsuite': 'https://github.com/emscripten-core/posixtestsuite',
    'test/third_party/wasi-test-suite': 'https://github.com/khronosproject/wasi-test-suite'
  } },
  emsdk: { commit: '6abe5123c34a7751a2d5b679e856b2591ba04145', tree: 'e41bcd780b05956b82a4eb843f0912658aa90554' }
};
const fail = message => { throw new Error(`Release validation: ${message}`); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function safePath(path) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..') || /^[A-Za-z]:/.test(path)) fail(`unsafe relative path ${JSON.stringify(path)}`);
  return path;
}

async function regularFile(root, path) {
  safePath(path);
  let current = root;
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail(`unsafe root ${root}`);
  for (const [index, component] of path.split('/').entries()) {
    current = join(current, component);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index === path.split('/').length - 1 ? !stat.isFile() : !stat.isDirectory())) fail(`not a regular file: ${path}`);
  }
  return current;
}

async function fileHash(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}

function records(value, label) {
  if (!Array.isArray(value) || !value.length) fail(`missing ${label}`);
  const paths = new Set();
  for (const item of value) {
    safePath(item.path);
    if (paths.has(item.path) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) fail(`invalid ${label} record`);
    paths.add(item.path);
  }
  return value;
}

async function checkFile(root, record) {
  const actual = await fileHash(await regularFile(root, record.path));
  if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) fail(`content mismatch: ${record.path}`);
}

export async function inventoryFiles(root) {
  const files = [];
  async function walk(path = '') {
    const stat = await lstat(join(root, path));
    if (stat.isSymbolicLink()) fail(`symlink: ${path}`);
    if (stat.isDirectory()) {
      for (const child of (await readdir(join(root, path))).sort()) await walk(path ? `${path}/${child}` : child);
    } else if (stat.isFile()) files.push({ path, ...await fileHash(join(root, path)) });
    else fail(`unsupported file: ${path}`);
  }
  await walk();
  return files;
}

// Python streams the concatenated parts and nested archives without extracting any path.
// Outer archives contain only regular source files; nested upstream archives may
// preserve contained links, with escape/cycle/dangling-target checks.
const archiveVerifier = String.raw`
import hashlib, io, json, pathlib, sys, tarfile, tempfile, posixpath, runpy
root, manifest_path, builder_path, strict = sys.argv[1:]
strict = strict == "true"
module = runpy.run_path(builder_path) if strict else None
m = json.load(open(manifest_path))
class Parts(io.RawIOBase):
    def __init__(self, paths): self.paths=iter(paths); self.current=None
    def readable(self): return True
    def readinto(self,b):
        while True:
            if self.current is None:
                try: self.current=open(next(self.paths),'rb')
                except StopIteration: return 0
            n=self.current.readinto(b)
            if n: return n
            self.current.close(); self.current=None
stream=io.BufferedReader(Parts([str(pathlib.Path(root)/p['path']) for p in m['sourceArchive']['parts']]))
expected={i['path']:i for i in m['inputs']}
expected.update({'application/'+i['path']:i for i in m['applicationFiles']})
required_inputs={
 'inputs/wrapper.tar': {'src/index.mjs','src/allCFunctions.mjs','LICENSE.md','Makefile','GEOS_EMCC_FLAGS.mk','package.json'},
 'inputs/geos-3.13.0.tar.bz2': {'geos-3.13.0/COPYING','geos-3.13.0/CMakeLists.txt'},
 'inputs/emscripten.tar': {'emcc.py','LICENSE','emscripten-version.txt'},
 'inputs/emsdk.tar': {'emsdk.py','emsdk_env.sh','emsdk_manifest.json','emscripten-releases-tags.json','LICENSE'}
}
def safe_member(member, allow_links=False):
    name=member.name.rstrip('/')
    if not name or name.startswith('/') or chr(92) in name or any(p in ('','..','.') for p in name.split('/')): raise ValueError('unsafe archive path '+name)
    if not (member.isfile() or member.isdir() or (allow_links and (member.issym() or member.islnk()))): raise ValueError('unsupported archive member '+name)
    return name
seen=set()
with tarfile.open(fileobj=stream,mode='r|gz') as archive:
    for member in archive:
        name=member.name.rstrip('/')
        if name == '' and member.isdir(): continue
        if not name or name.startswith('/') or '\\' in name or any(p in ('','..','.') for p in name.split('/')): raise ValueError('unsafe archive path '+name)
        safe_member(member)
        if member.isfile() and name not in expected and name not in ('inputs/manifest.json','REBUILD.md'): raise ValueError('undeclared source file '+name)
        if name in seen: raise ValueError('duplicate archive member '+name)
        seen.add(name)
        if not (member.isfile() or member.isdir() or (allow_links and (member.issym() or member.islnk()))): raise ValueError('unsupported archive member '+name)
        if name == 'inputs/manifest.json':
            embedded=json.load(archive.extractfile(member))
            if embedded.get('schemaVersion')!=1 or embedded.get('inputs')!=m['inputs']: raise ValueError('embedded input manifest differs')
        if name in expected:
            if not member.isfile(): raise ValueError('required member is not file '+name)
            digest=hashlib.sha256(); length=0
            with tempfile.TemporaryFile() as spool:
                with archive.extractfile(member) as source:
                    while data:=source.read(1048576): digest.update(data); length+=len(data); spool.write(data)
                want=expected[name]
                if digest.hexdigest()!=want['sha256'] or length!=want['bytes']: raise ValueError('archive content mismatch '+name)
                if strict and want.get('tree'):
                    spool.seek(0)
                    if module['archive_git_tree'](spool, gitlinks=want.get('gitlinks'))!=want['tree']: raise ValueError('pinned Git source tree mismatch '+name)
                if name == 'inputs/wrapper.tar':
                    spool.seek(0)
                    expected_wrapper={i['path']:i for i in m['engine']['files'] if i['path'].startswith('engine/src/')}
                    actual_wrapper=set()
                    with tarfile.open(fileobj=spool,mode='r:*') as wrapper:
                        for original in wrapper.getmembers():
                            source_path=original.name
                            legal='/' not in source_path and any(word in source_path.upper() for word in ('LICENSE','COPYING','NOTICE'))
                            if not (source_path.startswith('src/') or legal) or original.isdir(): continue
                            delivered='engine/'+source_path
                            if source_path.startswith('src/'): actual_wrapper.add(delivered)
                            record=next((i for i in m['engine']['files'] if i['path']==delivered),None)
                            if record is None: raise ValueError('missing delivered wrapper source '+delivered)
                            data=wrapper.extractfile(original).read()
                            if len(data)!=record['bytes'] or hashlib.sha256(data).hexdigest()!=record['sha256']: raise ValueError('delivered wrapper source differs '+delivered)
                    if actual_wrapper!=set(expected_wrapper): raise ValueError('delivered wrapper source inventory differs')
                if name in required_inputs:
                    spool.seek(0); nested_seen=set(); nested_links={}
                    with tarfile.open(fileobj=spool,mode='r|*') as nested:
                        for item in nested:
                            nested_name=item.name.rstrip('/')
                            if nested_name == '' and item.isdir(): continue
                            safe_member(item,allow_links=True)
                            if item.issym() or item.islnk():
                                target=item.linkname
                                if not target or target.startswith('/') or chr(92) in target: raise ValueError('unsafe nested link '+nested_name)
                                target=posixpath.normpath(posixpath.join(posixpath.dirname(nested_name),target) if item.issym() else target)
                                if target in ('','..','.') or target.startswith('../'): raise ValueError('escaping nested link '+nested_name)
                                nested_links[nested_name]=target
                            if nested_name in nested_seen: raise ValueError('duplicate nested member '+nested_name)
                            nested_seen.add(nested_name)
                    def resolve_link(path,active=frozenset()):
                        components=path.split('/')
                        for index in range(1,len(components)+1):
                            prefix='/'.join(components[:index])
                            if prefix in nested_links:
                                if prefix in active: raise ValueError('cyclic nested link '+prefix)
                                return resolve_link(posixpath.join(nested_links[prefix],*components[index:]),active|{prefix})
                        if path not in nested_seen: raise ValueError('dangling nested link '+path)
                        return path
                    for path in nested_links: resolve_link(path)
                    if required_inputs[name]-nested_seen: raise ValueError('incomplete input source '+name)
                    if name == 'inputs/emscripten.tar' and any(not any(p.startswith(prefix) for p in nested_seen) for prefix in ('src/','system/','tools/')): raise ValueError('missing Emscripten runtime/system/tools source')
missing=set(expected)-seen
if missing or not {'REBUILD.md','inputs/manifest.json'} <= seen: raise ValueError('missing archive members '+str(missing))
`;

export async function validateReleaseArtifacts(options) {
  const manifest = JSON.parse(await readFile(await regularFile(resolve(options.releaseDir), 'manifest.json')));
  validatePins(manifest);
  const result = await validateArtifactContents(options, { pinnedTrees: true });
  validatePins(result.manifest);
  await validateApplicationInventory(options.projectRoot ?? process.cwd(), result.manifest.applicationFiles);
  return result;
}

export async function validateApplicationInventory(projectRoot, applicationFiles) {
  const module = fileURLToPath(new URL('./build-engine.py', import.meta.url));
  const code = 'import json,pathlib,runpy,sys; module=runpy.run_path(sys.argv[1]); root=pathlib.Path(sys.argv[2]).resolve(); print(json.dumps([p.relative_to(root).as_posix() for p in module["application_files"](root)]))';
  const actual = JSON.parse(execFileSync('python3', ['-c', code, module, resolve(projectRoot)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  const expected = applicationFiles.map(file => file.path).sort();
  if (JSON.stringify([...actual].sort()) !== JSON.stringify(expected)) fail('application inventory is incomplete or includes excluded files');
  for (const required of ['package.json', 'src/engine/geos.ts', 'scripts/release/build-engine.py']) if (!expected.includes(required)) fail(`application inventory lacks ${required}`);
}

function validatePins(manifest) {
  const tc = manifest.toolchain;
  if (!tc || tc.emscriptenVersion !== pins.emscripten.version || tc.emscriptenCommit !== pins.emscripten.commit || tc.emsdkCommit !== pins.emsdk.commit || typeof tc.compilerVersion !== 'string' || !/\b3\.1\.73\b/.test(tc.compilerVersion)) fail('compiler pins do not match');
  const inputs = records(manifest.inputs, 'inputs');
  if (inputs.length !== 4 || new Set(inputs.map(i => i.name)).size !== 4) fail('four pinned input identities are required');
  const inputPaths = { wrapper: 'inputs/wrapper.tar', geos: 'inputs/geos-3.13.0.tar.bz2', emscripten: 'inputs/emscripten.tar', emsdk: 'inputs/emsdk.tar' };
  for (const input of inputs) {
    if (!pins[input.name] || input.path !== inputPaths[input.name]) fail('unknown input');
    for (const [key, value] of Object.entries(pins[input.name])) {
      const equal = key === 'gitlinks' || key === 'gitlinkRepositories'
        ? input[key] && typeof input[key] === 'object' && !Array.isArray(input[key]) && JSON.stringify(Object.entries(input[key]).sort()) === JSON.stringify(Object.entries(value).sort())
        : input[key] === value;
      if (!equal) fail(`incorrect ${input.name} ${key} pin`);
    }
    if (input.name !== 'emscripten' && (input.gitlinks !== undefined || input.gitlinkRepositories !== undefined)) fail(`unexpected ${input.name} gitlinks`);
  }
}

// Integrity checks are separately reusable for examining untrusted candidates; release
// packaging and final verification additionally require the immutable upstream pins.
export async function validateArtifactContents({ releaseDir, projectRoot = process.cwd() }, { pinnedTrees = false } = {}) {
  releaseDir = resolve(releaseDir); projectRoot = resolve(projectRoot);
  const manifestBytes = await readFile(await regularFile(releaseDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || manifest.status !== 'built') fail('manifest is not a built schema 1 candidate');
  records(manifest.inputs, 'inputs');
  const engine = manifest.engine;
  if (engine?.entry !== 'engine/geos.esm.js') fail('incorrect engine entry');
  const engineFiles = records(engine.files, 'engine files');
  if (engineFiles.some(file => !file.path.startsWith('engine/'))) fail('engine file outside engine/');
  for (const required of ['engine/geos.esm.js', 'engine/src/index.mjs', 'engine/build/package/geos.js']) if (!engineFiles.some(file => file.path === required)) fail(`missing ${required}`);
  for (const file of engineFiles) await checkFile(releaseDir, file);
  const actualEngine = await inventoryFiles(join(releaseDir, 'engine'));
  if (JSON.stringify(actualEngine.map(f => `engine/${f.path}`).sort()) !== JSON.stringify(engineFiles.map(f => f.path).sort())) fail('engine inventory does not match all files');
  const apps = records(manifest.applicationFiles, 'application files');
  for (const file of apps) await checkFile(projectRoot, file);
  const archive = manifest.sourceArchive;
  if (archive?.name !== 'engine-source.tar.gz' || !Number.isSafeInteger(archive.bytes) || archive.bytes < 1 || !/^[a-f0-9]{64}$/.test(archive.sha256)) fail('invalid source archive');
  const parts = records(archive.parts, 'source archive parts');
  const combined = createHash('sha256'); let total = 0;
  for (const [index, part] of parts.entries()) {
    if (part.path !== `sources/${archive.name}.part${String(index + 1).padStart(3, '0')}` || part.bytes < 1 || part.bytes > 20 * 1024 * 1024) fail('invalid source part order or size');
    await checkFile(releaseDir, part);
    for await (const chunk of createReadStream(await regularFile(releaseDir, part.path))) { combined.update(chunk); total += chunk.length; }
  }
  if (total !== archive.bytes || combined.digest('hex') !== archive.sha256) fail('concatenated source archive mismatch');
  try { execFileSync('python3', ['-c', archiveVerifier, releaseDir, join(releaseDir, 'manifest.json'), fileURLToPath(new URL('./build-engine.py', import.meta.url)), String(pinnedTrees)], { stdio: 'pipe', maxBuffer: 1024 * 1024 }); }
  catch (error) { fail(`source archive rejected: ${error.stderr?.toString() || error.message}`); }
  return { manifest, manifestSha256: sha256(manifestBytes) };
}

export function renderReleaseNotices(baseline, manifest) {
  const binary = manifest.engine.files.find(file => file.path === 'engine/build/package/geos.js');
  const tc = manifest.toolchain;
  const runtimeNotices = manifest.engine.files.some(file => file.path === 'engine/runtime-notices/LICENSE') ? '\nEmscripten runtime legal notices: [SDK license](../vendor/geos/runtime-notices/LICENSE) and [bundled runtime notice index](../vendor/geos/runtime-notices/index.txt).\n' : '';
  const section = `## geos-wasm 3.1.1 and GEOS 3.13.0

This release uses a replacement engine built from the original wrapper sources, loaded separately at ../vendor/geos/geos.esm.js. The generated binary/runtime module is ../vendor/geos/build/package/geos.js (${binary.bytes} bytes; SHA-256 ${binary.sha256}).

The geos-wasm 3.1.1 upstream package.json declares LGPL-3.0-or-later, while its LICENSE.md contains LGPL 2.1. Both upstream statements are preserved; supplying license texts does not resolve their difference:

- [Original geos-wasm license](geos-wasm-LICENSE.txt)
- [LGPL 3.0 or later](LGPL-3.0-or-later.txt)
- [GPL 3.0 or later](GPL-3.0-or-later.txt)
- [GEOS 3.13.0 COPYING](GEOS-COPYING.txt)

[Complete corresponding source and build materials](../sources/) are served from this site, including application source, wrapper, GEOS, Emscripten runtime source, SDK driver/manifest source, original license files, build scripts and REBUILD.md. Download all source parts and follow their reconstruction instructions. [The manifest](../sources/manifest.json) identifies each input and output by hash.
${runtimeNotices}
Wrapper commit: 82e49f9ba1849a004bf31fc1c1be2ff918889586. GEOS: 3.13.0. Emscripten: ${tc.emscriptenVersion}, commit ${tc.emscriptenCommit}; emsdk commit ${tc.emsdkCommit}. Compiler version: ${tc.compilerVersion}. This identifies the replacement build; it does not identify the compiler used for the older npm binary or assert byte-for-byte equivalence to that binary.

You can replace the engine while preserving its loader interface and rebuild using the supplied inputs. GeoLint imposes no additional restrictions on modification or reverse engineering for debugging library modifications.

`;
  const pattern = /## geos-wasm 3\.1\.1 and GEOS 3\.13\.0\n[^]*?(?=## Components included in GEOS)/;
  if (!pattern.test(baseline)) fail('missing engine notice section');
  return baseline.replace(pattern, section);
}

export async function packageReleaseArtifacts({ releaseDir, projectRoot = process.cwd(), distDir = 'dist' }) {
  const result = await validateReleaseArtifacts({ releaseDir, projectRoot });
  const { manifest } = result;
  await rm(join(distDir, 'vendor/geos'), { recursive: true, force: true });
  await mkdir(join(distDir, 'vendor/geos'), { recursive: true });
  await cp(join(releaseDir, 'engine'), join(distDir, 'vendor/geos'), { recursive: true });
  await rm(join(distDir, 'sources'), { recursive: true, force: true });
  await mkdir(join(distDir, 'sources'), { recursive: true });
  await cp(join(releaseDir, 'manifest.json'), join(distDir, 'sources/manifest.json'));
  for (const part of manifest.sourceArchive.parts) await cp(join(releaseDir, part.path), join(distDir, part.path));
  const links = manifest.sourceArchive.parts.map(part => `<li><a href="./${part.path.slice('sources/'.length)}">${part.path.slice('sources/'.length)}</a> (${part.bytes} bytes; SHA-256 ${part.sha256})</li>`).join('\n');
  await writeFile(join(distDir, 'sources/index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>GeoLint corresponding source</title><h1>Engine and application source materials</h1><p>GEOS 3.13.0; geos-wasm wrapper 3.1.1; Emscripten 3.1.73.</p><p><a href="./manifest.json">Build manifest</a></p><p>Download every numbered part in order, concatenate without modification, and extract ${manifest.sourceArchive.name}. Follow REBUILD.md in the archive. The archive includes application sources and licenses, wrapper, GEOS, Emscripten runtime and SDK driver sources. Compiler binaries are fetched by the pinned SDK.</p><ul>${links}</ul><p>Archive SHA-256: ${manifest.sourceArchive.sha256}</p><pre>cat ${manifest.sourceArchive.name}.part* &gt; ${manifest.sourceArchive.name}\nsha256sum ${manifest.sourceArchive.name}\ntar -xzf ${manifest.sourceArchive.name}</pre></html>\n`);
  const noticePath = join(distDir, 'licenses/THIRD-PARTY-NOTICES.md');
  const baseline = await readFile(noticePath, 'utf8');
  await writeFile(noticePath, renderReleaseNotices(baseline, manifest));
  return result;
}

export async function verifyRelease({ releaseDir, projectRoot = process.cwd(), distDir = 'dist' }) {
  const result = await validateReleaseArtifacts({ releaseDir, projectRoot });
  await validateValidationReceipt({ releaseDir, distDir, ...result });
  return result;
}

export async function validateValidationReceipt({ releaseDir, distDir, manifest, manifestSha256 }) {
  const result = { manifest, manifestSha256 };
  const receipt = JSON.parse(await readFile(await regularFile(releaseDir, 'validation.json')));
  if (receipt.schemaVersion !== 1 || receipt.manifestSha256 !== result.manifestSha256 || !Array.isArray(receipt.checks) || receipt.checks.length !== requiredChecks.length) fail('missing or stale validation receipt');
  if (new Set(receipt.checks.map(c => c.name)).size !== requiredChecks.length) fail('duplicate validation checks');
  for (const name of requiredChecks) {
    const check = receipt.checks.find(c => c.name === name);
    if (!check || check.status !== 'passed' || !Array.isArray(check.command) || !check.command.length || check.command.some(v => typeof v !== 'string') || !/^[a-f0-9]{64}$/.test(check.logSha256) || !check.log?.startsWith('checks/')) fail(`missing passed check evidence: ${name}`);
    const actual = await fileHash(await regularFile(releaseDir, check.log));
    if (actual.sha256 !== check.logSha256) fail(`changed validation evidence: ${name}`);
  }
  const expected = records(receipt.distFiles, 'dist files');
  const actual = await inventoryFiles(distDir);
  const sorted = list => [...list].sort((a, b) => a.path.localeCompare(b.path)).map(({path, bytes, sha256}) => ({path, bytes, sha256}));
  if (JSON.stringify(sorted(expected)) !== JSON.stringify(sorted(actual))) fail('final dist differs from validated files');
  for (const file of result.manifest.engine.files) await checkFile(distDir, { ...file, path: file.path.replace(/^engine\//, 'vendor/geos/') });
  for (const part of result.manifest.sourceArchive.parts) await checkFile(distDir, part);
  if (sha256(await readFile(await regularFile(distDir, 'sources/manifest.json'))) !== result.manifestSha256) fail('packaged manifest differs');
  await regularFile(distDir, 'sources/index.html');
  return result;
}
