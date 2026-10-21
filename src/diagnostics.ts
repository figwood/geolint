import { qgisRules } from './topology/qgis-catalog.ts';
export type RuleFamily = 'structure' | 'validity' | 'geometry' | 'topology' | 'attributes' | 'diagnostics';
export type RuleExecutionGroup = 'core' | 'topology' | 'attributes';
export interface CheckRule { executionGroup: RuleExecutionGroup; id: string; title: string; description: string; family: RuleFamily; required: boolean }
// Rule identifiers are category-independent. Append entries; never renumber or reuse.
export const checkRules: readonly CheckRule[] = [
  {
    "id": "Rule-001",
    "executionGroup": "core",
    "family": "diagnostics",
    "required": true,
    "title": "File format and size must be supported",
    "description": "Accept .geojson/.json, .shp or .zip. Read GeoJSON as UTF-8 JSON; files are processed locally."
  },
  {
    "id": "Rule-002",
    "executionGroup": "core",
    "family": "structure",
    "required": true,
    "title": "GeoJSON documents and features must be well formed",
    "description": "Require a supported geometry, Feature or FeatureCollection. Features must contain geometry. Legacy crs declarations are accepted as metadata; original coordinates are checked without reprojection."
  },
  {
    "id": "Rule-003",
    "executionGroup": "core",
    "family": "structure",
    "required": true,
    "title": "Shapefile headers and records must be well formed",
    "description": "Validate SHP headers and record boundaries."
  },
  {
    "id": "Rule-004",
    "executionGroup": "core",
    "family": "structure",
    "required": true,
    "title": "ZIP archives must contain one valid layer",
    "description": "Require one .shp layer and entries are validated. Validate framing and CRC; reject encryption, split archives, ZIP64, unsupported compression and duplicate filenames."
  },
  {
    "id": "Rule-005",
    "executionGroup": "core",
    "family": "structure",
    "required": true,
    "title": "Geometry structures and coordinates must be valid",
    "description": "Require supported coordinate structures and finite positions. Lines require at least two positions; collections have a 64-level nesting limit."
  },
  {
    "id": "Rule-006",
    "executionGroup": "core",
    "family": "validity",
    "required": true,
    "title": "Polygon rings must close",
    "description": "Each ring requires at least four positions; the first and last x/y positions must match. Input is never automatically closed."
  },
  {
    "id": "Rule-007",
    "executionGroup": "core",
    "family": "diagnostics",
    "required": true,
    "title": "Coordinates must be two-dimensional",
    "description": "Only consistently two-dimensional coordinates reach GEOS. Z/M coordinates are skipped; mixed dimensions fail parsing. No reprojection or spherical interpretation occurs."
  },
  {
    "id": "Rule-008",
    "executionGroup": "core",
    "family": "geometry",
    "required": true,
    "title": "Geometries must not be empty",
    "description": "Null geometry, empty top-level coordinates and empty collections are skipped. A collection with an empty member is skipped as a whole after structural validation."
  },
  {
    "id": "Rule-009",
    "executionGroup": "core",
    "family": "structure",
    "required": true,
    "title": "Shapefile record geometries must be well formed",
    "description": "Check record payloads, parts, coordinates and shell/hole structure. Malformed or ambiguous records fail parsing without repair."
  },
  {
    "id": "Rule-010",
    "executionGroup": "core",
    "family": "diagnostics",
    "required": true,
    "title": "Geometry types must be supported",
    "description": "Support all seven GeoJSON geometry types and 2D SHP Point, MultiPoint, PolyLine and Polygon. SHP Z/M and MultiPatch records are outside scope."
  },
  {
    "id": "Rule-011",
    "executionGroup": "core",
    "family": "validity",
    "required": true,
    "title": "Must not have invalid geometries",
    "description": "GEOS 3.13.0 uses GEOSisValidDetail with flags 0 on each supported nonempty 2D geometry. Return the first reason and optional location. Simplicity and spherical interpretation are outside scope."
  },
  {
    "id": "Rule-012",
    "executionGroup": "topology",
    "family": "topology",
    "required": false,
    "title": "Must not have duplicates",
    "description": "Detect topologically equal eligible records using GEOS, with no tolerance or snapping."
  },
  { id: 'Rule-013', executionGroup: 'topology', family: 'geometry', required: false, title: 'Must not have multi-part geometries', description: 'Require at most one actual part. A Multi geometry with only one part passes; collections are excluded.' },
  { id: 'Rule-014', executionGroup: 'topology', family: 'topology', required: false, title: 'Must not have dangles', description: 'Report coordinates with exactly one line part endpoint. Interior touches do not connect endpoints; no tolerance or snapping.' },
  { id: 'Rule-015', executionGroup: 'topology', family: 'topology', required: false, title: 'Must not have pseudos', description: 'Report coordinates with exactly two line part endpoints, including closed lines and connections within multipart records.' },
  { id: 'Rule-016', executionGroup: 'topology', family: 'topology', required: false, title: 'Must not overlap', description: 'Detect partial polygon overlaps using GEOS overlaps. Equality, containment and boundary contact do not violate this rule.' },
  { id: 'Rule-017', executionGroup: 'topology', family: 'topology', required: false, title: 'Must not have gaps', description: 'Report enclosed holes in the union of valid polygons. The unbounded exterior and open channels are not gaps.' },
  {
    "id": "Rule-018",
    "executionGroup": "attributes",
    "family": "attributes",
    "required": false,
    "title": "Required attribute values must be present",
    "description": "Check configured fields and null or empty-value policies."
  },
  {
    "id": "Rule-019",
    "executionGroup": "attributes",
    "family": "attributes",
    "required": false,
    "title": "Attribute values must match their types",
    "description": "Check strict string, int, double, boolean or date values without coercion."
  },
  {
    "id": "Rule-020",
    "executionGroup": "attributes",
    "family": "attributes",
    "required": false,
    "title": "Attribute values must satisfy their constraints",
    "description": "Check configured numeric bounds, enums, string lengths and regular expressions."
  },
  {
    "id": "Rule-021",
    "executionGroup": "attributes",
    "family": "structure",
    "required": false,
    "title": "Attribute sources must be readable",
    "description": "Read Feature properties or matching DBF attributes; unavailable or damaged sources have no field validity result."
  },
  {
    "id": "Rule-022",
    "executionGroup": "attributes",
    "family": "diagnostics",
    "required": false,
    "title": "Attribute rule configurations must be valid",
    "description": "Validate a versioned attribute rule file before starting inspection."
  },
  {
    "id": "Rule-023",
    "executionGroup": "attributes",
    "family": "attributes",
    "required": false,
    "title": "Feature IDs must be valid",
    "description": "Preserve string or numeric IDs. Invalid IDs fall back to the source index and produce an identity issue only when attribute rules are enabled."
  }
  ,...qgisRules.map(({id,title,description,family}) => ({id,title,description,family,executionGroup:'topology' as const,required:false}))
];
export const coreRuleIds: readonly string[] = Object.freeze(checkRules.filter(rule => rule.executionGroup === 'core').map(rule => rule.id));
export const requiredRuleIds: readonly string[] = Object.freeze(checkRules.filter(rule => rule.required).map(rule => rule.id));
// Execution membership is independent of the public quality category.
export const attributeRuleIds: readonly string[] = Object.freeze(checkRules.filter(rule => rule.executionGroup === 'attributes').map(rule => rule.id));
export function selectedRuleIds(attributesEnabled: boolean, topologyIds: readonly string[]): { required: string[]; optional: string[] } {
  return { required: [...requiredRuleIds], optional: [...topologyIds, ...(attributesEnabled ? attributeRuleIds : [])] };
}
// Internal diagnostic reasons map to rules; execution failures have no data rule.
export const reasonRules: readonly { code: string; ruleIds: readonly string[]; status: string }[] = [
  ...qgisRules.map(rule => ({code:rule.code,ruleIds:[rule.id],status:'violated'})),
  {
    "code": "READ_ERROR",
    "ruleIds": [
      "Rule-001"
    ],
    "status": "file failure"
  },
  {
    "code": "FILE_TOO_LARGE",
    "ruleIds": [
      "Rule-001"
    ],
    "status": "file failure"
  },
  {
    "code": "UNSUPPORTED_FORMAT",
    "ruleIds": [
      "Rule-001"
    ],
    "status": "file failure"
  },
  {
    "code": "INVALID_JSON",
    "ruleIds": [
      "Rule-001"
    ],
    "status": "file failure"
  },
  {
    "code": "INVALID_ROOT",
    "ruleIds": [
      "Rule-002"
    ],
    "status": "file failure"
  },
  {
    "code": "UNSUPPORTED_CRS",
    "ruleIds": [
      "Rule-002"
    ],
    "status": "file failure"
  },
  {
    "code": "INVALID_FEATURE",
    "ruleIds": [
      "Rule-002"
    ],
    "status": "parse_failed"
  },
  {
    "code": "INVALID_SHAPEFILE",
    "ruleIds": [
      "Rule-003"
    ],
    "status": "file failure"
  },
  {
    "code": "INVALID_ARCHIVE",
    "ruleIds": [
      "Rule-004"
    ],
    "status": "file failure"
  },
  {
    "code": "ARCHIVE_TOO_LARGE",
    "ruleIds": [
      "Rule-004"
    ],
    "status": "file failure"
  },
  {
    "code": "MISSING_SHAPEFILE",
    "ruleIds": [
      "Rule-004"
    ],
    "status": "file failure"
  },
  {
    "code": "MULTIPLE_SHAPEFILES",
    "ruleIds": [
      "Rule-004"
    ],
    "status": "file failure"
  },
  {
    "code": "GEOMETRY_INVALID",
    "ruleIds": [
      "Rule-011"
    ],
    "status": "invalid"
  },
  {
    "code": "EMPTY_GEOMETRY",
    "ruleIds": [
      "Rule-008"
    ],
    "status": "skipped"
  },
  {
    "code": "UNSUPPORTED_DIMENSION",
    "ruleIds": [
      "Rule-007"
    ],
    "status": "skipped"
  },
  {
    "code": "UNSUPPORTED_TYPE",
    "ruleIds": [
      "Rule-010"
    ],
    "status": "skipped"
  },
  {
    "code": "INVALID_COORDINATES",
    "ruleIds": [
      "Rule-005",
      "Rule-007",
      "Rule-010"
    ],
    "status": "parse_failed"
  },
  {
    "code": "INVALID_RING",
    "ruleIds": [
      "Rule-006"
    ],
    "status": "parse_failed"
  },
  {
    "code": "INVALID_SHAPE_RECORD",
    "ruleIds": [
      "Rule-009"
    ],
    "status": "parse_failed"
  },
  {
    "code": "TOPOLOGY_DUPLICATE_GEOMETRY",
    "ruleIds": [
      "Rule-012"
    ],
    "status": "violated"
  },
  { code: 'TOPOLOGY_MULTIPART_GEOMETRY', ruleIds: ['Rule-013'], status: 'violated' },
  { code: 'TOPOLOGY_DANGLE', ruleIds: ['Rule-014'], status: 'violated' },
  { code: 'TOPOLOGY_PSEUDO_NODE', ruleIds: ['Rule-015'], status: 'violated' },
  { code: 'TOPOLOGY_AREA_OVERLAP', ruleIds: ['Rule-016'], status: 'violated' },
  { code: 'TOPOLOGY_AREA_GAP', ruleIds: ['Rule-017'], status: 'violated' },
  {
    "code": "ATTRIBUTE_MISSING",
    "ruleIds": [
      "Rule-018"
    ],
    "status": "invalid"
  },
  {
    "code": "ATTRIBUTE_TYPE",
    "ruleIds": [
      "Rule-019"
    ],
    "status": "invalid"
  },
  {
    "code": "ATTRIBUTE_VALUE",
    "ruleIds": [
      "Rule-020"
    ],
    "status": "invalid"
  },
  {
    "code": "INVALID_PROPERTIES",
    "ruleIds": [
      "Rule-021"
    ],
    "status": "failed"
  },
  {
    "code": "ATTRIBUTES_UNAVAILABLE",
    "ruleIds": [
      "Rule-021"
    ],
    "status": "skipped"
  },
  {
    "code": "INVALID_DBF",
    "ruleIds": [
      "Rule-021"
    ],
    "status": "failed"
  },
  {
    "code": "DBF_ENCODING_ERROR",
    "ruleIds": [
      "Rule-021"
    ],
    "status": "failed"
  },
  {
    "code": "UNSUPPORTED_DBF_FIELD",
    "ruleIds": [
      "Rule-021"
    ],
    "status": "failed"
  },
  {
    "code": "DBF_DELETED_RECORD",
    "ruleIds": [
      "Rule-021"
    ],
    "status": "skipped"
  },
  {
    "code": "INVALID_FEATURE_ID",
    "ruleIds": [
      "Rule-023"
    ],
    "status": "invalid"
  },
  {
    "code": "ATTRIBUTE_CONFIG_ERROR",
    "ruleIds": [
      "Rule-022"
    ],
    "status": "run failure"
  },
  {
    "code": "ENGINE_ERROR",
    "ruleIds": [],
    "status": "run failure"
  },
  {
    "code": "ENGINE_INIT_ERROR",
    "ruleIds": [],
    "status": "run failure"
  },
  {
    "code": "ENGINE_FATAL_ERROR",
    "ruleIds": [],
    "status": "run failure"
  },
  {
    "code": "WORKER_ERROR",
    "ruleIds": [],
    "status": "run failure"
  },
  {
    "code": "TOPOLOGY_ENGINE_UNAVAILABLE",
    "ruleIds": [],
    "status": "run failure"
  },
  {
    "code": "TOPOLOGY_CONFIG_ERROR",
    "ruleIds": [],
    "status": "run failure"
  },
  {
    "code": "TOPOLOGY_INPUT_ERROR",
    "ruleIds": [],
    "status": "run failure"
  },
  {
    "code": "TOPOLOGY_LIMIT_EXCEEDED",
    "ruleIds": [],
    "status": "run failure"
  },
  {
    "code": "TOPOLOGY_TIMEOUT",
    "ruleIds": [],
    "status": "run failure"
  },
  {
    "code": "TOPOLOGY_CANCELLED",
    "ruleIds": [],
    "status": "cancelled"
  }
];
export function ruleIdsForReason(reasonCode: string): string[] {
  if (reasonCode === 'VALID') return ['Rule-011'];
  return [...(reasonRules.find(entry => entry.code === reasonCode)?.ruleIds ?? [])];
}
