import type { Geometry } from '../contracts.ts';
import type { Occurrence } from './contracts.ts';
import { geometryParts } from './geometry-parts.ts';
export interface GeometryShape { parts: {rings:number[]}[] }
export function geometryShape(geometry:Geometry):GeometryShape {
  const parts:{rings:number[]}[]=[];
  if(geometry.type==='Point')return {parts:[{rings:[1]}]};
  if(geometry.type==='MultiPoint')return {parts:geometry.coordinates.map(()=>({rings:[1]}))};
  for(const part of geometryParts(geometry)){
    parts[part.part]??={rings:[]};parts[part.part]!.rings[part.ring]=part.positions.length+Number(part.closed);
  }
  return {parts};
}
export function occurrenceSignature(ruleId:string, occurrence:Occurrence):string {
  return `${ruleId}:${JSON.stringify(occurrence)}`;
}
