import type { InspectionRecord } from '../contracts.ts';
import type { RuleParameters, TopologyIssue } from './contracts.ts';
import { polygonArea, polygonCentroid } from './geometry-parts.ts';
import { qgisPrecision } from './precision.ts';

const pathFields: Readonly<Record<string,readonly string[]>> = {
  'Rule-024':['part','ring','segment'], 'Rule-025':['part','ring','vertex'], 'Rule-026':['part','ring','vertex'],
  'Rule-027':['part','ring'], 'Rule-028':['part','ring'], 'Rule-029':[], 'Rule-030':['part','vertex'],
  'Rule-031':['part','ring','vertex'], 'Rule-032':['part','ring','vertex'], 'Rule-033':['part'], 'Rule-034':['part'],
  'Rule-035':[], 'Rule-036':[], 'Rule-037':[], 'Rule-038':[], 'Rule-039':['part','segment'], 'Rule-040':[],
};
export function verifyQgisIssue(id:string,issue:TopologyIssue,records:ReadonlyMap<string,InspectionRecord>,parameters:RuleParameters):void {
  const fail=():never=>{throw new Error('Optional rule occurrence or measurement contradicts its rule.');};
  const sources=issue.occurrence!.sources,fields=pathFields[id]!,m=issue.measurements??{};
  const expectedScope=id==='Rule-035'?'record':id==='Rule-038'?'dataset':new Set(sources.map(source=>source.recordKey)).size>1?'pair':'record';
  if(issue.scope!==expectedScope)fail();
  const regional=id==='Rule-037'||id==='Rule-038';
  if(regional?issue.occurrence!.region===undefined:issue.occurrence!.region!==undefined)fail();
  for(const source of sources)if(Object.keys(source).length!==fields.length+1||fields.some(key=>!Object.hasOwn(source,key)))fail();
  if(new Set(sources.map(source=>JSON.stringify(source))).size!==sources.length)fail();
  const twoSources=id==='Rule-024'||id==='Rule-036'||id==='Rule-037'||id==='Rule-039';
  if(id==='Rule-038'?sources.length!==0:id==='Rule-035'?sources.length<2:twoSources?sources.length!==2:sources.length!==1)fail();
  if(id==='Rule-024'&&(sources[0]!.recordKey!==sources[1]!.recordKey||sources[0]!.part!==sources[1]!.part||sources[0]!.ring!==sources[1]!.ring||sources[0]!.segment!>=sources[1]!.segment!))fail();
  if(id==='Rule-039'&&sources[0]!.recordKey===sources[1]!.recordKey&&sources[0]!.part===sources[1]!.part)fail();
  if(id==='Rule-035'){
    const indices=sources.map(source=>records.get(source.recordKey)!.featureIndex);
    if(indices.slice(1).some((value,i)=>value>=indices[0]!||i>0&&value<=indices[i]!))fail();
  }
  if(id==='Rule-027'){
    const s=sources[0]!,evidence=records.get(s.recordKey)!.preflightEvidence?.rings.find(r=>r.part===s.part&&r.ring===s.ring);
    if(!evidence||evidence.nodeCount!==m.nodeCount||![1,2].includes(m.nodeCount!)||JSON.stringify(issue.location)!==JSON.stringify(evidence.first))fail();
  }
  if(id==='Rule-028'&&sources[0]!.ring!<1)fail();
  if(id==='Rule-029'&&(m.partCount!==1||records.get(sources[0]!.recordKey)!.geometryShape?.parts.length!==1))fail();
  if(id==='Rule-040'&&(parameters.allowedTypes as readonly string[]).includes(records.get(sources[0]!.recordKey)!.geometryType!))fail();
  const precision=typeof parameters.toleranceDigits==='number'?qgisPrecision(parameters.toleranceDigits):{tolerance:0,reducedTolerance:0};
  if(id==='Rule-031'&&!(m.length!>precision.tolerance&&m.length!<m.minLength!))fail();
  if(id==='Rule-032'&&!(m.angle!>=0&&m.angle!<m.minAngle!))fail();
  if(id==='Rule-033'&&!(m.area!<m.minArea!))fail();
  if(id==='Rule-034'&&!(m.area!>0&&m.thinness!>m.maxThinness!&&(!m.maxArea||m.area!<=m.maxArea)))fail();
  if(id==='Rule-037'&&!(m.area!>precision.reducedTolerance&&(!m.maxArea||m.area!<m.maxArea)))fail();
  if(id==='Rule-038'&&!(m.area!>=precision.reducedTolerance&&(!m.maxArea||m.area!<=m.maxArea)))fail();
  if(regional){
    if(issue.geometry?.type!=='Polygon')fail();
    if(polygonArea(issue.geometry!.coordinates as number[][][])!==m.area||JSON.stringify(polygonCentroid(issue.geometry!.coordinates as number[][][]))!==JSON.stringify(issue.location))fail();
  }
}
