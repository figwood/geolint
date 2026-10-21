import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoot } from '../src/geojson/normalize.ts';
import { inspectRecord } from '../src/inspection/inspect.ts';
import { summarize } from '../src/inspection/summary.ts';
import { runInspection } from '../src/inspection/run.ts';
import { RecoverableEngineError } from '../src/errors.ts';

// A narrow engine boundary double: these tests prove orchestration, NOT GEOS correctness.
const p={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,0]]]};
const info={name:'TEST boundary double',version:'0',wasmPackageVersion:'0',parameters:{validityFlags:0},coordinateSemantics:'planar-2d'};
const file = text => ({name:'fixture.geojson',size:Buffer.byteLength(text),arrayBuffer:async()=>new TextEncoder().encode(text).buffer});
const engine = overrides => ({info,check:()=>({valid:true,reason:'Valid Geometry',location:null}),dispose(){},...overrides});

test('partitions data statuses and propagates record engine errors',()=>{
  const normalized=normalizeRoot({type:'FeatureCollection',features:[p,p,{type:'Feature',geometry:null},{type:'Feature'},p].map((g,i)=>i===0||i===1||i===4?{type:'Feature',geometry:g}:g)});
  let calls=0;
  const e=engine({check(){ calls++; if(calls===3)throw new RecoverableEngineError(); return {valid:calls===1,reason:calls===1?'Valid Geometry':'Self-intersection',location:null}; }});
  const records=normalized.slice(0,4).map(r=>inspectRecord(r,e));
  assert.throws(()=>inspectRecord(normalized[4],e),{code:'ENGINE_ERROR'});
  assert.deepEqual(records.map(r=>r.status),['valid','invalid','skipped','parse_failed']);
  assert.deepEqual(summarize(records),{total:4,checked:2,valid:1,invalid:1,skipped:1,parseFailed:1,engineFailed:0});
  assert.equal(records[1].location,null);
  assert.equal(records[1].reason,'Self-intersection');
  assert.equal('geometry' in records[0],false);
});
test('fatal WASM traps propagate instead of pretending completion',()=>{
  assert.throws(()=>inspectRecord(normalizeRoot(p)[0],engine({check(){throw new WebAssembly.RuntimeError('out of bounds')}})),WebAssembly.RuntimeError);
});
test('completed run metadata and summary reflect the real input and release engine',async()=>{
  const messages=[]; let disposed=0;
  await runInspection(file(JSON.stringify(p)),'r1',m=>messages.push(m),async()=>engine({dispose(){disposed++}}));
  const result=messages.at(-1).result;
  assert.equal(messages.at(-1).type,'completed');
  assert.equal(result.run.fileName,'fixture.geojson');
  assert.equal(result.summary.valid,1);
  assert.equal(result.schemaVersion,'5.0');
  assert.equal(disposed,1);
});
test('attribute checks and counters are independent of geometry dispositions',async()=>{
  const {parseAttributeRuleFile}=await import('../src/attributes/config.ts');
  const {summarizeAttributes}=await import('../src/attributes/summary.ts');
  const rules=parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'pid',field:'PID',required:true}]}).rules;
  const input={type:'FeatureCollection',features:[{type:'Feature',geometry:p,properties:{}},{type:'Feature',geometry:null,properties:{PID:1}},{type:'Feature',geometry:p,properties:[]}]};
  const records=normalizeRoot(input).map(r=>inspectRecord(r,engine(),rules));
  assert.deepEqual(records.map(r=>r.status),['valid','skipped','valid']);
  assert.deepEqual(records.map(r=>r.attributeResult.status),['invalid','valid','failed']);
  assert.deepEqual(summarizeAttributes(records),{total:3,checked:2,valid:1,invalid:1,skipped:0,failed:1,disabled:0,issueCount:1});
  assert.ok(records.every(r=>!('attributes' in r)));
});
test('run snapshots configuration before asynchronous reads and rejects invalid rules before loading',async()=>{
  const config={kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'pid',field:'PID',required:true}]};
  const messages=[];const input=file(JSON.stringify({type:'Feature',geometry:p,properties:{}}));
  const read=input.arrayBuffer;input.arrayBuffer=async()=>{config.rules[0].required=false;return read();};
  await runInspection(input,'snapshot',m=>messages.push(m),async()=>engine(),config);
  assert.equal(messages.at(-1).result.attributeRules.rules[0].required,true);
  assert.equal(messages.at(-1).result.attributeSummary.invalid,1);
  let loads=0;const errors=[];
  await runInspection(input,'bad-config',m=>errors.push(m),async()=>{loads++;return engine();},{...config,schemaVersion:'9'});
  assert.equal(loads,0);assert.equal(errors.at(-1).code,'ATTRIBUTE_CONFIG_ERROR');assert.equal(errors.at(-1).type,'failed');
});
test('empty collection completes with all counters zero',async()=>{
  const messages=[];
  await runInspection(file('{"type":"FeatureCollection","features":[]}'),'empty',m=>messages.push(m),async()=>engine());
  assert.deepEqual(messages.at(-1).result.summary,{total:0,checked:0,valid:0,invalid:0,skipped:0,parseFailed:0,engineFailed:0});
});
for (const [name, input, code] of [['invalid JSON',file('{'),'INVALID_JSON'],['invalid UTF-8',{name:'bad.geojson',size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer},'READ_ERROR'],['read failure',{name:'bad',size:1,arrayBuffer:async()=>{throw new Error('secret data')}},'READ_ERROR'],['unsupported format',{name:'parcel.gpkg',size:2,arrayBuffer:async()=>new TextEncoder().encode('{}').buffer},'UNSUPPORTED_FORMAT']]) {
  test(`${name} yields file-level failure without loading engine`,async()=>{
    const messages=[]; let loads=0;
    await runInspection(input,'bad',m=>messages.push(m),async()=>{loads++;return engine()});
    assert.equal(loads,0);assert.equal(messages.at(-1).code,code);assert.equal(messages.at(-1).summary,null);
    assert.equal(messages.at(-1).message.includes('secret data'),false);
  });
}
test('engine initialization error remains a failure with no fake summary',async()=>{
  const messages=[];
  await runInspection(file(JSON.stringify(p)),'init',m=>messages.push(m),async()=>{throw new Error('internal data')});
  assert.equal(messages.at(-1).code,'ENGINE_INIT_ERROR');assert.equal(messages.at(-1).summary,null);
});
test('fatal error after partial work never emits completed or exports a partial report',async()=>{
  const messages=[];let disposed=0,calls=0;
  await runInspection(file(JSON.stringify({type:'FeatureCollection',features:[1,2].map(()=>({type:'Feature',geometry:p}))})),'fatal',m=>messages.push(m),async()=>engine({check(){if(++calls===2)throw new WebAssembly.RuntimeError('trap');return {valid:true,reason:'Valid Geometry',location:null}},dispose(){disposed++}}));
  assert.equal(messages.at(-1).code,'ENGINE_FATAL_ERROR');assert.equal(messages.at(-1).processed,1);assert.equal(disposed,1);
  assert.equal(messages.at(-1).partialRecords.length,1);
  assert.equal(messages.at(-1).partialRecords[0].status,'valid');
  assert.equal('geometry' in messages.at(-1).partialRecords[0],false);
  assert.equal(messages.some(m=>m.type==='completed'),false);
});
