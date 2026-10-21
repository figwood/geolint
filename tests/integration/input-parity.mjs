import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseInput } from '../../src/input/adapters.ts';
import { shapefile, shapeRecord, square } from '../helpers/shapefile.mjs';

test('QGIS OGR independently reads raw GeoJSON and SHP coordinates and ring grouping', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geolint input parity '));
  try {
    const hole = [[500002, 3000002], [500008, 3000002], [500008, 3000008], [500002, 3000008], [500002, 3000002]];
    const island = [[500004, 3000004], [500004, 3000006], [500006, 3000006], [500006, 3000004], [500004, 3000004]];
    const second = square.map(([x, y]) => [x + 30, y]);
    const crossed = [[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]];
    const repeated = [square[0], square[1], square[1], ...square.slice(2)];
    const fractional = square.map(([x, y]) => [-x - 0.125, y + 0.0625]);
    const degenerate = [[0, 0], [1, 0], [2, 0], [0, 0]];
    const polygon = { type: 'Polygon', coordinates: [square, hole] };
    const sources = [
      ['points.shp', shapefile([shapeRecord([], 0), shapeRecord([], 1), shapeRecord([], 0)], 1)],
      ['multipoints.shp', shapefile([shapeRecord([[[0, 0], [0, 0], [-1.125, 3000000.0625]]], 8)], 8)],
      ['lines.shp', shapefile([shapeRecord([crossed.slice(0, -1)], 3), shapeRecord([fractional, [[0, 0], [0, 0]]], 3)], 3)],
      ['types.geojson', new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features: [
        { type: 'Point', coordinates: [-1.125, 3000000.0625] },
        { type: 'MultiPoint', coordinates: [[0, 0], [0, 0], [1, 2]] },
        { type: 'LineString', coordinates: crossed.slice(0, -1) },
        { type: 'MultiLineString', coordinates: [fractional, [[0, 0], [0, 0]]] },
        { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [0, 0] }, { type: 'GeometryCollection', geometries: [polygon] }] },
      ].map(geometry => ({ type: 'Feature', geometry, properties: {} })) }))],
      ['rings.shp', shapefile([
        shapeRecord([], 0), shapeRecord([square]), shapeRecord([hole, second, square]),
        shapeRecord([hole, island, square]), shapeRecord([crossed]), shapeRecord([repeated]),
        shapeRecord([fractional]), shapeRecord([degenerate]), shapeRecord([], 0),
      ])],
      ['records.geojson', new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features: [
        { type: 'Feature', id: 'parcel', geometry: polygon, properties: {} },
        { type: 'Feature', id: 'parcel', geometry: null, properties: {} },
        { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [polygon.coordinates, [second]] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [crossed] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [repeated] }, properties: {} },
      ] }))],
      ['empty.geojson', new TextEncoder().encode('{"type":"FeatureCollection","features":[]}')],
    ];
    const manifest = { files: [] }, expected = [];
    for (const [file, bytes] of sources) {
      const path = join(directory, file);
      await writeFile(path, bytes, { mode: 0o600 });
      manifest.files.push({ file, path });
      expected.push({ file, records: parseInput(file, bytes) });
    }
    const manifestPath = join(directory, 'inputs.json'), reportPath = join(directory, 'reference.json');
    await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
    const result = spawnSync('bash', [new URL('../../validation/qgis/run.sh', import.meta.url).pathname, '--read-input', manifestPath, reportPath], { encoding: 'utf8', timeout: 45000 });
    assert.equal(result.status, 0, `Independent QGIS reader failed (missing QGIS is blocked, not passed): ${result.stderr}`);
    const { compareInputFiles } = await import('../../validation/compare-inputs.mjs');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    compareInputFiles(expected, report);
    assert.match(report.reader.name, /OGR/);
    assert.equal(expected.find(source => source.file === 'rings.shp').records.length, 9);
    assert.equal(expected.find(source => source.file === 'records.geojson').records.length, 5);
    assert.equal(expected.find(source => source.file === 'types.geojson').records.length, 5);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the independent reader refuses dimensional conversion and missing input files', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geolint input rejection '));
  try {
    const path = join(directory, 'dimension.geojson');
    await writeFile(path, JSON.stringify({ type: 'Polygon', coordinates: [square.map(([x, y]) => [x, y, 1])] }));
    for (const [name, source] of [['dimension', path], ['missing', join(directory, 'missing.shp')]]) {
      const manifestPath = join(directory, `${name}-inputs.json`), reportPath = join(directory, `${name}-reference.json`);
      await writeFile(manifestPath, JSON.stringify({ files: [{ file: name, path: source }] }));
      const result = spawnSync('bash', [new URL('../../validation/qgis/run.sh', import.meta.url).pathname, '--read-input', manifestPath, reportPath], { encoding: 'utf8', timeout: 45000 });
      assert.equal(result.status, 2, `${name}: unsupported or unreadable input must fail`);
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      assert.equal(report.status, 'failed');
      assert.deepEqual(report.files, []);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
