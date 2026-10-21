import { geometryParts, polygonArea, polygonCentroid } from '../geometry-parts.ts';
import { distance, finite, qgisPrecision } from '../precision.ts';
import { emitQgis, qgisChecker } from './qgis-common.ts';

export const metricCheckers = ['Rule-031','Rule-032','Rule-033','Rule-034'].map(id => qgisChecker(id, async context => {
  const tolerance = typeof context.parameters.toleranceDigits==='number' ? qgisPrecision(context.parameters.toleranceDigits).tolerance : 0;
  for(const record of context.records){
    const geometry=record.geometry;
    if(id==='Rule-031' || id==='Rule-032'){
      for(const part of geometryParts(geometry)){
        const p=part.positions,n=p.length;
        for(let vertex=part.closed?0:1;vertex<(id==='Rule-032' && !part.closed?n-1:n);vertex++){
          context.checked();const current=p[vertex]!,previous=p[(vertex+n-1)%n]!,length=distance(current,previous);
          const source={recordKey:record.recordKey,part:part.part,ring:part.ring,vertex};
          if(id==='Rule-031'){
            const minLength=context.parameters.minLength as number;
            if(length<minLength && length>tolerance)emitQgis(context,id,[source],{x:finite(current[0]!/2+previous[0]!/2),y:finite(current[1]!/2+previous[1]!/2)},{length,minLength});
          }else{
            const next=p[(vertex+1)%n]!,other=distance(current,next);
            if(length>0 && other>0){
              const dot=finite((previous[0]!-current[0]!)/length*((next[0]!-current[0]!)/other)+(previous[1]!-current[1]!)/length*((next[1]!-current[1]!)/other));
              const angle=finite(Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI),minAngle=context.parameters.minAngle as number;
              if(angle<minAngle)emitQgis(context,id,[source],{x:current[0]!,y:current[1]!},{angle,minAngle});
            }
          }
          await context.controls.yield();
        }
      }
      context.checked();
    }else if(geometry.type==='Polygon' || geometry.type==='MultiPolygon'){
      const parts=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
      for(const [part,rings] of parts.entries()){
        context.checked();const area=polygonArea(rings),location=polygonCentroid(rings),source={recordKey:record.recordKey,part};
        if(id==='Rule-033'){
          const minArea=context.parameters.minArea as number;
          if(area<minArea)emitQgis(context,id,[source],location,{area,minArea});
        }else{
          let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
          for(const ring of rings)for(const [x,y] of ring){context.controls.checkpoint();minX=Math.min(minX,x!);minY=Math.min(minY,y!);maxX=Math.max(maxX,x!);maxY=Math.max(maxY,y!);}
          const side=finite(Math.max(maxX-minX,maxY-minY)),thinness=finite(finite(side*side)/area);
          const maxThinness=context.parameters.maxThinness as number,maxArea=context.parameters.maxArea as number;
          if(thinness>maxThinness && (!maxArea || area<=maxArea))emitQgis(context,id,[source],location,{thinness,area,maxThinness,maxArea});
        }
        await context.controls.yield();
      }
    }
  }
}, id==='Rule-033'||id==='Rule-034'?'valid':'normalized'));
