import type { TopologyChecker, TopologyDatasetContext } from '../contracts.ts';
import { noParameters } from './parameters.ts';

async function checkEndpoints(context: TopologyDatasetContext, occurrences: number): Promise<void> {
  const nodes = new Map<number, Map<number, { x: number; y: number; count: number; keys: Set<string> }>>();
  for (const record of context.records) {
    const geometry = record.geometry;
    const parts = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const part of parts) {
      context.controls.checkpoint();
      for (const position of [part[0]!, part[part.length - 1]!]) {
        const x = position[0] === 0 ? 0 : position[0]!, y = position[1] === 0 ? 0 : position[1]!;
        let column = nodes.get(x);
        if (!column) { column = new Map(); nodes.set(x, column); }
        let node = column.get(y);
        if (!node) { node = { x, y, count: 0, keys: new Set() }; column.set(y, node); }
        node.count++; node.keys.add(record.recordKey);
      }
      await context.controls.yield();
    }
  }
  const order = new Map(context.records.map(record => [record.recordKey, record.featureIndex]));
  for (const x of [...nodes.keys()].sort((a, b) => a - b)) {
    for (const node of [...nodes.get(x)!.values()].sort((a, b) => a.y - b.y)) {
      context.controls.checkpoint(); context.checked();
      if (node.count === occurrences) context.emit({
        reasonCode: occurrences === 1 ? 'TOPOLOGY_DANGLE' : 'TOPOLOGY_PSEUDO_NODE',
        reason: occurrences === 1 ? 'A line endpoint is not shared by another part endpoint.' : 'Exactly two line part endpoints meet at this node.',
        location: { x: node.x, y: node.y },
      }, [...node.keys].sort((a, b) => order.get(a)! - order.get(b)!));
      await context.controls.yield();
    }
  }
}
export const danglesChecker: TopologyChecker = {
  id: 'Rule-014', geometryTypes: ['LineString', 'MultiLineString'], candidateMode: 'dataset', parseParameters: noParameters,
  checkDataset: context => checkEndpoints(context, 1),
};
export const pseudosChecker: TopologyChecker = {
  id: 'Rule-015', geometryTypes: ['LineString', 'MultiLineString'], candidateMode: 'dataset', parseParameters: noParameters,
  checkDataset: context => checkEndpoints(context, 2),
};
