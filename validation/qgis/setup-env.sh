#!/usr/bin/env bash
# Repository-local installation; no sudo or shell profile modification.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/../.." && pwd)"
qgis_cache="${QGIS_CACHE_DIR:-$repo_dir/.cache/qgis}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=osx-arm64 ;;
  Darwin-x86_64) platform=osx-64 ;;
  Linux-x86_64) platform=linux-64 ;;
  Linux-aarch64|Linux-arm64) platform=linux-aarch64 ;;
  *) echo 'Supported platforms: macOS and Linux (x86_64/arm64).' >&2; exit 2 ;;
esac
if [[ "${1:-}" == '--help' ]]; then
  echo 'Usage: validation/qgis/setup-env.sh [--dry-run]'
  echo 'Installs micromamba, Python 3.12, QGIS >=3.40,<4 and GEOS 3.13.0 in .cache/qgis.'
  echo 'Override installation location with an absolute QGIS_CACHE_DIR.'
  exit 0
fi
if [[ "${1:-}" == '--dry-run' && $# == 1 ]]; then
  echo "Download micromamba from https://micro.mamba.pm/api/micromamba/$platform/latest"
  echo "Create/update $qgis_cache/env from conda-forge: python=3.12 qgis>=3.40,<4 geos=3.13.0"
  echo "Run $script_dir/run.sh --self-test"
  exit 0
fi
if [[ $# != 0 ]]; then echo 'Unknown arguments; use --help.' >&2; exit 2; fi
if [[ "$qgis_cache" != /* ]]; then echo 'QGIS_CACHE_DIR must be absolute.' >&2; exit 2; fi
for dependency in curl tar; do
  command -v "$dependency" >/dev/null || { echo "Missing dependency: $dependency" >&2; exit 2; }
done
mkdir -p "$qgis_cache/tools"
chmod 700 "$qgis_cache"
if [[ ! -x "$qgis_cache/tools/bin/micromamba" ]]; then
  download_dir="$(mktemp -d "$qgis_cache/download-XXXXXX")"
  trap 'rm -rf -- "$download_dir"' EXIT
  curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' \
    "https://micro.mamba.pm/api/micromamba/$platform/latest" -o "$download_dir/micromamba.tar.bz2"
  tar -xjf "$download_dir/micromamba.tar.bz2" -C "$qgis_cache/tools" bin/micromamba
fi
export MAMBA_ROOT_PREFIX="$qgis_cache/mamba"
export PYTHONNOUSERSITE=1
unset PYTHONHOME PYTHONPATH
operation=create
if [[ -d "$qgis_cache/env/conda-meta" ]]; then operation=install; fi
"$qgis_cache/tools/bin/micromamba" "$operation" --yes --override-channels --strict-channel-priority \
  -c conda-forge -p "$qgis_cache/env" 'python=3.12' 'qgis>=3.40,<4' 'geos=3.13.0'
# Ignore an external interpreter override while checking this installation.
QGIS_PYTHON= QGIS_CACHE_DIR="$qgis_cache" bash "$script_dir/run.sh" --self-test
"$qgis_cache/tools/bin/micromamba" list -p "$qgis_cache/env" --explicit > "$qgis_cache/packages-explicit.txt"
echo "QGIS environment ready: $qgis_cache/env"
