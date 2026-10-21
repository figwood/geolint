import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPolygon, compareInputFiles } from '../validation/compare-inputs.mjs';

const shell = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
const hole = [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]];
const far = shell.map(([x, y]) => [x + 20, y]);
const polygon = { type: 'Polygon', coordinates: [shell, hole] };
const expected = [{ file: 'a.shp', records: [
  { featureIndex: 0, disposition: 'check', geometry: polygon },
  { featureIndex: 1, disposition: 'skipped', reasonCode: 'EMPTY_GEOMETRY' },
] }];
const reference = () => ({ status: 'completed', files: [{ file: 'a.shp', status: 'completed', records: [
  { featureIndex: 0, geometry: structuredClone(polygon) },
  { featureIndex: 1, geometry: null },
] }] });

test('representation changes preserve shell ownership and every vertex', () => {
  const shifted = [...shell.slice(2, -1), ...shell.slice(0, 2), shell[2]];
  assert.deepEqual(canonicalPolygon(polygon), canonicalPolygon({ type: 'MultiPolygon', coordinates: [[shifted.reverse(), [...hole].reverse()]] }));
  assert.deepEqual(canonicalPolygon({ type: 'MultiPolygon', coordinates: [[shell, hole], [far]] }), canonicalPolygon({ type: 'MultiPolygon', coordinates: [[far], [shell, hole]] }));
  const actual = reference(); actual.files[0].records[0].geometry.coordinates[0].reverse();
  assert.doesNotThrow(() => compareInputFiles(expected, actual));
});

test('precision loss, lost repeated vertices and changed shell ownership cannot match', () => {
  for (const geometry of [
    { type: 'Polygon', coordinates: [shell.map(([x, y], i) => [x + (i === 1 ? 1e-12 : 0), y]), hole] },
    { type: 'MultiPolygon', coordinates: [[shell], [hole]] },
    { type: 'Polygon', coordinates: [hole, shell] },
  ]) {
    const actual = reference(); actual.files[0].records[0].geometry = geometry;
    assert.throws(() => compareInputFiles(expected, actual), /geometry differs/);
  }
  const repeated = { type: 'Polygon', coordinates: [[shell[0], shell[1], shell[1], ...shell.slice(2)]] };
  assert.notDeepEqual(canonicalPolygon(repeated), canonicalPolygon({ type: 'Polygon', coordinates: [shell] }));
});

test('failed providers, missing or duplicate records and wrong order never pass', () => {
  for (const mutate of [
    value => { value.status = 'failed'; },
    value => { value.files[0].status = 'failed'; },
    value => { value.files = []; },
    value => { value.files.push(structuredClone(value.files[0])); },
    value => { value.files[0].records.pop(); },
    value => { value.files[0].records[1].featureIndex = 0; },
    value => { value.files[0].records.reverse(); },
    value => { value.files[0].records[1].geometry = polygon; },
  ]) {
    const actual = reference(); mutate(actual);
    assert.throws(() => compareInputFiles(expected, actual));
  }
  assert.doesNotThrow(() => compareInputFiles([{ file: 'empty.geojson', records: [] }], { status: 'completed', files: [{ file: 'empty.geojson', status: 'completed', records: [] }] }));
  assert.throws(() => canonicalPolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]] }), /closed/);
});

test('independent point, line and collection comparisons preserve every coordinate and member', () => {
  for (const geometry of [
    { type: 'Point', coordinates: [-0.125, 3000000.0625] },
    { type: 'MultiPoint', coordinates: [[0, 0], [0, 0], [1, 2]] },
    { type: 'LineString', coordinates: [[0, 0], [1, 2], [1, 2], [3, 4]] },
    { type: 'MultiLineString', coordinates: [[[0, 0], [1, 2]], [[3, 4], [5, 6]]] },
    { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [0, 0] }, polygon] },
  ]) {
    const input = [{ file: 'types.geojson', records: [{ featureIndex: 0, disposition: 'check', geometry }] }];
    const actual = { status: 'completed', files: [{ file: 'types.geojson', status: 'completed', records: [{ featureIndex: 0, geometry: structuredClone(geometry) }] }] };
    assert.doesNotThrow(() => compareInputFiles(input, actual));
    actual.files[0].records[0].geometry = { type: 'Point', coordinates: [999, 999] };
    assert.throws(() => compareInputFiles(input, actual), /geometry differs/);
  }
  const input = [{ file: 'line.shp', records: [{ featureIndex: 0, disposition: 'check', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 2], [1, 2], [3, 4]] } }] }];
  const actual = { status: 'completed', files: [{ file: 'line.shp', status: 'completed', records: [{ featureIndex: 0, geometry: { type: 'MultiLineString', coordinates: [[[3, 4], [1, 2], [1, 2], [0, 0]]] } }] }] };
  assert.doesNotThrow(() => compareInputFiles(input, actual));
  actual.files[0].records[0].geometry.coordinates[0].splice(1, 1);
  assert.throws(() => compareInputFiles(input, actual), /geometry differs/);
});
