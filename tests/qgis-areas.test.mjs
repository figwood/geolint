import test from 'node:test';import assert from 'node:assert/strict';import {inspect,square,polygon} from './helpers/qgis.mjs';
test('overlap area has a strict upper bound, no-limit zero and no containment',async()=>{
 const g=[square(),square(2,0)];
 assert.equal((await inspect(g,'Rule-037',{maxArea:8})).topology.summary.issues,0);
 const r=await inspect(g,'Rule-037',{maxArea:9});assert.equal(r.topology.summary.issues,1);assert.equal(r.topology.rules[0].issues[0].measurements.area,8);assert.equal(r.topology.rules[0].issues[0].geometry.type,'Polygon');
 assert.equal((await inspect([square(),square(1,1,1)],'Rule-037')).topology.summary.issues,0);
});
test('gap upper bound is inclusive and covered islands are retained as holes',async()=>{
 const g=[polygon([[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[2,8],[8,8],[8,2],[2,2]]]),square(4,4,2)];
 const r=await inspect(g,'Rule-038',{maxArea:32});assert.equal(r.topology.summary.issues,1);assert.equal(r.topology.rules[0].issues[0].measurements.area,32);assert.equal(r.topology.rules[0].issues[0].geometry.coordinates.length,2);
 assert.equal((await inspect(g,'Rule-038',{maxArea:31})).topology.summary.issues,0);
});
