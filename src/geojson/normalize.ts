import type { NormalizedRecord, RecordRef } from '../contracts.ts';
import { InspectionError } from '../errors.ts';
import { normalizeGeometry } from '../geometry/normalize.ts';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const own = (value: object, key: string) => Object.hasOwn(value, key);

function normalizeRecord(value: unknown, index: number, bare = false): NormalizedRecord {
  const ref: RecordRef = {
    recordKey: `feature:${index}`, featureIndex: index, featureId: null,
    featureIdType: 'missing', geometryType: null, warnings: [],
  };
  const result = (disposition: 'skipped' | 'parse_failed', reasonCode: string, reason: string): NormalizedRecord =>
    ({ ...ref, disposition, reasonCode, reason });
  if (!object(value) || (!bare && value.type !== 'Feature')) {
    ref.attributes = { status: 'skipped', reasonCode: 'ATTRIBUTES_UNAVAILABLE', reason: 'This record is not a Feature.' };
    return result('parse_failed', 'INVALID_FEATURE', 'Expected a GeoJSON Feature object.');
  }
  ref.attributes = bare
    ? { status: 'skipped', reasonCode: 'ATTRIBUTES_UNAVAILABLE', reason: 'Bare geometry does not contain Feature attributes.' }
    : value.properties == null
      ? { status: 'available', values: {} }
      : object(value.properties)
        ? { status: 'available', values: value.properties }
        : { status: 'failed', reasonCode: 'INVALID_PROPERTIES', reason: 'Feature properties must be an object or null.' };
  if (!bare && own(value, 'id')) {
    if (typeof value.id === 'string' || (typeof value.id === 'number' && Number.isFinite(value.id))) {
      ref.featureId = value.id;
      ref.featureIdType = typeof value.id === 'string' ? 'string' : 'number';
    } else {
      ref.featureIdType = 'invalid';
    }
  }
  if (!bare && !own(value, 'geometry')) return result('parse_failed', 'INVALID_FEATURE', 'Feature geometry is missing.');
  const geometry = bare ? value : value.geometry;
  return normalizeGeometry(geometry, ref);
}

export function normalizeRoot(input: unknown): NormalizedRecord[] {
  if (!object(input)) throw new InspectionError('INVALID_ROOT', 'Expected a GeoJSON object.');
  // Legacy crs metadata is accepted; normalizeGeometry retains original x/y without reprojection.
  if (input.type === 'FeatureCollection') {
    if (!Array.isArray(input.features)) throw new InspectionError('INVALID_ROOT', 'FeatureCollection.features must be an array.');
    return input.features.map((value, index) => normalizeRecord(value, index));
  }
  if (input.type === 'Feature') return [normalizeRecord(input, 0)];
  if (['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'].includes(input.type as string)) {
    return [normalizeRecord(input, 0, true)];
  }
  throw new InspectionError('INVALID_ROOT', 'Expected FeatureCollection, Feature or a GeoJSON geometry.');
}
