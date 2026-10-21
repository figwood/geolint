import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('topology comparator checks independent human expectations and rejects joint omissions or failures',async()=>{
  const {compareTopology}=await import('../validation/topology/compare.mjs');
  const expected={geosVersion:'3.13.0',cases:[{name:'equal',expected:{participants:2,coverage:'complete',comparisons:1,equal:[[0,1]],area:[[0,1]]}}]};
  const geolint={status:'completed',version:'3.13.0',cases:[{name:'equal',participants:2,coverage:'complete',comparisons:1,pairs:{equal:[[0,1]],area:[[0,1]]},states:{equal:'violated',area:'violated'}}]};
  const qgis={status:'completed',version:'3.13.0',cases:[{name:'equal',participants:2,coverage:'complete',fullComparisons:1,pairs:{equal:[[0,1]],area:[[0,1]]}}]};
  assert.equal(compareTopology(geolint,qgis,expected).status,'matched');
  for(const mutate of [
    (a,b)=>{a.cases[0].pairs.area=[];b.cases[0].pairs.area=[];},
    (a,b)=>{a.status=b.status='failed';},(a,b)=>{a.cases=[];b.cases=[];},
    (a,b)=>b.version='3.15.0',(a,b)=>a.cases.push(a.cases[0]),
    (a,b)=>b.cases[0].pairs.equal.push([0,1]),(a,b)=>a.cases[0].comparisons=0,
    (a,b)=>b.cases[0].fullComparisons=0,(a,b)=>a.cases[0].states.area='passed',
  ]){const a=structuredClone(geolint),b=structuredClone(qgis);mutate(a,b);assert.notEqual(compareTopology(a,b,expected).status,'matched');}
});
test('real topology regression matches every hand-authored case',async()=>{
  const {checkTopologyRegression}=await import('../validation/topology/check.mjs');
  const result=await checkTopologyRegression();assert.equal(result.cases,15);assert.equal(result.problems,9);
  const cases=JSON.parse(await readFile(new URL('./fixtures/topology/cases.json',import.meta.url),'utf8'));
  assert.equal(cases.cases.length,15);
});

test('duplicate comparison rejects missing pairs, groups, coverage, cases and incompatible references',async()=>{
  const comparator=await import('../validation/topology/compare.mjs');
  const expected={geosVersion:'3.13.0',cases:[{name:'three',expected:{participants:3,coverage:'complete',comparisons:3,pairs:[[0,1],[0,2],[1,2]],groups:[[0,1,2]]}}]};
  const geolint={status:'completed',version:'3.13.0',cases:[{name:'three',participants:3,coverage:'complete',comparisons:3,pairs:[[0,1],[0,2],[1,2]],groups:[[0,1,2]],state:'violated'}]};
  const qgis={status:'completed',version:'3.13.0',qgisVersion:'3.45.0',reference:'pyqgis-relations',cases:[{name:'three',participants:3,coverage:'complete',fullComparisons:3,pairs:[[0,1],[0,2],[1,2]],groups:[[0,1,2]]}]};
  assert.equal(comparator.compareDuplicateTopology?.(geolint,qgis,expected)?.status,'matched');
  for(const mutate of [
    (a,b)=>{a.cases[0].pairs=[];b.cases[0].pairs=[];},
    (a,b)=>{a.cases[0].groups=[];b.cases[0].groups=[];},
    (a,b)=>b.cases[0].pairs.push([0,1]),(a,b)=>b.cases[0].pairs.push([0,99]),
    (a,b)=>b.cases[0].fullComparisons=0,(a,b)=>a.cases[0].comparisons=0,
    (a,b)=>a.cases[0].state='passed',(a,b)=>b.cases[0].coverage='partial',
    (a,b)=>b.qgisVersion='5.0.0',(a,b)=>b.reference='topology-plugin',
    (a,b)=>b.version='3.15.0',(a,b)=>{a.status=b.status='failed';},
    (a,b)=>b.cases.push(b.cases[0]),(a,b)=>b.cases=[],
  ]){
    const a=structuredClone(geolint),b=structuredClone(qgis);mutate(a,b);
    assert.equal(comparator.compareDuplicateTopology(a,b,expected).status,'failed');
  }
});
test('single layer comparison rejects joint omissions, wrong geometries and unsupported references',async()=>{
  const module=await import('../validation/topology/single-layer.mjs');
  assert.equal(typeof module.compareSingleLayerTopology,'function');
  const result=await module.checkSingleLayerRegression();
  const qgis={...structuredClone(result.report),qgisVersion:'3.40.3',reference:'pyqgis-single-layer'};
  assert.equal(module.compareSingleLayerTopology(result.report,qgis,result.expected).status,'matched');
  for(const mutate of [
    (a,b)=>{a.cases[5].rules[0].issues=[];b.cases[5].rules[0].issues=[];},
    (a,b)=>{a.cases=[];b.cases=[];},(a,b)=>{a.status=b.status='failed';},
    (a,b)=>b.version='3.15.0',(a,b)=>b.reference='topology-plugin',
    (a,b)=>{b.cases.find(c=>c.name==='two-holes-one-record').rules[0].issues[0].geometry.coordinates[0][0][0]=9;},
  ]){const a=structuredClone(result.report),b=structuredClone(qgis);mutate(a,b);assert.equal(module.compareSingleLayerTopology(a,b,result.expected).status,'failed');}
});
