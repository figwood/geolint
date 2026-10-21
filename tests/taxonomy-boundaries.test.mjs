import test from 'node:test';
import assert from 'node:assert/strict';
import * as catalog from '../src/diagnostics.ts';
import { normalizeRoot } from '../src/geojson/normalize.ts';
import { inspectRecord } from '../src/inspection/inspect.ts';
import { runInspection } from '../src/inspection/run.ts';
import { summarizeAttributes } from '../src/attributes/summary.ts';
import { parseAttributeRuleFile } from '../src/attributes/config.ts';
import { parseTopologyOptions } from '../src/topology/config.ts';
import { resolveTopologyCheckers } from '../src/topology/run.ts';
import { topologyCheckers } from '../src/topology/registry.ts';
import { RecoverableEngineError } from '../src/errors.ts';
import { buildJsonReport, buildCsvReport } from '../src/report/export.ts';
import { recordPage } from '../src/ui/results.ts';
import { createEngine } from '../src/engine/geos.ts';

const required = ['Rule-001','Rule-002','Rule-003','Rule-004','Rule-005','Rule-006','Rule-007','Rule-008','Rule-009','Rule-010','Rule-011'];
const attrs = ['Rule-018','Rule-019','Rule-020','Rule-021','Rule-022','Rule-023'];
const geometry = { type:'Point', coordinates:[1,2] };
const info = { name:'Boundary engine', version:'0', wasmPackageVersion:'0', parameters:{}, coordinateSemantics:'planar-2d' };
const config = parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'parcel-area',field:'area',required:true}]});
const engine = overrides => ({info,check:()=>({valid:true,reason:'Valid Geometry',location:null}),dispose(){},...overrides});
const file = input => { const bytes=new TextEncoder().encode(JSON.stringify(input)); return {name:'fixture.geojson',size:bytes.length,arrayBuffer:async()=>bytes.buffer}; };
async function completed(input, rules) {const messages=[];await runInspection(file(input),'test',m=>messages.push(m),async()=>engine(),rules);assert.equal(messages.at(-1).type,'completed');return messages.at(-1).result;}

test('public taxonomy separates required checks, optional groups and execution errors',()=>{
  assert.deepEqual(catalog.requiredRuleIds,required);
  assert.deepEqual(catalog.attributeRuleIds,attrs);
  for(const [code,ruleIds] of [['INVALID_FEATURE',['Rule-002']],['GEOMETRY_INVALID',['Rule-011']],['INVALID_FEATURE_ID',['Rule-023']],['ATTRIBUTE_CONFIG_ERROR',['Rule-022']],['TOPOLOGY_DUPLICATE_GEOMETRY',['Rule-012']],['ENGINE_ERROR',[]],['TOPOLOGY_CANCELLED',[]]]) assert.deepEqual(catalog.ruleIdsForReason(code),ruleIds);
  assert.deepEqual(catalog.ruleIdsForReason('VALID'),['Rule-011']);
  assert.deepEqual(catalog.ruleIdsForReason('TOPOLOGY_NOT_APPLICABLE'),[]);
  assert.equal(catalog.checkRules.filter(r=>r.required).length,11);
  assert.ok(catalog.reasonRules.every(e=>e.ruleIds.every(id=>catalog.checkRules.some(r=>r.id===id))));
  assert.throws(()=>resolveTopologyCheckers(parseTopologyOptions({rules:[{id:'must-not-have-duplicates'}]}),topologyCheckers),{code:'TOPOLOGY_CONFIG_ERROR'});
  assert.equal(resolveTopologyCheckers(parseTopologyOptions({rules:[{id:'Rule-012'}]}),topologyCheckers).length,1);
});

test('invalid IDs silently fall back unless attribute checks are enabled',()=>{
  const record=normalizeRoot({type:'Feature',id:{bad:true},geometry,properties:{area:1}})[0];
  assert.deepEqual(record.warnings,[]);
  const disabled=inspectRecord(record,engine());
  assert.equal(disabled.featureIdType,'invalid');assert.equal(disabled.featureId,null);
  assert.deepEqual(disabled.attributeResult.identityIssues,[]);
  const enabled=inspectRecord(record,engine(),config.rules);
  assert.equal(enabled.status,'valid');assert.equal(enabled.attributeResult.status,'invalid');
  assert.deepEqual(enabled.attributeResult.identityIssues.map(i=>[i.ruleId,i.reasonCode]),[['Rule-023','INVALID_FEATURE_ID']]);
  assert.equal('configuredRuleId' in enabled.attributeResult.identityIssues[0],false);
});

