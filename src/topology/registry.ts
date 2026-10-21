import { relationCheckers } from './checkers/qgis-relations.ts';
import { qgisAreaCheckers } from './checkers/qgis-areas.ts';
import { metricCheckers } from './checkers/qgis-metrics.ts';
import { nodeCheckers } from './checkers/qgis-nodes.ts';
import { propertyCheckers } from './checkers/qgis-properties.ts';
import type { TopologyChecker } from './contracts.ts';
import { duplicateGeometryChecker } from './checkers/duplicates.ts';

import { multipartChecker } from './checkers/multipart.ts';
import { danglesChecker, pseudosChecker } from './checkers/endpoints.ts';

import { areaOverlapsChecker, areaGapsChecker } from './checkers/areas.ts';

export const topologyCheckers: readonly TopologyChecker[] = [duplicateGeometryChecker, multipartChecker, danglesChecker, pseudosChecker, areaOverlapsChecker, areaGapsChecker, ...propertyCheckers, ...nodeCheckers, ...metricCheckers, ...relationCheckers, ...qgisAreaCheckers];
