import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createEngine} from '../src/engine/geos.ts';
import {normalizeRoot} from '../src/geojson/normalize.ts';
import {inspectDataset} from '../src/inspection/dataset.ts';
import {runInspection} from '../src/inspection/run.ts';
import {emptyAttributeRuleFile} from '../src/attributes/config.ts';
import {buildJsonReport,buildCsvReport} from '../src/report/export.ts';

const config={rules:[{id:'Rule-012'}]};
const fixture=JSON.parse(await readFile(new URL('./fixtures/topology/duplicates.json',import.meta.url),'utf8'));
const root=geometries=>({type:'FeatureCollection',features:geometries.map(geometry=>({type:'Feature',id:'same-id',properties:{secret:'PRIVATE_VALUE'},geometry}))});

test('registered duplicate rule detects topological equality and preserves eligibility on real GEOS',async()=>{
  const engine=await createEngine();
  try{
    for(const sample of fixture.cases){
      let result;
      await assert.doesNotReject(async()=>{result=await inspectDataset(normalizeRoot(root(sample.geometries)),engine,emptyAttributeRuleFile(),{topology:config});},sample.name);
      const rule=result.topology.rules[0],want=sample.expected;
      assert.equal(rule.participantCount,want.participants,sample.name);
      assert.equal(rule.coverage,want.coverage,sample.name);
      assert.equal(rule.checkCount,want.comparisons,sample.name);
      assert.equal(rule.status,want.pairs.length?'violated':want.comparisons?'passed':'skipped',sample.name);
      assert.deepEqual(rule.issues.map(i=>i.participants.map(p=>p.featureIndex)),want.pairs,sample.name);
      assert.ok(rule.issues.every(i=>i.reasonCode==='TOPOLOGY_DUPLICATE_GEOMETRY'&&i.location===null));
    }
  }finally{engine.dispose();}
});

test('file inspection accepts the product rule and exports complete duplicate reports without private values',async()=>{
  const bytes=new TextEncoder().encode(JSON.stringify(root(fixture.cases[0].geometries)));
  const messages=[];
  await runInspection({name:'duplicates.geojson',size:bytes.length,arrayBuffer:async()=>bytes.buffer},'run',m=>messages.push(m),createEngine,undefined,config);
  assert.equal(messages.at(-1).type,'completed');
  const run=messages.at(-1).result;
  const report=JSON.parse(buildJsonReport(run));
  assert.equal(report.topology.summary.issues,3);
  assert.equal(report.issues.length,3);
  assert.ok(report.issues.every(i=>!Object.hasOwn(i,'domain')&&i.participants.length===2));
  assert.equal(buildCsvReport(run).split('\r\n').length,5);
  assert.equal(JSON.stringify(report).includes('PRIVATE_VALUE'),false);
  assert.equal(JSON.stringify(report).includes('"coordinates":'),false);
});

test('duplicate rules stay opt-in and enforce failure and cancellation instead of completing',async()=>{
  const engine=await createEngine(),records=normalizeRoot(root(fixture.cases[0].geometries));
  try{
    assert.equal((await inspectDataset(records,engine,emptyAttributeRuleFile())).topology.status,'disabled');
    await assert.rejects(inspectDataset(records,engine,emptyAttributeRuleFile(),{topology:{...config,limits:{issues:1}}}),{code:'TOPOLOGY_LIMIT_EXCEEDED'});
    const controller=new AbortController();
    await assert.rejects(inspectDataset(records,engine,emptyAttributeRuleFile(),{topology:config,signal:controller.signal,onProgress:p=>{if(p.phase==='topology-checking')controller.abort();}}),{code:'TOPOLOGY_CANCELLED'});
    await assert.rejects(inspectDataset(records,engine,emptyAttributeRuleFile(),{topology:{rules:[{id:'unknown'}]}}),{code:'TOPOLOGY_CONFIG_ERROR'});
    await assert.rejects(inspectDataset(records,engine,emptyAttributeRuleFile(),{topology:{rules:[{id:config.rules[0].id,parameters:{tolerance:1}}]}}),{code:'TOPOLOGY_CONFIG_ERROR'});
  }finally{engine.dispose();}
});
