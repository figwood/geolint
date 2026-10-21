import test from 'node:test';import assert from 'node:assert/strict';
import {inspect,line,square,polygon} from './helpers/qgis.mjs';
test('segment minimum has strict upper bound and excludes tolerance-length duplicates',async()=>{
 for(const [minLength,count] of [[1,0],[1.1,2]])assert.equal((await inspect([line([[0,0],[1,0],[1,1]])],'Rule-031',{minLength})).topology.summary.issues,count);
 assert.equal((await inspect([line([[0,0],[0,0],[1,0]])],'Rule-031',{minLength:.1})).topology.summary.issues,0);
});
test('angle minima count only interior or ring vertices',async()=>{
 assert.equal((await inspect([line([[0,0],[1,0],[1,1]])],'Rule-032',{minAngle:91})).topology.summary.issues,1);
 assert.equal((await inspect([line([[0,0],[1,0],[1,1]])],'Rule-032',{minAngle:90})).topology.summary.issues,0);
});
test('net polygon area and sliver ratio use polygon parts and exact boundaries',async()=>{
 assert.equal((await inspect([square(0,0,2)],'Rule-033',{minArea:4})).topology.summary.issues,0);
 const small=await inspect([square(0,0,2)],'Rule-033',{minArea:5});assert.equal(small.topology.summary.issues,1);assert.deepEqual(small.topology.rules[0].issues[0].location,{x:1,y:1});
 const rectangle=polygon([[[0,0],[10,0],[10,1],[0,1],[0,0]]]);
 const run=await inspect([rectangle],'Rule-034',{maxThinness:9});assert.equal(run.topology.summary.issues,1);assert.equal(run.topology.rules[0].issues[0].measurements.thinness,10);
 assert.equal((await inspect([rectangle],'Rule-034',{maxThinness:10})).topology.summary.issues,0);
 assert.equal((await inspect([rectangle],'Rule-034',{maxThinness:9,maxArea:9})).topology.summary.issues,0);
});
test('metrics reject missing business thresholds, unsafe numbers and invalid precision',async()=>{
 await assert.rejects(inspect([square()],'Rule-033'),{code:'TOPOLOGY_CONFIG_ERROR'});
 await assert.rejects(inspect([line([[-1e308,0],[1e308,0]])],'Rule-031',{minLength:1}),{code:'TOPOLOGY_INPUT_ERROR'});
 await assert.rejects(inspect([line([[0,0],[1,0]])],'Rule-031',{minLength:1,toleranceDigits:16}),{code:'TOPOLOGY_CONFIG_ERROR'});
});
