import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkRules } from '../src/diagnostics.ts';
import { topologyCheckers } from '../src/topology/registry.ts';
import { createRuleSelection } from '../public/rule-selection.js';

// A missing/unchecked required checkbox or mismatched row must fail these checks.
test('selection table presents 34 available rules and locks every required checkbox on',async()=>{
  const html=await readFile('public/index.html','utf8');
  const table=html.match(/<table id="rule-table"[^>]*>([^]*?)<\/table>/)?.[1];
  assert.ok(table,'Rule selection uses a table');
  const page=html.match(/<section id="step-rules"[^>]*>([^]*?)<\/section>/)[1];
  assert.doesNotMatch(page,/data-category=|id="rule-search"|Find a rule|catalog-count|catalog-empty|attribute-group-notice|topology-rule-notice/);
  assert.doesNotMatch(html,/rules-select-all|rules-clear|Select all optional rules|Clear optional rules|Clear removes optional rules/);
  const app=await readFile('public/app.js','utf8');
  assert.doesNotMatch(app,/rules-select-all|rules-clear/);
  assert.deepEqual([...table.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(m=>m[1]),['Rule ID','Name','Category','Selected']);
  const rows=[...table.matchAll(/<tr class="rule-row"([^>]*)>([^]*?)<\/tr>/g)];
  const available=checkRules.filter(rule=>rule.executionGroup !== 'attributes');
  assert.equal(rows.length,34);
  const categories={'structure': 'Data structure', 'validity': 'Geometry validity', 'geometry': 'Geometry constraints', 'topology': 'Topology and spatial relationships', 'attributes': 'Attribute constraints', 'diagnostics': 'Run diagnostics'};
  for (const rule of available) {
    const row=rows.find(([,attrs])=>attrs.includes(`data-rule-id="${rule.id}"`));
    assert.ok(row,rule.id);
    assert.ok(row[1].includes(`data-rule-category="${rule.family}"`));
    assert.ok(row[2].includes(rule.title));
    assert.ok(row[2].includes(`<td>${categories[rule.family]}</td>`));
    assert.equal((row[2].match(/<(?:td|th)\b/g)??[]).length,4);
    const input=row[2].match(/<input ([^>]+)>/)[1];
    assert.match(input,/type="checkbox"/);
    assert.equal(/\bchecked\b/.test(input),rule.required);
    assert.equal(/\bdisabled\b/.test(input),rule.required);
  }
  assert.doesNotMatch(html,/data-attribute-rule|id="attribute-editor"|id="attribute-results"|<th scope="col">Attributes<\/th>/);
});

test('rules reference documents geometry applicability and QGIS topology references',async()=>{
  const html=await readFile('public/rules.html','utf8');
  const expectedFamilies={
    'Rule-005':'Point, line, polygon and geometry collection layers',
    'Rule-006':'Polygon layers',
    'Rule-007':'Point, line, polygon and geometry collection layers',
    'Rule-008':'Point, line, polygon and geometry collection layers',
    'Rule-009':'Point, line and polygon shapefile layers',
    'Rule-010':'Point, line, polygon and geometry collection layers',
    'Rule-011':'Point, line, polygon and geometry collection layers',
    'Rule-012':'Point, line and polygon layers',
    'Rule-013':'Point, line and polygon layers',
    'Rule-014':'Line layers',
    'Rule-015':'Line layers',
    'Rule-016':'Polygon layers',
    'Rule-017':'Polygon layers',
  };
  for(const [id, family] of Object.entries(expectedFamilies)) {
    const section=html.match(new RegExp(`<section id="${id}"[^>]*>([^]*?)</section>`))?.[1];
    assert.ok(section,`missing ${id}`);
    assert.ok(section.includes(`Applies to · ${family}`),`${id} applicability`);
    if(checkRules.find(rule => rule.id === id).executionGroup === 'topology' || id==='Rule-011') assert.match(section,/href="https:\/\/doc\.qgis\.org\/3\.44\/en\/docs\/user_manual\/plugins\/core_plugins\/plugins_topology_checker\.html"/);
    if(id==='Rule-006') assert.match(section,/href="https:\/\/doc\.qgis\.org\/3\.44\/en\/docs\/user_manual\/plugins\/core_plugins\/plugins_geometry_checker\.html"/);
  }
  const supported={
    'Rule-012':['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'],
    'Rule-013':['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'],
    'Rule-014':['LineString','MultiLineString'],
    'Rule-015':['LineString','MultiLineString'],
    'Rule-016':['Polygon','MultiPolygon'],
    'Rule-017':['Polygon','MultiPolygon'],
  };
  for(const checker of topologyCheckers.filter(c=>Object.hasOwn(supported,c.id))) assert.deepEqual(checker.geometryTypes,supported[checker.id],checker.id);
});

// Only DOM methods used by createRuleSelection are represented here; real event
// wiring and browser accessibility are covered by the selection E2E case.
function workspace() {
  const inputs=Array.from({length:6},()=>({checked:false}));
  const root={querySelectorAll(selector){return selector==='[data-attribute-rule]'?inputs:[];}};
  const elements=Object.fromEntries(['attribute-editor','selection-summary','selection-notice'].map(id=>[id,{textContent:'',hidden:false}]));
  elements['attribute-enabled']=inputs[0];
  elements['rules-title']={closest:()=>root};
  elements['selected-rules']={replaceChildren(){},append(){}};
  const selection=createRuleSelection(id=>elements[id],{getConfig:()=>({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'name-required',field:'name',required:true,enabled:true}]})},[]);
  return {selection,inputs,elements};
}

test('attribute table checkboxes stay linked and selection retains the group contract',()=>{
  const {selection,inputs}=workspace();
  selection.setAttributes(true);
  assert.ok(inputs.every(input=>input.checked));
  assert.equal(selection.config().attributes.rules[0].id,'name-required');
  selection.setAttributes(false);
  assert.ok(inputs.every(input=>!input.checked));
  assert.deepEqual(selection.config().attributes,{kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[]});
});

test('selection renders its summary and linked editor without search or category controls',()=>{
  const {selection,inputs,elements}=workspace();
  selection.setAttributes(true);
  selection.render();
  assert.ok(inputs.every(input=>input.checked));
  assert.equal(elements['attribute-editor'].hidden,false);
  assert.match(elements['selection-summary'].textContent,/6 optional rules · 1 field rules/);
  selection.setAttributes(false);
  selection.render();
  assert.equal(elements['attribute-editor'].hidden,true);
  assert.match(elements['selection-summary'].textContent,/0 optional rules/);
});
