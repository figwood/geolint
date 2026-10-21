import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, supportsInput } from '../src/input/adapters.ts';
import { normalizeGeometry } from '../src/geometry/normalize.ts';
import { shapefile, shapeRecord, square } from './helpers/shapefile.mjs';

const polygon = { type: 'Polygon', coordinates: [square] };
const encode = input => new TextEncoder().encode(JSON.stringify(input));
const ref = { recordKey: 'source:7', featureIndex: 7, featureId: 'parcel', featureIdType: 'string', geometryType: null, warnings: ['SOURCE_WARNING'] };

test('each supported byte adapter preserves coordinates and stable record provenance', () => {
  const json = parseInput('PARCEL.GEOJSON', encode({ type: 'Feature', id: 'parcel', geometry: polygon }));
  assert.equal(json[0].featureId, 'parcel');
  assert.deepEqual(json[0].geometry.coordinates, [square]);
  const bytes = shapefile([shapeRecord([], 0), shapeRecord([square])]);
  const padded = new Uint8Array(bytes.length + 16); padded.set(bytes, 8);
  const shape = parseInput('PARCEL.SHP', padded.subarray(8, 8 + bytes.length));
  assert.deepEqual(shape.map(record => [record.featureIndex, record.disposition]), [[0, 'skipped'], [1, 'check']]);
  assert.deepEqual(shape[1].geometry.coordinates, [square]);
  assert.equal(supportsInput('parcel.JSON'), true);
  assert.equal(supportsInput('parcel.ZIP'), true);
  assert.equal(supportsInput('parcel.gpkg'), false);
});

test('unsupported inputs and malformed JSON fail with explicit input errors', () => {
  assert.throws(() => parseInput('parcel.gpkg', encode(polygon)), error => error.code === 'UNSUPPORTED_FORMAT');
  assert.throws(() => parseInput('parcel.geojson', new Uint8Array([255])), error => error.code === 'READ_ERROR');
  assert.throws(() => parseInput('parcel.json', new TextEncoder().encode('{')), error => error.code === 'INVALID_JSON');
  assert.throws(() => parseInput('parcel.shp', new Uint8Array(10485761)), error => error.code === 'INVALID_SHAPEFILE');
});

test('common geometry normalization preserves source identity without applying GeoJSON CRS rules', () => {
  Object.freeze(ref.warnings); Object.freeze(ref);
  const input = { ...polygon, crs: { name: 'source CRS metadata' }, properties: { private: true } };
  const record = normalizeGeometry(input, ref);
  assert.equal(record.disposition, 'check');
  assert.equal(record.featureIndex, 7);
  assert.equal(record.featureId, 'parcel');
  assert.equal(record.geometryType, 'Polygon');
  assert.deepEqual(record.warnings, ['SOURCE_WARNING']);
  assert.deepEqual(Object.keys(record.geometry).sort(), ['coordinates', 'type']);
  assert.deepEqual(record.geometry.coordinates, [square]);
  assert.equal(ref.geometryType, null);
  record.warnings.push('OTHER');
  assert.deepEqual(ref.warnings, ['SOURCE_WARNING']);
  assert.equal(normalizeGeometry(null, ref).reasonCode, 'EMPTY_GEOMETRY');
  assert.equal(normalizeGeometry({ type: 'Polygon', coordinates: [square.slice(0, -1)] }, ref).reasonCode, 'INVALID_RING');
  assert.equal(normalizeGeometry({ type: 'Polygon', coordinates: [square.map(([x, y]) => [x, y, 1])] }, ref).reasonCode, 'UNSUPPORTED_DIMENSION');
});
