import test from 'node:test';import assert from 'node:assert/strict';
import {inspect,line,polygon} from './helpers/qgis.mjs';import {buildJsonReport,buildCsvReport} from '../src/report/export.ts';
test('multi-event reports include occurrence, measurements and the original parameter snapshot',async()=>{
 const run=await inspect([line([[0,0],[1,0],[1,1]])],'Rule-031',{minLength:2});
 const json=JSON.parse(buildJsonReport(run));assert.equal(json.issues.length,2);assert.equal(json.issues[0].measurements.length,1);assert.ok(json.issues[0].occurrence.sources.length);
 const csv=buildCsvReport(run);assert.match(csv.split('\r\n')[0],/occurrence,measurements$/);assert.match(csv,/minLength/);
 for(const mutate of [r=>r.topology.rules[0].issues[0].occurrence.sources[0].vertex=-1,r=>r.topology.rules[0].issues[0].measurements.minLength=99,r=>r.topology.rules[0].issues[0].measurements.length=Infinity,r=>r.topology.rules[0].issues[0].occurrence.sources[0].vertex=999]){const r=structuredClone(run);mutate(r);assert.throws(()=>buildJsonReport(r));}
});
test('safe short ring failures can export their independently checked issues without raw geometry',async()=>{
 const run=await inspect([polygon([[[0,0],[1,0],[0,0]]])],'Rule-027');const json=JSON.parse(buildJsonReport(run));assert.equal(json.issues.length,2);assert.equal(json.issues[1].measurements.nodeCount,2);assert.doesNotMatch(JSON.stringify(json),/preflightEvidence|"coordinates"\s*:/);
});
test('export rejects semantically impossible measurements and malformed occurrence paths',async()=>{
 const run=await inspect([line([[0,0],[1,0],[1,1]])],'Rule-031',{minLength:2});
 for(const mutate of [r=>r.topology.rules[0].issues[0].measurements.length=3,r=>{const i=r.topology.rules[0].issues[0];delete i.occurrence.sources[0].vertex;i.issueId=i.ruleId+':'+JSON.stringify(i.occurrence);},r=>{const i=r.topology.rules[0].issues[0];i.occurrence.region=0;i.issueId=i.ruleId+':'+JSON.stringify(i.occurrence);}]){const r=structuredClone(run);mutate(r);assert.throws(()=>buildJsonReport(r));}
});
test('scope follows the rule event rather than the dataset scheduler',async()=>{
 const run=await inspect([{type:'Point',coordinates:[0,0]},{type:'Point',coordinates:[0,0]},{type:'Point',coordinates:[0,0]}],'Rule-035');
 assert.ok(run.topology.rules[0].issues.every(issue=>issue.scope==='record'));
 const c=await inspect([{type:'MultiLineString',coordinates:[[[0,0],[4,4]],[[0,4],[4,0]]]}],'Rule-039');c.topology.rules[0].issues[0].scope='pair';assert.throws(()=>buildJsonReport(c));
});
