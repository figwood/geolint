#!/usr/bin/env python3
"""Independent PyQGIS relations, endpoint counts and polygon aggregation.

This runs public geometry APIs, not GUI Topology Checker error rows.
"""
import json
import os
from pathlib import Path
import sys


def main():
    if len(sys.argv) != 3:
        raise RuntimeError('Expected FIXTURE.json OUTPUT.json.')
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
    from qgis.core import Qgis, QgsApplication, QgsGeometry, QgsJsonUtils
    if not 34000 <= Qgis.QGIS_VERSION_INT < 40000 or Qgis.geosVersion().split('-')[0] != '3.13.0':
        raise RuntimeError('Expected QGIS >=3.40,<4 with GEOS 3.13.0.')
    if os.environ.get('QGIS_PREFIX_PATH'):
        QgsApplication.setPrefixPath(os.environ['QGIS_PREFIX_PATH'], True)
    app = QgsApplication([], False)
    app.initQgis()
    report = {'status': 'completed', 'version': Qgis.geosVersion(), 'qgisVersion': Qgis.QGIS_VERSION,
              'reference': 'pyqgis-single-layer', 'cases': []}
    families = {'Point': 'point', 'MultiPoint': 'point', 'LineString': 'line',
                'MultiLineString': 'line', 'Polygon': 'area', 'MultiPolygon': 'area'}
    all_types = set(families)
    try:
        manifest = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
        report['sourceReference'] = manifest['sourceReference']
        for sample in manifest['cases']:
            values = []
            invalid = []
            for index, value in enumerate(sample['geometries']):
                if value is None or value['type'] not in families:
                    values.append((index, value, None, False))
                    continue
                positions = []
                def collect(coordinates):
                    if coordinates and isinstance(coordinates[0], (int, float)):
                        positions.append(coordinates)
                    else:
                        for child in coordinates:
                            collect(child)
                collect(value['coordinates'])
                if not positions or any(len(p) != 2 for p in positions):
                    values.append((index, value, None, False))
                    continue
                geometry = QgsJsonUtils.geometryFromGeoJson(json.dumps(value, allow_nan=False))
                if geometry.isNull():
                    raise RuntimeError('QGIS input construction failed.')
                valid = geometry.isGeosValid()
                if not valid:
                    invalid.append(index)
                values.append((index, value, geometry, valid))
            rules = []
            for selected in sample['expected']['rules']:
                rule_id = selected['id']
                allowed = all_types if rule_id in ('Rule-012', 'Rule-013') else {'LineString', 'MultiLineString'} if rule_id in ('Rule-014', 'Rule-015') else {'Polygon', 'MultiPolygon'}
                participants, excluded = [], 0
                for entry in values:
                    index, value, geometry, valid = entry
                    if value is not None and value['type'] not in allowed:
                        continue
                    if geometry is None or (rule_id != 'Rule-013' and not valid):
                        excluded += 1
                    else:
                        participants.append(entry)
                issues, checks, candidates = [], 0, 0
                def issue(members, location=None, geometry=None):
                    item = {'participants': members, 'location': location}
                    if geometry is not None:
                        item['geometry'] = geometry
                    issues.append(item)
                if rule_id == 'Rule-013':
                    for index, value, geometry, valid in participants:
                        checks += 1
                        if geometry.isMultipart() and geometry.constGet().numGeometries() > 1:
                            issue([index])
                elif rule_id in ('Rule-012', 'Rule-016'):
                    for i, (index, value, left, valid) in enumerate(participants):
                        for other, right_value, right, _ in participants[i + 1:]:
                            if not left.boundingBox().intersects(right.boundingBox()):
                                continue
                            checks += 1
                            candidates += 1
                            matched = (families[value['type']] == families[right_value['type']] and left.isGeosEqual(right)) if rule_id == 'Rule-012' else left.overlaps(right)
                            if matched:
                                issue([index, other])
                elif rule_id in ('Rule-014', 'Rule-015'):
                    nodes = {}
                    for index, value, geometry, valid in participants:
                        lines = geometry.asMultiPolyline() if geometry.isMultipart() else [geometry.asPolyline()]
                        for line in lines:
                            for point in (line[0], line[-1]):
                                nodes.setdefault((point.x(), point.y()), []).append(index)
                    checks = len(nodes)
                    for (x, y), members in sorted(nodes.items()):
                        if len(members) == (1 if rule_id == 'Rule-014' else 2):
                            issue(sorted(set(members)), {'x': x, 'y': y})
                elif participants:
                    union = QgsGeometry.unaryUnion([entry[2] for entry in participants])
                    if union.isNull():
                        raise RuntimeError('QGIS union failed.')
                    checks = 1
                    # Use the plugin's buffered extent difference as an independent
                    # reference. Discard every component touching its outer boundary.
                    extent = QgsGeometry.fromRect(union.boundingBox()).buffer(2, 3)
                    difference = extent.difference(union)
                    if difference.isNull():
                        raise RuntimeError('QGIS gap difference failed.')
                    boundary = QgsGeometry.fromPolylineXY(extent.asPolygon()[0])
                    inside = [part for part in difference.asGeometryCollection() if not part.intersects(boundary)]
                    for gap in inside:
                        polygon = gap.asPolygon()
                        if not polygon:
                            raise RuntimeError('Unexpected QGIS gap component.')
                        coordinates = [[[p.x(), p.y()] for p in ring] for ring in polygon]
                        issue([], {'x': coordinates[0][0][0], 'y': coordinates[0][0][1]}, {'type': 'Polygon', 'coordinates': coordinates})
                rules.append({'id': rule_id, 'participants': len(participants),
                              'coverage': 'none' if not participants else 'partial' if excluded else 'complete',
                              'checks': checks, 'candidates': candidates, 'issues': issues,
                              'state': 'violated' if issues else 'passed' if checks else 'skipped'})
            report['cases'].append({'name': sample['name'], 'invalid': invalid, 'rules': rules})
        with Path(sys.argv[2]).open('x', encoding='utf-8') as output:
            json.dump(report, output, indent=2, allow_nan=False)
            output.write('\n')
    finally:
        app.exitQgis()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Independent single-layer QGIS regression failed: {error}', file=sys.stderr)
        sys.exit(2)
