import type { Geometry, NormalizedRecord, PolygonalGeometry, RecordRef } from '../contracts.ts';
import { InspectionError } from '../errors.ts';
import { normalizeGeometry } from '../geometry/normalize.ts';

type Ring = number[][];
const shapeTypes = new Map<number, string>([
  [0, 'Null'], [1, 'Point'], [3, 'LineString'], [5, 'Polygon'], [8, 'MultiPoint'],
  [11, 'Point'], [13, 'LineString'], [15, 'Polygon'], [18, 'MultiPoint'],
  [21, 'Point'], [23, 'LineString'], [25, 'Polygon'], [28, 'MultiPoint'], [31, 'MultiPatch'],
]);

function signedArea(ring: Ring): number {
  // Translate to the first vertex to avoid cancellation with projected coordinates.
  const [x, y] = ring[0]!;
  let area = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i]!;
    area += (a[0]! - x!) * (b[1]! - y!) - (b[0]! - x!) * (a[1]! - y!);
  }
  return area;
}

function contains(ring: Ring, point: number[]): boolean {
  const [x, y] = point as [number, number];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j] as [number, number], [bx, by] = ring[i] as [number, number];
    if ((bx - ax) * (y - ay) === (by - ay) * (x - ax)
      && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function validatePayload(view: DataView, type: number): void {
  const length = view.byteLength;
  if ([1, 11, 21].includes(type)) {
    if (type === 1 ? length !== 20 : type === 21 ? length !== 28 : length !== 28 && length !== 36) throw new Error();
    for (let offset = 4; offset < length; offset += 8) if (!Number.isFinite(view.getFloat64(offset, true))) throw new Error();
    return;
  }
  const multiPoint = [8, 18, 28].includes(type);
  if (length < (multiPoint ? 40 : 44)) throw new Error();
  const parts = multiPoint ? 0 : view.getInt32(36, true);
  const points = view.getInt32(multiPoint ? 36 : 40, true);
  if (parts < 0 || points < 0 || (!multiPoint && ((parts === 0) !== (points === 0)))) throw new Error();
  const pointOffset = multiPoint ? 40 : 44 + parts * (type === 31 ? 8 : 4);
  const xyEnd = pointOffset + points * 16;
  const hasZ = [13, 15, 18, 31].includes(type);
  const minimum = xyEnd + (hasZ ? 16 + points * 8 : 0);
  const optionalM = type > 8 ? 16 + points * 8 : 0;
  if (length !== minimum && (optionalM === 0 || length !== minimum + optionalM)) throw new Error();
  for (let i = 0; i < parts; i++) {
    const start = view.getInt32(44 + i * 4, true);
    const end = i + 1 < parts ? view.getInt32(48 + i * 4, true) : points;
    let ring = type === 15 || type === 25;
    if (type === 31) {
      const partType = view.getInt32(44 + parts * 4 + i * 4, true);
      if (partType < 0 || partType > 5) throw new Error();
      ring = partType >= 2;
    }
    if ((i === 0 && start !== 0) || start < 0 || end > points || end - start < (ring ? 4 : type === 31 ? 3 : 2)) throw new Error();
    if (ring) {
      const first = pointOffset + start * 16, last = pointOffset + (end - 1) * 16;
      if (view.getFloat64(first, true) !== view.getFloat64(last, true)
        || view.getFloat64(first + 8, true) !== view.getFloat64(last + 8, true)) throw new Error();
    }
  }
  // Coordinates and Z/M blocks contain doubles; finite M no-data sentinels are allowed.
  for (let offset = pointOffset; offset < length; offset += 8) if (!Number.isFinite(view.getFloat64(offset, true))) throw new Error();
}

function pointOrLine(view: DataView, type: number): Geometry {
  validatePayload(view, type);
  if (type === 1) return { type: 'Point', coordinates: [view.getFloat64(4, true), view.getFloat64(12, true)] };
  const multiPoint = type === 8;
  const count = view.getInt32(multiPoint ? 36 : 40, true);
  const parts = multiPoint ? 0 : view.getInt32(36, true);
  const pointOffset = multiPoint ? 40 : 44 + parts * 4;
  const coordinates = Array.from({ length: count }, (_, index) => [
    view.getFloat64(pointOffset + index * 16, true), view.getFloat64(pointOffset + index * 16 + 8, true),
  ]);
  if (multiPoint) return { type: 'MultiPoint', coordinates };
  const lines = Array.from({ length: parts }, (_, index) => {
    const start = view.getInt32(44 + index * 4, true);
    const end = index + 1 < parts ? view.getInt32(48 + index * 4, true) : count;
    return coordinates.slice(start, end);
  });
  return lines.length === 1 ? { type: 'LineString', coordinates: lines[0]! }
    : { type: 'MultiLineString', coordinates: lines };
}

function polygon(view: DataView): PolygonalGeometry {
  if (view.byteLength < 44) throw new Error();
  const parts = view.getInt32(36, true), points = view.getInt32(40, true);
  if (parts < 0 || points < 0 || view.byteLength !== 44 + parts * 4 + points * 16) throw new Error();
  if (parts === 0 && points === 0) return { type: 'Polygon', coordinates: [] };
  if (parts === 0 || points === 0) throw new Error();
  const rings: Ring[] = [];
  let previous = -1;
  for (let i = 0; i < parts; i++) {
    const start = view.getInt32(44 + i * 4, true);
    const end = i + 1 < parts ? view.getInt32(48 + i * 4, true) : points;
    if ((i === 0 && start !== 0) || start <= previous || end <= start || end > points) throw new Error();
    previous = start;
    const ring: Ring = [];
    for (let j = start; j < end; j++) {
      const offset = 44 + parts * 4 + j * 16;
      const x = view.getFloat64(offset, true), y = view.getFloat64(offset + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error();
      ring.push([x, y]);
    }
    // Never close or reverse rings. Invalid rings must retain their original status.
    if (ring.length < 4 || ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1]) throw new Error();
    rings.push(ring);
  }
  if (rings.length === 1) return { type: 'Polygon', coordinates: rings };
  // ESRI: clockwise shells, counterclockwise holes; part order is arbitrary.
  // Zero-area rings remain shells so GEOS can diagnose the degenerate geometry.
  const shells = rings.filter(ring => signedArea(ring) <= 0).map(ring => [ring]);
  const holes = rings.filter(ring => signedArea(ring) > 0);
  if (!shells.length) throw new Error();
  for (const hole of holes) {
    const owners = shells.filter(shell => contains(shell[0]!, hole[0]!));
    if (owners.length !== 1) throw new Error();
    owners[0]!.push(hole);
  }
  return shells.length === 1 ? { type: 'Polygon', coordinates: shells[0]! }
    : { type: 'MultiPolygon', coordinates: shells };
}

export function parseShapefile(bytes: Uint8Array): NormalizedRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => new InspectionError('INVALID_SHAPEFILE', 'The Shapefile header or record framing is invalid.');
  if (bytes.length < 100 || view.getInt32(0) !== 9994 || view.getInt32(28, true) !== 1000
    || view.getInt32(24) * 2 !== bytes.length || !shapeTypes.has(view.getInt32(32, true))) throw invalid();
  const headerType = view.getInt32(32, true);
  const records: NormalizedRecord[] = [];
  for (let offset = 100; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw invalid();
    const length = view.getInt32(offset + 4) * 2;
    if (length < 4 || offset + 8 + length > bytes.length || view.getInt32(offset) !== records.length + 1) throw invalid();
    const record = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, length);
    const type = record.getInt32(0, true), index = records.length;
    const ref: RecordRef = { recordKey: `feature:${index}`, featureIndex: index, featureId: null,
      featureIdType: 'missing', geometryType: shapeTypes.get(type) ?? null, warnings: [] };
    const add = (disposition: 'skipped' | 'parse_failed', reasonCode: string, reason: string) =>
      records.push({ ...ref, disposition, reasonCode, reason });
    if (!shapeTypes.has(type) || (type !== 0 && type !== headerType)) {
      add('parse_failed', 'INVALID_SHAPE_RECORD', 'Shape type is unknown or differs from the file header.');
    } else if (type === 0) {
      ref.geometryType = null;
      if (length !== 4) add('parse_failed', 'INVALID_SHAPE_RECORD', 'Null shape has unexpected content.');
      else add('skipped', 'EMPTY_GEOMETRY', 'Null geometry was not checked.');
    } else if (![1, 3, 5, 8].includes(type)) {
      try {
        validatePayload(record, type);
        if (type >= 11 && type !== 31) add('skipped', 'UNSUPPORTED_DIMENSION', 'Only two-dimensional coordinates are checked; Z/M shapes were not converted.');
        else add('skipped', 'UNSUPPORTED_TYPE', 'MultiPatch shapes cannot be checked without conversion.');
      } catch {
        add('parse_failed', 'INVALID_SHAPE_RECORD', 'Shape payload, coordinates or part indexes are malformed.');
      }
    } else {
      try {
        records.push(normalizeGeometry(type === 5 ? polygon(record) : pointOrLine(record, type), ref));
      } catch {
        add('parse_failed', 'INVALID_SHAPE_RECORD', 'Shape coordinates, parts, rings or shell/hole relationships could not be parsed without repair.');
      }
    }
    offset += 8 + length;
  }
  return records;
}
