import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {createEngine} from '../../src/engine/geos.ts';
import {normalizeRoot} from '../../src/geojson/normalize.ts';
import {inspectDataset} from '../../src/inspection/dataset.ts';
import {emptyAttributeRuleFile} from '../../src/attributes/config.ts';

export const singleLayerFixture=new URL('../../tests/fixtures/topology/single-layer.json',import.meta.url);
function canonicalRing(ring){
  if(!Array.isArray(ring)||ring.length<4||!ring.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))||!isDeepStrictEqual(ring[0],ring.at(-1)))throw new Error('Invalid ring');
  let points=ring.slice(0,-1).map(p=>p.map(n=>n===0?0:n));
  let changed=true;
  while(changed&&points.length>3){
    changed=false;
    for(let i=0;i<points.length;i++){
      const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];
      if((b[0]-a[0])*(c[1]-b[1])===(b[1]-a[1])*(c[0]-b[0])&&b[0]>=Math.min(a[0],c[0])&&b[0]<=Math.max(a[0],c[0])&&b[1]>=Math.min(a[1],c[1])&&b[1]<=Math.max(a[1],c[1])){points.splice(i,1);changed=true;break;}
    }
  }
  return [points,points.toReversed()].flatMap(direction=>direction.map((_,i)=>JSON.stringify([...direction.slice(i),...direction.slice(0,i)]))).sort()[0];
}
function normalizedIssues(issues){
  if(!Array.isArray(issues))throw new Error('Missing issues');
  return issues.map(issue=>{
    if(!Array.isArray(issue.participants)||!issue.participants.every(Number.isSafeInteger)||new Set(issue.participants).size!==issue.participants.length)throw new Error('Invalid members');
    const members=[...issue.participants].sort((a,b)=>a-b);
    if(issue.geometry){
      if(issue.geometry.type!=='Polygon'||!issue.geometry.coordinates.length)throw new Error('Invalid gap');
      if(!issue.location||!issue.geometry.coordinates[0].some(([x,y])=>x===issue.location.x&&y===issue.location.y))throw new Error('Gap location is not on its boundary');
      return JSON.stringify({participants:members,geometry:[canonicalRing(issue.geometry.coordinates[0]),...issue.geometry.coordinates.slice(1).map(canonicalRing).sort()]});
    }
    if(issue.location!==null&&(!issue.location||!Number.isFinite(issue.location.x)||!Number.isFinite(issue.location.y)))throw new Error('Invalid location');
    return JSON.stringify({participants:members,location:issue.location});
  }).sort();
}
function compareCase(actual,want){
  if(!isDeepStrictEqual(actual.invalid,want.invalid)||actual.rules.length!==want.rules.length)throw new Error('Invalid geometry results or rule count differ');
  for(const rule of want.rules){
    const got=actual.rules.find(item=>item.id===rule.id);
    if(!got||['participants','coverage','checks','candidates'].some(key=>got[key]!==rule[key]))throw new Error(`${rule.id}: coverage or counts differ`);
    if(!isDeepStrictEqual(normalizedIssues(got.issues),normalizedIssues(rule.issues)))throw new Error(`${rule.id}: issue locations, regions or participants differ`);
    if(got.state!==(rule.issues.length?'violated':rule.checks?'passed':'skipped'))throw new Error(`${rule.id}: state differs`);
  }
}
export function compareSingleLayerTopology(actual,reference,expected){
  const errors=[];
  const version=value=>typeof value==='string'?value.match(/^\d+\.\d+\.\d+/)?.[0]:undefined;
  if(actual?.status!=='completed'||reference?.status!=='completed')errors.push('Single-layer runners did not both complete.');
  if(version(actual?.version)!==expected.geosVersion||version(reference?.version)!==expected.geosVersion)errors.push('Single-layer GEOS versions differ.');
  if(!/^3\.(4\d|[5-9]\d)\./.test(reference?.qgisVersion??'')||reference?.reference!=='pyqgis-single-layer')errors.push('Unsupported QGIS version or reference kind.');
  for(const [label,report] of [['geolint',actual],['QGIS',reference]]){
    if(!Array.isArray(report?.cases)||report.cases.length!==expected.cases.length||new Set(report.cases.map(c=>c.name)).size!==expected.cases.length){errors.push(`${label}: missing or duplicate cases.`);continue;}
    for(const sample of expected.cases){try{const got=report.cases.find(c=>c.name===sample.name);if(!got)throw new Error('Missing case');compareCase(got,sample.expected);}catch(e){errors.push(`${label} ${sample.name}: ${e.message}`);}}
  }
  return {status:errors.length?'failed':'matched',reference:'pyqgis-single-layer',qgisVersion:reference?.qgisVersion,sourceReference:expected.sourceReference,errors};
}
export async function checkSingleLayerRegression(){
  const expected=JSON.parse(await readFile(singleLayerFixture,'utf8')),engine=await createEngine();
  const report={status:'completed',version:engine.info.version,sourceReference:expected.sourceReference,cases:[]};
  try{
    for(const sample of expected.cases){
      const records=normalizeRoot({type:'FeatureCollection',features:sample.geometries.map(geometry=>({type:'Feature',id:'same',geometry,properties:{}}))});
      const result=await inspectDataset(records,engine,emptyAttributeRuleFile(),{topology:{rules:sample.expected.rules.map(rule=>({id:rule.id}))}});
      const item={name:sample.name,invalid:result.records.filter(r=>r.status==='invalid').map(r=>r.featureIndex),rules:result.topology.rules.map(rule=>({id:rule.ruleId,participants:rule.participantCount,coverage:rule.coverage,checks:rule.checkCount,candidates:rule.candidateCount,state:rule.status,
        issues:rule.issues.map(issue=>({participants:issue.participants.map(p=>p.featureIndex),location:issue.location,...(issue.geometry?{geometry:issue.geometry}:{})}))}))};
      compareCase(item,sample.expected);report.cases.push(item);
    }
  }finally{engine.dispose();}
  return {report,expected,cases:report.cases.length,problems:report.cases.reduce((n,c)=>n+c.invalid.length+c.rules.reduce((n,r)=>n+r.issues.length,0),0)};
}
