#!/usr/bin/env python3
"""Headless PyQGIS GEOS validity checks on a shared geolint batch."""
import argparse
import json
import math
import os
from pathlib import Path
import sys


class QgisChecker:
    def __init__(self):
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        from qgis.core import Qgis, QgsApplication, QgsJsonUtils

        if Qgis.QGIS_VERSION_INT < 34000 or Qgis.QGIS_VERSION_INT >= 40000:
            raise RuntimeError("QGIS >=3.40,<4 is required.")
        self.qgis = Qgis
        self.json_utils = QgsJsonUtils
        if os.environ.get("QGIS_PREFIX_PATH"):
            QgsApplication.setPrefixPath(os.environ["QGIS_PREFIX_PATH"], True)
        self.app = QgsApplication([], False)
        try:
            self.app.initQgis()
        except Exception:
            self.app.exitQgis()
            raise
        self.info = {"name": "QGIS GEOS", "version": Qgis.geosVersion(),
                     "qgisVersion": Qgis.QGIS_VERSION, "pythonVersion": sys.version.split()[0],
                     "parameters": {"validationMethod": "Geos", "validityFlags": 0},
                     "coordinateSemantics": "planar-2d"}

    def check(self, value):
        geometry = self.json_utils.geometryFromGeoJson(json.dumps(value, allow_nan=False))
        if geometry.isNull() or geometry.isEmpty():
            raise RuntimeError("QGIS could not construct the prepared geometry.")
        flags = self.qgis.GeometryValidityFlags()
        valid = geometry.isGeosValid(flags)
        errors = geometry.validateGeometry(self.qgis.GeometryValidationEngine.Geos, flags)
        if valid != (len(errors) == 0):
            raise RuntimeError("QGIS validity APIs returned inconsistent results.")
        details = []
        for error in errors:
            location = None
            if error.hasWhere():
                point = error.where()
                if math.isfinite(point.x()) and math.isfinite(point.y()):
                    location = {"x": point.x(), "y": point.y()}
            details.append({"reason": error.what(), "location": location})
        return {"status": "valid" if valid else "invalid",
                "reasonCode": "VALID" if valid else "GEOMETRY_INVALID",
                "reason": "Valid Geometry" if valid else details[0]["reason"],
                "location": None if valid else details[0]["location"], "errors": details}

    def close(self):
        self.app.exitQgis()


def inspect_batch(batch, checker):
    files = []
    for source in batch["files"]:
        if source["status"] == "failed":
            expected = source.get("expectedErrorCode")
            rejected = expected and source.get("error", {}).get("code") == expected
            files.append({**source, "status": "rejected" if rejected else "failed"})
            continue
        records = []
        for record in source["records"]:
            result = {key: value for key, value in record.items() if key not in ("geometry", "disposition")}
            if record["disposition"] != "check":
                result.update(status=record["disposition"], location=None)
            else:
                try:
                    result.update(checker.check(record["geometry"]))
                except Exception:
                    result.update(status="engine_failed", reasonCode="ENGINE_ERROR",
                                  reason="QGIS geometry construction or validity check failed.", location=None)
            records.append(result)
        files.append({"file": source["file"], "sha256": source["sha256"], "status": "completed", "records": records})
    complete = all(file["status"] in ("completed", "rejected") and all(record["status"] != "engine_failed" for record in file["records"]) for file in files)
    return {"schemaVersion": "1.0", "status": "completed" if complete else "failed", "engine": checker.info, "files": files}


def self_test(checker):
    cases = [
        ([[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], "valid"),
        ([[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]], "invalid"),
        ([[0, 0], [4, 0], [4, 0], [4, 4], [0, 4], [0, 0]], "valid"),
        ([[0, 0], [1, 0], [2, 0], [0, 0]], "invalid"),
    ]
    for ring, expected in cases:
        result = checker.check({"type": "Polygon", "coordinates": [ring]})
        if result["status"] != expected:
            raise RuntimeError("QGIS validity self-test failed.")
    point = {"type": "Point", "coordinates": [-500000.125, 3000000.0625]}
    line = {"type": "LineString", "coordinates": [[0, 0], [4, 4], [0, 4], [4, 0]]}
    collapsed = {"type": "LineString", "coordinates": [[1, 2], [1, 2]]}
    for geometry, expected in [
        (point, "valid"),
        ({"type": "MultiPoint", "coordinates": [[0, 0], [0, 0], [1, 2]]}, "valid"),
        (line, "valid"),
        ({"type": "MultiLineString", "coordinates": [line["coordinates"]]}, "valid"),
        (collapsed, "invalid"),
        ({"type": "GeometryCollection", "geometries": [point, line]}, "valid"),
        ({"type": "GeometryCollection", "geometries": [point, collapsed]}, "invalid"),
    ]:
        if checker.check(geometry)["status"] != expected:
            raise RuntimeError("QGIS point, line or collection validity self-test failed.")
    if checker.info["version"].split("-")[0] != "3.13.0":
        raise RuntimeError("Expected GEOS 3.13.0 to match geolint WASM.")
    print(json.dumps({"status": "ready", "engine": checker.info}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("batch", nargs="?")
    parser.add_argument("output", nargs="?")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not args.self_test and (not args.batch or not args.output):
        parser.error("BATCH.json and OUTPUT.json are required")
    checker = None
    report = {"schemaVersion": "1.0", "status": "failed", "files": []}
    try:
        checker = QgisChecker()
        if args.self_test:
            self_test(checker)
            return 0
        batch = json.loads(Path(args.batch).read_text(encoding="utf-8"))
        report = inspect_batch(batch, checker)
    except Exception:
        report["error"] = "PyQGIS initialization, batch loading or environment self-test failed. Run validation/qgis/setup-env.sh."
        print(report["error"], file=sys.stderr)
    finally:
        if checker is not None:
            checker.close()
    if args.output:
        Path(args.output).write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    return 0 if report["status"] == "completed" else 2


if __name__ == "__main__":
    sys.exit(main())
