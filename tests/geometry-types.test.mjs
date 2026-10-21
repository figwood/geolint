import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { normalizeRoot } from '../src/geojson/normalize.ts';
import { parseInput } from '../src/input/adapters.ts';
import { runInspection } from '../src/inspection/run.ts';
import { createEngine } from '../src/engine/geos.ts';
import { buildJsonReport } from '../src/report/export.ts';
import { shapefile, shapeRecord } from './helpers/shapefile.mjs';

const point = { type: 'Point', coordinates: [-500000.125, 3000000.0625] };
const line = { type: 'LineString', coordinates: [[0, 0], [4, 4], [0, 4], [4, 0]] };
const polygon = { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]]] };
const collection = { type: 'GeometryCollection', geometries: [point, { type: 'GeometryCollection', geometries: [line, polygon] }] };
const geometries = [point, { type: 'MultiPoint', coordinates: [[0, 0], [0, 0], [2, 3]] }, line,
  { type: 'MultiLineString', coordinates: [line.coordinates, [[-1, 0], [2, 3]]] },
  polygon, { type: 'MultiPolygon', coordinates: [polygon.coordinates] }, collection];

for (const geometry of geometries) test(`normalizes bare and Feature ${geometry.type} without losing coordinates or collection members`, () => {
  const input = structuredClone(geometry);
  input.ignored = { private: true };
  const record = normalizeRoot(input)[0];
  assert.equal(record.disposition, 'check');
  assert.deepEqual(record.geometry, geometry);
  assert.equal(record.geometryType, geometry.type);
  assert.equal(input.ignored.private, true);
  const feature = normalizeRoot({ type: 'Feature', id: 'source', geometry: input })[0];
  assert.equal(feature.disposition, 'check');
  assert.equal(feature.featureId, 'source');
});

for (const geometry of [
  { type: 'Point', coordinates: [0] }, { type: 'Point', coordinates: [0, Infinity] },
  { type: 'MultiPoint', coordinates: [[0, 0], []] },
  { type: 'LineString', coordinates: [[0, 0]] },
  { type: 'MultiLineString', coordinates: [[]] },
  { type: 'GeometryCollection' }, { type: 'GeometryCollection', geometries: [null] },
  { type: 'GeometryCollection', geometries: [point, { type: 'Oops', coordinates: [] }] },
  { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2, 3] }, { type: 'LineString', coordinates: [[1, 2, 3]] }] },
]) test(`rejects malformed ${JSON.stringify(geometry)} before GEOS`, () => {
  assert.equal(normalizeRoot({ type: 'Feature', geometry })[0].disposition, 'parse_failed');
});

test('collections preserve one source record and reject mixed dimensions and excessive nesting', () => {
  const mixed = { type: 'GeometryCollection', geometries: [point, { type: 'Point', coordinates: [1, 2, 3] }] };
  assert.equal(normalizeRoot(mixed)[0].disposition, 'parse_failed');
  assert.equal(normalizeRoot({ type: 'MultiLineString', coordinates: [[[0, 0, 1], [1, 1, 1]]] })[0].reasonCode, 'UNSUPPORTED_DIMENSION');
  assert.equal(normalizeRoot({ type: 'Point', coordinates: [1, 2, 3, 4] })[0].reasonCode, 'UNSUPPORTED_DIMENSION');
  assert.deepEqual(normalizeRoot({ type: 'GeometryCollection', geometries: [{ ...point, crs: null }] })[0].geometry,
    { type: 'GeometryCollection', geometries: [point] });
  let nested = point;
  for (let i = 0; i < 64; i++) nested = { type: 'GeometryCollection', geometries: [nested] };
  assert.equal(normalizeRoot(nested)[0].disposition, 'check');
  nested = point;
  for (let i = 0; i < 100; i++) nested = { type: 'GeometryCollection', geometries: [nested] };
  assert.equal(normalizeRoot(nested)[0].disposition, 'parse_failed');
  const records = normalizeRoot({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 7, geometry: collection }, { type: 'Feature', geometry: point }] });
  assert.deepEqual(records.map(record => [record.featureIndex, record.disposition]), [[0, 'check'], [1, 'check']]);
  assert.equal(records[0].featureId, 7);
  assert.equal(records[0].geometry.geometries.length, 2);
});

test('well-formed dimensional point, multipoint and polyline SHP payloads stay explicitly skipped', () => {
  for (const type of [11, 21, 13, 23, 18, 28]) {
    const records = parseInput('dimensional.shp', shapefile([shapeRecord([[[0, 0], [1, 1]]], type)], type));
    assert.equal(records[0].disposition, 'skipped');
    assert.equal(records[0].reasonCode, 'UNSUPPORTED_DIMENSION');
    const bad = shapeRecord([[[0, 0], [1, 1]]], type);
    new DataView(bad.buffer).setFloat64(type === 11 || type === 21 ? 4 : type === 18 || type === 28 ? 40 : 48, Infinity, true);
    assert.equal(parseInput('bad.shp', shapefile([bad], type))[0].disposition, 'parse_failed');
  }
});

