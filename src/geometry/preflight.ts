import type { Location } from '../contracts.ts';
export interface RingEvidence { part: number; ring: number; nodeCount: number; first: Location | null }
export interface PreflightEvidence { kind: 'polygon-rings'; rings: readonly RingEvidence[] }
// Inspect only the safe 2D ring shape. No repairs and no GEOS object creation.
export function polygonRingEvidence(value: unknown): PreflightEvidence | undefined {
  if (!value || typeof value !== 'object') return;
  const input = value as { type?: unknown; coordinates?: unknown };
  if (input.type !== 'Polygon' && input.type !== 'MultiPolygon') return;
  const parts = input.type === 'Polygon' ? [input.coordinates] : input.coordinates;
  if (!Array.isArray(parts) || !parts.length) return;
  const rings: RingEvidence[] = [];
  for (const [part, polygon] of parts.entries()) {
    if (!Array.isArray(polygon) || !polygon.length) return;
    for (const [ring, points] of polygon.entries()) {
      if (!Array.isArray(points) || !points.length || !points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n)))) return;
      const first = points[0] as number[], last = points.at(-1) as number[];
      const closed = first[0] === last[0] && first[1] === last[1];
      if (!closed) return;
      rings.push({part, ring, nodeCount: points.length - Number(points.length > 1), first: {x:first[0]!, y:first[1]!}});
    }
  }
  return {kind:'polygon-rings', rings};
}
