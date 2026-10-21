import contextlib
import importlib.util
import io
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("setup_geos", ROOT / "scripts/setup-geos.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTests(unittest.TestCase):
    def test_sdk_option_is_available_in_dry_run_without_running_tools(self):
        result = subprocess.run([sys.executable, str(ROOT / "scripts/setup-geos.py"), "--dry-run", "--macos-sdk", "/selected/MacOSX26.5.sdk"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("/selected/MacOSX26.5.sdk", result.stdout)

    def test_macos_sdk_and_apple_tools_are_pinned_and_cache_isolated(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            sdk = Path(directory) / "MacOSX26.5.sdk"
            sdk.mkdir()
            other = Path(directory) / "MacOSX27.0.sdk"
            other.mkdir()
            commands = []
            def external(command, root, env=None, capture=False):
                commands.append(list(map(str, command)))
                if command[0] == "xcrun":
                    return "/apple/tools/" + command[-1] + "\n"
                return ""
            args = setup.parse_args(["--macos-sdk", str(sdk)])
            with patch.object(setup.platform, "system", return_value="Darwin"), patch.object(setup, "run", side_effect=external):
                flags, env, build_name = setup.native_build_settings(args, ROOT)
                other_flags, _, other_build = setup.native_build_settings(setup.parse_args(["--macos-sdk", str(other)]), ROOT)
            self.assertIn(f"-DCMAKE_OSX_SYSROOT={sdk.resolve()}", flags)
            self.assertIn("-DCMAKE_C_COMPILER=/apple/tools/clang", flags)
            self.assertIn("-DCMAKE_CXX_COMPILER=/apple/tools/clang++", flags)
            self.assertIn("-DCMAKE_LINKER=/apple/tools/ld", flags)
            self.assertEqual(env["SDKROOT"], str(sdk.resolve()))
            self.assertNotEqual(build_name, "build")
            self.assertNotEqual(build_name, other_build)
            for compiler in ("/apple/tools/clang", "/apple/tools/clang++"):
                probes = [cmd for cmd in commands if cmd[0] == compiler]
                self.assertEqual(len(probes), 2)
                self.assertEqual(probes[0][probes[0].index("-isysroot") + 1], str(sdk.resolve()))

    def test_bad_sdk_linker_probe_stops_with_actionable_error(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            sdk = Path(directory) / "MacOSX27.0.sdk"
            sdk.mkdir()
            def external(command, root, env=None, capture=False):
                if command[0] == "xcrun":
                    return "/apple/tools/" + command[-1] + "\n"
                raise setup.SetupError("ld: tapi error: unknown architecture arm64e.x1-macos")
            with patch.object(setup.platform, "system", return_value="Darwin"), patch.object(setup, "run", side_effect=external):
                with self.assertRaisesRegex(setup.SetupError, "--macos-sdk"):
                    setup.native_build_settings(setup.parse_args(["--macos-sdk", str(sdk)]), ROOT)

    def test_linux_keeps_existing_build_behavior_and_rejects_macos_sdk(self):
        from unittest.mock import patch
        with patch.object(setup.platform, "system", return_value="Linux"):
            flags, _, build_name = setup.native_build_settings(setup.parse_args([]), ROOT)
            self.assertEqual(flags, [])
            self.assertEqual(build_name, "build")
            with self.assertRaises(setup.SetupError):
                setup.native_build_settings(setup.parse_args(["--macos-sdk", "/sdk"]), ROOT)

    def test_dry_run_from_another_directory_has_no_install_side_effect(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(ROOT / "scripts/setup-geos.py"), "--dry-run", "--jobs", "2"], cwd=directory, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("3.13.0", result.stdout)
            self.assertIn(str(ROOT / ".cache/geos/3.13.0/install"), result.stdout)
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_checksum_rejects_corruption_before_extracting(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "archive"
            archive.write_bytes(b"abc")
            setup.verify_checksum(archive, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
            archive.write_bytes(b"changed")
            with self.assertRaisesRegex(setup.SetupError, "SHA-256"):
                setup.verify_checksum(archive, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

    def test_tar_extraction_refuses_escape_and_extracts_expected_source_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, permitted in [("../outside", False), ("geos-3.13.0/CMakeLists.txt", True)]:
                archive = root / "input.tar.bz2"
                with tarfile.open(archive, "w:bz2") as tar:
                    member = tarfile.TarInfo(name)
                    content = b"cmake_minimum_required(VERSION 3.15)"
                    member.size = len(content)
                    tar.addfile(member, io.BytesIO(content))
                if permitted:
                    source = setup.extract_source(archive, root / "source")
                    self.assertTrue((source / "CMakeLists.txt").is_file())
                else:
                    with self.assertRaises(setup.SetupError):
                        setup.extract_source(archive, root / "source")
                    self.assertFalse((root / "outside").exists())

    def test_rejects_a_different_wasm_package_or_runtime_version(self):
        expected = {"name": "geos-wasm", "version": "3.1.1", "GEOS_VERSION": "3.13.0"}
        setup.validate_versions(expected, "3.13.0-CAPI-1.19.0", "3.13.0")
        for package, runtime, reference in [({**expected, "version": "3.2.0"}, "3.13.0", "3.13.0"), (expected, "3.14.1", "3.13.0"), (expected, "3.13.0", "3.14.1")]:
            with self.assertRaises(setup.SetupError):
                setup.validate_versions(package, runtime, reference)

    def test_finds_only_project_prefix_libraries_on_macos_and_linux(self):
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory)
            self.assertIsNone(setup.find_library(prefix, "Darwin"))
            (prefix / "lib").mkdir()
            dylib = prefix / "lib/libgeos_c.dylib"
            dylib.touch()
            self.assertEqual(setup.find_library(prefix, "Darwin"), dylib)
            (prefix / "lib64").mkdir()
            shared = prefix / "lib64/libgeos_c.so"
            shared.touch()
            self.assertEqual(setup.find_library(prefix, "Linux"), shared)

    def test_external_command_failure_is_not_reported_as_success(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(setup.SetupError, "17"):
                setup.run([sys.executable, "-c", "raise SystemExit(17)"], Path(directory))

    def test_npm_failure_stops_before_native_download_and_removes_stale_success(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".cache").mkdir()
            summary = root / ".cache/geos-setup.json"
            summary.write_text('{"status":"passed"}')
            args = setup.parse_args([])
            with patch.object(setup, "preflight"), patch.object(setup, "run", side_effect=setup.SetupError("npm failed")), patch.object(setup, "download") as download:
                with self.assertRaisesRegex(setup.SetupError, "npm failed"):
                    setup.execute(args, root)
                download.assert_not_called()
            self.assertFalse(summary.exists())


if __name__ == "__main__":
    unittest.main()
