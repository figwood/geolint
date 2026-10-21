import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../src/engine/geos.ts';
import {normalizeRoot} from '../src/geojson/normalize.ts';
import {inspectDataset} from '../src/inspection/dataset.ts';
import {emptyAttributeRuleFile} from '../src/attributes/config.ts';
import {inspect,line,polygon} from './helpers/single-layer.mjs';
test('feature scheduling checks a single record without bbox candidates',async()=>{
  const checker={id:'feature-probe',geometryTypes:['LineString'],candidateMode:'feature',parseParameters:()=>({}),checkFeature:()=>null};
  const r=await inspect([line([[0,0],[1,0]])],[checker.id],{checkers:[checker]});
  assert.equal(r.topology.rules[0].checkCount,1);assert.equal(r.topology.rules[0].candidateCount,0);assert.equal(r.topology.rules[0].status,'passed');
});
test('dataset scheduler preserves multiple findings for the same source and cancels at yields',async()=>{
  const checker={id:'dataset-probe',geometryTypes:['LineString'],candidateMode:'dataset',parseParameters:()=>({}),async checkDataset(c){
    for(const x of [0,1]) {c.checked();c.emit({reasonCode:'probe',reason:'endpoint',location:{x,y:0}},[c.records[0].recordKey]);await c.controls.yield();}
  }};
  const r=await inspect([line([[0,0],[1,0]])],[checker.id],{checkers:[checker]});
  assert.equal(r.topology.rules[0].issues.length,2);assert.equal(r.topology.rules[0].issues[0].scope,'dataset');
  const controller=new AbortController();
  const cancelling={...checker,async checkDataset(c){controller.abort();await c.controls.yield();}};
  await assert.rejects(inspect([line([[0,0],[1,0]])],[checker.id],{checkers:[cancelling],signal:controller.signal}),{code:'TOPOLOGY_CANCELLED'});
});
test('multipart checks actual part counts including invalid normalized polygons',async()=>{
  const bad=[[[0,0],[2,2],[0,2],[2,0],[0,0]]];
  const r=await inspect([{type:'MultiPoint',coordinates:[[0,0]]},{type:'MultiPoint',coordinates:[[0,0],[1,1]]},{type:'MultiPolygon',coordinates:[bad,bad]}],['Rule-013']);
  assert.equal(r.topology.rules[0].checkCount,3);assert.equal(r.topology.rules[0].coverage,'complete');
  assert.deepEqual(r.topology.rules[0].issues.map(i=>i.participants[0].featureIndex),[1,2]);
});
test('endpoint rules count part endpoints rather than unique features or interior touches',async()=>{
  const cases=[
    {g:[line([[0,0],[1,0]])],d:2,p:0},
    {g:[line([[0,0],[1,0]]),line([[1,0],[2,0]])],d:2,p:1},
    {g:[line([[0,0],[1,0],[0,0]])],d:0,p:1},
    {g:[{type:'MultiLineString',coordinates:[[[0,0],[1,0]],[[1,0],[2,0]]]}],d:2,p:1},
    {g:[line([[0,0],[1,0]]),line([[1,0],[2,0]]),line([[1,0],[1,1]])],d:3,p:0},
    {g:[line([[0,0],[2,0]]),line([[1,0],[1,1]])],d:4,p:0},
    {g:[line([[-0,0],[1,0]]),line([[0,0],[1,0]])],d:0,p:2},
  ];
  for(const c of cases){const r=await inspect(c.g,['Rule-014','Rule-015']);assert.deepEqual(r.topology.rules.map(r=>r.issues.length),[c.d,c.p]);assert.ok(r.topology.rules.every(r=>r.status!=='skipped'));}
});
test('shared work budgets are reserved before invoking the next GEOS operation',async()=>{
  let calls=0;
  const checker={id:'budget-probe',geometryTypes:['LineString'],candidateMode:'bbox-intersects',parseParameters:()=>({}),check(){calls++;return null;}};
  await assert.rejects(inspect([line([[0,0],[1,0]]),line([[0,0],[1,0]]),line([[0,0],[1,0]])],[checker.id],{checkers:[checker],topology:{limits:{candidates:1}}}),{code:'TOPOLOGY_LIMIT_EXCEEDED'});
  assert.equal(calls,1);
});
test('a gap aggregation cannot start after preceding rules exhaust shared work budget',async()=>{
  const engine=await createEngine();let aggregates=0;
  const create=engine.createTopologySession.bind(engine);
  engine.createTopologySession=()=>{const session=create();return {...session,async polygonGaps(){aggregates++;return [];}};};
  try{
    const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]};
    const input=normalizeRoot(geometry);
    await assert.rejects(inspectDataset(input,engine,emptyAttributeRuleFile(),{topology:{rules:[{id:'Rule-013'},{id:'Rule-017'}],limits:{candidates:1}}}),{code:'TOPOLOGY_LIMIT_EXCEEDED'});
    assert.equal(aggregates,0);
  }finally{engine.dispose();}
});
