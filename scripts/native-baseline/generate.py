"""Record a native GEOS baseline. Never imply parity with a different WASM version."""
import argparse
import ctypes as c
import ctypes.util
import hashlib
import json
import platform
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def generate(library_path, require_version):
    library = library_path or ctypes.util.find_library("geos_c")
    if not library:
        raise RuntimeError("Native GEOS C library not found; provide --library /absolute/path.")
    geos = c.CDLL(library)
    definitions = {
        "GEOSversion": (c.c_char_p, []),
        "GEOS_init_r": (c.c_void_p, []),
        "GEOS_finish_r": (None, [c.c_void_p]),
        "GEOSGeoJSONReader_create_r": (c.c_void_p, [c.c_void_p]),
        "GEOSGeoJSONReader_destroy_r": (None, [c.c_void_p, c.c_void_p]),
        "GEOSGeoJSONReader_readGeometry_r": (c.c_void_p, [c.c_void_p, c.c_void_p, c.c_char_p]),
        "GEOSisValidDetail_r": (c.c_byte, [c.c_void_p, c.c_void_p, c.c_int, c.POINTER(c.c_void_p), c.POINTER(c.c_void_p)]),
        "GEOSGeomGetX_r": (c.c_int, [c.c_void_p, c.c_void_p, c.POINTER(c.c_double)]),
        "GEOSGeomGetY_r": (c.c_int, [c.c_void_p, c.c_void_p, c.POINTER(c.c_double)]),
        "GEOSGeom_destroy_r": (None, [c.c_void_p, c.c_void_p]),
        "GEOSFree_r": (None, [c.c_void_p, c.c_void_p]),
    }
    for name, (restype, argtypes) in definitions.items():
        function = getattr(geos, name)
        function.restype, function.argtypes = restype, argtypes
    version = geos.GEOSversion().decode()
    if require_version and version.split("-")[0] != require_version:
        raise RuntimeError(f"Version mismatch: native={version}, required={require_version}. No same-version baseline generated.")
    manifest_path = ROOT / "tests/fixtures/manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    context = geos.GEOS_init_r()
    if not context:
        raise RuntimeError("Could not initialize GEOS.")
    records = []
    try:
        for case in manifest["cases"]:
            reader, geometry = None, None
            reason, location = c.c_void_p(), c.c_void_p()
            try:
                reader = geos.GEOSGeoJSONReader_create_r(context)
                if not reader:
                    raise RuntimeError("Could not create GeoJSON reader.")
                geometry = geos.GEOSGeoJSONReader_readGeometry_r(context, reader, json.dumps(case["geometry"]).encode())
                if not geometry:
                    raise RuntimeError(f"Cannot parse fixture {case['name']}.")
                status = geos.GEOSisValidDetail_r(context, geometry, manifest["validityFlags"], c.byref(reason), c.byref(location))
                if status not in (0, 1):
                    raise RuntimeError(f"GEOS failed for fixture {case['name']}.")
                point = None
                if location.value:
                    x, y = c.c_double(), c.c_double()
                    if geos.GEOSGeomGetX_r(context, location, c.byref(x)) and geos.GEOSGeomGetY_r(context, location, c.byref(y)):
                        point = {"x": x.value, "y": y.value}
                record = {"name": case["name"], "valid": status == 1,
                          "reason": c.string_at(reason).decode() if reason.value else "Valid Geometry" if status == 1 else "Invalid geometry (no reason supplied).",
                          "location": point}
                if record["valid"] != case["expectedValid"]:
                    raise RuntimeError(f"Fixture semantic expectation failed: {case['name']}.")
                records.append(record)
            finally:
                if reason.value: geos.GEOSFree_r(context, reason)
                if location.value: geos.GEOSGeom_destroy_r(context, location)
                if geometry: geos.GEOSGeom_destroy_r(context, geometry)
                if reader: geos.GEOSGeoJSONReader_destroy_r(context, reader)
    finally:
        geos.GEOS_finish_r(context)
    return {"engineVersion": version, "parameters": {"validityFlags": manifest["validityFlags"]},
            "coordinateSemantics": manifest["semantics"], "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
            "environment": {"os": platform.platform(), "architecture": platform.machine(), "python": platform.python_version(), "library": library},
            "recordedAt": datetime.now(timezone.utc).isoformat(), "records": records}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library")
    parser.add_argument("--require-version")
    parser.add_argument("--output", default=str(ROOT / ".cache/native-baseline.json"))
    args = parser.parse_args()
    try:
        result = generate(args.library, args.require_version)
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
        print(f"Recorded {len(result['records'])} cases using {result['engineVersion']} in {output}.")
    except Exception as error:
        parser.exit(1, f"Baseline blocked: {error}\n")
