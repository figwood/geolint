#!/usr/bin/env python3
"""Independent QGIS geometry API reference; not GUI/plugin error-row parity.

Uses QgsGeometry/GeometryEngine/GeometryUtils, never product output or fixture
expectations. The installed QGIS version is recorded, not relabeled as 3.44.
"""
import json
import math
import os
from pathlib import Path
import sys


def main():
    from qgis.core import Qgis, QgsApplication, QgsGeometry, QgsGeometryUtils, QgsJsonUtils, QgsPoint
    from qgis.analysis import QgsGeometryCheckContext
    from qgis.core import QgsCoordinateReferenceSystem, QgsCoordinateTransformContext
    if len(sys.argv) != 3:
        raise RuntimeError('Expected FIXTURE.json OUTPUT.json')
    target = Path(sys.argv[2])
    if target.exists():
        raise RuntimeError('Output must not already exist')
    if not 34000 <= Qgis.QGIS_VERSION_INT < 40000 or Qgis.geosVersion().split('-')[0] != '3.13.0':
        raise RuntimeError('Expected QGIS 3.40–3.x with GEOS 3.13.0')
    app = QgsApplication([], False)
    app.initQgis()
    manifest = json.loads(Path(sys.argv[1]).read_text())
    report = {'status': 'completed', 'qgisVersion': Qgis.QGIS_VERSION, 'geosVersion': Qgis.geosVersion(),
              'referenceKind': 'pyqgis-geometry-checker-algorithms', 'pluginParity': False,
              'sourceReference': manifest['sourceReference'], 'cases': []}
    def geom(value):
        return QgsJsonUtils.geometryFromGeoJson(json.dumps(value))
    def xy(point):
        return {'x': point.x(), 'y': point.y()}
    def centroid(value):
        return xy(value.centroid().asPoint())
    def source(index, **extra):
        return {'recordKey': f'feature:{index}', **extra}
    def parts(value):
        kind, c = value['type'], value.get('coordinates', [])
        if kind == 'LineString':
            return [(0, 0, c)]
        if kind == 'MultiLineString':
            return [(i, 0, p) for i, p in enumerate(c)]
        if kind == 'Polygon':
            return [(0, i, p) for i, p in enumerate(c)]
        if kind == 'MultiPolygon':
            return [(i, j, r) for i, p in enumerate(c) for j, r in enumerate(p)]
        return []
    def unclosed(p):
        return p[:-1] if len(p) > 1 and p[0] == p[-1] else p
    def distance(a, b):
        return QgsPoint(*a).distance(QgsPoint(*b))
    try:
        for sample in manifest['cases']:
            rid, config, values = sample['ruleId'], sample['parameters'], sample['geometries']
            number = int(rid[-3:])
            precision = QgsGeometryCheckContext(config.get('toleranceDigits', 8), QgsCoordinateReferenceSystem(), QgsCoordinateTransformContext(), None)
            eps, reduced = precision.tolerance, precision.reducedTolerance
            all_types = {'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'}
            types = all_types
            if number in (24, 25, 26, 31, 32):
                types = {'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'}
            elif number in (27, 28, 33, 34, 37, 38):
                types = {'Polygon', 'MultiPolygon'}
            elif number == 29:
                types = {'MultiPoint', 'MultiLineString', 'MultiPolygon'}
            elif number in (30, 39):
                types = {'LineString', 'MultiLineString'}
            indices = [i for i, v in enumerate(values) if v and v['type'] in types]
            geometries = {i: geom(values[i]) for i in indices if number != 27}
            # Area/GEOS relation rules require valid input, node/property rules do not.
            excluded = [i for i in indices if number in (33, 34, 35, 36, 37, 38) and not geometries[i].isGeosValid()]
            indices = [i for i in indices if i not in excluded]
            issues = []
            def emit(members, location, paths, measurements=None, geometry=None, region=None):
                occurrence = {'sources': paths}
                if region is not None:
                    occurrence['region'] = region
                row = {'participants': members, 'location': location, 'occurrence': occurrence, 'measurements': measurements or {}}
                if geometry is not None:
                    row['geometry'] = json.loads(geometry.asJson())
                issues.append(row)
            if number in (24, 25, 26, 27, 28, 29, 31, 32, 33, 34, 40):
                for index in indices:
                    value = values[index]
                    if number == 29:
                        if len(value['coordinates']) == 1:
                            emit([index], centroid(geometries[index]), [source(index)], {'partCount': 1})
                    elif number == 40:
                        if value['type'] not in config['allowedTypes']:
                            c = value['coordinates']
                            while isinstance(c[0], list):
                                c = c[0]
                            emit([index], {'x': c[0], 'y': c[1]}, [source(index)])
                    elif number in (33, 34):
                        polygons = [value['coordinates']] if value['type'] == 'Polygon' else value['coordinates']
                        for part, rings in enumerate(polygons):
                            shape = geom({'type': 'Polygon', 'coordinates': rings})
                            area = shape.area()
                            if number == 33 and area < config['minArea']:
                                emit([index], centroid(shape), [source(index, part=part)], {'area': area, 'minArea': config['minArea']})
                            elif number == 34:
                                bbox = shape.boundingBox()
                                thinness = max(bbox.width(), bbox.height()) ** 2 / area
                                if thinness > config['maxThinness'] and (not config['maxArea'] or area <= config['maxArea']):
                                    emit([index], centroid(shape), [source(index, part=part)], {'area': area, 'thinness': thinness, 'maxThinness': config['maxThinness'], 'maxArea': config['maxArea']})
                    else:
                        for part, ring, original in parts(value):
                            p = unclosed(original)
                            n, closed = len(p), len(p) < len(original)
                            def src(**extra):
                                return source(index, part=part, ring=ring, **extra)
                            if number == 27:
                                if n < 3:
                                    emit([index], xy(QgsPoint(*p[0])), [src()], {'nodeCount': n})
                            elif number == 28:
                                if ring:
                                    emit([index], centroid(geom({'type': 'Polygon', 'coordinates': [original]})), [src()])
                            elif number == 25:
                                for vertex in range(n):
                                    if distance(p[vertex - 1], p[vertex]) < eps:
                                        emit([index], xy(QgsPoint(*p[vertex])), [src(vertex=vertex)])
                            elif number == 24:
                                for a in range(len(original) - 1):
                                    for b in range(a + 2, len(original) - 1):
                                        if closed and a == 0 and b == len(original) - 2:
                                            continue
                                        hit, point, _ = QgsGeometryUtils.segmentIntersection(QgsPoint(*original[a]), QgsPoint(*original[a + 1]), QgsPoint(*original[b]), QgsPoint(*original[b + 1]), eps)
                                        if hit:
                                            emit([index], xy(point), [src(segment=a), src(segment=b)])
                            elif number == 26:
                                retained = []
                                for vertex in range(n):
                                    if not retained or distance(p[retained[-1]], p[vertex]) > eps:
                                        retained.append(vertex)
                                while len(retained) > 1 and distance(p[retained[0]], p[retained[-1]]) < eps:
                                    retained.pop()
                                segments = list(zip(retained, retained[1:] + retained[:1])) if closed else list(zip(retained, retained[1:]))
                                for vertex in retained:
                                    for a, b in segments:
                                        if vertex in (a, b):
                                            continue
                                        projected = QgsGeometryUtils.projectPointOnSegment(QgsPoint(*p[vertex]), QgsPoint(*p[a]), QgsPoint(*p[b]))
                                        if projected.distance(QgsPoint(*p[vertex])) < eps:
                                            emit([index], xy(QgsPoint(*p[vertex])), [src(vertex=vertex)])
                                            break
                            elif number == 31:
                                for vertex in range(0 if closed else 1, n):
                                    length = distance(p[vertex - 1], p[vertex])
                                    if eps < length < config['minLength']:
                                        a, b = p[vertex - 1], p[vertex]
                                        emit([index], {'x': (a[0] + b[0]) / 2, 'y': (a[1] + b[1]) / 2}, [src(vertex=vertex)], {'length': length, 'minLength': config['minLength']})
                            elif number == 32:
                                for vertex in range(0 if closed else 1, n if closed else n - 1):
                                    a, b, c = p[vertex - 1], p[vertex], p[(vertex + 1) % n]
                                    if not distance(a, b) or not distance(b, c):
                                        continue
                                    angle = QgsGeometryUtils.angleBetweenThreePoints(*a, *b, *c)
                                    angle = math.degrees(min(angle, 2 * math.pi - angle))
                                    if angle < config['minAngle']:
                                        emit([index], xy(QgsPoint(*b)), [src(vertex=vertex)], {'angle': angle, 'minAngle': config['minAngle']})
            elif number == 30:
                line_parts = [(i, part, p) for i in indices for part, _, p in parts(values[i])]
                for i, part, p in line_parts:
                    box = geom({'type': 'LineString', 'coordinates': p}).boundingBox()
                    for vertex in (0, len(p) - 1):
                        touches = False
                        for j, other_part, other in line_parts:
                            if not box.intersects(geometries[j].boundingBox()):
                                continue
                            own = i == j and part == other_part
                            for segment in range(1 if own else 0, len(other) - 1 - (1 if own else 0)):
                                a, b = other[segment], other[segment + 1]
                                length = distance(a, b)
                                if length and abs((b[1] - a[1]) * (p[vertex][0] - a[0]) - (b[0] - a[0]) * (p[vertex][1] - a[1])) / length < eps:
                                    touches = True
                                    break
                            if touches:
                                break
                        if not touches:
                            emit([i], xy(QgsPoint(*p[vertex])), [source(i, part=part, vertex=vertex)])
            elif number in (35, 36, 37):
                for i in indices:
                    engine = QgsGeometry.createGeometryEngine(geometries[i].constGet(), eps)
                    duplicates = []
                    for j in indices:
                        if j >= i:
                            continue
                        if geometries[i].type() != geometries[j].type() or not geometries[i].boundingBox().intersects(geometries[j].boundingBox()):
                            continue
                        other = QgsGeometry.createGeometryEngine(geometries[j].constGet(), eps)
                        if number == 35 and engine.isEqual(geometries[j].constGet()):
                            duplicates.append(j)
                        elif number == 36:
                            for container, subject, a, b in [(i, j, engine, other), (j, i, other, engine)]:
                                if a.contains(geometries[subject].constGet()) and not b.contains(geometries[container].constGet()):
                                    emit([subject, container], centroid(geometries[subject]), [source(subject), source(container)])
                        elif number == 37 and engine.overlaps(geometries[j].constGet()):
                            intersection = QgsGeometry(engine.intersection(geometries[j].constGet()))
                            for region, part in enumerate(intersection.asGeometryCollection()):
                                area = part.area()
                                if area > reduced and (not config['maxArea'] or area < config['maxArea']):
                                    emit([j, i], centroid(part), [source(j), source(i)], {'area': area, 'maxArea': config['maxArea']}, part, region)
                    if duplicates:
                        emit([i] + duplicates, centroid(geometries[i]), [source(i)] + [source(j) for j in duplicates])
            elif number == 38 and indices:
                coverage = QgsGeometry.unaryUnion([geometries[i] for i in indices])
                envelope = coverage.boundingBox()
                envelope.grow(2)
                difference = QgsGeometry.fromRect(envelope).difference(coverage)
                region = 0
                for part in difference.asGeometryCollection():
                    if part.boundingBox() == envelope:
                        continue
                    area = part.area()
                    if area >= reduced and (not config['maxArea'] or area <= config['maxArea']):
                        emit([], centroid(part), [], {'area': area, 'maxArea': config['maxArea']}, part, region)
                    region += 1
            elif number == 39:
                line_parts = [(i, part, p) for i in indices for part, _, p in parts(values[i])]
                for a, (i, ipart, p) in enumerate(line_parts):
                    for j, jpart, q in line_parts[a + 1:]:
                        for first in range(len(p) - 1):
                            for second in range(len(q) - 1):
                                hit, point, _ = QgsGeometryUtils.segmentIntersection(QgsPoint(*p[first]), QgsPoint(*p[first + 1]), QgsPoint(*q[second]), QgsPoint(*q[second + 1]), eps)
                                if hit:
                                    emit(list(dict.fromkeys([i, j])), xy(point), [source(i, part=ipart, segment=first), source(j, part=jpart, segment=second)])
            report['cases'].append({'name': sample['name'], 'ruleId': rid, 'parameters': config,
                                    'participants': len(indices), 'coverage': 'none' if not indices else 'partial' if excluded else 'complete',
                                    'state': 'violated' if issues else 'passed' if indices else 'skipped', 'issues': issues})
        with target.open('x', encoding='utf8') as out:
            json.dump(report, out, allow_nan=False, indent=2)
    finally:
        app.exitQgis()


if __name__ == '__main__':
    os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
    main()
