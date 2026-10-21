import type { Geometry } from '../contracts.ts';

export type Bbox = [number, number, number, number];
export interface IndexEntry { featureIndex: number; bbox: Bbox }
export function geometryExtent(geometry: Geometry): { bbox: Bbox; positions: number } {
  const bbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  let positions = 0;
  const walkCoordinates = (value: unknown): void => {
    const array = value as unknown[];
    if (typeof array[0] === 'number') {
      const x = array[0], y = array[1] as number;
      bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
      bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y); positions++;
    } else for (const child of array) walkCoordinates(child);
  };
  const walk = (value: Geometry): void => {
    if (value.type === 'GeometryCollection') for (const child of value.geometries) walk(child);
    else walkCoordinates(value.coordinates);
  };
  walk(geometry);
  return { bbox, positions };
}
interface Node { bbox: Bbox; entries?: IndexEntry[]; left?: Node; right?: Node }
const intersects = (a: Bbox, b: Bbox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
function build(entries: IndexEntry[]): Node {
  const bbox: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const entry of entries) {
    bbox[0] = Math.min(bbox[0], entry.bbox[0]); bbox[1] = Math.min(bbox[1], entry.bbox[1]);
    bbox[2] = Math.max(bbox[2], entry.bbox[2]); bbox[3] = Math.max(bbox[3], entry.bbox[3]);
  }
  if (entries.length <= 8) return { bbox, entries };
  const axis = bbox[2] - bbox[0] >= bbox[3] - bbox[1] ? 0 : 1;
  entries.sort((a, b) => a.bbox[axis]! / 2 + a.bbox[axis + 2]! / 2 - b.bbox[axis]! / 2 - b.bbox[axis + 2]! / 2 || a.featureIndex - b.featureIndex);
  const middle = Math.floor(entries.length / 2);
  return { bbox, left: build(entries.slice(0, middle)), right: build(entries.slice(middle)) };
}
export function* candidatePairs(entries: readonly IndexEntry[], checkpoint: () => void = () => {}): Generator<[number, number]> {
  if (!entries.length) return;
  checkpoint();
  const root = build([...entries]);
  for (const entry of entries) {
    checkpoint();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      checkpoint();
      if (!intersects(entry.bbox, node.bbox)) continue;
      if (node.entries) {
        for (const other of node.entries) if (other.featureIndex > entry.featureIndex && intersects(entry.bbox, other.bbox)) yield [entry.featureIndex, other.featureIndex];
      } else { stack.push(node.right!, node.left!); }
    }
  }
}
