import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {createEngine} from '../../src/engine/geos.ts';
import {normalizeRoot} from '../../src/geojson/normalize.ts';
import {inspectDataset} from '../../src/inspection/dataset.ts';
import {emptyAttributeRuleFile} from '../../src/attributes/config.ts';
import {buildJsonReport,buildCsvReport} from '../../src/report/export.ts';
export const geometryCheckerFixture=new URL('../../tests/fixtures/topology/geometry-checker.json',import.meta.url);
function ringKey(ring){
 if(!Array.isArray(ring)||ring.length<4||!isDeepStrictEqual(ring[0],ring.at(-1)))throw new Error('Invalid problem ring');
 const points=ring.slice(0,-1);return [points,points.toReversed()].flatMap(p=>p.map((_,i)=>JSON.stringify([...p.slice(i),...p.slice(0,i)]))).sort()[0];
}
function normalized(issue){
 const result={participants:issue.participants,location:issue.location,occurrence:issue.occurrence,measurements:Object.fromEntries(Object.entries(issue.measurements??{}).sort(([a],[b])=>a.localeCompare(b)))};
 if(issue.geometry){if(issue.geometry.type!=='Polygon')throw new Error('Expected a polygon region');result.geometry=[ringKey(issue.geometry.coordinates[0]),...issue.geometry.coordinates.slice(1).map(ringKey).sort()];}
 return result;
}
function assertCase(got,want){
 if(!got||got.name!==want.name||got.ruleId!==want.ruleId)throw new Error('Missing or mismatched rule case');
 for(const key of ['participants','coverage','state'])if(got[key]!==want.expected[key])throw new Error(`Incorrect ${key}`);
 if(!isDeepStrictEqual(got.parameters,want.parameters))throw new Error('Configuration snapshot differs');
 const actual=got.issues.map(normalized).map(JSON.stringify).sort(),expected=want.expected.issues.map(normalized).map(JSON.stringify).sort();
 if(!isDeepStrictEqual(actual,expected))throw new Error(`Issues differ: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
}
export function compareGeometryChecker(actual,reference,expected){
 const errors=[];
 if(actual?.status!=='completed'||reference?.status!=='completed')errors.push('Both runners must complete.');
 if(actual?.geosVersion?.split('-')[0]!==expected.geosVersion||reference?.geosVersion?.split('-')[0]!==expected.geosVersion)errors.push('GEOS versions differ.');
 if(!/^3\.(4\d|[5-9]\d)\./.test(reference?.qgisVersion??'')||reference?.referenceKind!=='pyqgis-geometry-checker-algorithms')errors.push('Invalid QGIS reference kind/version.');
 for(const [label,report] of [['geolint',actual],['QGIS',reference]]){
  if(!Array.isArray(report?.cases)||report.cases.length!==expected.cases.length||new Set(report.cases.map(c=>c.name)).size!==expected.cases.length){errors.push(`${label}: missing or duplicate cases`);continue;}
  for(const sample of expected.cases)try{assertCase(report.cases.find(c=>c.name===sample.name),sample);}catch(e){errors.push(`${label} ${sample.name}: ${e.message}`);}
 }
 return {status:errors.length?'failed':'matched',referenceKind:reference?.referenceKind,qgisVersion:reference?.qgisVersion,sourceReference:expected.sourceReference,pluginParity:false,errors};
}
export async function checkGeometryCheckerRegression(){
 const expected=JSON.parse(await readFile(geometryCheckerFixture,'utf8')),engine=await createEngine();
 const report={status:'completed',geosVersion:engine.info.version,referenceKind:'geolint-real-wasm',sourceReference:expected.sourceReference,cases:[]};
 try{
  for(const sample of expected.cases){
   const normalized=normalizeRoot({type:'FeatureCollection',features:sample.geometries.map(geometry=>({type:'Feature',id:'same',properties:{},geometry}))});
   const attributes=emptyAttributeRuleFile();
   const run=await inspectDataset(normalized,engine,attributes,{topology:{rules:[{id:sample.ruleId,parameters:sample.parameters}]}});
   const rule=run.topology.rules[0];
   const item={name:sample.name,ruleId:sample.ruleId,parameters:run.topology.options.rules[0].parameters,participants:rule.participantCount,coverage:rule.coverage,state:rule.status,
    work:{checks:rule.checkCount,candidates:rule.candidateCount},issues:rule.issues.map(i=>({participants:i.participants.map(p=>p.featureIndex),location:i.location,occurrence:i.occurrence,measurements:i.measurements??{},...(i.geometry?{geometry:i.geometry}:{})}))};
   assertCase(item,sample);
   if(rule.issues.length&&!rule.checkCount)throw new Error('Problems require completed work');
   const completed={...run,schemaVersion:'5.0',engine:engine.info,attributeRules:attributes,run:{fileName:'reference.geojson',fileBytes:100,completedAt:'2026-10-15T00:00:00Z',status:'completed'}};
   buildJsonReport(completed);buildCsvReport(completed);
   report.cases.push(item);
  }
 }finally{engine.dispose();}
 return {report,expected};
}
