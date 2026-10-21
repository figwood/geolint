#!/usr/bin/env python3
"""Manually install geos-wasm and build matching native GEOS on macOS/Linux."""
import argparse
import hashlib
import json
import os
import platform
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
WASM_VERSION = "3.1.1"
GEOS_VERSION = "3.13.0"
SOURCE_URL = f"https://download.osgeo.org/geos/geos-{GEOS_VERSION}.tar.bz2"
# Release archive checksum independently recorded by Buildroot maintainers:
# https://lists.buildroot.org/pipermail/buildroot/2025-March/775836.html
SOURCE_SHA256 = "47ec83ff334d672b9e4426695f15da6e6368244214971fabf386ff8ef6df39e4"


class SetupError(RuntimeError):
    pass


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Show operations without downloads or writes.")
    parser.add_argument("--registry", help="npm registry URL for this invocation only.")
    parser.add_argument("--source-archive", type=Path, help="Use a local official geos-3.13.0.tar.bz2 (checksum still enforced).")
    parser.add_argument("--skip-npm", action="store_true", help="Use already installed node_modules; do not run npm install.")
    parser.add_argument("--jobs", type=int, default=min(os.cpu_count() or 2, 4), help="CMake build parallelism (default: up to 4).")
    parser.add_argument("--macos-sdk", type=Path, help="Explicit macOS SDK directory; overrides SDKROOT and the active default SDK.")
    args = parser.parse_args(argv)
    if args.jobs < 1:
        parser.error("--jobs must be a positive integer")
    return args


def run(command, root, env=None, capture=False):
    print("[setup] " + shlex.join(map(str, command)), flush=True)
    try:
        result = subprocess.run(list(map(str, command)), cwd=root, env=env, text=True, capture_output=capture)
    except OSError as error:
        raise SetupError(f"Cannot start {command[0]}: {error}") from error
    if result.returncode:
        if capture and result.stderr:
            print(result.stderr, file=sys.stderr)
        raise SetupError(f"{command[0]} failed with exit code {result.returncode}; setup is incomplete.")
    return result.stdout if capture else None


def preflight(args):
    if sys.version_info < (3, 12):
        raise SetupError("Python 3.12+ is required for safe tar extraction.")
    if platform.system() not in ("Darwin", "Linux"):
        raise SetupError("This script supports macOS and Linux; on Windows use WSL with a Linux toolchain.")
    if args.macos_sdk and platform.system() != "Darwin":
        raise SetupError("--macos-sdk is only supported on macOS.")
    required = ["node", "npm", "cmake", "c++", "make"]
    if args.source_archive is None:
        required.append("curl")
    if platform.system() == "Darwin":
        required.append("xcrun")
    missing = [name for name in required if not shutil.which(name)]
    if missing:
        raise SetupError("Missing tools: " + ", ".join(missing) + ". Install CMake and a C/C++ build toolchain first.")
    node_version = subprocess.check_output(["node", "--version"], text=True).strip()
    if int(node_version.removeprefix("v").split(".")[0]) < 24:
        raise SetupError(f"Node.js 24+ is required; found {node_version}.")


def verify_checksum(archive, expected=SOURCE_SHA256):
    digest = hashlib.sha256()
    with archive.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != expected:
        raise SetupError(f"SHA-256 mismatch for {archive}. Expected the official GEOS {GEOS_VERSION} release archive; no extraction performed.")


def download(archive, root):
    if archive.exists():
        verify_checksum(archive)
        print(f"[setup] Reusing verified source archive: {archive}")
        return
    partial = archive.with_suffix(archive.suffix + ".part")
    try:
        run(["curl", "--fail", "--location", "--retry", "3", "--connect-timeout", "20", "--max-time", "300", "--proto", "=https", "--proto-redir", "=https", "--output", partial, SOURCE_URL], root)
        verify_checksum(partial)
        partial.replace(archive)
    finally:
        partial.unlink(missing_ok=True)


def extract_source(archive, destination):
    try:
        with tarfile.open(archive, "r:bz2") as tar:
            members = tar.getmembers()
            for member in members:
                parts = PurePosixPath(member.name).parts
                if not parts or parts[0] != f"geos-{GEOS_VERSION}" or ".." in parts or PurePosixPath(member.name).is_absolute():
                    raise SetupError("Unexpected or unsafe path in GEOS archive.")
            tar.extractall(destination, members=members, filter="data")
    except (tarfile.TarError, OSError) as error:
        raise SetupError(f"Cannot extract GEOS source: {error}") from error
    source = destination / f"geos-{GEOS_VERSION}"
    if not (source / "CMakeLists.txt").is_file():
        raise SetupError("GEOS source archive has no CMakeLists.txt.")
    return source


