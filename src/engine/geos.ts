import type { GeometryEngine } from '../contracts.ts';
import { InspectionError } from '../errors.ts';
import { createGeosTopologySession } from './topology.ts';
import type { TopologySession } from '../topology/contracts.ts';

export interface GeosBindings {
  _ctx?: number | null;
  GEOS_finish_r?(context: number): void;
  Module: {
    _malloc(size: number): number; _free(pointer: number): void;
    setValue(pointer: number, value: number, type: string): void;
    getValue(pointer: number, type: string): number;
    stringToUTF8(value: string, pointer: number, maxBytes: number): void;
    UTF8ToString(pointer: number): string;
    print?: (value: string) => void; printErr?: (value: string) => void;
  };
  initGEOS(): void; finishGEOS(): void; GEOSversion(): string;
  GEOSGeoJSONReader_create(): number; GEOSGeoJSONReader_destroy(reader: number): void;
  GEOSGeoJSONReader_readGeometry(reader: number, json: number): number;
  GEOSisValidDetail(geometry: number, flags: number, reason: number, location: number): number;
  GEOSGeomGetX(geometry: number, output: number): number;
  GEOSGeomGetY(geometry: number, output: number): number;
  GEOSFree(pointer: number): void; GEOSGeom_destroy(geometry: number): void;
  GEOSContains(left: number, right: number): number;
  GEOSIntersection(left: number, right: number): number;
  GEOSGetCentroid(geometry: number): number;
  GEOSOverlaps(left: number, right: number): number;
  GEOSGeom_clone(geometry: number): number;
  GEOSGeom_createPolygon(shell: number, holes: number, count: number): number;
  GEOSDifference(left: number, right: number): number;
  GEOSUnion(left: number, right: number): number;
  GEOSGeomTypeId(geometry: number): number;
  GEOSGetNumGeometries(geometry: number): number;
  GEOSGetGeometryN(geometry: number, index: number): number;
  GEOSGetNumInteriorRings(geometry: number): number;
  GEOSGetInteriorRingN(geometry: number, index: number): number;
  GEOSGetExteriorRing(geometry: number): number;
  GEOSGeom_getCoordSeq(geometry: number): number;
  GEOSCoordSeq_getSize(sequence: number, output: number): number;
  GEOSCoordSeq_getX(sequence: number, index: number, output: number): number;
  GEOSCoordSeq_getY(sequence: number, index: number, output: number): number;
  GEOSEquals(left: number, right: number): number;
  GEOSRelatePattern(left: number, right: number, pattern: number): number;
}
const activeBindings = new WeakSet<object>();
function finishBindings(geos: GeosBindings): void {
  // The pinned package overwrites finishGEOS with finishGEOS_r's wrapper,
  // which frees the context but leaves _ctx dangling. Own the reset here.
  if (typeof geos._ctx === 'number' && geos.GEOS_finish_r) {
    const context = geos._ctx;
    geos._ctx = null;
    geos.GEOS_finish_r(context);
  } else geos.finishGEOS();
}

export async function createEngine(moduleUrl?: string): Promise<GeometryEngine> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abandoned = false;
  try {
    const load = async () => {
      const packageName = moduleUrl ?? 'geos-wasm';
      const library = await import(/* @vite-ignore */ packageName);
      const geos = await library.default({ autoInit: false, errorHandler: () => {}, noticeHandler: () => {} }) as GeosBindings;
      if (activeBindings.has(geos)) throw new Error('Only one engine may own a module context.');
      geos.Module.print = () => {};
      geos.Module.printErr = () => {};
      geos.initGEOS();
      let engine: GeometryEngine;
      try { engine = wrapGeos(geos); } catch (error) { finishBindings(geos); throw error; }
      if (abandoned) { engine.dispose(); throw new Error('Initialization was abandoned.'); }
      return engine;
    };
    return await Promise.race([
      load(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { abandoned = true; reject(new Error('Initialization timed out.')); }, 15000); }),
    ]);
  } catch {
    throw new InspectionError('ENGINE_INIT_ERROR', 'GEOS WASM is unavailable or could not be initialized.');
  } finally { if (timer) clearTimeout(timer); }
}

