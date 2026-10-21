import { InspectionError } from '../errors.ts';
export function finite(value: number): number {
  if (!Number.isFinite(value)) throw new InspectionError('TOPOLOGY_INPUT_ERROR', 'Geometry measurement exceeded the finite numeric range.');
  return value;
}
export function qgisPrecision(digits: number): { tolerance: number; reducedTolerance: number } {
  return {tolerance:10 ** -digits, reducedTolerance:10 ** (-digits / 2)};
}
export const distance = (a: readonly number[], b: readonly number[]): number => finite(Math.hypot(finite(a[0]! - b[0]!), finite(a[1]! - b[1]!)));
export function pointSegmentDistance(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const length = distance(a,b);
  if (!length) return distance(p,a);
  const x = finite(b[0]! - a[0]!) / length, y = finite(b[1]! - a[1]!) / length;
  const projection = Math.max(0, Math.min(length, finite((p[0]! - a[0]!) * x + (p[1]! - a[1]!) * y)));
  return distance(p,[finite(a[0]! + projection * x),finite(a[1]! + projection * y)]);
}
// QGIS proper intersections exclude segment endpoints and collinear overlap.
export function segmentIntersection(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], tolerance: number): {x:number;y:number} | null {
  const ab = distance(a,b), cd = distance(c,d);
  if (ab <= tolerance || cd <= tolerance) return null;
  const ux=(b[0]! - a[0]!)/ab, uy=(b[1]! - a[1]!)/ab, vx=(d[0]! - c[0]!)/cd, vy=(d[1]! - c[1]!)/cd;
  const determinant=ux*vy-uy*vx;
  if (Math.abs(determinant) < 1e-15) return null;
  const dx=finite(c[0]! - a[0]!),dy=finite(c[1]! - a[1]!);
  const t=finite((dx*vy-dy*vx)/determinant),u=finite((dx*uy-dy*ux)/determinant);
  if (t <= tolerance || t >= ab-tolerance || u <= tolerance || u >= cd-tolerance) return null;
  return {x:finite(a[0]!+t*ux),y:finite(a[1]!+t*uy)};
}
