import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsvReport, buildJsonReport } from '../src/report/export.ts';
import { parseTopologyOptions } from '../src/topology/config.ts';
import { selectedRuleIds } from '../src/diagnostics.ts';

const statuses=['valid','invalid','skipped','parse_failed'];
const run={schemaVersion:'5.0',ruleSelection:selectedRuleIds(false,[]),run:{fileName:'local.geojson',fileBytes:300,completedAt:'2026-10-09T00:00:00Z',status:'completed'},engine:{name:'GEOS',version:'3.13.0',wasmPackageVersion:'3.1.1',parameters:{validityFlags:0},coordinateSemantics:'planar-2d'},summary:{total:4,checked:2,valid:1,invalid:1,skipped:1,parseFailed:1,engineFailed:0},records:statuses.map((status,i)=>({recordKey:`feature:${i}`,featureIndex:i,featureId:i===1?'café,"ID"\nnext line':i,featureIdType:i===1?'string':'number',geometryType:'Polygon',status,reasonCode:['VALID','GEOMETRY_INVALID','EMPTY_GEOMETRY','INVALID_RING'][i],reason:'Reason,"quoted"\nnext',location:i===1?{x:-2,y:3}:null,warnings:[]}))};
run.topology={status:'disabled',options:parseTopologyOptions(),rules:[],summary:{total:0,passed:0,violated:0,skipped:0,failed:0,candidates:0,checks:0,issues:0}};
run.attributeRules={kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[]};
run.attributeSummary={total:4,checked:0,valid:0,invalid:0,skipped:0,failed:0,disabled:4,issueCount:0};
for(const record of run.records)record.attributeResult={status:'disabled',issues:[],identityIssues:[]};
// Independent minimal CSV decoder checks field boundaries and escaped quote/newline round trips.
function parseCsv(csv){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<csv.length;i++){const c=csv[i];if(c==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(cell);cell=''}else if(c==='\r'&&!quoted&&csv[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++}else cell+=c}assert.equal(quoted,false);return rows;}
test('JSON and CSV contain exactly the three data problems with traceable IDs and check parameters',()=>{
  const json=JSON.parse(buildJsonReport(run));const rows=parseCsv(buildCsvReport(run));
  assert.equal(json.issues.length,3);assert.equal(rows.length,4);
  assert.equal(json.issues[0].featureIndex,1);assert.equal(json.issues[0].featureId,run.records[1].featureId);
  assert.equal('records' in json,false);assert.equal('geometry' in json.issues[0],false);
  const columns=rows[0];for(let i=1;i<rows.length;i++){const values=Object.fromEntries(columns.map((c,j)=>[c,rows[i][j]]));assert.equal(values.record_key,`feature:${i}`);assert.equal(values.status,statuses[i]);assert.equal(values.check_parameters,JSON.stringify({...run.engine.parameters,optionalRules:run.topology.options.rules}));assert.equal(rows[i].length,columns.length);}
  const first=Object.fromEntries(columns.map((c,i)=>[c,rows[1][i]]));
  assert.equal(first.feature_id,run.records[1].featureId);assert.equal(first.error_x,'-2');assert.equal(first.reason,run.records[1].reason);
});
test('protects all spreadsheet formula prefixes in text but JSON preserves the original',()=>{
  for(const value of ['=SUM(1,2)','+cmd','-text','@SUM(1)','\t=1','\r=1','\n=1','  =1']){
    const copy=structuredClone(run);copy.records[1].featureId=value;copy.records[1].reason=value;
    const rows=parseCsv(buildCsvReport(copy));
    assert.equal(rows[1][rows[0].indexOf('feature_id')],`'${value}`);
    assert.equal(rows[1][rows[0].indexOf('reason')],`'${value}`);
    assert.equal(JSON.parse(buildJsonReport(copy)).issues[0].featureId,value);
  }
});
test('zero problems CSV contains header and JSON has an empty issues list',()=>{
  const zero={...run,records:[],summary:{total:0,checked:0,valid:0,invalid:0,skipped:0,parseFailed:0,engineFailed:0},attributeSummary:{...run.attributeSummary,total:0,disabled:0}};
  assert.equal(parseCsv(buildCsvReport(zero)).length,1);assert.deepEqual(JSON.parse(buildJsonReport(zero)).issues,[]);
});
test('5.0 exports every attribute problem on spatially valid records and rejects old or incomplete reports',async()=>{
  const {inspectAttributes}=await import('../src/attributes/inspect.ts');
  const {parseAttributeRuleFile}=await import('../src/attributes/config.ts');
  const {summarizeAttributes}=await import('../src/attributes/summary.ts');
  const copy=structuredClone(run);
  copy.attributeRules=parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'=PID',field:'=field',required:true},{id:'area',field:'geo_area',type:'double',constraints:{exclusiveMinimum:0}}]});
  copy.records[0].attributeResult=inspectAttributes({status:'available',values:{geo_area:0,secret:'PRIVATE_VALUE'}},copy.attributeRules.rules);
  for(const record of copy.records.slice(1))record.attributeResult=inspectAttributes({status:'available',values:{'=field':'ok',geo_area:1}},copy.attributeRules.rules);
  copy.ruleSelection=selectedRuleIds(true,[]);
  copy.attributeSummary=summarizeAttributes(copy.records);
  const json=JSON.parse(buildJsonReport(copy));
  assert.equal(Object.hasOwn(json,'schemaVersion'),false);assert.equal(json.issues.length,5);
  assert.deepEqual(json.issues.filter(i=>i.configuredRuleId).map(i=>i.ruleIds[0]),['Rule-018','Rule-020']);
  assert.ok(!JSON.stringify(json).includes('PRIVATE_VALUE'));assert.deepEqual(json.attributeRules,{kind:copy.attributeRules.kind,rules:copy.attributeRules.rules});
  const csv=parseCsv(buildCsvReport(copy));assert.equal(csv.length,6);
  const row=Object.fromEntries(csv[0].map((c,i)=>[c,csv[1][i]]));assert.equal(row.field,"'=field");assert.equal(row.configured_rule_id,"'=PID");assert.equal(row.error_x,'');
  for(const bad of [{...copy,schemaVersion:'1.0'},{...copy,attributeSummary:{...copy.attributeSummary,invalid:0}},{...copy,records:copy.records.map(r=>({...r,attributeResult:undefined}))}]) assert.throws(()=>buildJsonReport(bad));
});
test('refuses partial and internally inconsistent runs rather than exporting misleading totals',()=>{
  for(const broken of [{...run,run:{...run.run,status:'cancelled'}},{...run,summary:{...run.summary,invalid:2}},{...run,records:[...run.records,run.records[0]]}]){
    assert.throws(()=>buildJsonReport(broken));assert.throws(()=>buildCsvReport(broken));
  }
});
test('reports include stable rule numbers without replacing original diagnostics',()=>{
  const issue=JSON.parse(buildJsonReport(run)).issues[0];
  assert.deepEqual(issue.ruleIds,['Rule-011']);assert.equal(Object.hasOwn(issue,'errorId'),false);
  assert.equal(issue.reasonCode,'GEOMETRY_INVALID');
  const rows=parseCsv(buildCsvReport(run));
  assert.equal(rows[0].includes('error_id'),false);
  assert.equal(rows[1][rows[0].indexOf('rule_ids')],'["Rule-011"]');
  assert.deepEqual(JSON.parse(buildJsonReport(run)).issues[1].ruleIds,['Rule-008']);
  const warned=structuredClone(run);
  warned.records[1].warnings=['INVALID_FEATURE_ID','FUTURE_WARNING'];
  assert.throws(()=>buildJsonReport(warned),/warnings/);
});

test('CSV and JSON omit requested metadata fields at every exported level and preserve the completed run', () => {
  const removed = new Set(['schema_version','schemaVersion','engine_name','engine_version','wasm_package_version','coordinate_semantics','warnings','domain','wasmPackageVersion','coordinateSemantics']);
  const before = structuredClone(run), json = JSON.parse(buildJsonReport(run));
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!removed.has(key), `Unexpected exported field: ${key}`);
      inspect(child);
    }
  }
  inspect(json);
  assert.deepEqual(json.engine, { parameters: run.engine.parameters });
  const rows = parseCsv(buildCsvReport(run));
  assert.deepEqual(rows[0], ['issue_id','check_parameters','record_key','feature_index','feature_id','feature_id_type','geometry_type','status','rule_ids','reason_code','reason','error_x','error_y','attribute_status','configured_rule_id','field','constraint','expected','participants','scope','issue_geometry','rule_names','rule_families','occurrence','measurements']);
  for (const row of rows.slice(1)) assert.equal(row.length, rows[0].length);
  assert.equal(json.issues.length, rows.length - 1);
  assert.deepEqual(run, before);
});
