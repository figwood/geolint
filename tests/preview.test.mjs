import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoot } from '../src/geojson/normalize.ts';
import { parseInput } from '../src/input/adapters.ts';
import { summarizePreview, thumbnailPreview, PREVIEW_LIMITS } from '../src/preview/data.ts';
const feature = (geometry, properties = {}) => ({ type: 'Feature', geometry, properties });
const records = features => normalizeRoot({ type: 'FeatureCollection', features });
const point = { type: 'Point', coordinates: [2, 3] };

test('legacy CRS files produce preview rows and a thumbnail in their original coordinates', () => {
  const input = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:3857' } },
    features: [feature({ type: 'Point', coordinates: [500000, 3000000] }, { name: 'projected' })] };
  const parsed = parseInput('legacy.geojson', new TextEncoder().encode(JSON.stringify(input)));
  const summary = summarizePreview(parsed);
  assert.equal(summary.total, 1);
  assert.equal(summary.parseFailed, 0);
  assert.deepEqual(summary.rows[0].values, ['projected']);
  const thumbnail = thumbnailPreview(parsed);
  assert.deepEqual(thumbnail.bounds, [500000, 3000000, 500000, 3000000]);
  assert.deepEqual(thumbnail.paths[0].points, [[500000, 3000000]]);
});

test('overview counts all records but caps rows, fields and property text', () => {
  const properties = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field${i}`, 'x'.repeat(500)]));
  const result = summarizePreview(records(Array.from({ length: 70 }, () => feature(point, properties))));
  assert.equal(result.total, 70);
  assert.deepEqual(result.geometryTypes, [['Point', 70]]);
  assert.equal(result.rows.length, 20);
  assert.equal(result.fields.length, 20);
  assert.equal(result.fieldsTruncated, true);
  assert.ok(result.rows[0].values.every(value => value.length <= PREVIEW_LIMITS.text));
});
test('unavailable attributes, malformed geometry and empty datasets remain explicit', () => {
  const input = records([feature(null), feature({ type: 'LineString', coordinates: [[0, 0]] }, { later: 1 }), feature(point, false)]);
  const result = summarizePreview(input);
  assert.equal(result.skipped, 1);
  assert.equal(result.parseFailed, 1);
  assert.equal(result.rows[2].attributeStatus, 'failed');
  assert.deepEqual(result.fields, ['later']);
  assert.equal(result.rows[0].values[0], '');
  assert.equal(summarizePreview(normalizeRoot(point)).rows[0].attributeStatus, 'skipped');
  assert.equal(summarizePreview(records([])).total, 0);
});
test('thumbnail includes collection, multipart and holes without changing coordinates', () => {
  const input = records([feature({ type: 'GeometryCollection', geometries: [point,
    { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] },
    { type: 'Polygon', coordinates: [[[0, 0], [5, 0], [5, 5], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 1]]] },
  ] }), feature(null)]);
  const before = structuredClone(input), result = thumbnailPreview(input);
  assert.equal(result.paths.length, 4);
  assert.equal(result.paths.filter(path => path.closed).length, 2);
  assert.equal(result.drawnRecords, 1);
  assert.equal(result.omittedRecords, 1);
  assert.equal(result.limited, false);
  assert.deepEqual(input, before);
});
test('thumbnail covers records beyond the old prefix limit and deduplicates coincident points', () => {
  const many = thumbnailPreview(records([...Array.from({ length: 1500 }, () => feature(point)), feature({ type: 'Point', coordinates: [100, 200] })]));
  assert.equal(many.drawnRecords, 1501);
  assert.equal(many.omittedRecords, 0);
  assert.equal(many.paths.length, 2);
  assert.deepEqual(many.bounds, [2, 3, 100, 200]);
  assert.equal(many.limited, true);
});
test('thumbnail simplifies a whole huge line while retaining endpoints and source data', () => {
  const input = records([feature({ type: 'LineString', coordinates: Array.from({ length: 20000 }, (_, i) => [i, i]) })]);
  const before = structuredClone(input), result = thumbnailPreview(input);
  assert.ok(result.paths[0].points.length < 1000);
  assert.deepEqual(result.paths[0].points[0], [0, 0]);
  assert.deepEqual(result.paths[0].points.at(-1), [19999, 19999]);
  assert.equal(result.limited, true);
  assert.deepEqual(input, before);
});
test('thumbnail retains late multipart geometry, closed rings and full extent', () => {
  const ring = Array.from({ length: 20001 }, (_, i) => [Math.cos(i / 20000 * Math.PI * 2) * 10, Math.sin(i / 20000 * Math.PI * 2) * 10]);
  ring[ring.length - 1] = ring[0];
  const input = records([feature({ type: 'MultiPolygon', coordinates: [[ring], [[[100, 0], [101, 0], [101, 1], [100, 0]]]] }),
    feature({ type: 'MultiLineString', coordinates: Array.from({ length: 1500 }, (_, i) => [[i, 0], [i, 1]]) })]);
  const result = thumbnailPreview(input);
  assert.equal(result.paths.length, 1502);
  assert.equal(result.paths[0].closed, true);
  assert.deepEqual(result.paths[0].points[0], result.paths[0].points.at(-1));
  assert.ok(result.paths[0].points.length < 1000);
  assert.deepEqual(result.paths[1].points.at(-1), [100, 0]);
  assert.deepEqual(result.paths.at(-1).points, [[1499, 0], [1499, 1]]);
  assert.deepEqual(result.bounds, [-10, -10, 1499, 10]);
});
test('thumbnail simplification handles tiny, extreme and coincident ranges', () => {
  for (const coordinates of [[[0, 0], [1e-320, 1e-320]], [[-1e308, -1e308], [1e308, 1e308]], [[5, 5], [5, 5]]]) {
    const result = thumbnailPreview(records([feature({ type: 'LineString', coordinates })]));
    assert.deepEqual(result.paths[0].points, coordinates);
  }
});

test('attribute preview preserves source values without synthetic descriptions', () => {
  const input = records([feature(point, { list: [1, null, 'a'], nested: { enabled: true }, nothing: null }), feature(point)]);
  const result = summarizePreview(input);
  assert.deepEqual(result.rows[0].values, ['[1,null,"a"]', '{"enabled":true}', 'null']);
  assert.deepEqual(result.rows[1].values, ['', '', '']);
});
