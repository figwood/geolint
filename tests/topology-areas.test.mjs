import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect,polygon} from './helpers/single-layer.mjs';
const ring=(x,y,w=2,h=w)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];
const square=(x=0,y=0,w=2)=>polygon([ring(x,y,w)]);
test('area overlaps excludes equality, containment and boundary contact',async()=>{
  for(const [right,n] of [[square(1),1],[square(),0],[square(0.5,0.5,0.5),0],[square(2),0]]){
    const r=await inspect([square(),right],['Rule-016']);assert.equal(r.topology.rules[0].issues.length,n);
  }
});
test('gaps are union holes, including one polygon, filled holes and multiple islands',async()=>{
  const holed=polygon([ring(0,0,6),ring(1,1,1),ring(3,3,1)]);
  const r=await inspect([holed],['Rule-017']);
  assert.equal(r.topology.rules[0].checkCount,1);assert.equal(r.topology.rules[0].issues.length,2);
  assert.ok(r.topology.rules[0].issues.every(i=>i.scope==='dataset'&&i.participants.length===0&&i.geometry.type==='Polygon'));
  assert.equal((await inspect([holed,square(1,1,1),square(3,3,1)],['Rule-017'])).topology.summary.issues,0);
  assert.equal((await inspect([square(),square(10)],['Rule-017'])).topology.summary.issues,0);
  const walls=[polygon([ring(0,0,4,1)]),polygon([ring(0,3,4,1)]),polygon([ring(0,1,1,2)]),polygon([ring(3,1,1,2)])];
  assert.equal((await inspect(walls,['Rule-017'])).topology.summary.issues,1);
  assert.equal((await inspect(walls.slice(1),['Rule-017'])).topology.summary.issues,0);
});
test('area exclusions, output budgets and subsequent initialization remain explicit',async()=>{
  const bad=polygon([[[0,0],[2,2],[0,2],[2,0],[0,0]]]);
  const r=await inspect([square(),bad,null],['Rule-017']);assert.equal(r.topology.rules[0].coverage,'partial');
  await assert.rejects(inspect([polygon([ring(0,0,4),ring(1,1,1)])],['Rule-017'],{topology:{limits:{positions:10}}}),{code:'TOPOLOGY_LIMIT_EXCEEDED'});
  assert.equal((await inspect([square()],['Rule-017'])).topology.rules[0].status,'passed');
});
test('gaps exclude covered islands and do not duplicate holes within those islands',async()=>{
  const outer=polygon([ring(0,0,10),ring(1,1,8)]);
  const island=polygon([ring(3,3,4),ring(4,4,1)]);
  const r=await inspect([outer,island],['Rule-017']);
  const gaps=r.topology.rules[0].issues;
  assert.equal(gaps.length,2);
  assert.deepEqual(gaps.map(i=>i.geometry.coordinates.length).sort(),[1,2]);
});
