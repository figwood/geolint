import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createEngine } from '../src/engine/geos.ts';
import { runInspection } from '../src/inspection/run.ts';
import { parseAttributeRuleFile } from '../src/attributes/config.ts';
import { buildJsonReport, buildCsvReport, projectReportIssues } from '../src/report/export.ts';

function assertRuleOnly(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['errorId','warningIds','error_id','warning_ids'].includes(key),`Obsolete public field: ${key}`);
    assertRuleOnly(child);
  }
}
async function completed() {
  const input={type:'FeatureCollection',features:[{type:'Feature',id:[],properties:[],geometry:{type:'Point',coordinates:[1,2]}},{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[1,2]}}]};
  const bytes=new TextEncoder().encode(JSON.stringify(input)),messages=[];
  const config=parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'name-rule',field:'name',required:true}]});
  await runInspection({name:'rules.geojson',size:bytes.length,arrayBuffer:async()=>bytes.buffer},'rule-only',m=>messages.push(m),()=>createEngine(),config,{rules:[{id:'Rule-012'}]});
  assert.equal(messages.at(-1).type,'completed');return messages.at(-1).result;
}

test('data issues reference only rules while retaining independent diagnostic reasons',async()=>{
  const run=await completed(),json=JSON.parse(buildJsonReport(run)),csv=buildCsvReport(run);
  assertRuleOnly(run);assertRuleOnly(json);assertRuleOnly(projectReportIssues(run));
  assert.deepEqual(json.issues.map(i=>[i.reasonCode,i.ruleIds]),[
    ['INVALID_FEATURE_ID',['Rule-023']],['INVALID_PROPERTIES',['Rule-021']],['ATTRIBUTE_MISSING',['Rule-018']],['TOPOLOGY_DUPLICATE_GEOMETRY',['Rule-012']],
  ]);
  const headers=csv.split('\r\n')[0].split(',');
  assert.ok(headers.includes('rule_ids'));assert.ok(headers.includes('reason_code'));
  assert.ok(!headers.includes('error_id'));assert.ok(!headers.includes('warning_ids'));
});

test('export rejects obsolete error-number fields rather than accepting two taxonomies',async()=>{
  const run=await completed();
  for(const add of [r=>r.records[0].attributeResult.identityIssues[0].errorId='AE-010',r=>r.records[1].attributeResult.issues[0].errorId='AE-001',r=>r.topology.rules[0].issues[0].errorId='SE-001']){
    const copy=structuredClone(run);add(copy);assert.throws(()=>buildJsonReport(copy));assert.throws(()=>buildCsvReport(copy));
  }
});

test('all site navigation uses Rules as the sole public diagnostic reference',async()=>{
  for(const page of ['index.html','rules.html','help.html','about.html','methodology.html','limitations.html','privacy.html','licenses/NOTICE.html']){
    const html=await readFile(`public/${page}`,'utf8');
    assert.doesNotMatch(html,/errors\.html|Error types/);
  }
  await assert.rejects(access('public/errors.html'),{code:'ENOENT'});
});
