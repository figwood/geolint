import type { TopologyChecker } from '../contracts.ts';
import { InspectionError } from '../../errors.ts';
import { noParameters } from './parameters.ts';

export const areaOverlapsChecker: TopologyChecker = {
  id: 'Rule-016', geometryTypes: ['Polygon', 'MultiPolygon'], candidateMode: 'bbox-intersects', parseParameters: noParameters,
  check(session, left, right) {
    if (!session.overlaps) throw new InspectionError('TOPOLOGY_ENGINE_UNAVAILABLE', 'Polygon overlap operations are unavailable.');
    return session.overlaps(left.recordKey, right.recordKey)
      ? { reasonCode: 'TOPOLOGY_AREA_OVERLAP', reason: 'Polygon interiors overlap without containment or equality.', location: null } : null;
  },
};
export const areaGapsChecker: TopologyChecker = {
  id: 'Rule-017', geometryTypes: ['Polygon', 'MultiPolygon'], candidateMode: 'dataset', parseParameters: noParameters,
  async checkDataset(context) {
    if (!context.session.polygonGaps) throw new InspectionError('TOPOLOGY_ENGINE_UNAVAILABLE', 'Polygon aggregation operations are unavailable.');
    context.checked();
    const gaps = await context.session.polygonGaps(context.records.map(record => record.recordKey), context.controls);
    for (const geometry of gaps) {
      context.controls.checkpoint();
      const point = geometry.type === 'Polygon' ? geometry.coordinates[0]![0]! : geometry.coordinates[0]![0]![0]!;
      context.emit({ reasonCode: 'TOPOLOGY_AREA_GAP', reason: 'The polygon coverage contains an enclosed gap.', location: { x: point[0]!, y: point[1]! }, geometry }, []);
      await context.controls.yield();
    }
  },
};
