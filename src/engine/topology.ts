import { precisionGeometry, readPolygons } from './qgis-operations.ts';
import type { Geometry } from '../contracts.ts';
import { polygonGaps } from './areas.ts';
import { InspectionError } from '../errors.ts';
import type { GeosBindings } from './geos.ts';
import type { TopologySession } from '../topology/contracts.ts';

export function createGeosTopologySession(geos: GeosBindings): TopologySession {
  if (typeof geos.GEOSEquals !== 'function' || typeof geos.GEOSRelatePattern !== 'function') throw new InspectionError('TOPOLOGY_ENGINE_UNAVAILABLE', 'GEOS topology operations are unavailable.');
  const geometries = new Map<string, number>();
  const sources = new Map<string, Geometry>();
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Topology session has been disposed.'); };
  const get = (key: string) => { live(); const pointer = geometries.get(key); if (!pointer) throw new Error('Unknown topology record.'); return pointer; };
  const result = (status: number) => {
    if (status !== 0 && status !== 1) throw new InspectionError('ENGINE_FATAL_ERROR', 'GEOS topology operation failed.');
    return status === 1;
  };
  const withText = <T>(value: string, use: (pointer: number) => T): T => {
    const size = new TextEncoder().encode(value).length + 1;
    const pointer = geos.Module._malloc(size);
    if (!pointer) throw new InspectionError('ENGINE_FATAL_ERROR', 'GEOS could not allocate topology input.');
    try { geos.Module.stringToUTF8(value, pointer, size); return use(pointer); }
    finally { geos.Module._free(pointer); }
  };
  const add = (key: string, geometry: Geometry): void => {
      live();
      if (geometries.has(key)) throw new Error('Duplicate topology record.');
      const reader = geos.GEOSGeoJSONReader_create();
      if (!reader) throw new InspectionError('ENGINE_FATAL_ERROR', 'GEOS could not allocate a topology reader.');
      try {
        const pointer = withText(JSON.stringify(geometry), text => geos.GEOSGeoJSONReader_readGeometry(reader, text));
        if (!pointer) throw new InspectionError('ENGINE_FATAL_ERROR', 'GEOS could not read topology geometry.');
        geometries.set(key, pointer);
        sources.set(key, geometry);
      } finally { geos.GEOSGeoJSONReader_destroy(reader); }
  };
  const precise = (key: string, digits: number): number => {
    live(); const source = sources.get(key); if (!source) throw new Error('Unknown topology record.');
    const cacheKey = `${key}\u0000precision:${digits}`;
    if (!geometries.has(cacheKey)) add(cacheKey, precisionGeometry(source, digits));
    return get(cacheKey);
  };
  return {
    add,
    qgisEquals: (left,right,digits) => result(geos.GEOSEquals(precise(left,digits),precise(right,digits))),
    qgisContains: (left,right,digits) => result(geos.GEOSContains(precise(left,digits),precise(right,digits))),
    qgisOverlaps: (left,right,digits) => result(geos.GEOSOverlaps(precise(left,digits),precise(right,digits))),
    centroid(key) {
      const point = geos.GEOSGetCentroid(get(key)), slots = geos.Module._malloc(16);
      try {
        if (!point || !slots || geos.GEOSGeomGetX(point,slots)!==1 || geos.GEOSGeomGetY(point,slots+8)!==1) throw new InspectionError('ENGINE_FATAL_ERROR','GEOS could not locate an issue.');
        const x=geos.Module.getValue(slots,'double'),y=geos.Module.getValue(slots+8,'double');
        if(!Number.isFinite(x)||!Number.isFinite(y))throw new InspectionError('ENGINE_FATAL_ERROR','GEOS returned a non-finite centroid.');
        return {x,y};
      } finally {if(point)geos.GEOSGeom_destroy(point);if(slots)geos.Module._free(slots);}
    },
    async polygonIntersections(left,right,digits,controls) {
      const pointer=geos.GEOSIntersection(precise(left,digits),precise(right,digits));
      if(!pointer)throw new InspectionError('ENGINE_FATAL_ERROR','GEOS intersection failed.');
      try{return await readPolygons(geos,pointer,controls);}finally{geos.GEOSGeom_destroy(pointer);}
    },
    async qgisPolygonGaps(keys,digits,controls) { return polygonGaps(geos,keys.map(key=>precise(key,digits)),controls); },
    overlaps(left, right) {
      if (typeof geos.GEOSOverlaps !== 'function') throw new InspectionError('TOPOLOGY_ENGINE_UNAVAILABLE', 'Polygon overlap operations are unavailable.');
      return result(geos.GEOSOverlaps(get(left), get(right)));
    },
    async polygonGaps(keys, controls) {
      if (['GEOSGeom_createPolygon', 'GEOSDifference', 'GEOSGeom_clone', 'GEOSUnion', 'GEOSGeomTypeId', 'GEOSGetNumGeometries', 'GEOSGetGeometryN', 'GEOSGetNumInteriorRings', 'GEOSGetInteriorRingN', 'GEOSGetExteriorRing', 'GEOSGeom_getCoordSeq', 'GEOSCoordSeq_getSize', 'GEOSCoordSeq_getX', 'GEOSCoordSeq_getY'].some(name => typeof geos[name as keyof GeosBindings] !== 'function')) throw new InspectionError('TOPOLOGY_ENGINE_UNAVAILABLE', 'Polygon aggregation operations are unavailable.');
      return polygonGaps(geos, keys.map(get), controls);
    },
    equals(left, right) { return result(geos.GEOSEquals(get(left), get(right))); },
    relatePattern(left, right, pattern) {
      const a = get(left), b = get(right);
      if (!/^[012TF*]{9}$/.test(pattern)) throw new Error('Invalid DE-9IM pattern.');
      return withText(pattern, text => result(geos.GEOSRelatePattern(a, b, text)));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      let failure: unknown;
      for (const pointer of geometries.values()) {
        try { geos.GEOSGeom_destroy(pointer); }
        catch (error) { failure ??= error; }
      }
      geometries.clear(); sources.clear();
      if (failure) throw failure;
    },
  };
}
