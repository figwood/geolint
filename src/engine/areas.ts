import type { PolygonalGeometry } from '../contracts.ts';
import { InspectionError } from '../errors.ts';
import type { TopologyOperationControls } from '../topology/contracts.ts';
import type { GeosBindings } from './geos.ts';

// Borrowed ring/sequence pointers belong to the final union. Only clones and
// union results are owned here; the session's original geometries stay intact.
export async function polygonGaps(geos: GeosBindings, inputs: readonly number[], controls: TopologyOperationControls): Promise<PolygonalGeometry[]> {
  const owned = new Set<number>();
  let slots = 0;
  const fatal = () => new InspectionError('ENGINE_FATAL_ERROR', 'GEOS polygon aggregation failed.');
  const retain = (pointer: number) => { if (!pointer) throw fatal(); owned.add(pointer); return pointer; };
  const destroy = (pointer: number) => { owned.delete(pointer); geos.GEOSGeom_destroy(pointer); };
  try {
    let level: number[] = [];
    for (const input of inputs) { controls.checkpoint(); level.push(retain(geos.GEOSGeom_clone(input))); await controls.yield(); }
    const merge = async (items: number[]): Promise<number> => {
      let current = items;
      while (current.length > 1) {
        const next: number[] = [];
        for (let i = 0; i < current.length; i += 2) {
          controls.checkpoint();
          if (i + 1 === current.length) next.push(current[i]!);
          else {
            next.push(retain(geos.GEOSUnion(current[i]!, current[i + 1]!)));
            destroy(current[i]!); destroy(current[i + 1]!);
          }
          await controls.yield();
        }
        current = next;
      }
      return current[0]!;
    };
    if (level.length) level = [await merge(level)];
    if (!level.length) return [];
    slots = geos.Module._malloc(24);
    if (!slots) throw fatal();
    const readRing = async (ring: number, include: boolean): Promise<number[][]> => {
      controls.checkpoint();
      const sequence = ring && geos.GEOSGeom_getCoordSeq(ring);
      if (!sequence || geos.GEOSCoordSeq_getSize(sequence, slots) !== 1) throw fatal();
      const size = geos.Module.getValue(slots, 'i32') >>> 0;
      controls.reservePositions(size);
      const positions: number[][] = [];
      if (include) for (let i = 0; i < size; i++) {
        controls.checkpoint();
        if (geos.GEOSCoordSeq_getX(sequence, i, slots + 8) !== 1 || geos.GEOSCoordSeq_getY(sequence, i, slots + 16) !== 1) throw fatal();
        const x = geos.Module.getValue(slots + 8, 'double'), y = geos.Module.getValue(slots + 16, 'double');
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw fatal();
        positions.push([x, y]);
        if (i % 256 === 0) await controls.yield();
      }
      return positions;
    };
    const components = (pointer: number): number[] => {
      const type = geos.GEOSGeomTypeId(pointer);
      if (type === 3) return [pointer];
      if (type !== 6 && type !== 7) throw fatal();
      const count = geos.GEOSGetNumGeometries(pointer);
      if (count < 0) throw fatal();
      const parts: number[] = [];
      for (let i = 0; i < count; i++) {
        controls.checkpoint();
        const child = geos.GEOSGetGeometryN(pointer, i);
        if (!child || geos.GEOSGeomTypeId(child) !== 3) throw fatal();
        parts.push(child);
      }
      return parts;
    };
    const coverage = level[0]!;
    const shells: number[] = [];
    let hasHoles = false;
    for (const polygon of components(coverage)) {
      const shell = geos.GEOSGetExteriorRing(polygon);
      await readRing(shell, false);
      const count = geos.GEOSGetNumInteriorRings(polygon);
      if (count < 0) throw fatal();
      hasHoles ||= count > 0;
      for (let i = 0; i < count; i++) await readRing(geos.GEOSGetInteriorRingN(polygon, i), false);
      const clonedShell = retain(geos.GEOSGeom_clone(shell));
      // GEOS takes ownership of the shell when creating a polygon.
      owned.delete(clonedShell);
      const filled = retain(geos.GEOSGeom_createPolygon(clonedShell, 0, 0));
      shells.push(filled);
      await controls.yield();
    }
    if (!hasHoles) return [];
    // Fill and union exterior shells, then subtract actual coverage. This keeps
    // islands inside holes covered and separates nested holes into distinct gaps.
    const filledCoverage = await merge(shells);
    const difference = retain(geos.GEOSDifference(filledCoverage, coverage));
    const gaps: PolygonalGeometry[] = [];
    for (const polygon of components(difference)) {
      const rings = [await readRing(geos.GEOSGetExteriorRing(polygon), true)];
      const count = geos.GEOSGetNumInteriorRings(polygon);
      if (count < 0) throw fatal();
      for (let i = 0; i < count; i++) rings.push(await readRing(geos.GEOSGetInteriorRingN(polygon, i), true));
      gaps.push({ type: 'Polygon', coordinates: rings });
      await controls.yield();
    }
    controls.checkpoint();
    return gaps;
  } finally {
    if (slots) geos.Module._free(slots);
    let failure: unknown;
    for (const pointer of owned) { try { geos.GEOSGeom_destroy(pointer); } catch (error) { failure ??= error; } }
    if (failure) throw failure;
  }
}
