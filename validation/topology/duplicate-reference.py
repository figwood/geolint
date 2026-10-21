#!/usr/bin/env python3
"""Independent PyQGIS equality and duplicate groups, not plugin error rows."""
import json
import os
from pathlib import Path
import sys


def groups_from_pairs(pairs):
    adjacency = {}
    for left, right in pairs:
        adjacency.setdefault(left, set()).add(right)
        adjacency.setdefault(right, set()).add(left)
    groups = []
    remaining = set(adjacency)
    while remaining:
        pending = [min(remaining)]
        group = set()
        while pending:
            vertex = pending.pop()
            if vertex in group:
                continue
            group.add(vertex)
            pending.extend(adjacency[vertex] - group)
        remaining -= group
        groups.append(sorted(group))
    return sorted(groups)


def main():
    if len(sys.argv) != 3:
        raise RuntimeError('Expected FIXTURE.json OUTPUT.json.')
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
    from qgis.core import Qgis, QgsApplication, QgsJsonUtils
    if not 34000 <= Qgis.QGIS_VERSION_INT < 40000:
        raise RuntimeError('Expected QGIS >=3.40,<4.')
    if Qgis.geosVersion().split('-')[0] != '3.13.0':
        raise RuntimeError('Expected GEOS 3.13.0.')
    if os.environ.get('QGIS_PREFIX_PATH'):
        QgsApplication.setPrefixPath(os.environ['QGIS_PREFIX_PATH'], True)
    app = QgsApplication([], False)
    app.initQgis()
    report = {'status': 'completed', 'version': Qgis.geosVersion(),
              'qgisVersion': Qgis.QGIS_VERSION, 'reference': 'pyqgis-relations', 'cases': []}
    families = {'Point': 'point', 'MultiPoint': 'point', 'LineString': 'line',
                'MultiLineString': 'line', 'Polygon': 'area', 'MultiPolygon': 'area'}
    try:
        manifest = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
        for sample in manifest['cases']:
            geometries = []
            excluded = 0
            for index, value in enumerate(sample['geometries']):
                if value is None:
                    excluded += 1
                    continue
                if value['type'] not in families:
                    continue
                positions = []
                def collect(coordinates):
                    if coordinates and isinstance(coordinates[0], (int, float)):
                        positions.append(coordinates)
                    else:
                        for child in coordinates:
                            collect(child)
                collect(value['coordinates'])
                if not positions or any(len(position) != 2 for position in positions):
                    excluded += 1
                    continue
                geometry = QgsJsonUtils.geometryFromGeoJson(json.dumps(value, allow_nan=False))
                if geometry.isNull():
                    raise RuntimeError('QGIS could not construct duplicate geometry.')
                if geometry.isEmpty() or not geometry.isGeosValid():
                    excluded += 1
                    continue
                geometries.append((index, families[value['type']], geometry))
            pairs = []
            comparisons = 0
            for i, (left_index, left_family, left) in enumerate(geometries):
                for right_index, right_family, right in geometries[i + 1:]:
                    comparisons += 1
                    # QGIS has an approximate shortcut for Point equality. The plugin
                    # first queries its exact spatial-index bounding boxes, so near
                    # but disjoint points never reach that shortcut. Reproduce this
                    # gate with QGIS rectangles, independently of the product index.
                    if (left_family == right_family
                            and left.boundingBox().intersects(right.boundingBox())
                            and left.isGeosEqual(right)):
                        pairs.append([left_index, right_index])
            report['cases'].append({'name': sample['name'], 'participants': len(geometries),
                                    'coverage': 'none' if not geometries else 'partial' if excluded else 'complete',
                                    'fullComparisons': comparisons, 'pairs': pairs,
                                    'groups': groups_from_pairs(pairs)})
        with Path(sys.argv[2]).open('x', encoding='utf-8') as output:
            json.dump(report, output, indent=2, allow_nan=False)
            output.write('\n')
    finally:
        app.exitQgis()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Independent QGIS duplicate regression failed.', file=sys.stderr)
        sys.exit(2)
