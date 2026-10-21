import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../src/engine/geos.ts';
import {normalizeRoot} from '../src/geojson/normalize.ts';
import {inspectDataset} from '../src/inspection/dataset.ts';
import {emptyAttributeRuleFile} from '../src/attributes/config.ts';
import {buildJsonReport,buildCsvReport} from '../src/report/export.ts';
const p={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]};
async function report(){
  const engine=await createEngine();
  try{
    const input=normalizeRoot({type:'FeatureCollection',features:[0,1,2].map(id=>({type:'Feature',id:id===0?'=evil,"id"':id,geometry:p,properties:{secret:'PRIVATE_VALUE'}}))});
    const attributeRules=emptyAttributeRuleFile();const result=await inspectDataset(input,engine,attributeRules,{topology:{rules:[{id:'Rule-012'}]}});
    return {schemaVersion:'5.0',run:{fileName:'x.geojson',fileBytes:200,completedAt:'2026-10-10T00:00:00Z',status:'completed'},engine:engine.info,attributeRules,...result};
  }finally{engine.dispose();}
}
test('V5 exports one row per topology issue with multiple participants and no original geometry',async()=>{
  const run=await report(),json=JSON.parse(buildJsonReport(run)),csv=buildCsvReport(run);
  assert.equal(Object.hasOwn(json,'schemaVersion'),false);assert.equal(json.issues.length,3);
  assert.ok(json.issues.every(i=>!Object.hasOwn(i,'domain')&&i.participants.length===2));
  assert.ok(json.issues.every(i=>i.ruleIds[0]==='Rule-012'));
  assert.ok(json.topology.rules[0].issues.every(i=>i.ruleId==='Rule-012'));
  assert.equal(json.topology.summary.issues,3);assert.equal(csv.split('\r\n').length,5);assert.ok(csv.includes('participants'));
  assert.equal(JSON.stringify(json).includes('"coordinates":'),false);assert.equal(JSON.stringify(json).includes('PRIVATE_VALUE'),false);
});
test('V5 export rejects truncated, failed and forged topology reports',async()=>{
  const run=await report();
  const corruptions=[
    r=>r.topology.status='failed',r=>r.topology.rules[0].status='failed',
    r=>r.topology.rules[0].issues.pop(),r=>r.topology.summary.issues++,
    r=>r.topology.rules[0].issues[1].issueId=r.topology.rules[0].issues[0].issueId,
    r=>r.topology.rules[0].issues[0].participants[0].recordKey='missing',
    r=>r.topology.rules[0].issues[0].participants[0].featureIndex=900,
    r=>r.topology.rules[0].issues[0].participants.push(r.topology.rules[0].issues[0].participants[0]),
    r=>r.topology.rules[0].ruleId='not-configured',r=>r.topology.rules[0].checkCount=0,
    r=>r.topology.rules[0].issues[0].location={x:NaN,y:0},
  ];
  for(const corrupt of corruptions){const copy=structuredClone(run);corrupt(copy);assert.throws(()=>buildJsonReport(copy));assert.throws(()=>buildCsvReport(copy));}
});
test('topology notices expose disabled, skipped and partial coverage',async()=>{
  const {topologyNotice}=await import('../src/ui/results.ts');const run=await report();
  assert.match(topologyNotice({...run.topology,status:'disabled'}),/not run/i);
  run.topology.rules[0].coverage='partial';assert.match(topologyNotice(run.topology),/unchecked|partial/i);
  run.topology.rules[0].coverage='complete';run.topology.rules[0].status='skipped';assert.match(topologyNotice(run.topology),/skipped/i);
});

test('exports reject version 2.0 reports with or without topology results',async()=>{
  const run=await report();
  for(const includeTopology of [false,true]){
    const legacy={...run,schemaVersion:'2.0'};
    if(!includeTopology)delete legacy.topology;
    assert.throws(()=>buildJsonReport(legacy),/Only complete version 5.0 reports/);
    assert.throws(()=>buildCsvReport(legacy),/Only complete version 5.0 reports/);
  }
});
