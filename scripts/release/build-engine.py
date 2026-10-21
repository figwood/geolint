#!/usr/bin/env python3
"""Build the replacement engine and its complete corresponding-source materials.

No successful manifest is written until every source and compilation step succeeds.
Toolchain binaries are prerequisites, never represented as source code.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LOCK = json.loads(Path(__file__).with_name('engine-lock.json').read_text())
INPUT_NAMES = {'wrapper': 'wrapper.tar', 'geos': 'geos-3.13.0.tar.bz2',
               'emscripten': 'emscripten.tar', 'emsdk': 'emsdk.tar'}
APPLICATION_ROOTS = ('src', 'public', 'scripts', 'tests', 'fixtures', 'examples', 'validation', '.github', 'sample_data')
APPLICATION_FILES = ('LICENSE', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json',
                     'tsconfig.build.json', 'worker.js', 'wrangler.toml', '.gitignore')
EXCLUDED = {'.git', '.cache', '.aws', '.ssh', '.codex', '.agents', 'node_modules', 'dist',
            '__pycache__', '.venv', 'venv', 'docs', 'test-results', 'playwright-report', 'coverage'}


def file_record(path, relative):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return {'path': str(relative), 'bytes': path.stat().st_size, 'sha256': digest.hexdigest()}


def application_files(root):
    selected = []
    for name in APPLICATION_FILES:
        path = root / name
        if path.is_file() and not path.is_symlink():
            selected.append(path)
    for name in APPLICATION_ROOTS:
        directory = root / name
        if not directory.is_dir() or directory.is_symlink():
            continue
        for base, directories, files in os.walk(directory, followlinks=False):
            directories[:] = sorted(item for item in directories if item not in EXCLUDED
                                     and (not item.startswith('.') or (Path(base) == root / 'sample_data' and item == '.config'))
                                     and not (Path(base) / item).is_symlink())
            for item in sorted(files):
                path = Path(base) / item
                if (path.is_symlink() or item.startswith('.') or item.endswith(('.pyc', '.log', '.pem', '.key'))):
                    continue
                selected.append(path)
    return sorted(selected, key=lambda path: path.relative_to(root).as_posix())


def safe_extract(archive, destination):
    """Reject traversal and escaping links before extracting original source files."""
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, 'r:*') as source:
        members = source.getmembers()
        seen = set()
        for member in members:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or '..' in path.parts or '\\' in member.name
                    or path.as_posix() in seen or not (member.isfile() or member.isdir() or member.issym() or member.islnk())):
                raise ValueError(f'Unsafe or duplicate source archive member: {member.name}')
            seen.add(path.as_posix())
            target = destination.joinpath(*path.parts)
            if not target.resolve().is_relative_to(destination.resolve()) or target.is_symlink():
                raise ValueError(f'Source archive escapes destination: {member.name}')
            if member.issym() or member.islnk():
                base = target.parent if member.issym() else destination
                linked = base / member.linkname
                if ('\\' in member.linkname or not linked.resolve().is_relative_to(destination.resolve())):
                    raise ValueError(f'Source archive link escapes destination: {member.name}')
        for member in members:
            target = destination.joinpath(*PurePosixPath(member.name).parts)
            if member.issym() or member.islnk():
                continue
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as content, target.open('wb') as output:
                    shutil.copyfileobj(content, output)
                target.chmod(member.mode & 0o777)
        pending = [member for member in members if member.issym() or member.islnk()]
        while pending:
            unresolved = []
            for member in pending:
                target = destination.joinpath(*PurePosixPath(member.name).parts)
                base = target.parent if member.issym() else destination
                linked = (base / member.linkname).resolve()
                if not linked.exists():
                    unresolved.append(member)
                    continue
                if not linked.resolve().is_relative_to(destination.resolve()):
                    raise ValueError(f'Source archive link escapes destination: {member.name}')
                target.parent.mkdir(parents=True, exist_ok=True)
                if member.issym():
                    target.symlink_to(member.linkname)
                elif linked.is_file():
                    os.link(linked, target)
                else:
                    raise ValueError('Source archive hard link must target a regular file')
            if len(unresolved) == len(pending):
                raise ValueError('Source archive has dangling or cyclic links')
            pending = unresolved


def source_archive(application, inputs, archive):
    selected = application_files(application)
    records = [file_record(path, path.relative_to(application).as_posix()) for path in selected]
    rebuild = '''# Rebuild and validate the engine

Concatenate engine-source.tar.gz.part* in numbered order, verify the archive SHA-256
against the distribution manifest, and extract the gzip tar into a fresh directory.
Use Node.js 24+, Python 3.12+, Git, CMake, make, npm, a native C/C++ compiler and a
supported Emscripten SDK host. Python and Node must be available on PATH.

Complete release validation also requires matching native GEOS 3.13.0, a compatible
QGIS >=3.40,<4 reference with GEOS 3.13.0, and Chromium with its system libraries.
The preparation command installs the native baseline, isolated QGIS environment and
Chromium. QGIS setup supports macOS and Linux on x86_64/arm64; the pinned SDK must
also support the host. The release CI environment is Ubuntu 24.04 x86_64.
Network access and sufficient disk space are required. On Linux, installing browser
system libraries may require administrative privileges.

Run this sequence from the extracted source bundle:

```sh
cd application
npm ci
npm run release:prepare
# On Linux, also install Chromium's system dependencies:
if [ "$(uname -s)" = "Linux" ]; then
  npx playwright install --with-deps chromium
fi
python3 scripts/release/build-engine.py --inputs ../inputs --output .cache/release-engine
npm run release:check
npm run release:verify
```

The engine output directory must be fresh. For another attempt, use a fresh source
extraction or a new --output directory and pass that same path to release:check and
release:verify with -- --release-dir PATH. Do not deploy an engine merely because
compilation or packaging succeeded; every required check and final verification
must pass. Missing native, QGIS or browser prerequisites are failures, not passes.

The pinned Emscripten commit is authoritative; its source driver reports 3.1.73-git.
The input manifest pins and hashes the supplied original source snapshots. Source is
not refetched by the engine builder with --inputs. Preparation can still download
native GEOS and QGIS, and the SDK installs pinned compiler binaries from its manifest.
Network access is also needed for npm dependencies and browser installation. An
already installed pinned SDK may be supplied using --emsdk /path/to/emsdk. No uploaded
geometry or internal project documents are included. This engine intentionally uses
the unbundled original wrapper and an embedded-WASM Emscripten module, without Rollup
or Node polyfill runtime. The builder's linker options are the authoritative recipe.
'''
    rebuild += '\nEmscripten test-only submodule contents are excluded from the source snapshot.\n'
    rebuild += 'Their original .gitmodules file and these immutable references are preserved.\n'
    rebuild += 'They are not needed for the compiler or bundled system runtime build.\n\n'
    for path, commit in LOCK['emscripten'].get('gitlinks', {}).items():
        rebuild += path + ': ' + commit + ' (' + LOCK['emscripten']['gitlinkRepositories'][path] + ')\n'
    import io
    with tarfile.open(archive, 'w:gz', format=tarfile.PAX_FORMAT) as output:
        for path in sorted(inputs.iterdir()):
            if path.is_file() and not path.is_symlink():
                output.add(path, arcname='inputs/' + path.name, recursive=False)
        for path in selected:
            output.add(path, arcname='application/' + path.relative_to(application).as_posix(), recursive=False)
        data = rebuild.encode()
        member = tarfile.TarInfo('REBUILD.md')
        member.size = len(data)
        member.mode = 0o644
        member.mtime = 0
        output.addfile(member, io.BytesIO(data))
    return records


def split_archive(archive, output, max_bytes=20 * 1024 * 1024):
    if max_bytes < 1:
        raise ValueError('Source part limit must be positive')
    directory = output / 'sources'
    directory.mkdir(parents=True, exist_ok=True)
    records = []
    with archive.open('rb') as source:
        index = 1
        while chunk := source.read(max_bytes):
            part = directory / f'{archive.name}.part{index:03d}'
            part.write_bytes(chunk)
            records.append(file_record(part, part.relative_to(output).as_posix()))
            index += 1
    return records


def validate_compiler_version(version):
    if not re.search(r'\bemcc\b[^\n]*\b3\.1\.73(?:-git)?(?=\s|$)', version):
        raise ValueError(f'Expected Emscripten {LOCK["emscripten"]["version"]}; got {version.strip()}')


def run(command, cwd=None, env=None, capture=False):
    print('+ ' + ' '.join(str(item) for item in command), flush=True)
    result = subprocess.run([str(item) for item in command], cwd=cwd, env=env,
                            check=True, capture_output=capture, text=True)
    return result.stdout.strip() if capture else None


def archive_git_tree(archive, gitlinks=None):
    """Reconstruct a Git archive's root tree identity, independent of tar metadata.

    Accept a path or an open binary file-like object. Git object identity binds all
    tracked file contents, executable modes, symbolic-link targets and paths.
    Known locked gitlinks are commit references, not bundled submodule contents.
    """
    root = {}
    seen = set()
    arguments = {'fileobj': archive} if hasattr(archive, 'read') else {'name': archive}
    def object_digest(kind, content):
        header = kind + b' ' + str(len(content)).encode('ascii') + b'\0'
        return hashlib.sha1(header + content).digest()
    with tarfile.open(mode='r:*', **arguments) as source:
        for member in source:
            path = PurePosixPath(member.name)
            if (path.is_absolute() or not path.parts or '..' in path.parts
                    or '\\' in member.name or '\0' in member.name):
                raise ValueError(f'Unsafe Git archive member: {member.name}')
            if member.isdir():
                continue
            if path.as_posix() in seen:
                raise ValueError(f'Duplicate Git archive member: {member.name}')
            seen.add(path.as_posix())
            if member.issym():
                content = member.linkname.encode('utf-8', 'surrogateescape')
                mode = b'120000'
                digest = object_digest(b'blob', content)
            elif member.isfile():
                mode = b'100755' if member.mode & 0o111 else b'100644'
                digest = hashlib.sha1(b'blob ' + str(member.size).encode('ascii') + b'\0')
                with source.extractfile(member) as content:
                    for chunk in iter(lambda: content.read(1024 * 1024), b''):
                        digest.update(chunk)
                digest = digest.digest()
            else:
                raise ValueError(f'Unsupported Git archive member: {member.name}')
            parent = root
            for component in path.parts[:-1]:
                child = parent.setdefault(component, {})
                if not isinstance(child, dict):
                    raise ValueError(f'Git archive path conflicts with a file: {member.name}')
                parent = child
            if path.name in parent:
                raise ValueError(f'Git archive path conflicts with a directory: {member.name}')
            parent[path.name] = (mode, digest)
    for name, commit in (gitlinks or {}).items():
        path = PurePosixPath(name)
        if (path.is_absolute() or not path.parts or '..' in path.parts
                or '\\' in name or '\0' in name or not re.fullmatch('[0-9a-f]{40}', commit)):
            raise ValueError(f'Unsafe or invalid Git submodule reference: {name}')
        parent = root
        for component in path.parts[:-1]:
            child = parent.setdefault(component, {})
            if not isinstance(child, dict):
                raise ValueError(f'Git submodule path conflicts with archive file: {name}')
            parent = child
        if path.name in parent:
            raise ValueError(f'Git submodule path conflicts with archive contents: {name}')
        parent[path.name] = (b'160000', bytes.fromhex(commit))
    def tree_digest(tree):
        entries = []
        for name, child in tree.items():
            encoded = name.encode('utf-8', 'surrogateescape')
            if isinstance(child, dict):
                entries.append((encoded + b'/', b'40000', encoded, tree_digest(child)))
            else:
                entries.append((encoded, child[0], encoded, child[1]))
        entries.sort(key=lambda entry: entry[0])
        content = b''.join(mode + b' ' + name + b'\0' + digest
                           for _, mode, name, digest in entries)
        return object_digest(b'tree', content)
    return tree_digest(root).hex()


def checkout_snapshot(name, destination, snapshots):
    pin = LOCK[name]
    checkout = destination / name
    run(['git', 'init', checkout])
    run(['git', '-C', checkout, 'remote', 'add', 'origin', pin['repository']])
    run(['git', '-C', checkout, 'fetch', '--depth=1', 'origin', pin['commit']])
    run(['git', '-C', checkout, 'checkout', '--detach', 'FETCH_HEAD'])
    if run(['git', '-C', checkout, 'rev-parse', 'HEAD'], capture=True) != pin['commit']:
        raise ValueError(f'{name} checkout differs from locked commit')
    # Git archive includes all tracked licenses/runtime sources, not installed binaries/caches.
    run(['git', '-C', checkout, 'archive', '--format=tar', '--output', snapshots / INPUT_NAMES[name], pin['commit']])


def input_records(inputs):
    records = []
    for name, filename in INPUT_NAMES.items():
        record = {'name': name, **file_record(inputs / filename, 'inputs/' + filename)}
        record.update({key: LOCK[name][key] for key in ('commit', 'version', 'tree', 'gitlinks', 'gitlinkRepositories') if key in LOCK[name]})
        if name != 'geos' and archive_git_tree(inputs / filename, LOCK[name].get('gitlinks')) != LOCK[name]['tree']:
            raise ValueError(f'{name} archive Git tree differs from engine lock')
        if name == 'geos' and record['sha256'] != LOCK['geos']['sha256']:
            raise ValueError('GEOS archive SHA-256 does not match engine lock')
        records.append(record)
    return records


def prepare_inputs(provided, work):
    snapshots = work / 'inputs'
    snapshots.mkdir()
    if provided:
        metadata = json.loads((provided / 'manifest.json').read_text())
        for name, filename in INPUT_NAMES.items():
            entries = [entry for entry in metadata['inputs'] if entry['name'] == name]
            if len(entries) != 1:
                raise ValueError(f'Expected one {name} input record')
            entry = entries[0]
            if entry['path'] != 'inputs/' + filename:
                raise ValueError('Unexpected input archive path')
            for key in ('commit', 'version', 'tree', 'gitlinks', 'gitlinkRepositories'):
                if key in LOCK[name] and entry.get(key) != LOCK[name][key]:
                    raise ValueError(f'{name} {key} differs from engine lock')
            original = provided / filename
            if original.is_symlink() or not original.is_file():
                raise ValueError(f'Input archive is missing or linked: {filename}')
            actual = file_record(original, entry['path'])
            if any(actual[key] != entry[key] for key in ('bytes', 'sha256')):
                raise ValueError(f'Input archive hash mismatch: {name}')
            shutil.copyfile(original, snapshots / filename)
    else:
        for name in ('wrapper', 'emscripten', 'emsdk'):
            checkout_snapshot(name, work, snapshots)
        with urllib.request.urlopen(LOCK['geos']['url'], timeout=120) as source, (snapshots / INPUT_NAMES['geos']).open('wb') as target:
            shutil.copyfileobj(source, target)
    records = input_records(snapshots)
    (snapshots / 'manifest.json').write_text(json.dumps({'schemaVersion': 1, 'inputs': records}, indent=2) + '\n')
    sources = work / 'sources'
    for name, filename in INPUT_NAMES.items():
        destination = sources / name
        safe_extract(snapshots / filename, destination)
    return snapshots, sources, records


def verify_source_tree(expected, actual):
    """An existing SDK must supply the same driver sources as the locked snapshots."""
    for source in expected.rglob('*'):
        if not source.is_file():
            continue
        counterpart = actual / source.relative_to(expected)
        if source.is_symlink():
            if not counterpart.is_symlink() or os.readlink(source) != os.readlink(counterpart):
                raise ValueError(f'Existing SDK source link differs from pinned snapshot: {counterpart}')
            continue
        if counterpart.is_symlink() or not counterpart.is_file():
            raise ValueError(f'Existing SDK is missing pinned source: {counterpart}')
        if file_record(source, '')['sha256'] != file_record(counterpart, '')['sha256']:
            raise ValueError(f'Existing SDK source differs from pinned snapshot: {counterpart}')


def validate_sdk_installation(installed):
    if not re.search(r'(?m)^[ \t]*\*?[ \t]*3\.1\.73[ \t]+[^\n]*\bINSTALLED\b', installed):
        raise ValueError('SDK must have exact release 3.1.73 INSTALLED; install/activate it with the pinned SDK')


def compiler_environment(sdk, emscripten, work):
    # Read the SDK's exported environment without logging credentials or all host env vars.
    result = subprocess.run(['bash', '-c', 'source "$1/emsdk_env.sh" >/dev/null 2>&1 && env -0',
                             'release-sdk-env', str(sdk)], check=True, capture_output=True)
    env = dict(item.decode().split('=', 1) for item in result.stdout.split(b'\0') if item)
    env['EM_CONFIG'] = str(sdk / '.emscripten')
    if not Path(env['EM_CONFIG']).is_file():
        raise ValueError('Selected SDK has no activated .emscripten configuration')
    env['PATH'] = str(emscripten) + os.pathsep + env.get('PATH', '')
    env['EM_CACHE'] = str(work / 'em-cache')
    env['EMCC_CFLAGS'] = '-O3 -fexceptions'
    return env


def copy_runtime_notices(emscripten, engine):
    """Keep original Emscripten and bundled system-runtime notices next to the binary."""
    destination = engine / 'runtime-notices'
    prefixes = ('LICENSE', 'COPYING', 'COPYRIGHT', 'NOTICE', 'CREDITS', 'AUTHORS')
    candidates = list(emscripten.iterdir())
    if (emscripten / 'system').is_dir():
        candidates.extend((emscripten / 'system').rglob('*'))
    copied = []
    for source in sorted(candidates):
        if not source.is_file() or not source.name.upper().startswith(prefixes):
            continue
        if not source.resolve().is_relative_to(emscripten.resolve()):
            raise ValueError(f'Runtime notice escapes Emscripten source: {source}')
        relative = source.relative_to(emscripten)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        copied.append(relative.as_posix())
    if 'LICENSE' not in copied:
        raise ValueError('Pinned Emscripten source is missing its root LICENSE')
    (destination / 'index.txt').write_text(
        'Original Emscripten and bundled system runtime legal notices\n'
        + 'Source commit: ' + LOCK['emscripten']['commit'] + '\n'
        + 'Files preserve their paths within the complete Emscripten source snapshot.\n'
        + 'Full sources and other original notices are also in engine-source.tar.gz parts.\n\n'
        + '\n'.join(copied) + '\n')


def compile_engine(sources, sdk, work, output, jobs):
    emscripten = sources / 'emscripten'
    if not sdk:
        sdk = sources / 'emsdk'
        run([sys.executable, sdk / 'emsdk.py', 'install', LOCK['emscripten']['version']], cwd=sdk)
        run([sys.executable, sdk / 'emsdk.py', 'activate', LOCK['emscripten']['version']], cwd=sdk)
    else:
        verify_source_tree(sources / 'emsdk', sdk)
    installed = run([sys.executable, sdk / 'emsdk.py', 'list', '--installed'], cwd=sdk, capture=True)
    validate_sdk_installation(installed)
    if not (sdk / 'emsdk_env.sh').is_file():
        raise ValueError('--emsdk must contain an installed SDK and emsdk_env.sh')
    env = compiler_environment(sdk, emscripten, work)
    version = run([emscripten / 'emcc', '--version'], env=env, capture=True)
    validate_compiler_version(version)
    clang_version = run([sdk / 'upstream/bin/clang', '--version'], env=env, capture=True)
    binaryen_version = run([sdk / 'upstream/bin/wasm-opt', '--version'], env=env, capture=True)
    # Emscripten optimizer npm dependencies are build tools, not distributed runtime sources.
    run(['npm', 'ci', '--ignore-scripts'], cwd=emscripten, env=env)
    geos = sources / 'geos' / ('geos-' + LOCK['geos']['version'])
    build = work / 'geos-build'
    prefix = work / 'geos-install'
    run([emscripten / 'emcmake', 'cmake', '-S', geos, '-B', build,
         '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DBUILD_TESTING=OFF',
         '-DBUILD_DOCUMENTATION=OFF', '-DCMAKE_INSTALL_LIBDIR=lib', '-DCMAKE_INSTALL_PREFIX=' + str(prefix),
         '-DCMAKE_CXX_FLAGS=-O3 -fexceptions', '-DCMAKE_C_FLAGS=-O3 -fexceptions'], env=env)
    run(['cmake', '--build', build, '--target', 'install', '--parallel', str(jobs)], env=env)
    wrapper = sources / 'wrapper'
    package = json.loads((wrapper / 'package.json').read_text())
    if package['version'] != LOCK['wrapper']['version'] or package['GEOS_VERSION'] != LOCK['geos']['version']:
        raise ValueError('Wrapper package versions differ from engine lock')
    engine = output / 'engine'
    shutil.copytree(wrapper / 'src', engine / 'src')
    target = engine / 'build/package/geos.js'
    target.parent.mkdir(parents=True)
    exports = re.findall(r"'([^']+)'", (wrapper / 'GEOS_EMCC_FLAGS.mk').read_text())
    if not exports or '_GEOSversion' not in exports:
        raise ValueError('Wrapper exported function list is missing GEOSversion')
    flags = ['-O3', '-fexceptions', '-sSINGLE_FILE=1', '-sALLOW_TABLE_GROWTH=1',
             '-sERROR_ON_UNDEFINED_SYMBOLS=1', '-sFORCE_FILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=1',
             '-sDISABLE_EXCEPTION_CATCHING=0', '-sNODEJS_CATCH_EXIT=0', '-sNODEJS_CATCH_REJECTION=0',
             '-sWASM=1', '-sEXPORT_ES6=1', '-sMODULARIZE=1', '-sEXPORT_NAME=CModule',
             '-sEXPORTED_FUNCTIONS=' + json.dumps(exports),
             '-sEXPORTED_RUNTIME_METHODS=' + json.dumps(['addFunction', 'removeFunction', 'setValue',
                 'getValue', 'ccall', 'cwrap', 'UTF8ToString', 'stringToUTF8'])]
    # em++ links the C++ standard library. Closure/Rollup are not used.
    run([emscripten / 'em++', prefix / 'lib/libgeos_c.a', prefix / 'lib/libgeos.a',
         '-o', target, *flags], env=env)
    if not target.is_file() or not target.stat().st_size:
        raise ValueError('Compiler did not produce the engine module')
    (engine / 'geos.esm.js').write_text("export { default } from './src/index.mjs';\n")
    (engine / 'package.json').write_text('{"type":"module"}\n')
    # Preserve wrapper legal notices alongside the delivered source and compiled module.
    for path in wrapper.iterdir():
        if path.is_file() and any(token in path.name.upper() for token in ('LICENSE', 'COPYING', 'NOTICE')):
            shutil.copyfile(path, engine / path.name)
    copy_runtime_notices(emscripten, engine)
    return {'compilerVersion': version, 'clangVersion': clang_version, 'binaryenVersion': binaryen_version}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/release-engine')
    parser.add_argument('--emsdk', type=Path, help='Existing installed SDK supplying pinned LLVM/Node binaries')
    parser.add_argument('--inputs', type=Path, help='Extracted source bundle inputs directory, including manifest.json')
    parser.add_argument('--jobs', type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument('--dry-run', action='store_true', help='Print pinned build plan without writing or downloading')
    args = parser.parse_args(argv)
    if args.dry_run:
        print(json.dumps({'pins': LOCK, 'output': str(args.output), 'sourcePartLimitBytes': 20 * 1024 * 1024}, indent=2))
        return 0
    output = args.output.resolve()
    if output == ROOT or ROOT.is_relative_to(output):
        parser.error('--output must not contain the project root')
    if args.jobs < 1:
        parser.error('--jobs must be positive')
    # Never keep a previous success receipt after a failed replacement build.
    output.mkdir(parents=True, exist_ok=True)
    for receipt in ('manifest.json', 'validation.json'):
        (output / receipt).unlink(missing_ok=True)
    for name in ('engine', 'sources'):
        if (output / name).exists():
            raise ValueError(f'Output {name}/ already exists; use a fresh --output directory')
    for command in ('git', 'cmake', 'npm', 'make'):
        if not shutil.which(command):
            raise ValueError(f'Missing build prerequisite: {command}')
    # System temporary work is outside both application source and output to prevent recursion.
    with tempfile.TemporaryDirectory(prefix='geolint-release-engine-') as temporary:
        work = Path(temporary)
        snapshots, sources, inputs = prepare_inputs(args.inputs.resolve() if args.inputs else None, work)
        compiler = compile_engine(sources, args.emsdk.resolve() if args.emsdk else None, work, output, args.jobs)
        archive = work / 'engine-source.tar.gz'
        applications = source_archive(ROOT, snapshots, archive)
        archive_record = file_record(archive, archive.name)
        parts = split_archive(archive, output)
        manifest = {'schemaVersion': 1, 'status': 'built', 'toolchain': {
            'emscriptenVersion': LOCK['emscripten']['version'], 'emscriptenCommit': LOCK['emscripten']['commit'],
            'emsdkCommit': LOCK['emsdk']['commit'], **compiler},
            'engine': {'entry': 'engine/geos.esm.js', 'files': [file_record(path, path.relative_to(output).as_posix())
                for path in sorted((output / 'engine').rglob('*')) if path.is_file()]},
            'sourceArchive': {'name': archive.name, 'bytes': archive_record['bytes'], 'sha256': archive_record['sha256'], 'parts': parts},
            'inputs': inputs, 'applicationFiles': applications}
        temporary_manifest = output / 'manifest.json.tmp'
        temporary_manifest.write_text(json.dumps(manifest, indent=2) + '\n')
        temporary_manifest.replace(output / 'manifest.json')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError, KeyError, tarfile.TarError) as error:
        print(f'Engine release build failed: {error}', file=sys.stderr)
        sys.exit(1)
