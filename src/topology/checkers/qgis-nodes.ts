import { geometryParts } from '../geometry-parts.ts';
import { distance, pointSegmentDistance, qgisPrecision, segmentIntersection } from '../precision.ts';
import { candidatePairs } from '../index.ts';
import { qgisChecker, emitQgis } from './qgis-common.ts';

export const nodeCheckers = ['Rule-024','Rule-025','Rule-026'].map(id => qgisChecker(id, async context => {
  const {tolerance}=qgisPrecision(context.parameters.toleranceDigits as number);
  for(const record of context.records)for(const part of geometryParts(record.geometry)){
    const points=part.positions,n=points.length;
    if(n<2)continue;
    const source=(index:number,segment=false)=>({recordKey:record.recordKey,part:part.part,ring:part.ring,...(segment?{segment:index}:{vertex:index})});
    if(id==='Rule-025'){
      for(let vertex=0;vertex<n;vertex++){
        context.checked();
        if(distance(points[(vertex+n-1)%n]!,points[vertex]!)<tolerance)emitQgis(context,id,[source(vertex)],{x:points[vertex]![0]!,y:points[vertex]![1]!});
        await context.controls.yield();
      }
      continue;
    }
    // Collapse adjacent duplicate nodes for self-contact, retaining original indices.
    const indices:number[]=[];
    for(let i=0;i<n;i++)if(!indices.length || id==='Rule-024' || distance(points[i]!,points[indices.at(-1)!]!)>tolerance)indices.push(i);
    if(id==='Rule-026')while(indices.length>1 && distance(points[indices[0]!]!,points[indices.at(-1)!]!)<tolerance)indices.pop();
    const segments=indices.slice(0,part.closed?indices.length:indices.length-1).map((start,i)=>({start,end:indices[(i+1)%indices.length]!,i}));
    const entries=segments.map((s,i)=>({featureIndex:i,bbox:[Math.min(points[s.start]![0]!,points[s.end]![0]!)-tolerance,Math.min(points[s.start]![1]!,points[s.end]![1]!)-tolerance,Math.max(points[s.start]![0]!,points[s.end]![0]!)+tolerance,Math.max(points[s.start]![1]!,points[s.end]![1]!)+tolerance] as [number,number,number,number]}));
    if(id==='Rule-024')for(const [left,right] of candidatePairs(entries,()=>context.controls.checkpoint())){
      context.checked();const a=segments[left]!,b=segments[right]!;
      if(a.start!==b.end && a.end!==b.start){
        const location=segmentIntersection(points[a.start]!,points[a.end]!,points[b.start]!,points[b.end]!,tolerance);
        if(location)emitQgis(context,id,[source(a.start,true),source(b.start,true)],location);
      }
      await context.controls.yield();
    }
    else {
      const vertexEntries=indices.map((index,i)=>({featureIndex:segments.length+i,bbox:[points[index]![0]!,points[index]![1]!,points[index]![0]!,points[index]![1]!] as [number,number,number,number]}));
      const contacts=new Set<number>();
      for(const [a,b] of candidatePairs([...entries,...vertexEntries],()=>context.controls.checkpoint())){
        context.checked();const segmentIndex=a<segments.length?a:b,vertexIndex=a>=segments.length?a:b;
        if(segmentIndex<segments.length && vertexIndex>=segments.length){
          const s=segments[segmentIndex]!,index=indices[vertexIndex-segments.length]!;
          if(index!==s.start && index!==s.end && !contacts.has(index) && pointSegmentDistance(points[index]!,points[s.start]!,points[s.end]!)<tolerance){
            contacts.add(index);emitQgis(context,id,[source(index)],{x:points[index]![0]!,y:points[index]![1]!});
          }
        }
        await context.controls.yield();
      }
    }
    // A single segment is a completed check even with no spatial candidates.
    if(!entries.length || entries.length===1)context.checked();
    await context.controls.yield();
  }
}));