test('identity issues coexist with failed or skipped sources and count once',()=>{
  const normalized=normalizeRoot({type:'Feature',id:[],geometry,properties:[]})[0];
  const failed=inspectRecord(normalized,engine(),config.rules);
  const skipped=inspectRecord({...normalized,attributes:{status:'skipped',reasonCode:'ATTRIBUTES_UNAVAILABLE',reason:'Unavailable'}},engine(),config.rules);
  assert.deepEqual([failed,skipped].map(r=>r.attributeResult.status),['failed','skipped']);
  assert.deepEqual([failed,skipped].map(r=>r.attributeResult.identityIssues.length),[1,1]);
  assert.deepEqual(summarizeAttributes([failed,skipped]),{total:2,checked:0,valid:0,invalid:0,skipped:1,failed:1,disabled:0,issueCount:2});
});

test('recoverable record engine failure terminates the run and releases the engine',async()=>{
  const messages=[];let checks=0,disposals=0;
  await runInspection(file({type:'FeatureCollection',features:[0,1,2].map(()=>({type:'Feature',geometry}))}),'failure',m=>messages.push(m),async()=>engine({check(){if(++checks===3)throw new RecoverableEngineError();return {valid:true,reason:'Valid Geometry',location:null};},dispose(){disposals++;}}));
  assert.equal(messages.at(-1).type,'failed');assert.equal(messages.at(-1).code,'ENGINE_ERROR');assert.equal(messages.at(-1).processed,2);assert.equal(disposals,1);assert.equal(messages.some(m=>m.type==='completed'),false);
});

test('cooperative cancellation after engine loading retains its reason code and releases the engine',async()=>{
  const controller=new AbortController(),messages=[];let disposed=0;
  await runInspection(file(geometry),'cancel',m=>messages.push(m),async()=>{controller.abort();return engine({dispose(){disposed++;}});},undefined,undefined,controller.signal);
  assert.equal(messages.at(-1).type,'cancelled');assert.equal(messages.at(-1).code,'TOPOLOGY_CANCELLED');assert.equal(Object.hasOwn(messages.at(-1),'errorId'),false);assert.equal(messages.at(-1).summary,null);assert.equal(disposed,1);
});

test('5.0 exports identity and source issues without fabricated field references',async()=>{
  const run=await completed({type:'Feature',id:[],geometry,properties:[]},config);
  assert.equal(run.schemaVersion,'5.0');assert.deepEqual(run.ruleSelection,{required,optional:attrs});
  const json=JSON.parse(buildJsonReport(run)),csv=buildCsvReport(run);
  assert.deepEqual(json.ruleSelection,run.ruleSelection);
  assert.deepEqual(json.issues.map(i=>i.ruleIds[0]).sort(),['Rule-021','Rule-023']);
  assert.ok(json.issues.every(i=>!Object.hasOwn(i,'configuredRuleId')));
  assert.match(csv,/Rule-021/);assert.match(csv,/Rule-023/);
});

test('5.0 exporter rejects forged selection, identity and execution outcomes',async()=>{
  const run=await completed({type:'Feature',id:[],geometry,properties:{}},config);
  const mutations=[r=>r.schemaVersion='3.0',r=>r.ruleSelection.required.reverse(),r=>r.ruleSelection.optional.pop(),r=>r.records[0].attributeResult.identityIssues=[],r=>r.records[0].attributeResult.identityIssues.push({...r.records[0].attributeResult.identityIssues[0]}),r=>r.records[0].warnings.push('ENGINE_ERROR'),r=>r.records[0].reasonCode='ENGINE_ERROR',r=>r.summary.engineFailed=1];
  for(const mutate of mutations){const copy=structuredClone(run);mutate(copy);assert.throws(()=>buildJsonReport(copy));assert.throws(()=>buildCsvReport(copy));}
});

test('empty datasets retain enabled attribute selection and complete required selection',async()=>{
  const run=await completed({type:'FeatureCollection',features:[]},config);
  assert.deepEqual(run.ruleSelection,{required,optional:attrs});assert.deepEqual(JSON.parse(buildJsonReport(run)).issues,[]);
});

for (const phase of ['reading','parsing','loading-engine','checking']) {
  test(`cancellation at ${phase} suppresses completion and releases allocated resources`,async()=>{
    const controller=new AbortController(),messages=[];let disposed=0,loaded=0;
    await runInspection(file(geometry),'cancel-phase',m=>{messages.push(m);if(m.type==='progress'&&m.phase===phase)controller.abort();},async()=>{loaded++;return engine({dispose(){disposed++;}});},undefined,undefined,controller.signal);
    assert.deepEqual(messages.filter(m=>m.type!=='progress').map(m=>[m.type,m.code,m.summary]),[['cancelled','TOPOLOGY_CANCELLED',null]]);
    assert.equal(disposed,loaded);
  });
}

test('cancellation while reading rejects late bytes before loading an engine',async()=>{
  const controller=new AbortController(),messages=[];let resolveRead,loaded=0;
  const input={...file(geometry),arrayBuffer:()=>new Promise(resolve=>{resolveRead=resolve;})};
  const running=runInspection(input,'late-read',m=>messages.push(m),async()=>{loaded++;return engine();},undefined,undefined,controller.signal);
  controller.abort();resolveRead(new TextEncoder().encode(JSON.stringify(geometry)).buffer);await running;
  assert.equal(loaded,0);assert.equal(messages.at(-1).type,'cancelled');
});

