import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../src/engine/geos.ts';
import {normalizeRoot} from '../src/geojson/normalize.ts';
import {emptyAttributeRuleFile} from '../src/attributes/config.ts';
import {runInspection} from '../src/inspection/run.ts';
import {topologyProbes} from './helpers/topology-probes.mjs';
const p={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]};
const normalized=()=>normalizeRoot({type:'FeatureCollection',features:[0,1].map(()=>({type:'Feature',geometry:p,properties:{}}))});
test('dataset runs independent topology stages using the actual engine',async()=>{
  const {inspectDataset}=await import('../src/inspection/dataset.ts');const engine=await createEngine();
  try{
    const progress=[];
    const result=await inspectDataset(normalized(),engine,emptyAttributeRuleFile(),{topology:{rules:[{id:'probe-area'}]},checkers:topologyProbes,onProgress:p=>progress.push(p)});
    assert.equal(result.summary.valid,2);assert.equal(result.topology.summary.issues,1);
    assert.ok(progress.some(p=>p.phase==='topology-checking'&&p.processed===2));
    assert.equal(result.records[0].status,'valid');
  }finally{engine.dispose();}
});
test('dataset failures preserve inspected records without completed topology',async()=>{
  const {inspectDataset}=await import('../src/inspection/dataset.ts');const engine=await createEngine();
  try{
    await assert.rejects(inspectDataset(normalized(),engine,emptyAttributeRuleFile(),{topology:{rules:[{id:'probe-area'}],limits:{features:1}},checkers:topologyProbes}),e=>e.code==='TOPOLOGY_LIMIT_EXCEEDED'&&e.partialRecords.length===2);
    const abort=new AbortController();abort.abort();
    await assert.rejects(inspectDataset(normalized(),engine,emptyAttributeRuleFile(),{signal:abort.signal}),e=>e.code==='TOPOLOGY_CANCELLED'&&e.partialRecords.length===0);
  }finally{engine.dispose();}
});
test('browser run uses V5 disabled topology and validates unsupported options before file reads',async()=>{
  const text=JSON.stringify(p);let reads=0;const messages=[];
  const file={name:'x.geojson',size:text.length,arrayBuffer:async()=>{reads++;return new TextEncoder().encode(text).buffer;}};
  await runInspection(file,'x',m=>messages.push(m),()=>createEngine());
  assert.equal(messages.at(-1).result.schemaVersion,'5.0');assert.equal(messages.at(-1).result.topology.status,'disabled');
  const failures=[];
  await runInspection(file,'y',m=>failures.push(m),()=>createEngine(),undefined,{rules:[{id:'probe-area'}]});
  assert.equal(reads,1);assert.equal(failures.at(-1).type,'failed');assert.equal(failures.at(-1).code,'TOPOLOGY_CONFIG_ERROR');
});
test('abort prevents completion for empty data and immediately after geometry checking',async()=>{
  const {inspectDataset}=await import('../src/inspection/dataset.ts');const engine=await createEngine();
  try{
    const empty=new AbortController();empty.abort();
    await assert.rejects(inspectDataset([],engine,emptyAttributeRuleFile(),{signal:empty.signal}),{code:'TOPOLOGY_CANCELLED'});
    const after=new AbortController();
    await assert.rejects(inspectDataset(normalized(),engine,emptyAttributeRuleFile(),{signal:after.signal,onProgress:p=>{if(p.processed===2)after.abort();}}),{code:'TOPOLOGY_CANCELLED'});
  }finally{engine.dispose();}
});
