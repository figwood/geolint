import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { dbf } from './helpers/dbf.mjs';
import { shapefile, shapeRecord } from './helpers/shapefile.mjs';

test('preview Worker parses supported files, separates thumbnail requests and accepts files above 10 MiB', async () => {
  const oldMessage = globalThis.onmessage, oldPost = globalThis.postMessage;
  let resolve;
  globalThis.postMessage = message => resolve(message);
  const receive = request => new Promise(done => { resolve = done; globalThis.onmessage({ data: request }); });
  try {
    await import('../src/worker/preview.worker.ts');
    const point = JSON.stringify({ type: 'Point', coordinates: [2, 3] });
    const shp = shapefile([shapeRecord([[[0,0],[4,0],[4,4],[0,0]]])]);
    for (const [name, bytes] of [['point.geojson', point], ['polygon.shp', shp], ['polygon.zip', zipSync({ 'polygon.shp': shp })]]) {
      const message = await receive({ type: 'load', file: new File([bytes], name) });
      assert.equal(message.type, 'summary');
      assert.equal(message.result.total, 1);
      assert.equal(message.result.rows[0].attributeStatus, 'skipped');
      const geometry = await receive({ type: 'thumbnail', requestId: 7 });
      assert.equal(geometry.requestId, 7);
      assert.equal(geometry.result.drawnRecords, 1);
    }
    const bundle = zipSync({ 'polygon.shp': shp, 'polygon.dbf': dbf([{ name: 'NAME', type: 'C', length: 8 }], [{ NAME: 'sample' }]) });
    const attributes = await receive({ type: 'load', file: new File([bundle], 'attributes.zip') });
    assert.deepEqual(attributes.result.fields, ['NAME']);
    assert.deepEqual(attributes.result.rows[0].values, ['sample']);
    assert.match((await receive({ type: 'load', file: new File(['{broken'], 'bad.json') })).message, /INVALID_JSON/);
    const file = new File([point, ' '.repeat(11 * 1024 * 1024)], 'big.json');
    assert.ok(file.size > 10 * 1024 * 1024);
    const largeFile = await receive({ type: 'load', file });
    assert.equal(largeFile.type, 'summary');
    assert.equal(largeFile.result.total, 1);
    assert.equal((await receive({ type: 'thumbnail', requestId: 8 })).result.drawnRecords, 1);
  } finally {
    globalThis.onmessage = oldMessage; globalThis.postMessage = oldPost;
  }
});