def validate_versions(package, runtime_version, reference_version):
    if package.get("name") != "geos-wasm" or package.get("version") != WASM_VERSION:
        raise SetupError(f"Installed geos-wasm does not match pinned package {WASM_VERSION}.")
    if package.get("GEOS_VERSION") != GEOS_VERSION or runtime_version.split("-")[0] != GEOS_VERSION or reference_version != GEOS_VERSION:
        raise SetupError(f"GEOS version mismatch: package={package.get('GEOS_VERSION')}, WASM runtime={runtime_version}, fixtures={reference_version}; all must be {GEOS_VERSION}.")


def find_library(prefix, system=None):
    name = "libgeos_c.dylib" if (system or platform.system()) == "Darwin" else "libgeos_c.so"
    for directory in (prefix / "lib", prefix / "lib64"):
        candidate = directory / name
        if candidate.is_file():
            return candidate
    return None


def native_version(library, root):
    return run([sys.executable, "-c", "import ctypes,sys; g=ctypes.CDLL(sys.argv[1]); g.GEOSversion.restype=ctypes.c_char_p; print(g.GEOSversion().decode())", library], root, capture=True).strip()


def native_build_settings(args, root):
    env = dict(os.environ)
    if platform.system() != "Darwin":
        if args.macos_sdk:
            raise SetupError("--macos-sdk is only supported on macOS.")
        return [], env, "build"
    tools = {name: run(["xcrun", "--sdk", "macosx", "--find", name], root, capture=True).strip()
             for name in ("clang", "clang++", "ld")}
    requested = args.macos_sdk or env.get("SDKROOT")
    sdk = Path(requested or run(["xcrun", "--sdk", "macosx", "--show-sdk-path"], root, capture=True).strip()).resolve()
    if not sdk.is_dir():
        raise SetupError(f"macOS SDK directory does not exist: {sdk}")
    env.update(SDKROOT=str(sdk), CC=tools["clang"], CXX=tools["clang++"])
    print(f"[setup] macOS SDK: {sdk}; C/C++: {tools['clang']}, {tools['clang++']}; linker: {tools['ld']}")
    # Probe both libSystem and libc++ before an expensive GEOS build.
    with tempfile.TemporaryDirectory(prefix="geolint-toolchain-") as directory:
        for suffix, compiler, source, flag_name in (
            ("c", tools["clang"], "int main(void) { return 0; }", "CFLAGS"),
            ("cpp", tools["clang++"], '#include <string>\nint main() { return std::string("ok").size() == 2 ? 0 : 1; }', "CXXFLAGS"),
        ):
            path = Path(directory) / f"probe.{suffix}"
            path.write_text(source)
            try:
                extra = shlex.split(env.get("CPPFLAGS", "")) + shlex.split(env.get(flag_name, ""))
                linker_flags = shlex.split(env.get("LDFLAGS", ""))
                run([compiler, *extra, "-isysroot", sdk, path, "-o", Path(directory) / f"probe-{suffix}", *linker_flags], root, env=env, capture=True)
            except (SetupError, ValueError) as error:
                raise SetupError(f"macOS C/C++ link probe failed with SDK {sdk}: {error}\n"
                                 "Use --macos-sdk /path/to/a/compatible/MacOSX.sdk, or update the selected Apple developer tools to match the SDK. No GEOS build started.") from error
    flags = [f"-DCMAKE_C_COMPILER={tools['clang']}", f"-DCMAKE_CXX_COMPILER={tools['clang++']}",
             f"-DCMAKE_LINKER={tools['ld']}", f"-DCMAKE_OSX_SYSROOT={sdk}"]
    fingerprint = json.dumps({"flags": flags, "environment": {key: env.get(key, "") for key in
                             ("CPPFLAGS", "CFLAGS", "CXXFLAGS", "LDFLAGS", "MACOSX_DEPLOYMENT_TARGET")}}, sort_keys=True)
    # Preserve old build output; a different SDK/toolchain gets a separate cache.
    name = "build-macos-" + hashlib.sha256(fingerprint.encode()).hexdigest()[:12]
    return flags, env, name


