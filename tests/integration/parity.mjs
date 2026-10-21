import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createEngine } from '../../src/engine/geos.ts';

function reasonCategory(text){
  const value=text.toLowerCase();
  if(value.includes('self-intersection'))return 'self-intersection';
  if(value.includes('hole lies outside shell'))return 'hole-outside-shell';
  if(value.includes('too few points'))return 'too-few-points';
  if(value.includes('valid geometry'))return 'valid';
  throw new Error(`Unclassified reference reason: ${text}`);
}
test('WASM matches native validity, reason categories and valid error locations with identical version and flags',async()=>{
  const path=process.env.GEOS_BASELINE ?? new URL('../../.cache/native-baseline.json',import.meta.url);
  const baseline=JSON.parse(await readFile(path,'utf8'));
  const bytes=await readFile(new URL('../fixtures/manifest.json',import.meta.url));
  const manifest=JSON.parse(bytes.toString());
  assert.equal(baseline.manifestSha256,createHash('sha256').update(bytes).digest('hex'),'Regenerate baseline for changed fixtures');
  const engine=await createEngine();
  try{
    assert.equal(engine.info.version.split('-')[0],baseline.engineVersion.split('-')[0],'Same GEOS version is mandatory');
    assert.deepEqual(engine.info.parameters,baseline.parameters);
    assert.equal(engine.info.coordinateSemantics,baseline.coordinateSemantics);
    assert.equal(baseline.records.length,manifest.cases.length);
    for(const sample of manifest.cases){
      const native=baseline.records.find(r=>r.name===sample.name);assert.ok(native,sample.name);
      const wasm=engine.check(sample.geometry);
      assert.equal(wasm.valid,native.valid,sample.name);
      assert.equal(reasonCategory(wasm.reason),reasonCategory(native.reason),sample.name);
      if(native.location&&wasm.location){
        // Equivalent first-error locations are explicitly enumerated per fixture.
        for(const point of [native.location,wasm.location])assert.ok(sample.allowedErrorLocations?.some(([x,y])=>Math.abs(point.x-x)<=1e-9&&Math.abs(point.y-y)<=1e-9),sample.name);
      } else assert.deepEqual(wasm.location,native.location,sample.name);
    }
  }finally{engine.dispose()}
});
