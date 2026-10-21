import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkRules, selectedRuleIds, ruleIdsForReason } from '../src/diagnostics.ts';
import { runInspection } from '../src/inspection/run.ts';
import { buildJsonReport, buildCsvReport } from '../src/report/export.ts';
import { parseTopologyOptions } from '../src/topology/config.ts';
import { resolveTopologyCheckers } from '../src/topology/run.ts';
import { topologyCheckers } from '../src/topology/registry.ts';

const ids = (start, count) => Array.from({length:count}, (_,i)=>`Rule-${String(start+i).padStart(3,'0')}`);
const required = ids(1,11);
async function completed(geometry = {type:'Point',coordinates:[]}) {
  const bytes = new TextEncoder().encode(JSON.stringify(geometry)), messages = [];
  await runInspection({name:'fixture.geojson',size:bytes.length,arrayBuffer:async()=>bytes.buffer}, 'v5', m=>messages.push(m), async()=>({
    info:{name:'test',version:'0',wasmPackageVersion:'0',parameters:{},coordinateSemantics:'planar-2d'},
    check:()=>({valid:true,reason:'Valid Geometry',location:null}),dispose(){},
  }));
  assert.equal(messages.at(-1).type,'completed');
  return messages.at(-1).result;
}
function csvRows(csv) {
  return [...csv.matchAll(/(?:^|\r\n)([^]*?)(?=\r\n|$)/g)].map(match=>{
    const row=match[1];
    if (!row.startsWith('"')) return row.split(',');
    return [...row.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(cell=>cell[1].replaceAll('""','"'));
  }).filter(row=>row.length>1);
}

test('V5 catalog preserves identifiers independently of quality categories',()=>{
  assert.equal(checkRules.length,40);
  assert.equal(new Set(checkRules.map(r=>r.id)).size,40);
  assert.deepEqual(checkRules.map(r=>r.id), ids(1,40));
  assert.deepEqual(selectedRuleIds(false,[]),{required,optional:[]});
  assert.deepEqual(checkRules.filter(r=>r.executionGroup === 'topology' && r.id <= 'Rule-017').map(r=>r.title),[
    'Must not have duplicates','Must not have multi-part geometries','Must not have dangles',
    'Must not have pseudos','Must not overlap','Must not have gaps',
  ]);
  assert.equal(checkRules.find(r=>r.id==='Rule-011').title,'Must not have invalid geometries');
  assert.deepEqual(ruleIdsForReason('TOPOLOGY_DUPLICATE_GEOMETRY'),['Rule-012']);
  assert.deepEqual(ruleIdsForReason('GEOMETRY_INVALID'),['Rule-011']);
});

test('V5 exports selected canonical rule metadata and CSV names without internal metadata',async()=>{
  const run=await completed(), report=JSON.parse(buildJsonReport(run));
  assert.equal(run.schemaVersion,'5.0');
  assert.deepEqual(report.ruleCatalog,checkRules.filter(r=>r.required));
  assert.deepEqual(report.issues.map(i=>i.ruleIds),[['Rule-008']]);
  assert.ok(report.issues.every(issue=>!Object.hasOwn(issue,'domain')));
  const rows=csvRows(buildCsvReport(run)), row=Object.fromEntries(rows[0].map((key,i)=>[key,rows[1][i]]));
  assert.equal(Object.hasOwn(row,'schema_version'),false);
  assert.deepEqual(JSON.parse(row.rule_ids),['Rule-008']);
  assert.deepEqual(JSON.parse(row.rule_names),['Geometries must not be empty']);
  assert.deepEqual(JSON.parse(row.rule_families),['geometry']);
  assert.equal(Object.hasOwn(row,'domain'),false);
  run.ruleCatalog=[{id:'Rule-008',title:'UNTRUSTED_METADATA'}];
  assert.ok(!buildJsonReport(run).includes('UNTRUSTED_METADATA'));
});

test('V5 rejects old report versions and legacy topology identifiers',async()=>{
  const run=await completed();
  for (const version of ['4.0','3.0','2.0']) {
    const copy={...run,schemaVersion:version};
    assert.throws(()=>buildJsonReport(copy));assert.throws(()=>buildCsvReport(copy));
  }
  for (const id of ['Rule-005','Rule-010','BR-001']) {
    assert.throws(()=>resolveTopologyCheckers(parseTopologyOptions({rules:[{id}]}),topologyCheckers),{code:'TOPOLOGY_CONFIG_ERROR'});
  }
  const copy=structuredClone(run);copy.ruleSelection.required[4]='BR-001';
  assert.throws(()=>buildJsonReport(copy));
});

test('V5 UI rows and reference anchors agree with the canonical catalog',async()=>{
  const home=await readFile('public/index.html','utf8'), reference=await readFile('public/rules.html','utf8');
  for (const rule of checkRules.filter(rule => rule.executionGroup !== 'attributes')) {
    assert.ok(reference.includes(`id="${rule.id}"`));
    assert.ok(reference.includes(`${rule.id} · ${rule.title}`));
    assert.ok(home.includes(`data-rule-category="${rule.family}" data-rule-id="${rule.id}"`));
  }
  assert.ok(home.includes('Geometry validity'));assert.ok(home.includes('Topology and spatial relationships'));
  assert.doesNotMatch(home,/Basic geometry|Extended geometry|BR-/);
});

test('CSV keeps all names and families aligned for multi-rule geometry diagnostics',async()=>{
  const run=await completed({type:'Point',coordinates:[1]}), report=JSON.parse(buildJsonReport(run));
  const rows=csvRows(buildCsvReport(run)), row=Object.fromEntries(rows[0].map((key,i)=>[key,rows[1][i]]));
  assert.deepEqual(report.issues[0].ruleIds,['Rule-005','Rule-007','Rule-010']);
  const expected=report.issues[0].ruleIds.map(id=>report.ruleCatalog.find(rule=>rule.id===id));
  assert.deepEqual(JSON.parse(row.rule_names),expected.map(rule=>rule.title));
  assert.deepEqual(JSON.parse(row.rule_families),['structure','diagnostics','diagnostics']);
});

test('optional topology and attribute metadata is exported only when selected',async()=>{
  const { createEngine } = await import('../src/engine/geos.ts');
  const { parseAttributeRuleFile } = await import('../src/attributes/config.ts');
  const rules=parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'custom-name',field:'name',required:true}]});
  const input={type:'FeatureCollection',features:[0,1].map(id=>({type:'Feature',id,properties:{secret:'PRIVATE_V5'},geometry:{type:'Point',coordinates:[1,2]}}))};
  const bytes=new TextEncoder().encode(JSON.stringify(input)), messages=[];
  await runInspection({name:'optional.geojson',size:bytes.length,arrayBuffer:async()=>bytes.buffer},'optional',m=>messages.push(m),createEngine,rules,{rules:[{id:'Rule-012'}]});
  assert.equal(messages.at(-1).type,'completed');
  const run=messages.at(-1).result,report=JSON.parse(buildJsonReport(run));
  assert.deepEqual(report.ruleCatalog.map(r=>r.id),[...required,'Rule-012',...ids(18,6)]);
  assert.deepEqual(report.issues.map(i=>i.ruleIds),[['Rule-018'],['Rule-018'],['Rule-012']]);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_V5'));
  const rows=csvRows(buildCsvReport(run));
  for (const cells of rows.slice(1)) {
    const row=Object.fromEntries(rows[0].map((key,i)=>[key,cells[i]]));
    const expected=JSON.parse(row.rule_ids).map(id=>report.ruleCatalog.find(rule=>rule.id===id));
    assert.deepEqual(JSON.parse(row.rule_names),expected.map(rule=>rule.title));
    assert.deepEqual(JSON.parse(row.rule_families),expected.map(rule=>rule.family));
  }
  for (const mutate of [
    r=>r.topology.options.rules[0].id='Rule-005',
    r=>r.topology.rules[0].ruleId='Rule-005',
    r=>r.topology.rules[0].issues[0].ruleId='Rule-005',
    r=>r.ruleSelection.optional[0]='Rule-005',
  ]) {
    const copy=structuredClone(run);mutate(copy);
    assert.throws(()=>buildJsonReport(copy));assert.throws(()=>buildCsvReport(copy));
  }
});
