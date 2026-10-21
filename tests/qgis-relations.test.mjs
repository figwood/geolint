import test from 'node:test';import assert from 'node:assert/strict';import {inspect,line,square} from './helpers/qgis.mjs';
test('QGIS dangles accept interior line connections unlike endpoint frequency',async()=>{
 const g=[line([[0,0],[4,0]]),line([[2,0],[2,2]])];
 assert.equal((await inspect(g,'Rule-030')).topology.summary.issues,3);
 assert.equal((await inspect(g,'Rule-014')).topology.summary.issues,4);
});
test('QGIS duplicate rows contain preceding members and containment remains directional',async()=>{
 const g=Array.from({length:3},()=>({type:'Point',coordinates:[0,0]}));const r=await inspect(g,'Rule-035');
 assert.equal(r.topology.summary.issues,2);assert.deepEqual(r.topology.rules[0].issues.map(i=>i.participants.map(p=>p.featureIndex)),[[1,0],[2,0,1]]);
 const c=await inspect([square(),square(1,1,1)],'Rule-036');assert.equal(c.topology.summary.issues,1);assert.deepEqual(c.topology.rules[0].issues[0].participants.map(p=>p.featureIndex),[1,0]);
 assert.equal((await inspect([square(),square()],'Rule-036')).topology.summary.issues,0);
});
test('different parts of the same line record intersect as a record event',async()=>{
 const r=await inspect([{type:'MultiLineString',coordinates:[[[0,0],[4,4]],[[0,4],[4,0]]]}],'Rule-039');
 assert.equal(r.topology.summary.issues,1);assert.equal(r.topology.rules[0].issues[0].scope,'record');
});
