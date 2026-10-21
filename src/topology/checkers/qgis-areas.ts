import { qgisChecker,emitQgis } from './qgis-common.ts';
import { candidatePairs,geometryExtent } from '../index.ts';
import { polygonArea, polygonCentroid } from '../geometry-parts.ts';
import { qgisPrecision } from '../precision.ts';
import { InspectionError } from '../../errors.ts';
export const qgisAreaCheckers=['Rule-037','Rule-038'].map(id=>{
  const checker=qgisChecker(id,async context=>{
    const digits=context.parameters.toleranceDigits as number,{reducedTolerance}=qgisPrecision(digits),maxArea=context.parameters.maxArea as number;
    const emit=(geometry:import('../../contracts.ts').PolygonalGeometry,sources:import('../contracts.ts').SourcePath[],region:number)=>{
      if(geometry.type!=='Polygon')throw new InspectionError('ENGINE_FATAL_ERROR','Expected individual polygon regions.');
      const area=polygonArea(geometry.coordinates),location=polygonCentroid(geometry.coordinates);
      if(id==='Rule-037'?area>reducedTolerance&&(!maxArea||area<maxArea):area>=reducedTolerance&&(!maxArea||area<=maxArea))emitQgis(context,id,sources,location,{area,maxArea},geometry,region);
    };
    if(id==='Rule-038'){
      if(!context.session.qgisPolygonGaps)throw new InspectionError('TOPOLOGY_ENGINE_UNAVAILABLE','QGIS gap operations are unavailable.');
      context.checked();const gaps=await context.session.qgisPolygonGaps(context.records.map(r=>r.recordKey),digits,context.controls);
      for(const [region,geometry] of gaps.entries()){emit(geometry,[],region);await context.controls.yield();}
    }else{
      if(!context.session.qgisOverlaps||!context.session.polygonIntersections)throw new InspectionError('TOPOLOGY_ENGINE_UNAVAILABLE','QGIS overlay operations are unavailable.');
      for(const record of context.records)context.checked();
      const entries=context.records.map((record,featureIndex)=>({featureIndex,bbox:geometryExtent(record.geometry).bbox}));
      for(const [a,b] of candidatePairs(entries,()=>context.controls.checkpoint())){
        context.checked();const left=context.records[a]!,right=context.records[b]!;
        if(context.session.qgisOverlaps(left.recordKey,right.recordKey,digits)){
          const regions=await context.session.polygonIntersections(left.recordKey,right.recordKey,digits,context.controls);
          for(const [region,geometry] of regions.entries())emit(geometry,[{recordKey:left.recordKey},{recordKey:right.recordKey}],region);
        }
        await context.controls.yield();
      }
    }
  },'valid');
  return {...checker,outputSchema:{...checker.outputSchema!,scopes:[id==='Rule-037'?'pair' as const:'dataset' as const],participants:{min:id==='Rule-037'?2:0,max:id==='Rule-037'?2:0},geometry:'required' as const}};
});