test('cancellation between dataset completion and run completion cannot publish a report',async()=>{
  const controller=new AbortController(),messages=[];let disposed=0;
  await runInspection(file(geometry),'completion-race',m=>messages.push(m),async()=>engine({check(){queueMicrotask(()=>queueMicrotask(()=>controller.abort()));return {valid:true,reason:'Valid Geometry',location:null};},dispose(){disposed++;}}),undefined,undefined,controller.signal);
  assert.equal(controller.signal.aborted,true);assert.equal(messages.at(-1).type,'cancelled');assert.equal(messages.at(-1).processed,1);assert.equal(disposed,1);
});

test('empty and parse-failed geometries never reach GEOS, while a Point does',async()=>{
  const messages=[];let checks=0;
  await runInspection(file({type:'FeatureCollection',features:[null,{type:'Point',coordinates:[]},{type:'Point',coordinates:[1,2,3]},{type:'LineString',coordinates:[[0,0]]},geometry].map(geometry=>({type:'Feature',geometry}))}),'applicable',m=>messages.push(m),async()=>engine({check(g){assert.equal(g.type,'Point');checks++;return {valid:true,reason:'Valid Geometry',location:null};}}));
  assert.equal(checks,1);assert.deepEqual(messages.at(-1).result.records.map(r=>r.status),['skipped','skipped','skipped','parse_failed','valid']);
  assert.deepEqual(messages.at(-1).result.ruleSelection.required,required);
});

test('5.0 exporter rejects forged feature identity metadata',async()=>{
  const run=await completed({type:'Feature',id:'original',geometry,properties:{area:1}},config);
  for(const mutate of [r=>r.records[0].featureIdType='obsolete',r=>r.records[0].featureId=[],r=>r.records[0].featureIdType='number',r=>{r.records[0].featureIdType='missing';r.records[0].featureId='original';}]){
    const copy=structuredClone(run);mutate(copy);assert.throws(()=>buildJsonReport(copy));
  }
});

test('field issues cannot claim constraints absent from the configured rule',async()=>{
  const run=await completed({type:'Feature',geometry,properties:{}},config);
  run.records[0].attributeResult.issues=[{ruleId:'Rule-020',reasonCode:'ATTRIBUTE_VALUE',configuredRuleId:'parcel-area',field:'area',constraint:'maximum',expected:'Value must be <= 100',reason:'Field area: Value must be <= 100.'}];
  assert.throws(()=>buildJsonReport(run));assert.throws(()=>buildCsvReport(run));
});

test('field issue expectations must match the saved constraint value',async()=>{
  const rules=parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'bounded-area',field:'area',type:'double',constraints:{maximum:100}}]});
  const run=await completed({type:'Feature',geometry,properties:{area:200}},rules);
  run.records[0].attributeResult.issues[0].expected='Value must be <= 1';
  assert.throws(()=>buildJsonReport(run));
});

test('attribute problem filtering retains identity issues on failed sources',()=>{
  const record=inspectRecord(normalizeRoot({type:'Feature',id:[],geometry,properties:[]})[0],engine(),config.rules);
  assert.equal(recordPage([record],'attribute-issues',0).records.length,1);
  assert.equal(recordPage([record],'attribute-invalid',0).records.length,0);
});

for(const phase of ['topology-preparing','topology-checking']) {
  test(`cancellation during ${phase} releases real GEOS resources`,async()=>{
    const controller=new AbortController(),messages=[];let engineDisposals=0,sessionDisposals=0;
    await runInspection(file({type:'FeatureCollection',features:[0,1].map(id=>({type:'Feature',id,geometry}))}),'cancel-topology',m=>{messages.push(m);if(m.type==='progress'&&m.phase===phase)controller.abort();},async()=>{
      const e=await createEngine();const dispose=e.dispose.bind(e),createSession=e.createTopologySession.bind(e);
      e.dispose=()=>{engineDisposals++;dispose();};
      e.createTopologySession=()=>{const session=createSession(),disposeSession=session.dispose.bind(session);session.dispose=()=>{sessionDisposals++;disposeSession();};return session;};
      return e;
    },undefined,{rules:[{id:'Rule-012'}]},controller.signal);
    assert.equal(messages.at(-1).type,'cancelled');assert.equal(Object.hasOwn(messages.at(-1),'errorId'),false);assert.equal(messages.at(-1).processed,2);
    assert.equal(engineDisposals,1);assert.equal(sessionDisposals,phase==='topology-checking'?1:0);
    assert.equal(messages.filter(m=>m.type!=='progress').length,1);
  });
}
