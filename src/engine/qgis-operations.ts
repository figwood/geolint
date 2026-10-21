import type { Geometry, PolygonalGeometry } from '../contracts.ts';
import type { TopologyOperationControls } from '../topology/contracts.ts';
import type { GeosBindings } from './geos.ts';
import { InspectionError } from '../errors.ts';
import { finite } from '../topology/precision.ts';

// QGIS constructs GEOS inputs by rounding coordinates, without altering source data.
export function precisionGeometry(geometry: Geometry, digits: number): Geometry {
  const scale=10 ** digits;
  const position=(values:unknown):unknown=>Array.isArray(values)?values.map(value=>typeof value==='number'?finite(Math.sign(value)*Math.floor(finite(Math.abs(value)*scale)+0.5)/scale):position(value)):values;
  if(geometry.type==='GeometryCollection')return {type:'GeometryCollection',geometries:geometry.geometries.map(g=>precisionGeometry(g,digits))};
  return {type:geometry.type,coordinates:position(geometry.coordinates)} as Geometry;
}
export async function readPolygons(geos:GeosBindings, pointer:number, controls:TopologyOperationControls):Promise<PolygonalGeometry[]> {
  const fatal=()=>new InspectionError('ENGINE_FATAL_ERROR','GEOS could not read an overlay result.');
  const slots=geos.Module._malloc(24);
  if(!slots)throw fatal();
  const result:PolygonalGeometry[]=[];
  try{
    const ring=async(p:number):Promise<number[][]>=>{
      const seq=p && geos.GEOSGeom_getCoordSeq(p);
      if(!seq || geos.GEOSCoordSeq_getSize(seq,slots)!==1)throw fatal();
      const n=geos.Module.getValue(slots,'i32')>>>0;controls.reservePositions(n);const positions:number[][]=[];
      for(let i=0;i<n;i++){
        controls.checkpoint();
        if(geos.GEOSCoordSeq_getX(seq,i,slots+8)!==1 || geos.GEOSCoordSeq_getY(seq,i,slots+16)!==1)throw fatal();
        positions.push([finite(geos.Module.getValue(slots+8,'double')),finite(geos.Module.getValue(slots+16,'double'))]);
        if(i%256===0)await controls.yield();
      }
      return positions;
    };
    const visit=async(p:number):Promise<void>=>{
      controls.checkpoint();const type=geos.GEOSGeomTypeId(p);
      if(type===3){
        const shell=geos.GEOSGetExteriorRing(p);if(!shell)return;
        const coordinates=[await ring(shell)],count=geos.GEOSGetNumInteriorRings(p);if(count<0)throw fatal();
        for(let i=0;i<count;i++)coordinates.push(await ring(geos.GEOSGetInteriorRingN(p,i)));
        result.push({type:'Polygon',coordinates});
      }else if(type===6 || type===7){
        const n=geos.GEOSGetNumGeometries(p);if(n<0)throw fatal();
        for(let i=0;i<n;i++){const child=geos.GEOSGetGeometryN(p,i);if(!child)throw fatal();await visit(child);}
      }
      await controls.yield();
    };
    await visit(pointer);return result;
  }finally{geos.Module._free(slots);}
}