def execute(args, root=ROOT):
    work = root / ".cache/geos" / GEOS_VERSION
    prefix = work / "install"
    if args.dry_run:
        print(f"Project: {root}\nWASM: geos-wasm {WASM_VERSION}\nNative GEOS: {GEOS_VERSION}\nInstall prefix: {prefix}")
        if args.macos_sdk:
            print(f"macOS SDK override: {args.macos_sdk}")
        print("1. " + ("Use installed node_modules" if args.skip_npm else "npm ci if lockfile exists, otherwise npm install (project-local cache)"))
        print("2. Read installed WASM metadata and actual runtime version; run test:engine")
        print(f"3. Reuse matching project library, or verify SHA-256 and compile {args.source_archive or SOURCE_URL} with {args.jobs} jobs")
        print("4. Generate strict same-version native baseline; run parity, core tests, typecheck and build")
        print("5. Write .cache/geos-setup.json only after every check passes. No changes in dry-run mode.")
        return
    summary_path = root / ".cache/geos-setup.json"
    summary_path.unlink(missing_ok=True)
    preflight(args)
    work.mkdir(parents=True, exist_ok=True)
    if not args.skip_npm:
        command = ["npm", "ci" if (root / "package-lock.json").is_file() else "install", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", root / ".cache/npm"]
        if args.registry:
            command += ["--registry", args.registry]
        run(command, root)
    try:
        package = json.loads((root / "node_modules/geos-wasm/package.json").read_text())
        reference = json.loads((root / "tests/fixtures/manifest.json").read_text())["intendedReferenceVersion"]
    except (OSError, ValueError, KeyError) as error:
        raise SetupError("Cannot read installed WASM metadata or fixtures; run npm install first.") from error
    output = run(["node", "--input-type=module", "--eval", "import {createEngine} from './src/engine/geos.ts'; const e=await createEngine(); try {console.log(JSON.stringify(e.info));} finally {e.dispose();}"], root, capture=True)
    try:
        engine = json.loads(output.strip().splitlines()[-1])
        validate_versions(package, engine["version"], reference)
    except (ValueError, KeyError, IndexError) as error:
        raise SetupError("Could not identify the actual WASM engine version.") from error
    run(["npm", "run", "test:engine"], root)
    library = find_library(prefix)
    if library and native_version(library, root).split("-")[0] != GEOS_VERSION:
        raise SetupError(f"Cached library {library} has an unexpected version. Remove only {work} and rerun.")
    if library is None:
        native_flags, native_env, build_name = native_build_settings(args, root)
        archive = args.source_archive.resolve() if args.source_archive else work / f"geos-{GEOS_VERSION}.tar.bz2"
        if args.source_archive:
            verify_checksum(archive)
        else:
            download(archive, root)
        source = extract_source(archive, work / "source")
        build = work / build_name
        run(["cmake", "-S", source, "-B", build, "-G", "Unix Makefiles", "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=ON", "-DBUILD_TESTING=OFF", "-DBUILD_BENCHMARKS=OFF", "-DBUILD_DOCUMENTATION=OFF", f"-DCMAKE_INSTALL_PREFIX={prefix}", "-DCMAKE_INSTALL_LIBDIR=lib", f"-DCMAKE_INSTALL_RPATH={prefix / 'lib'}", *native_flags], root, env=native_env)
        run(["cmake", "--build", build, "--parallel", args.jobs], root, env=native_env)
        run(["cmake", "--install", build], root, env=native_env)
        library = find_library(prefix)
        if library is None:
            raise SetupError(f"Native C library not found under {prefix} after install.")
    baseline = root / ".cache/native-baseline.json"
    run([sys.executable, root / "scripts/native-baseline/generate.py", "--library", library, "--require-version", GEOS_VERSION, "--output", baseline], root)
    env = {**os.environ, "GEOS_BASELINE": str(baseline)}
    run(["npm", "run", "test:parity"], root, env=env)
    for command in (["npm", "test"], ["npm", "run", "typecheck"], ["npm", "run", "build"]):
        run(command, root)
    summary = {"status": "passed", "recordedAt": datetime.now(timezone.utc).isoformat(), "wasmPackageVersion": WASM_VERSION,
               "wasmEngineVersion": engine["version"], "nativeLibrary": str(library), "baseline": str(baseline),
               "sourceSha256": SOURCE_SHA256, "checks": ["test:engine", "test:parity", "test", "typecheck", "build"]}
    summary_path.write_text(json.dumps(summary, indent=2) + "\n")
    print(f"[setup] WASM/native setup and parity passed. Record: {summary_path}\n[setup] Browser, license and release acceptance remain separate checks.")


def main():
    try:
        execute(parse_args())
    except (SetupError, OSError, subprocess.SubprocessError) as error:
        print(f"Setup stopped: {error}\nResolve the reported problem and rerun this command. Existing verified downloads/builds can be reused.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Setup interrupted. No success result was recorded.", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
