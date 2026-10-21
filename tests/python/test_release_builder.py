import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('release_builder', ROOT / 'scripts/release/build-engine.py')
builder = importlib.util.module_from_spec(SPEC)


class ReleaseBuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        SPEC.loader.exec_module(builder)

    def test_application_snapshot_contains_build_sources_and_public_licenses_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('src/main.ts', 'scripts/release/build-engine.py', 'public/licenses/NOTICE.txt',
                         'LICENSE', 'package.json', 'docs/internal.md', '.env', '.git/config',
                         'node_modules/private/key', 'user_uploads/user.json', 'src/.env', 'public/.aws/key'):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(name)
            paths = [path.relative_to(root).as_posix() for path in builder.application_files(root)]
            self.assertEqual(paths, ['LICENSE', 'package.json', 'public/licenses/NOTICE.txt',
                                     'scripts/release/build-engine.py', 'src/main.ts'])

    def test_application_snapshot_includes_required_sample_configs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('sample_data/sample.geojson', 'sample_data/.config/example.json',
                         'sample_data/.env', 'sample_data/.aws/key'):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(name)
            self.assertEqual([path.relative_to(root).as_posix() for path in builder.application_files(root)],
                             ['sample_data/.config/example.json', 'sample_data/sample.geojson'])

    def test_archive_extraction_rejects_traversal_links_and_duplicates(self):
        for names in (['../escape'], ['/escape'], ['ok', 'ok'], ['link']):
            with self.subTest(names=names), tempfile.TemporaryDirectory() as temporary:
                archive = Path(temporary) / 'input.tar'
                with tarfile.open(archive, 'w') as output:
                    for name in names:
                        item = tarfile.TarInfo(name)
                        if name == 'link':
                            item.type = tarfile.SYMTYPE
                            item.linkname = '../escape'
                        output.addfile(item)
                with self.assertRaises(ValueError):
                    builder.safe_extract(archive, Path(temporary) / 'out')

    def test_archive_extraction_preserves_internal_source_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'source.tar'
            with tarfile.open(archive, 'w') as output:
                link = tarfile.TarInfo('sub/alias')
                link.type = tarfile.SYMTYPE
                link.linkname = '../runtime.txt'
                output.addfile(link)
                content = tarfile.TarInfo('runtime.txt')
                content.size = 7
                output.addfile(content, io.BytesIO(b'runtime'))
            builder.safe_extract(archive, root / 'out')
            self.assertEqual((root / 'out/sub/alias').read_bytes(), b'runtime')
            self.assertTrue((root / 'out/sub/alias').is_symlink())

    def test_source_archive_roundtrip_and_parts_have_real_hashes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            application = root / 'app'
            (application / 'src').mkdir(parents=True)
            (application / 'src/main.ts').write_text('export const answer = 42;')
            inputs = root / 'inputs'
            inputs.mkdir()
            for name in ('wrapper.tar', 'emscripten.tar', 'emsdk.tar', 'geos-3.13.0.tar.bz2'):
                (inputs / name).write_bytes(name.encode())
            archive = root / 'engine-source.tar.gz'
            records = builder.source_archive(application, inputs, archive)
            with tarfile.open(archive) as source:
                self.assertEqual(source.extractfile('application/src/main.ts').read(), b'export const answer = 42;')
                self.assertIn('inputs/emscripten.tar', source.getnames())
                self.assertIn('--inputs', source.extractfile('REBUILD.md').read().decode())
            self.assertEqual(records[0]['sha256'], hashlib.sha256(b'export const answer = 42;').hexdigest())
            parts = builder.split_archive(archive, root / 'artifacts', max_bytes=30)
            reconstructed = b''.join((root / 'artifacts' / item['path']).read_bytes() for item in parts)
            self.assertEqual(reconstructed, archive.read_bytes())
            for part in parts:
                self.assertLessEqual(part['bytes'], 30)
                self.assertEqual(part['sha256'], hashlib.sha256((root / 'artifacts' / part['path']).read_bytes()).hexdigest())

    def test_git_archive_tree_matches_actual_git_with_executable_and_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repository = root / 'repo'
            repository.mkdir()
            for name, data in [('a/child', b'nested'), ('a.txt', b'file'),
                               ('binary', b'\x00\x01\xff'), ('script', b'#!/bin/sh\nexit 0\n')]:
                path = repository / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            (repository / 'script').chmod(0o755)
            (repository / 'alias').symlink_to('a/child')
            def git(*arguments):
                return subprocess.run(['git', '-C', str(repository), *arguments], check=True,
                                      capture_output=True, text=True).stdout.strip()
            git('init')
            git('add', '.')
            git('-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid',
                'commit', '-m', 'Source tree fixture')
            expected = git('rev-parse', 'HEAD^{tree}')
            archive = root / 'source.tar'
            git('archive', '--format=tar', '--output', str(archive), 'HEAD')
            self.assertEqual(builder.archive_git_tree(archive), expected)
            self.assertEqual(builder.archive_git_tree(io.BytesIO(archive.read_bytes())), expected)
            for changed in ('truncate', 'change', 'omit'):
                modified = root / (changed + '.tar')
                if changed == 'truncate':
                    modified.write_bytes(archive.read_bytes()[:600])
                    with self.assertRaises((ValueError, tarfile.TarError)):
                        builder.archive_git_tree(modified)
                    continue
                with tarfile.open(archive) as source, tarfile.open(modified, 'w') as output:
                    for member in source.getmembers():
                        if changed == 'omit' and member.name == 'a/child':
                            continue
                        if member.isfile():
                            data = source.extractfile(member).read()
                            if changed == 'change' and member.name == 'a/child':
                                data = b'changed'
                                member.size = len(data)
                            output.addfile(member, io.BytesIO(data))
                        else:
                            output.addfile(member)
                self.assertNotEqual(builder.archive_git_tree(modified), expected)

    def test_git_archive_known_test_gitlinks_reconstruct_exact_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            repository = root / 'repo'
            repository.mkdir()
            (repository / 'driver.py').write_text('pinned driver')
            (repository / '.gitmodules').write_text(
                '[submodule "test/library"]\npath = test/library\nurl = https://example.invalid/library\n')
            def git(*arguments):
                return subprocess.run(['git', '-C', str(repository), *arguments], check=True,
                                      capture_output=True, text=True).stdout.strip()
            git('init')
            git('add', '.')
            gitlink = '4fb7039fda3f6588c7ca9664176f8c9e0a023b4a'
            git('update-index', '--add', '--cacheinfo', '160000,' + gitlink + ',test/library')
            git('-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid',
                'commit', '-m', 'Test-only gitlink fixture')
            expected = git('rev-parse', 'HEAD^{tree}')
            archive = root / 'source.tar'
            git('archive', '--format=tar', '--output', str(archive), 'HEAD')
            with tarfile.open(archive) as source:
                self.assertTrue(source.getmember('test/library').isdir())
            self.assertEqual(builder.archive_git_tree(archive, {'test/library': gitlink}), expected)
            self.assertNotEqual(builder.archive_git_tree(archive), expected)
            self.assertNotEqual(builder.archive_git_tree(archive, {'test/library': '0' * 40}), expected)
            with self.assertRaises(ValueError):
                builder.archive_git_tree(archive, {'driver.py': gitlink})

    def test_input_records_reject_self_relabelled_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with tarfile.open(root / 'wrapper.tar', 'w') as output:
                member = tarfile.TarInfo('src/index.mjs')
                member.size = 4
                output.addfile(member, io.BytesIO(b'fake'))
            with self.assertRaisesRegex(ValueError, 'Git tree'):
                builder.input_records(root)

    def test_compiler_version_requires_exact_release(self):
        builder.validate_compiler_version('emcc (Emscripten gcc/clang-like replacement) 3.1.73 (abc)')
        builder.validate_compiler_version('emcc (Emscripten gcc/clang-like replacement) 3.1.73-git')
        for version in ('3.1.730', '3.1.73-git-extra', '3.1.74', '4.0.0', 'not a compiler'):
            with self.assertRaises(ValueError):
                builder.validate_compiler_version('emcc ' + version)

    def test_sdk_rejects_changed_source_and_wrong_binary_installation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            expected = root / 'sources'
            actual = root / 'sdk'
            expected.mkdir()
            actual.mkdir()
            (expected / 'emsdk.py').write_text('pinned driver')
            (actual / 'emsdk.py').write_text('changed driver')
            with self.assertRaises(ValueError):
                builder.verify_source_tree(expected, actual)
            (actual / 'emsdk.py').write_text('pinned driver')
            builder.verify_source_tree(expected, actual)
            builder.validate_sdk_installation('  3.1.73    INSTALLED')
            builder.validate_sdk_installation('* 3.1.73    INSTALLED')
            for installed in ('3.1.74 INSTALLED', '3.1.73', '3.1.730 INSTALLED'):
                with self.assertRaises(ValueError):
                    builder.validate_sdk_installation(installed)

    def test_offline_inputs_reject_corruption_and_commit_mismatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inputs = root / 'inputs'
            inputs.mkdir()
            records = []
            for name, filename in builder.INPUT_NAMES.items():
                path = inputs / filename
                path.write_text(name)
                entry = {'name': name, **builder.file_record(path, 'inputs/' + filename)}
                entry.update({key: builder.LOCK[name][key] for key in ('commit', 'version', 'tree', 'gitlinks', 'gitlinkRepositories') if key in builder.LOCK[name]})
                records.append(entry)
            (inputs / 'manifest.json').write_text(json.dumps({'schemaVersion': 1, 'inputs': records}))
            (inputs / 'wrapper.tar').write_text('corrupt')
            work = root / 'work'
            work.mkdir()
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                builder.prepare_inputs(inputs, work)
            records[0]['commit'] = 'bad'
            (inputs / 'manifest.json').write_text(json.dumps({'schemaVersion': 1, 'inputs': records}))
            other = root / 'other'
            other.mkdir()
            with self.assertRaisesRegex(ValueError, 'commit differs'):
                builder.prepare_inputs(inputs, other)

    def test_compiler_environment_uses_selected_sdk_config(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sdk = root / 'sdk'
            sdk.mkdir()
            (sdk / 'emsdk_env.sh').write_text('export EM_CONFIG=/unrelated/config\n')
            (sdk / '.emscripten').write_text('LLVM_ROOT = "pinned"')
            env = builder.compiler_environment(sdk, root / 'source', root)
            self.assertEqual(env['EM_CONFIG'], str(sdk / '.emscripten'))
            self.assertEqual(env['PATH'].split(':')[0], str(root / 'source'))

    def test_runtime_notices_preserve_source_paths_without_build_tool_dependencies(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sources = root / 'emscripten'
            for name in ('LICENSE', 'AUTHORS', 'system/lib/libc/COPYRIGHT',
                         'system/lib/libcxx/LICENSE.TXT', 'system/lib/libcxx/src/main.cpp',
                         'node_modules/compiler/LICENSE'):
                path = sources / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(name)
            engine = root / 'engine'
            builder.copy_runtime_notices(sources, engine)
            actual = sorted(path.relative_to(engine / 'runtime-notices').as_posix()
                            for path in (engine / 'runtime-notices').rglob('*') if path.is_file())
            self.assertEqual(actual, ['AUTHORS', 'LICENSE', 'index.txt',
                                     'system/lib/libc/COPYRIGHT', 'system/lib/libcxx/LICENSE.TXT'])
            self.assertEqual((engine / 'runtime-notices/system/lib/libc/COPYRIGHT').read_text(),
                             'system/lib/libc/COPYRIGHT')

    def test_dry_run_creates_no_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'candidate'
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/release/build-engine.py'),
                                     '--dry-run', '--output', str(output)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('3.1.73', result.stdout)
            self.assertFalse(output.exists())

    def test_missing_inputs_fails_without_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'candidate'
            result = subprocess.run([sys.executable, str(ROOT / 'scripts/release/build-engine.py'),
                                     '--inputs', str(Path(temporary) / 'missing'), '--output', str(output)],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((output / 'manifest.json').exists())


if __name__ == '__main__':
    unittest.main()
