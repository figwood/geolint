import type { Geometry, NormalizedRecord } from '../contracts.ts';

export const PREVIEW_LIMITS = { rows: 20, fields: 20, text: 200, width: 720, height: 320, padding: 16, pixelTolerance: 1 } as const;
export interface PreviewRow {
  index: number; id: string; geometryType: string; disposition: string;
  attributeStatus: string; attributeReason: string; values: string[];
}
export interface PreviewSummary {
  total: number; geometryTypes: [string, number][]; skipped: number; parseFailed: number;
  fields: string[]; fieldsTruncated: boolean; rows: PreviewRow[];
}
export interface PreviewPath { points: [number, number][]; closed: boolean }
export interface ThumbnailPreview { paths: PreviewPath[]; drawnRecords: number; omittedRecords: number; limited: boolean; bounds: [number, number, number, number] | null }
const clip = (value: string): string => value.length > PREVIEW_LIMITS.text ? value.slice(0, PREVIEW_LIMITS.text - 1) + '…' : value;
function cell(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return clip(value);
  if (value !== null && typeof value === 'object') {
    try { return clip(JSON.stringify(value)); }
    catch { return '…'; } // Extremely deep attributes cannot be serialized safely.
  }
  return clip(String(value));
}
export function summarizePreview(records: readonly NormalizedRecord[]): PreviewSummary {
  const types = new Map<string, number>(), fields = new Set<string>();
  let skipped = 0, parseFailed = 0, fieldsTruncated = false;
  for (const record of records) {
    const type = record.geometryType === null ? 'None' : ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'].includes(record.geometryType) ? record.geometryType : 'Unsupported';
    types.set(type, (types.get(type) ?? 0) + 1);
    if (record.disposition === 'skipped') skipped++;
    if (record.disposition === 'parse_failed') parseFailed++;
    if (record.attributes?.status === 'available') {
      for (const field in record.attributes.values) {
        if (!Object.hasOwn(record.attributes.values, field) || fields.has(field)) continue;
        if (fields.size === PREVIEW_LIMITS.fields) { fieldsTruncated = true; break; }
        fields.add(field);
      }
    }
  }
  const names = [...fields];
  const rows = records.slice(0, PREVIEW_LIMITS.rows).map(record => ({
    index: record.featureIndex + 1, id: cell(record.featureId), geometryType: clip(record.geometryType ?? 'None'),
    disposition: record.disposition, attributeStatus: record.attributes?.status ?? 'skipped',
    attributeReason: record.attributes?.status !== 'available' ? clip(record.attributes?.reason ?? 'Attributes unavailable.') : '',
    values: names.map(name => cell(record.attributes?.status === 'available' && Object.hasOwn(record.attributes.values, name) ? record.attributes.values[name] : undefined)),
  }));
  return { total: records.length, geometryTypes: [...types].map(([type, count]) => [clip(type), count]), skipped, parseFailed, fields: names.map(clip), fieldsTruncated, rows };
}
// Walk every part; preview limits must never truncate the source extent or a ring.
function* geometryPaths(geometry: Geometry): Generator<{ coordinates: number[][]; closed: boolean }> {
  switch (geometry.type) {
    case 'Point': yield { coordinates: [geometry.coordinates], closed: false }; break;
    case 'MultiPoint':
      for (const point of geometry.coordinates) yield { coordinates: [point], closed: false };
      break;
    case 'LineString': yield { coordinates: geometry.coordinates, closed: false }; break;
    case 'Polygon':
    case 'MultiLineString':
      for (const coordinates of geometry.coordinates) yield { coordinates, closed: geometry.type === 'Polygon' };
      break;
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates) for (const coordinates of polygon) yield { coordinates, closed: true };
      break;
    case 'GeometryCollection':
      for (const member of geometry.geometries) yield* geometryPaths(member);
  }
}
export function thumbnailPreview(records: readonly NormalizedRecord[]): ThumbnailPreview {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const record of records) {
    if (record.disposition !== 'check') continue;
    for (const { coordinates } of geometryPaths(record.geometry)) for (const point of coordinates) {
      minX = Math.min(minX, point[0]!); maxX = Math.max(maxX, point[0]!);
      minY = Math.min(minY, point[1]!); maxY = Math.max(maxY, point[1]!);
    }
  }
  const paths: PreviewPath[] = [];
  if (!Number.isFinite(minX)) return { paths, drawnRecords: 0, omittedRecords: records.length, limited: false, bounds: null };
  // Normalize before subtracting to avoid overflow with extreme finite coordinates.
  const magnitude = Math.max(Math.abs(minX), Math.abs(minY), Math.abs(maxX), Math.abs(maxY)) || 1;
  const width = maxX / magnitude - minX / magnitude, height = maxY / magnitude - minY / magnitude;
  const scale = Math.min(width > 0 ? (PREVIEW_LIMITS.width - 2 * PREVIEW_LIMITS.padding) / width : Infinity,
    height > 0 ? (PREVIEW_LIMITS.height - 2 * PREVIEW_LIMITS.padding) / height : Infinity);
  const factor = Number.isFinite(scale) ? scale : 1;
  const project = (point: number[]): [number, number] => [(point[0]! / magnitude - minX / magnitude) * factor,
    (point[1]! / magnitude - minY / magnitude) * factor];
  const occupied = new Set<string>();
  let drawnRecords = 0, limited = false;
  for (const record of records) {
    if (record.disposition !== 'check') continue;
    let represented = false;
    for (const { coordinates, closed } of geometryPaths(record.geometry)) {
      if (!coordinates.length) continue;
      represented = true;
      if (coordinates.length === 1) {
        const point = coordinates[0]!, [x, y] = project(point);
        const key = `${Math.floor(x)},${Math.floor(y)}`;
        if (occupied.has(key)) { limited = true; continue; }
        occupied.add(key);
        paths.push({ points: [[point[0]!, point[1]!]], closed: false });
        continue;
      }
      const indices = new Set<number>([0, coordinates.length - 1]);
      let previous = project(coordinates[0]!);
      for (let i = 1; i < coordinates.length - 1; i++) {
        const pixel = project(coordinates[i]!);
        if (Math.hypot(pixel[0] - previous[0], pixel[1] - previous[1]) >= PREVIEW_LIMITS.pixelTolerance) {
          indices.add(i); previous = pixel;
        }
      }
      // Keep at least three source vertices plus closure even for subpixel rings.
      if (closed && indices.size < 4) {
        indices.add(Math.floor((coordinates.length - 1) / 3));
        indices.add(Math.floor(2 * (coordinates.length - 1) / 3));
      }
      const points: [number, number][] = [...indices].sort((a, b) => a - b).map(i => {
        const point = coordinates[i]!;
        return [point[0]!, point[1]!];
      });
      if (points.length < coordinates.length) limited = true;
      paths.push({ points, closed });
    }
    if (represented) drawnRecords++;
  }
  return { paths, drawnRecords, omittedRecords: records.length - drawnRecords, limited, bounds: [minX, minY, maxX, maxY] };
}
