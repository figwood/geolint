import test from 'node:test';import assert from 'node:assert/strict';
import {inspect,line,polygon} from './helpers/qgis.mjs';
test('self intersection reports all proper crossings without replacing valid line status',async()=>{
 const r=await inspect([line([[0,0],[4,4],[0,4],[4,0]])],'Rule-024');assert.equal(r.records[0].status,'valid');assert.equal(r.topology.summary.issues,1);assert.deepEqual(r.topology.rules[0].issues[0].location,{x:2,y:2});
});
test('duplicate nodes exclude closing ring coordinate but retain separate repeated nodes',async()=>{
 const r=await inspect([polygon([[[0,0],[4,0],[4,0],[4,4],[0,4],[0,0]]])],'Rule-025');assert.equal(r.topology.summary.issues,1);
 const clean=await inspect([polygon([[[0,0],[4,0],[4,4],[0,0]]])],'Rule-025');assert.equal(clean.topology.summary.issues,0);
});
test('self contact reports a node on a non-adjacent segment once',async()=>{
 const r=await inspect([line([[0,0],[4,0],[4,4],[2,0],[2,-2]])],'Rule-026');assert.equal(r.topology.summary.issues,1);assert.deepEqual(r.topology.rules[0].issues[0].location,{x:2,y:0});
});
