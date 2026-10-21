import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect,line,polygon} from './helpers/single-layer.mjs';
import {buildJsonReport,buildCsvReport} from '../src/report/export.ts';
const ring=(x,y,w)=>[[x,y],[x+w,y],[x+w,y+w],[x,y+w],[x,y]];
async function report(){return inspect([line([[0,0],[1,0]]),line([[0,0],[1,0]]),polygon([ring(0,0,6),ring(1,1,1),ring(3,3,1)]),{type:'MultiPoint',coordinates:[[0,0],[1,1]]}],['Rule-012','Rule-013','Rule-014','Rule-015','Rule-016','Rule-017']);}
test('new scopes export complete dataset gaps and multiple endpoint findings to JSON and CSV',async()=>{
  const run=await report(),json=JSON.parse(buildJsonReport(run)),csv=buildCsvReport(run);
  assert.equal(json.issues.length,6);assert.equal(csv.split('\r\n').length,8);
  const gaps=json.issues.filter(i=>i.ruleIds[0]==='Rule-017');assert.equal(gaps.length,2);assert.ok(gaps.every(i=>i.scope==='dataset'&&i.participants.length===0&&i.geometry.type==='Polygon'));
  for(const issue of json.issues)assert.ok(csv.includes(issue.issueId));
  assert.ok(csv.startsWith('issue_id,check_parameters,'));
  const exportedIds=csv.split('\r\n').slice(1,-1).map(row=>row.match(/^"([^"]*)"/)[1]);
  assert.deepEqual(exportedIds,json.issues.map(issue=>issue.issueId));assert.ok(csv.includes('issue_geometry'));assert.equal(JSON.stringify(json).includes('private'),false);
});
test('invalid normalized multipart sources can export their independent part violations',async()=>{
  const bad=[[[0,0],[2,2],[0,2],[2,0],[0,0]]];
  const r=await inspect([{type:'MultiPolygon',coordinates:[bad,bad]}],['Rule-013']);assert.equal(JSON.parse(buildJsonReport(r)).issues.length,2);
});
test('export rejects forged new scopes, counts, exclusions, participants and problem geometry',async()=>{
  const run=await report();
  const bad=[r=>r.topology.rules[5].issues[0].scope='pair',r=>r.topology.rules[5].issues[0].participants=[r.topology.rules[0].issues[0].participants[0]],
    r=>r.topology.rules[3].issues[0].location=null,r=>r.topology.rules[5].issues[0].geometry.coordinates[0][0][0]=NaN,
    r=>r.topology.rules[5].issues[0].geometry.coordinates[0].pop(),r=>r.topology.rules[1].checkCount++,
    r=>r.topology.rules[3].issues[0].reasonCode='TOPOLOGY_AREA_GAP',r=>r.topology.rules[3].issues[1].location=r.topology.rules[3].issues[0].location];
  for(const corrupt of bad){const copy=structuredClone(run);corrupt(copy);assert.throws(()=>buildJsonReport(copy));assert.throws(()=>buildCsvReport(copy));}
});
test('export enforces cumulative gap-position budgets',async()=>{
  const run=await report();
  const cumulative=structuredClone(run);cumulative.topology.options.limits.positions=9;
  assert.throws(()=>buildJsonReport(cumulative));
});
test('export refuses nonempty endpoint participants without any node checks',async()=>{
  const empty=await inspect([line([[0,0],[1,0],[0,0]])],['Rule-014']);
  empty.topology.rules[0].checkCount=0;empty.topology.rules[0].status='skipped';empty.topology.summary.checks=0;empty.topology.summary.passed=0;empty.topology.summary.skipped=1;
  assert.throws(()=>buildJsonReport(empty));
});
test('multipart rules cannot exclude normalized invalid geometries as unchecked',async()=>{
  const bad=[[[0,0],[2,2],[0,2],[2,0],[0,0]]];
  const run=await inspect([{type:'MultiPolygon',coordinates:[bad,bad]}],['Rule-013']);
  Object.assign(run.topology.rules[0],{participantCount:0,checkCount:0,issues:[],coverage:'none',status:'skipped',exclusions:[{recordKey:'feature:0',reasonCode:'GEOMETRY_INVALID',affectsCoverage:true}]});
  Object.assign(run.topology.summary,{checks:0,issues:0,violated:0,skipped:1});
  assert.throws(()=>buildJsonReport(run));
});
test('export validates shared feature budgets across different rules',async()=>{
  const run=await inspect([line([[0,0],[1,0]]),polygon([[[0,0],[2,0],[2,2],[0,2],[0,0]]])],['Rule-014','Rule-017']);
  run.topology.options.limits.features=1;
  assert.throws(()=>buildJsonReport(run));
});
test('empty datasets cannot claim endpoint work or aggregate gap issues',async()=>{
  const empty=await inspect([],['Rule-014']);
  Object.assign(empty.topology.rules[0],{checkCount:1,status:'passed'});Object.assign(empty.topology.summary,{checks:1,passed:1,skipped:0});
  assert.throws(()=>buildJsonReport(empty));
});
test('aggregate gaps require actual participants and completed aggregation',async()=>{
  const source=await report();const gap=structuredClone(source.topology.rules[5].issues[0]);
  const noCoverage=await inspect([],['Rule-017']);
  Object.assign(noCoverage.topology.rules[0],{issues:[gap],status:'violated'});Object.assign(noCoverage.topology.summary,{issues:1,violated:1,skipped:0});
  assert.throws(()=>buildJsonReport(noCoverage));
});
test('endpoint uniqueness is independent of coordinate object property order',async()=>{
  const run=await inspect([line([[0,0],[1,0]])],['Rule-014']);
  run.topology.rules[0].issues[1].location={y:0,x:0};
  assert.throws(()=>buildJsonReport(run));
});
