import { InspectionError } from '../../errors.ts';
import type { TopologyChecker, TopologyParticipant } from '../contracts.ts';

function family(type: TopologyParticipant['geometryType']): 'point' | 'line' | 'area' | null {
  switch (type) {
    case 'Point': case 'MultiPoint': return 'point';
    case 'LineString': case 'MultiLineString': return 'line';
    case 'Polygon': case 'MultiPolygon': return 'area';
    default: return null;
  }
}

export const duplicateGeometryChecker: TopologyChecker = {
  id: 'Rule-012',
  geometryTypes: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
  candidateMode: 'bbox-intersects',
  parseParameters(value: unknown): Record<string, never> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) {
      throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Duplicate geometry checks do not accept parameters or tolerance.');
    }
    return {};
  },
  check(session, left, right) {
    if (family(left.geometryType) !== family(right.geometryType) || !session.equals(left.recordKey, right.recordKey)) return null;
    return { reasonCode: 'TOPOLOGY_DUPLICATE_GEOMETRY', reason: 'Different records have topologically equal geometries.', location: null };
  },
};