test('empty geometry remains skipped and never makes a collection partially checked', () => {
  for (const geometry of [
    ...['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].map(type => ({ type, coordinates: [] })),
    { type: 'GeometryCollection', geometries: [] },
    { type: 'GeometryCollection', geometries: [point, { type: 'Point', coordinates: [] }] },
  ]) assert.equal(normalizeRoot(geometry)[0].reasonCode, 'EMPTY_GEOMETRY');
  assert.equal(normalizeRoot({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [] }, { type: 'Point', coordinates: ['bad', 2] }] })[0].disposition, 'parse_failed');
});

test('the 64-level collection limit also applies when the innermost member is empty', () => {
  let geometry = { type: 'GeometryCollection', geometries: [] };
  for (let i = 0; i < 63; i++) geometry = { type: 'GeometryCollection', geometries: [geometry] };
  assert.equal(normalizeRoot(geometry)[0].reasonCode, 'EMPTY_GEOMETRY');
  assert.equal(normalizeRoot({ type: 'GeometryCollection', geometries: [geometry] })[0].disposition, 'parse_failed');
});

// A process owns one geos-wasm module; reuse it across real inspection runs.
let engine;
after(() => engine?.dispose());
async function inspect(bytes, name) {
  const messages = [];
  await runInspection({ name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer }, 'geometry', message => messages.push(message), async () => {
    engine ??= await createEngine();
    return { info: engine.info, check: geometry => engine.check(geometry), dispose() {} };
  });
  return messages.at(-1);
}

test('all GeoJSON types reach real GEOS, with validity rather than simplicity for crossing lines', async () => {
  const crossed = { type: 'Polygon', coordinates: [[[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]]] };
  const input = { type: 'FeatureCollection', features: [...geometries,
    { type: 'LineString', coordinates: [[1, 2], [1, 2]] },
    { type: 'GeometryCollection', geometries: [point, crossed] },
  ].map((geometry, id) => ({ type: 'Feature', id, geometry })) };
  const message = await inspect(new TextEncoder().encode(JSON.stringify(input)), 'all.geojson');
  assert.equal(message.type, 'completed');
  assert.deepEqual(message.result.records.map(record => record.status), ['valid', 'valid', 'valid', 'valid', 'valid', 'valid', 'valid', 'invalid', 'invalid']);
  assert.deepEqual(message.result.records[8].location, { x: 2, y: 2 });
  const report = JSON.parse(buildJsonReport(message.result));
  assert.deepEqual(report.issues.map(record => [record.featureIndex, record.geometryType]), [[7, 'LineString'], [8, 'GeometryCollection']]);
  assert.equal(report.issues.some(record => 'geometry' in record), false);
});

for (const [type, parts, geometry] of [
  [1, [], { type: 'Point', coordinates: [500000, 3000000] }],
  [8, [[[0, 0], [0, 0], [-1.125, 2.0625]]], { type: 'MultiPoint', coordinates: [[0, 0], [0, 0], [-1.125, 2.0625]] }],
  [3, [line.coordinates], line],
  [3, [line.coordinates, [[1, 2], [1, 2]]], { type: 'MultiLineString', coordinates: [line.coordinates, [[1, 2], [1, 2]]] }],
]) test(`SHP type ${type} ${geometry.type} retains parts and coordinates through plain and ZIP inspection`, async () => {
  const bytes = shapefile([shapeRecord([], 0), shapeRecord(parts, type)], type);
  const padded = new Uint8Array(bytes.length + 16); padded.set(bytes, 8);
  const records = parseInput('geometry.shp', padded.subarray(8, bytes.length + 8));
  assert.equal(records[1].disposition, 'check');
  assert.deepEqual(records[1].geometry, geometry);
  for (const [name, data] of [['geometry.shp', bytes], ['geometry.zip', zipSync({ 'nested/GEOMETRY.SHP': bytes })]]) {
    const message = await inspect(data, name);
    assert.equal(message.type, 'completed');
    assert.deepEqual(message.result.records.map(record => record.status), ['skipped', geometry.type === 'MultiLineString' ? 'invalid' : 'valid']);
    assert.deepEqual(message.result.records.map(record => record.featureIndex), [0, 1]);
  }
});

test('malformed point, multipoint and polyline SHP records fail individually while later records are checked', () => {
  for (const [type, parts, mutate] of [
    [1, [], view => view.setFloat64(4, NaN, true)],
    [8, [[[0, 0]]], view => view.setInt32(36, 100, true)],
    [3, [[[0, 0], [1, 1]]], view => view.setInt32(44, -1, true)],
    [3, [[[0, 0]]], () => {}],
  ]) {
    const malformed = shapeRecord(parts, type); mutate(new DataView(malformed.buffer));
    const valid = shapeRecord(type === 1 ? [] : [[[0, 0], [1, 1]]], type);
    const records = parseInput('geometry.shp', shapefile([malformed, valid], type));
    assert.deepEqual(records.map(record => record.disposition), ['parse_failed', 'check']);
    assert.equal(records[0].reasonCode, 'INVALID_SHAPE_RECORD');
  }
  for (const type of [3, 8]) assert.equal(parseInput('empty.shp', shapefile([shapeRecord([], type)], type))[0].reasonCode, 'EMPTY_GEOMETRY');
});
