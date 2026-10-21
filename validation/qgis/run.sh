#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/../.." && pwd)"
checker="$script_dir/check.py"
if [[ "${1:-}" == '--geometry-checker' ]]; then
  if [[ $# != 3 ]]; then echo 'Usage: run.sh --geometry-checker FIXTURE.json OUTPUT.json' >&2; exit 2; fi
  checker="$script_dir/../topology/geometry-checker-reference.py"
  shift
elif [[ "${1:-}" == '--single-layer' ]]; then
  if [[ $# != 3 ]]; then
    echo 'Usage: run.sh --single-layer FIXTURE.json OUTPUT.json' >&2
    exit 2
  fi
  checker="$script_dir/../topology/single-layer-reference.py"
  shift
elif [[ "${1:-}" == '--duplicates' ]]; then
  if [[ $# != 3 ]]; then
    echo 'Usage: run.sh --duplicates FIXTURE.json OUTPUT.json' >&2
    exit 2
  fi
  checker="$script_dir/../topology/duplicate-reference.py"
  shift
elif [[ "${1:-}" == '--topology' ]]; then
  if [[ $# != 3 ]]; then
    echo 'Usage: run.sh --topology FIXTURE.json OUTPUT.json' >&2
    exit 2
  fi
  checker="$script_dir/../topology/reference.py"
  shift
elif [[ "${1:-}" == '--read-input' ]]; then
  if [[ $# != 3 ]]; then
    echo 'Usage: run.sh --read-input INPUT_MANIFEST.json OUTPUT.json' >&2
    exit 2
  fi
  checker="$script_dir/read-input.py"
  shift
elif [[ "${1:-}" != '--self-test' ]] && { [[ $# != 2 ]] || [[ "${1:-}" == -* ]] || [[ "${2:-}" == -* ]]; }; then
  exec node "$script_dir/../run-single.mjs" qgis "$@"
fi
qgis_cache="${QGIS_CACHE_DIR:-$repo_dir/.cache/qgis}"
export QT_QPA_PLATFORM=offscreen
export PYTHONNOUSERSITE=1

if [[ -n "${QGIS_PYTHON:-}" ]]; then
  exec "$QGIS_PYTHON" "$checker" "$@"
fi
if [[ -x "$qgis_cache/tools/bin/micromamba" && -x "$qgis_cache/env/bin/python" ]]; then
  unset PYTHONHOME PYTHONPATH QGIS_PREFIX_PATH
  export MAMBA_ROOT_PREFIX="$qgis_cache/mamba"
  export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$qgis_cache/cache}"
  exec "$qgis_cache/tools/bin/micromamba" run -p "$qgis_cache/env" python "$checker" "$@"
fi
echo "QGIS environment missing. Run: $script_dir/setup-env.sh (or set QGIS_PYTHON)." >&2
exit 2
