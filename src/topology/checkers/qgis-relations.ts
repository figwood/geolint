import type { TopologyDatasetContext, TopologyInput, SourcePath } from '../contracts.ts';
import { geometryParts } from '../geometry-parts.ts';
import { distance, finite, qgisPrecision, segmentIntersection } from '../precision.ts';
import { candidatePairs, geometryExtent } from '../index.ts';
import { InspectionError } from '../../errors.ts';
import { emitQgis, qgisChecker } from './qgis-common.ts';

function lines(context: TopologyDatasetContext) {
  return context.records.flatMap(record=>[...geometryParts(record.geometry)].map(part=>({record,part:part.part,points:part.closed?[...part.positions,part.positions[0]!]:part.positions})));
}
const bounds=(points:readonly number[][]):[number,number,number,number]=>{
  let x=Infinity,y=Infinity,X=-Infinity,Y=-Infinity;
  for(const p of points){x=Math.min(x,p[0]!);y=Math.min(y,p[1]!);X=Math.max(X,p[0]!);Y=Math.max(Y,p[1]!);}
  return [x,y,X,Y];
};
const intersects=(a:readonly number[],b:readonly number[])=>a[0]!<=b[2]!&&b[0]!<=a[2]!&&a[1]!<=b[3]!&&b[1]!<=a[3]!;
// Preserve QGIS 3.44 CheckerUtils::pointOnLine's supporting-line test.
// Its spatial feature query supplies the coarse bounds; it does not clamp projection.
function supportingLineDistance(p:readonly number[],a:readonly number[],b:readonly number[]):number {
  const length=distance(a,b);if(!length)return Infinity;
  return Math.abs(finite((b[1]!-a[1]!)/length*(p[0]!-a[0]!)-(b[0]!-a[0]!)/length*(p[1]!-a[1]!)));
}
async function checkDangles(context: TopologyDatasetContext):Promise<void>{
  const parts=lines(context),{tolerance}=qgisPrecision(context.parameters.toleranceDigits as number);
  const extents=new Map(context.records.map(record=>[record.recordKey,geometryExtent(record.geometry).bbox]));
  for(const own of parts){
    const box=bounds(own.points);
    for(const vertex of [0,own.points.length-1]){
      const point=own.points[vertex]!;let touches=false;
      for(const other of parts){
        if(!intersects(box,extents.get(other.record.recordKey)!))continue;
        const self=own===other;
        for(let segment=self?1:0;segment<other.points.length-1-(self?1:0);segment++){
          context.checked();
          if(supportingLineDistance(point,other.points[segment]!,other.points[segment+1]!)<tolerance){touches=true;break;}
          await context.controls.yield();
        }
        if(touches)break;
      }
      context.checked();
      if(!touches)emitQgis(context,'Rule-030',[{recordKey:own.record.recordKey,part:own.part,vertex}],{x:point[0]!,y:point[1]!});
      await context.controls.yield();
    }
  }
}
async function checkLineIntersections(context:TopologyDatasetContext):Promise<void>{
  const segments=lines(context).flatMap(line=>line.points.slice(1).map((end,segment)=>({line,segment,start:line.points[segment]!,end})));
  const entries=segments.map((s,featureIndex)=>({featureIndex,bbox:bounds([s.start,s.end])}));
  const {tolerance}=qgisPrecision(context.parameters.toleranceDigits as number);
  for(const record of context.records)context.checked();
  for(const [a,b] of candidatePairs(entries,()=>context.controls.checkpoint())){
    context.checked();const left=segments[a]!,right=segments[b]!;
    if(left.line!==right.line){
      const location=segmentIntersection(left.start,left.end,right.start,right.end,tolerance);
      if(location){
        const source=(s:typeof left):SourcePath=>({recordKey:s.line.record.recordKey,part:s.line.part,segment:s.segment});
        emitQgis(context,'Rule-039',[source(left),source(right)],location);
      }
    }
    await context.controls.yield();
  }
}
function family(record:TopologyInput):string{return record.geometry.type.replace(/^Multi/,'');}
async function checkFeatures(context:TopologyDatasetContext,id:string):Promise<void>{
  const session=context.session,digits=context.parameters.toleranceDigits as number;
  if(!session.qgisEquals || !session.qgisContains || !session.centroid)throw new InspectionError('TOPOLOGY_ENGINE_UNAVAILABLE','QGIS relation operations are unavailable.');
  const duplicateMembers=new Map<string,TopologyInput[]>();
  const records=[...context.records].sort((a,b)=>a.featureIndex-b.featureIndex);
  for(const record of records)context.checked();
  const entries=records.map((record,featureIndex)=>({featureIndex,bbox:geometryExtent(record.geometry).bbox}));
  for(const [a,b] of candidatePairs(entries,()=>context.controls.checkpoint())){
    context.checked();const left=records[a]!,right=records[b]!;
    if(family(left)===family(right)){
      if(id==='Rule-035'){
        if(session.qgisEquals(left.recordKey,right.recordKey,digits)){
          const members=duplicateMembers.get(right.recordKey)??[];members.push(left);duplicateMembers.set(right.recordKey,members);
        }
      }else{
        for(const [container,subject] of [[left,right],[right,left]] as const){
          if(session.qgisContains(container.recordKey,subject.recordKey,digits) && !session.qgisContains(subject.recordKey,container.recordKey,digits))emitQgis(context,id,[{recordKey:subject.recordKey},{recordKey:container.recordKey}],session.centroid(subject.recordKey));
        }
      }
    }
    await context.controls.yield();
  }
  for(const record of records){
    const members=duplicateMembers.get(record.recordKey);
    if(members?.length)emitQgis(context,id,[record,...members.sort((a,b)=>a.featureIndex-b.featureIndex)].map(r=>({recordKey:r.recordKey})),session.centroid(record.recordKey));
  }
}
export const relationCheckers=['Rule-030','Rule-035','Rule-036','Rule-039'].map(id=>{
  const checker=qgisChecker(id,context=>id==='Rule-030'?checkDangles(context):id==='Rule-039'?checkLineIntersections(context):checkFeatures(context,id),id==='Rule-035'||id==='Rule-036'?'valid':'normalized');
  return {...checker,outputSchema:{...checker.outputSchema!,scopes:id==='Rule-030'||id==='Rule-035'?['record' as const]:id==='Rule-036'?['pair' as const]:['record' as const,'pair' as const],participants:{min:id==='Rule-035'||id==='Rule-036'?2:1,max:id==='Rule-035'?null:id==='Rule-030'?1:2}}};
});
