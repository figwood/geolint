import test from 'node:test';import assert from 'node:assert/strict';
import {inspect,polygon} from './helpers/qgis.mjs';
import {parseTopologyOptions} from '../src/topology/config.ts';
test('holes are individual events and multipart constraint is independent from Rule-013',async()=>{
 const r=await inspect([polygon([[[0,0],[10,0],[10,10],[0,10],[0,0]],[[1,1],[1,2],[2,2],[1,1]],[[3,3],[3,4],[4,4],[3,3]]])],'Rule-028');assert.equal(r.topology.summary.issues,2);
 assert.equal((await inspect([{type:'MultiPoint',coordinates:[[0,0]]}],'Rule-029')).topology.summary.issues,1);
 assert.equal((await inspect([{type:'MultiPoint',coordinates:[[0,0],[1,1]]}],'Rule-029')).topology.summary.issues,0);
});
test('allowed types are explicit constraints with strict canonical parameters',async()=>{
 assert.throws(()=>parseTopologyOptions({rules:[{id:'Rule-040',parameters:{allowedTypes:[]}}]}));
 assert.throws(()=>parseTopologyOptions({rules:[{id:'Rule-040',parameters:{allowedTypes:['Point','Point']}}]}));
 const r=await inspect([{type:'Point',coordinates:[0,0]},{type:'MultiPoint',coordinates:[[0,0]]}],'Rule-040',{allowedTypes:['Point']});assert.equal(r.topology.summary.issues,1);
});
test('explicit null parameters are invalid rather than defaulted',()=>{
 for(const [id,parameters] of [['Rule-031',{minLength:2,toleranceDigits:null}],['Rule-034',{maxThinness:9,maxArea:null}]])assert.throws(()=>parseTopologyOptions({rules:[{id,parameters}]}),{code:'TOPOLOGY_CONFIG_ERROR'});
});
