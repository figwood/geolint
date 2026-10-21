import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEngine } from '../../src/engine/geos.ts';
import { runInspection } from '../../src/inspection/run.ts';
import { parseInput } from '../../src/input/adapters.ts';
import { summarizePreview, thumbnailPreview } from '../../src/preview/data.ts';

test('real files above 10 MiB complete preview and inspection with GEOS WASM', { timeout: 60000 }, async () => {
  const inputs = [
    { type: 'LineString', coordinates: Array.from({ length: 400000 }, (_, i) => [i / 1000, Math.sin(i / 1000)]) },
    { type: 'FeatureCollection', features: Array.from({ length: 100000 }, (_, i) => ({
      type: 'Feature', id: i, properties: { name: `record-${i}` }, geometry: { type: 'Point', coordinates: [i, i] },
    })) },
  ];
  for (const input of inputs) {
    const file = new File([JSON.stringify(input)], 'large.geojson');
    assert.ok(file.size > 10 * 1024 * 1024);
    const expected = input.type === 'FeatureCollection' ? input.features.length : 1;
    const normalized = parseInput(file.name, new Uint8Array(await file.arrayBuffer()));
    assert.equal(summarizePreview(normalized).total, expected);
    assert.equal(thumbnailPreview(normalized).drawnRecords, expected);
    let terminal;
    const topology = input.type === 'LineString' ? { rules: [{ id: 'Rule-025' }] } : undefined;
    await runInspection(file, 'large', message => { if (message.type !== 'progress') terminal = message; }, createEngine, undefined, topology);
    assert.equal(terminal.type, 'completed', JSON.stringify(terminal));
    assert.equal(terminal.result.run.fileBytes, file.size);
    assert.equal(terminal.result.summary.valid, expected);
    assert.equal(terminal.result.summary.total, expected);
    if (topology) {
      assert.equal(terminal.result.topology.status, 'completed');
      assert.equal(terminal.result.topology.rules[0].checkCount, input.coordinates.length);
      assert.equal(terminal.result.topology.rules[0].coverage, 'complete');
      assert.equal(terminal.result.topology.rules[0].status, 'passed');
    }
  }
});

test('real GEOS WASM satisfies every synthetic validity expectation and repeats deterministically',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../fixtures/manifest.json',import.meta.url),'utf8'));
  const engine=await createEngine();
  try{
    assert.equal(engine.info.version.split('-')[0],manifest.intendedReferenceVersion);
    for(const sample of manifest.cases){
      const result=engine.check(sample.geometry);
      assert.equal(result.valid,sample.expectedValid,sample.name);
      assert.deepEqual(engine.check(sample.geometry),result,sample.name);
      assert.ok(result.reason.length>0);
      if(result.location)assert.ok(Number.isFinite(result.location.x)&&Number.isFinite(result.location.y));
    }
  }finally{engine.dispose()}
});
