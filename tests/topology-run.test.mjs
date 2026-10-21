import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../src/engine/geos.ts';
import {normalizeRoot} from '../src/geojson/normalize.ts';
import {inspectRecord} from '../src/inspection/inspect.ts';
import {parseTopologyOptions} from '../src/topology/config.ts';
import {topologyProbes} from './helpers/topology-probes.mjs';

export const square=(x=0)=>({type:'Polygon',coordinates:[[[x,0],[x+2,0],[x+2,2],[x,2],[x,0]]]});
const records=geometries=>normalizeRoot({type:'FeatureCollection',features:geometries.map(geometry=>({type:'Feature',id:'duplicate',geometry,properties:{secret:'private'}}))});
async function run(geometries,options,controls,checkers=topologyProbes){
  const {runTopology}=await import('../src/topology/run.ts');const engine=await createEngine();
  try {const normalized=records(geometries);return await runTopology(normalized,normalized.map(r=>inspectRecord(r,engine)),engine,parseTopologyOptions(options),checkers,controls);}
  finally{engine.dispose();}
}
test('disabled topology never loads session and unknown or unavailable rules fail explicitly',async()=>{
  const {runTopology}=await import('../src/topology/run.ts');
  const result=await runTopology([],[],{},parseTopologyOptions(),[]);
  assert.equal(result.status,'disabled');assert.equal(result.summary.total,0);
  await assert.rejects(runTopology([],[],{},parseTopologyOptions({rules:[{id:'missing'}]}),[]),{code:'TOPOLOGY_CONFIG_ERROR'});
  await assert.rejects(runTopology([],[],{},parseTopologyOptions({rules:[{id:'probe-equals'}]}),topologyProbes),{code:'TOPOLOGY_ENGINE_UNAVAILABLE'});
});
test('rules retain distinct pair issues and duplicate IDs while excluding invalid inputs',async()=>{
  const bad={type:'Polygon',coordinates:[[[0,0],[2,2],[0,2],[2,0],[0,0]]]};
  const result=await run([square(),square(),square(1),bad,{type:'Point',coordinates:[10,10]},null],{rules:[{id:'probe-equals'},{id:'probe-area'}]});
  assert.equal(result.status,'completed');
  assert.equal(result.rules[0].issues.length,1);assert.equal(result.rules[1].issues.length,3);
  assert.equal(result.rules[1].coverage,'partial');
  assert.equal(result.rules[1].exclusions.find(e=>e.recordKey==='feature:4').affectsCoverage,false);
  assert.deepEqual(result.rules[0].issues[0].participants.map(p=>p.recordKey),['feature:0','feature:1']);
  assert.equal(JSON.stringify(result).includes('private'),false);
  assert.equal(new Set(result.rules.flatMap(r=>r.issues.map(i=>i.issueId))).size,4);
});
test('zero comparisons are skipped and never count as topology passing',async()=>{
  for(const geometries of [[],[square()],[square(),square(10)],[{type:'Point',coordinates:[1,1]}]]){
    const result=await run(geometries,{rules:[{id:'probe-area'}]});
    assert.equal(result.rules[0].status,'skipped');assert.equal(result.summary.passed,0);
  }
  const touching=await run([square(),square(2)],{rules:[{id:'probe-area'}]});
  assert.equal(touching.rules[0].status,'passed');assert.equal(touching.rules[0].checkCount,1);
});
test('limits are cumulative across rules and enforced before allocating retained geometry',async()=>{
  await assert.rejects(run([square(),square()],{rules:[{id:'probe-equals'},{id:'probe-area'}],limits:{candidates:1}}),{code:'TOPOLOGY_LIMIT_EXCEEDED'});
  await assert.rejects(run([square(),square(),square()],{rules:[{id:'probe-area'}],limits:{issues:2}}),{code:'TOPOLOGY_LIMIT_EXCEEDED'});
  for(const limits of [{features:1},{positions:9}]) await assert.rejects(run([square(),square()],{rules:[{id:'probe-area'}],limits}),{code:'TOPOLOGY_LIMIT_EXCEEDED'});
});
test('abort and time budgets stop topology and release the session',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(run([square(),square()],{rules:[{id:'probe-area'}]},{signal:controller.signal}),{code:'TOPOLOGY_CANCELLED'});
  let now=0;
  await assert.rejects(run([square(),square()],{rules:[{id:'probe-area'}],limits:{durationMs:1}},{now:()=>now++}),{code:'TOPOLOGY_TIMEOUT'});
  // Subsequent real engine initialization proves no active context was leaked.
  assert.equal((await run([square(),square()],{rules:[{id:'probe-area'}]})).summary.issues,1);
});
