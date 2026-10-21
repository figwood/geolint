import type { Geometry } from '../contracts.ts';
import { finite } from './precision.ts';
export interface GeometryPart {part:number;ring:number;closed:boolean;positions:number[][]}
export function* geometryParts(geometry: Geometry): Iterable<GeometryPart> {
  const ring = function*(positions:number[][],part:number,index:number): Iterable<GeometryPart> {
    const first=positions[0],last=positions.at(-1);
    const closed=positions.length>1 && first![0]===last![0] && first![1]===last![1];
    yield {part,ring:index,closed,positions:closed?positions.slice(0,-1):positions};
  };
  if (geometry.type==='LineString') yield* ring(geometry.coordinates,0,0);
  else if (geometry.type==='MultiLineString') for(const [part,points] of geometry.coordinates.entries()) yield* ring(points,part,0);
  else if(geometry.type==='Polygon') for(const [index,points] of geometry.coordinates.entries()) yield* ring(points,0,index);
  else if(geometry.type==='MultiPolygon') for(const [part,polygon] of geometry.coordinates.entries()) for(const [index,points] of polygon.entries()) yield* ring(points,part,index);
}
export function ringArea(points: readonly number[][]): number {
  if (!points.length) return 0;
  const origin=points[0]!;let sum=0;
  for(let i=1;i<points.length-1;i++)sum=finite(sum+finite((points[i]![0]!-origin[0]!)*(points[i+1]![1]!-origin[1]!)-(points[i+1]![0]!-origin[0]!)*(points[i]![1]!-origin[1]!)));
  return Math.abs(sum/2);
}
export function polygonArea(rings: readonly number[][][]): number {
  return finite(ringArea(rings[0]??[]) - rings.slice(1).reduce((sum,points)=>finite(sum+ringArea(points)),0));
}
export function firstPosition(geometry:Geometry): {x:number;y:number}|null {
  if(geometry.type==='GeometryCollection')return null;
  let value: unknown=geometry.coordinates;
  while(Array.isArray(value) && Array.isArray(value[0])) value=value[0];
  return Array.isArray(value) && value.length>=2 ? {x:value[0] as number,y:value[1] as number}:null;
}
export function polygonCentroid(rings:readonly number[][][]):{x:number;y:number} {
  let weight=0,x=0,y=0;
  for(const [index,points] of rings.entries()){
    const origin=points[0]!;let crossSum=0,cx=0,cy=0;
    for(let i=1;i<points.length;i++){
      const a=points[i-1]!,b=points[i]!,ax=a[0]!-origin[0]!,ay=a[1]!-origin[1]!,bx=b[0]!-origin[0]!,by=b[1]!-origin[1]!;
      const cross=finite(ax*by-bx*ay);crossSum=finite(crossSum+cross);cx=finite(cx+finite((ax+bx)*cross));cy=finite(cy+finite((ay+by)*cross));
    }
    if(crossSum){const w=Math.abs(crossSum)*(index===0?1:-1);weight=finite(weight+w);x=finite(x+finite((origin[0]!+cx/(3*crossSum))*w));y=finite(y+finite((origin[1]!+cy/(3*crossSum))*w));}
  }
  if(!weight){const p=rings[0]![0]!;return {x:p[0]!,y:p[1]!};}
  return {x:finite(x/weight),y:finite(y/weight)};
}
