#!/usr/bin/env python3
"""Independent all-pairs PyQGIS relations for fixed topology fixtures."""
import json
import os
from pathlib import Path
import sys


def main():
    if len(sys.argv) != 3:
        raise RuntimeError('Expected FIXTURE.json OUTPUT.json.')
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
    from qgis.core import Qgis, QgsApplication, QgsGeometry, QgsJsonUtils
    if not 34000 <= Qgis.QGIS_VERSION_INT < 40000:
        raise RuntimeError('Expected QGIS >=3.40,<4.')
    if Qgis.geosVersion().split('-')[0] != '3.13.0':
        raise RuntimeError('Expected GEOS 3.13.0.')
    if os.environ.get('QGIS_PREFIX_PATH'):
        QgsApplication.setPrefixPath(os.environ['QGIS_PREFIX_PATH'], True)
    app = QgsApplication([], False)
    app.initQgis()
    report = {'status': 'completed', 'version': Qgis.geosVersion(), 'cases': []}
    try:
        manifest = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
        for sample in manifest['cases']:
            geometries = []
            excluded = 0
            for index, value in enumerate(sample['geometries']):
                if value is None:
                    excluded += 1
                    continue
                if value['type'] not in ('Polygon', 'MultiPolygon'):
                    if value['type'] != 'GeometryCollection':
                        raise RuntimeError('Fixed fixture eligibility needs expansion.')
                    continue
                geometry = QgsJsonUtils.geometryFromGeoJson(json.dumps(value, allow_nan=False))
                if geometry.isNull():
                    raise RuntimeError('QGIS could not construct topology geometry.')
                if geometry.isEmpty() or not geometry.isGeosValid():
                    excluded += 1
                    continue
                geometries.append((index, geometry))
            pairs = {'equal': [], 'area': []}
            comparisons = 0
            for i, (left_index, left) in enumerate(geometries):
                engine = QgsGeometry.createGeometryEngine(left.constGet())
                for right_index, right in geometries[i + 1:]:
                    comparisons += 1
                    matrix = engine.relate(right.constGet())
                    if len(matrix) != 9 or any(char not in 'F012' for char in matrix):
                        raise RuntimeError('QGIS relation failed.')
                    if left.isGeosEqual(right):
                        pairs['equal'].append([left_index, right_index])
                    if matrix[0] == '2':
                        pairs['area'].append([left_index, right_index])
            report['cases'].append({'name': sample['name'], 'participants': len(geometries),
                                    'coverage': 'none' if not geometries else 'partial' if excluded else 'complete',
                                    'fullComparisons': comparisons, 'pairs': pairs})
        with Path(sys.argv[2]).open('x', encoding='utf-8') as output:
            json.dump(report, output, indent=2, allow_nan=False)
            output.write('\n')
    finally:
        app.exitQgis()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Independent QGIS topology regression failed.', file=sys.stderr)
        sys.exit(2)
