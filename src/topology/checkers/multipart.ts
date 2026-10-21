import type { TopologyChecker } from '../contracts.ts';
import { noParameters } from './parameters.ts';

export const multipartChecker: TopologyChecker = {
  id: 'Rule-013', geometryTypes: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
  candidateMode: 'feature', acceptsInvalid: true, parseParameters: noParameters,
  checkFeature(record) {
    const geometry = record.geometry;
    if (!['MultiPoint', 'MultiLineString', 'MultiPolygon'].includes(geometry.type) || !('coordinates' in geometry) || geometry.coordinates.length <= 1) return null;
    return { reasonCode: 'TOPOLOGY_MULTIPART_GEOMETRY', reason: 'The geometry contains more than one part.', location: null };
  },
};