export function wrapGeos(input: unknown): GeometryEngine {
  const geos = input as GeosBindings;
  if (!geos?.Module || typeof geos.GEOSisValidDetail !== 'function' || typeof geos.GEOSversion !== 'function') throw new Error('Unsupported GEOS bindings.');
  if (activeBindings.has(geos)) throw new Error('This module already has an active engine.');
  const info = { name: 'GEOS', version: geos.GEOSversion(), wasmPackageVersion: '3.1.1', parameters: { validityFlags: 0 }, coordinateSemantics: 'planar-2d' as const };
  activeBindings.add(geos);
  let disposed = false;
  const sessions = new Set<TopologySession>();
  return {
    info,
    createTopologySession() {
      if (disposed) throw new Error('Engine has been disposed.');
      const owned = createGeosTopologySession(geos);
      const session: TopologySession = {
        ...owned,
        add: (key, geometry) => owned.add(key, geometry),
        overlaps: (left, right) => owned.overlaps!(left, right),
        polygonGaps: (keys, controls) => owned.polygonGaps!(keys, controls),
        equals: (left, right) => owned.equals(left, right),
        relatePattern: (left, right, pattern) => owned.relatePattern(left, right, pattern),
        dispose() { try { owned.dispose(); } finally { sessions.delete(session); } },
      };
      sessions.add(session);
      return session;
    },
    check(geometry) {
      if (disposed) throw new Error('Engine has been disposed.');
      const heap = geos.Module;
      const allocations: number[] = [];
      const allocate = (bytes: number) => {
        const pointer = heap._malloc(bytes);
        if (!pointer) throw new InspectionError('ENGINE_FATAL_ERROR', 'The geometry engine ran out of memory.');
        allocations.push(pointer);
        return pointer;
      };
      let reader = 0, geom = 0, reasonSlot = 0, locationSlot = 0;
      try {
        reader = geos.GEOSGeoJSONReader_create();
        if (!reader) throw new InspectionError('ENGINE_FATAL_ERROR', 'GEOS could not allocate a geometry reader.');
        // Normalization strips foreign members recursively, including collections.
        const json = JSON.stringify(geometry);
        const byteLength = new TextEncoder().encode(json).byteLength + 1;
        const text = allocate(byteLength);
        heap.stringToUTF8(json, text, byteLength);
        geom = geos.GEOSGeoJSONReader_readGeometry(reader, text);
        if (!geom) throw new InspectionError('ENGINE_FATAL_ERROR', 'GEOS could not read a validated geometry.');
        reasonSlot = allocate(4); heap.setValue(reasonSlot, 0, 'i32');
        locationSlot = allocate(4); heap.setValue(locationSlot, 0, 'i32');
        const xSlot = allocate(8), ySlot = allocate(8);
        const status = geos.GEOSisValidDetail(geom, 0, reasonSlot, locationSlot);
        if (status === 2) throw new InspectionError('ENGINE_FATAL_ERROR', 'GEOS reported an exception; inspection was stopped.');
        if (status !== 0 && status !== 1) throw new Error('Unexpected GEOS validity return code.');
        const reasonPtr = heap.getValue(reasonSlot, 'i32') >>> 0;
        const locationPtr = heap.getValue(locationSlot, 'i32') >>> 0;
        const reason = reasonPtr ? heap.UTF8ToString(reasonPtr) : status === 1 ? 'Valid Geometry' : 'Invalid geometry (no reason supplied).';
        let location = null;
        if (locationPtr && geos.GEOSGeomGetX(locationPtr, xSlot) === 1 && geos.GEOSGeomGetY(locationPtr, ySlot) === 1) {
          const x = heap.getValue(xSlot, 'double'), y = heap.getValue(ySlot, 'double');
          if (Number.isFinite(x) && Number.isFinite(y)) location = { x, y };
        }
        return { valid: status === 1, reason, location };
      } finally {
        const reason = reasonSlot ? heap.getValue(reasonSlot, 'i32') >>> 0 : 0;
        const location = locationSlot ? heap.getValue(locationSlot, 'i32') >>> 0 : 0;
        if (reason) geos.GEOSFree(reason);
        if (location) geos.GEOSGeom_destroy(location);
        if (geom) geos.GEOSGeom_destroy(geom);
        if (reader) geos.GEOSGeoJSONReader_destroy(reader);
        for (const pointer of allocations) heap._free(pointer);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      let failure: unknown;
      for (const session of [...sessions]) {
        try { session.dispose(); }
        catch (error) { failure ??= error; }
      }
      activeBindings.delete(geos);
      try { finishBindings(geos); }
      catch (error) { failure ??= error; }
      if (failure) throw failure;
    },
  };
}
