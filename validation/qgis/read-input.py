#!/usr/bin/env python3
"""Read raw local fixture files using QGIS OGR, without GeoLint normalization."""
import argparse
import json
import os
from pathlib import Path
import sys


def read_inputs(manifest):
    from qgis.core import Qgis, QgsApplication, QgsGeometry, QgsVectorLayer, QgsWkbTypes

    def coordinates(geometry, depth=0):
        if depth > 64:
            raise RuntimeError("Geometry nesting exceeds the comparison limit.")
        kind = geometry.wkbType()
        allowed = (QgsWkbTypes.Point, QgsWkbTypes.MultiPoint, QgsWkbTypes.LineString,
                   QgsWkbTypes.MultiLineString, QgsWkbTypes.Polygon,
                   QgsWkbTypes.MultiPolygon, QgsWkbTypes.GeometryCollection)
        if kind not in allowed:
            raise RuntimeError("Only straight 2D geometries can be compared without conversion.")
        # Access doubles directly; GeoJSON serialization can round coordinates.
        def xy(point):
            return [point.x(), point.y()]
        if kind == QgsWkbTypes.Point:
            return {"type": "Point", "coordinates": xy(geometry.asPoint())}
        if kind == QgsWkbTypes.MultiPoint:
            return {"type": "MultiPoint", "coordinates": [xy(point) for point in geometry.asMultiPoint()]}
        if kind in (QgsWkbTypes.LineString, QgsWkbTypes.MultiLineString):
            multi = kind == QgsWkbTypes.MultiLineString
            lines = geometry.asMultiPolyline() if multi else [geometry.asPolyline()]
            values = [[xy(point) for point in line] for line in lines]
            return {"type": "MultiLineString" if multi else "LineString",
                    "coordinates": values if multi else values[0]}
        if kind == QgsWkbTypes.GeometryCollection:
            if depth >= 64:
                raise RuntimeError("GeometryCollection nesting exceeds the comparison limit.")
            collection = geometry.constGet()
            return {"type": "GeometryCollection", "geometries": [
                coordinates(QgsGeometry(collection.geometryN(index).clone()), depth + 1)
                for index in range(collection.numGeometries())
            ]}
        multi = kind == QgsWkbTypes.MultiPolygon
        polygons = geometry.asMultiPolygon() if multi else [geometry.asPolygon()]
        values = [[[xy(point) for point in ring] for ring in polygon] for polygon in polygons]
        return {"type": "MultiPolygon" if multi else "Polygon",
                "coordinates": values if multi else values[0]}

    if Qgis.QGIS_VERSION_INT < 34000 or Qgis.QGIS_VERSION_INT >= 40000:
        raise RuntimeError("QGIS >=3.40,<4 is required.")
    if os.environ.get("QGIS_PREFIX_PATH"):
        QgsApplication.setPrefixPath(os.environ["QGIS_PREFIX_PATH"], True)
    app = QgsApplication([], False)
    try:
        app.initQgis()
        files = []
        for source in manifest["files"]:
            path = Path(source["path"]).resolve(strict=True)
            if path.suffix.lower() not in (".geojson", ".json", ".shp"):
                raise RuntimeError("Only raw GeoJSON and SHP fixtures are supported.")
            layer = QgsVectorLayer(str(path), "input-parity", "ogr")
            try:
                if not layer.isValid():
                    raise RuntimeError("OGR could not open an input fixture.")
                records = []
                for index, feature in enumerate(layer.getFeatures()):
                    geometry = feature.geometry()
                    value = None
                    if not geometry.isNull() and not geometry.isEmpty():
                        value = coordinates(geometry)
                    records.append({
                        "featureIndex": int(feature.id()) if path.suffix.lower() == ".shp" else index,
                        "geometry": value,
                    })
                if len(records) != layer.featureCount():
                    raise RuntimeError("OGR did not return all input records.")
                files.append({"file": source["file"], "status": "completed", "records": records})
            finally:
                # Providers must be destroyed before QgsApplication, even on failure.
                del layer
        if not files:
            raise RuntimeError("No input fixtures were supplied.")
        return {"schemaVersion": "1.0", "status": "completed",
                "reader": {"name": "QGIS OGR", "qgisVersion": Qgis.QGIS_VERSION}, "files": files}
    finally:
        app.exitQgis()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest")
    parser.add_argument("output")
    args = parser.parse_args()
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    # Integration fixtures contain SHP bytes only. Rebuilt indexes stay in their
    # temporary directory; this does not close, reorient or repair their geometry.
    os.environ["SHAPE_RESTORE_SHX"] = "YES"
    report = {"schemaVersion": "1.0", "status": "failed", "files": []}
    try:
        report = read_inputs(json.loads(Path(args.manifest).read_text(encoding="utf-8")))
    except Exception:
        report["error"] = "Independent QGIS OGR input reading failed. Check the QGIS environment and raw fixtures."
        print(report["error"], file=sys.stderr)
    output = Path(args.output)
    with output.open("x", encoding="utf-8") as stream:
        output.chmod(0o600)
        json.dump(report, stream, allow_nan=False)
        stream.write("\n")
    return 0 if report["status"] == "completed" else 2


if __name__ == "__main__":
    sys.exit(main())
