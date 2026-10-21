import type { PreflightEvidence } from './geometry/preflight.ts';
import type { AttributeSource, AttributeResult, AttributeSummary, AttributeRuleFile } from './attributes/contracts.ts';
import type { TopologySession, TopologyResult, TopologyOptions, TopologyProgress } from './topology/contracts.ts';
export type RecordStatus = 'valid' | 'invalid' | 'skipped' | 'parse_failed' | 'engine_failed';
export type PolygonalGeometry = { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };
export type Geometry = PolygonalGeometry
  | { type: 'Point'; coordinates: number[] }
  | { type: 'MultiPoint' | 'LineString'; coordinates: number[][] }
  | { type: 'MultiLineString'; coordinates: number[][][] }
  | { type: 'GeometryCollection'; geometries: Geometry[] };
export type Location = { x: number; y: number };
export interface EngineInfo {
  name: string; version: string; wasmPackageVersion: string;
  parameters: Record<string, string | number | boolean>;
  coordinateSemantics: 'planar-2d';
}
export interface EngineResult { valid: boolean; reason: string; location: Location | null }
export interface GeometryEngine {
  info: EngineInfo;
  check(geometry: Geometry): EngineResult;
  createTopologySession?(): TopologySession;
  dispose(): void;
}
export interface RecordRef {
  recordKey: string; featureIndex: number; featureId: string | number | null;
  featureIdType: 'string' | 'number' | 'missing' | 'invalid';
  geometryType: string | null; warnings: string[];
  attributes?: AttributeSource;
  preflightEvidence?: PreflightEvidence;
  geometryShape?: import('./topology/occurrence.ts').GeometryShape;
}
export type NormalizedRecord = RecordRef & (
  { disposition: 'check'; geometry: Geometry }
  | { disposition: 'skipped' | 'parse_failed'; reasonCode: string; reason: string }
);
export interface InspectionRecord extends RecordRef {
  status: RecordStatus; reasonCode: string; reason: string; location: Location | null;
  attributeResult?: AttributeResult;
}
export interface Summary {
  total: number; checked: number; valid: number; invalid: number;
  skipped: number; parseFailed: number; engineFailed: number;
}
interface CompletedRunBase {
  run: { fileName: string; fileBytes: number; completedAt: string; status: 'completed' };
  engine: EngineInfo; summary: Summary; records: InspectionRecord[];
  attributeRules: AttributeRuleFile; attributeSummary: AttributeSummary;
}
export interface CompletedRunV5 extends CompletedRunBase {
  schemaVersion: '5.0'; topology: TopologyResult;
  ruleSelection: { required: string[]; optional: string[] };
}
export type CompletedRun = CompletedRunV5;
export type InspectionPhase = 'reading' | 'parsing' | 'loading-engine' | 'checking' | TopologyProgress['phase'];
export type WorkerMessage =
  | { type: 'progress'; runId: string; phase: InspectionPhase; processed: number; total: number | null; topology?: { candidates: number; checks: number } }
  | { type: 'completed'; runId: string; result: CompletedRun }
  | { type: 'failed'; runId: string; code: string; message: string; processed: number; summary: null; partialRecords?: InspectionRecord[] }
  | { type: 'cancelled'; runId: string; code: 'TOPOLOGY_CANCELLED'; processed: number; summary: null };
export interface StartRequest { type: 'start'; runId: string; file: File; engineUrl: string; attributeRules?: AttributeRuleFile; topology?: TopologyOptions }
