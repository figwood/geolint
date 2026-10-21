import { polygonRingEvidence } from './preflight.ts';
import type { Geometry, NormalizedRecord, RecordRef } from '../contracts.ts';

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class GeometryStructureError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

// Format readers supply provenance; this boundary applies only geometry policy.
export function normalizeGeometry(geometry: unknown, source: RecordRef): NormalizedRecord {
  const ref: RecordRef = { ...source, warnings: [...source.warnings] };
  const result = (disposition: 'skipped' | 'parse_failed', reasonCode: string, reason: string): NormalizedRecord =>
    ({ ...ref, disposition, reasonCode, reason });
  if (geometry === null) return result('skipped', 'EMPTY_GEOMETRY', 'Null geometry was not checked.');
  if (object(geometry) && typeof geometry.type === 'string') ref.geometryType = geometry.type;
  const dimensions = new Set<number>();
  let empty = false;
  const fail = (message: string, code = 'INVALID_COORDINATES'): never => { throw new GeometryStructureError(code, message); };
  const position = (value: unknown): number[] => {
    if (!Array.isArray(value) || value.length < 2 || value.length > 4
      || !value.every(n => typeof n === 'number' && Number.isFinite(n))) {
      fail('Positions must contain two to four finite numbers.');
    }
    const coordinates = value as number[];
    dimensions.add(coordinates.length);
    return coordinates;
  };
  const positions = (value: unknown, ring = false): number[][] => {
    if (!Array.isArray(value) || value.length < (ring ? 4 : 2)) {
      fail(ring ? 'Rings require at least four positions.' : 'Lines require at least two positions.', ring ? 'INVALID_RING' : 'INVALID_COORDINATES');
    }
    const coordinates = (value as unknown[]).map(position);
    if (ring && (coordinates[0]![0] !== coordinates.at(-1)![0] || coordinates[0]![1] !== coordinates.at(-1)![1])) {
      fail('Rings must be explicitly closed in x and y.', 'INVALID_RING');
    }
    return coordinates;
  };
  const polygon = (value: unknown): number[][][] => {
    if (!Array.isArray(value) || value.length === 0) fail('Polygon members must contain at least one ring.');
    return (value as unknown[]).map(ring => positions(ring, true));
  };
  const visit = (value: unknown, depth: number): Geometry => {
    // Bound recursion in normalization, JSON serialization and GEOS construction.
    if (depth > 64) fail('GeometryCollection nesting exceeds the limit of 64 levels.');
    if (!object(value) || typeof value.type !== 'string') fail('Expected a geometry object with a type.');
    const input = value as Record<string, unknown>;
    if (input.type === 'GeometryCollection') {
      if (depth >= 64) fail('GeometryCollection nesting exceeds the limit of 64 levels.');
      if (!Array.isArray(input.geometries)) fail('GeometryCollection.geometries must be an array.');
      const members = input.geometries as unknown[];
      if (members.length === 0) empty = true;
      return { type: 'GeometryCollection', geometries: members.map(member => visit(member, depth + 1)) };
    }
    if (!['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(input.type as string)) fail('Unknown geometry type.');
    if (!Array.isArray(input.coordinates)) fail('Coordinates must be an array.');
    const coordinates = input.coordinates as unknown[];
    if (coordinates.length === 0) {
      empty = true;
      return { type: input.type, coordinates: [] } as Geometry;
    }
    switch (input.type) {
      case 'Point': return { type: 'Point', coordinates: position(coordinates) };
      case 'MultiPoint': return { type: 'MultiPoint', coordinates: coordinates.map(position) };
      case 'LineString': return { type: 'LineString', coordinates: positions(coordinates) };
      case 'MultiLineString': return { type: 'MultiLineString', coordinates: coordinates.map(line => positions(line)) };
      case 'Polygon': return { type: 'Polygon', coordinates: polygon(coordinates) };
      default: return { type: 'MultiPolygon', coordinates: coordinates.map(polygon) };
    }
  };
  let normalized: Geometry;
  try { normalized = visit(geometry, 0); }
  catch (error) {
    if (!(error instanceof GeometryStructureError)) throw error;
    if (error.code === 'INVALID_RING') ref.preflightEvidence = polygonRingEvidence(geometry);
    return result('parse_failed', error.code, error.message);
  }
  if (dimensions.size > 1) return result('parse_failed', 'INVALID_COORDINATES', 'Mixed coordinate dimensions are not supported.');
  if (empty) return result('skipped', 'EMPTY_GEOMETRY', 'Empty geometry or collection member was not checked; collections are not partially checked.');
  if (!dimensions.has(2)) return result('skipped', 'UNSUPPORTED_DIMENSION', 'Only two-dimensional coordinates are checked.');
  return { ...ref, disposition: 'check', geometry: normalized };
}
