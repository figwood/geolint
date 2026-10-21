import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkRules } from '../src/diagnostics.ts';
import { parseTopologyOptions } from '../src/topology/config.ts';
import { parseAttributeRuleFile } from '../src/attributes/config.ts';

const legacy = ['GR-001','GR-002','GR-003','GR-004','SR-001','SR-002','SR-003','SR-004','SR-005','SR-006','SR-007','TR-001','TR-002','TR-003','TR-004','TR-005','TR-006','AR-001','AR-002','AR-003','AR-004','AR-005','AR-006'];
const canonical = legacy.map((_, i) => `Rule-${String(i + 1).padStart(3, '0')}`);
test('built-in identifiers are unique and independent of categories and execution groups', () => {
  assert.deepEqual(checkRules.map(rule => rule.id), [...canonical,...Array.from({length:17},(_,i)=>`Rule-${String(i+24).padStart(3,'0')}`)]);
  assert.deepEqual(checkRules.filter(rule => rule.executionGroup === 'attributes').map(rule => rule.id), canonical.slice(17));
});
test('legacy topology configuration normalizes before duplicate detection without mutating input', () => {
  const input = {rules: legacy.slice(11,17).map(id => ({id}))};
  assert.deepEqual(parseTopologyOptions(input).rules.map(rule => rule.id), canonical.slice(11,17));
  assert.equal(input.rules[0].id, 'TR-001');
  assert.throws(() => parseTopologyOptions({rules: [{id:'TR-001'}, {id:'Rule-012'}]}), {code:'TOPOLOGY_CONFIG_ERROR'});
});
test('user attribute identifiers are not built-in aliases', () => {
  const input = {kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'AR-001',field:'name',required:true},{id:'Rule-018',field:'code',required:true}]};
  assert.deepEqual(parseAttributeRuleFile(input).rules.map(rule => rule.id), ['AR-001','Rule-018']);
});
test('legacy reference links and canonical rule sections both remain addressable', async () => {
  const html = await readFile('public/rules.html','utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'bookmark targets must be unique');
  for (const [index, old] of legacy.slice(0,17).entries()) {
    assert.match(html, new RegExp(`<section id="${canonical[index]}"[^>]*><span id="${old}"[^>]*></span><h2>${canonical[index]} ·`), old);
    assert.ok(html.includes(`href="#${canonical[index]}"`), canonical[index]);
    assert.ok(!html.includes(`href="#${old}"`), 'new navigation must use canonical bookmarks');
  }
});
test('alias map is complete, immutable and does not resolve inherited properties', async () => {
  const { legacyRuleIds, canonicalRuleId } = await import('../src/rule-identifiers.ts');
  assert.deepEqual(Object.keys(legacyRuleIds), legacy);
  assert.deepEqual(Object.values(legacyRuleIds), canonical);
  assert.ok(Object.isFrozen(legacyRuleIds));
  for (const id of canonical) assert.equal(canonicalRuleId(id),id);
  for (const id of ['constructor','toString','__proto__','TR-999','Rule-999','tr-001']) assert.equal(canonicalRuleId(id),id);
});
test('legacy aliases produce the same canonical run and reports as new identifiers', async () => {
  const { runInspection } = await import('../src/inspection/run.ts');
  const { createEngine } = await import('../src/engine/geos.ts');
  const { buildJsonReport, buildCsvReport } = await import('../src/report/export.ts');
  const input = {type:'FeatureCollection',features:[0,1].map(id => ({type:'Feature',id,properties:{},geometry:{type:'Point',coordinates:[1,2]}}))};
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const attributes = parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'AR-001',field:'name',required:true}]});
  async function run(ids) {
    const messages = [];
    await runInspection({name:'legacy.geojson',size:bytes.length,arrayBuffer:async()=>bytes.buffer},'migration',m=>messages.push(m),createEngine,attributes,{rules:ids.map(id=>({id}))});
    assert.equal(messages.at(-1).type,'completed');
    return messages.at(-1).result;
  }
  const old = await run(legacy.slice(11,17)), current = await run(canonical.slice(11,17));
  assert.deepEqual(old.ruleSelection,current.ruleSelection);
  assert.deepEqual(old.topology,current.topology);
  const report = JSON.parse(buildJsonReport(old));
  assert.deepEqual(report.ruleCatalog.map(rule=>rule.id),canonical);
  assert.deepEqual(report.topology.options.rules.map(rule=>rule.id),canonical.slice(11,17));
  assert.equal(report.attributeRules.rules[0].id,'AR-001');
  assert.deepEqual(report.issues.map(issue=>issue.ruleIds),[['Rule-018'],['Rule-018'],['Rule-012']]);
  assert.equal(report.topology.rules[0].issues[0].issueId,'Rule-012:0:1');
  assert.match(buildCsvReport(old),/Rule-012/);
  assert.doesNotMatch(buildCsvReport(old),/TR-001|SR-007|GR-001/);
  const mixed = structuredClone(old); mixed.topology.options.rules[0].id = 'TR-001';
  assert.throws(()=>buildJsonReport(mixed),/not normalized/);
});
test('old geometry namespaces are not reinterpreted as topology aliases', async () => {
  const { resolveTopologyCheckers } = await import('../src/topology/run.ts');
  const { topologyCheckers } = await import('../src/topology/registry.ts');
  for (const id of ['SR-001','GR-001','AR-001','BR-001','constructor','Rule-999']) {
    assert.throws(()=>resolveTopologyCheckers(parseTopologyOptions({rules:[{id}]}),topologyCheckers), {code:'TOPOLOGY_CONFIG_ERROR'});
  }
});
