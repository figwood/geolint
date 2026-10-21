import type { Geometry, Location, RecordRef, NormalizedRecord, PolygonalGeometry } from '../contracts.ts';

export interface TopologyLimits { features: number; positions: number; candidates: number; issues: number; durationMs: number }
export type RuleParameters = Readonly<Record<string, number | string | boolean | readonly string[]>>;
export interface SourcePath { recordKey: string; part?: number; ring?: number; vertex?: number; segment?: number }
export interface Occurrence { sources: readonly SourcePath[]; region?: number }
export type Measurements = Readonly<Record<string, number>>;
export interface TopologyOptions { rules: { id: string; parameters: RuleParameters }[]; limits: TopologyLimits }
export interface TopologySession {
  add(recordKey: string, geometry: Geometry): void;
  equals(left: string, right: string): boolean;
  relatePattern(left: string, right: string, pattern: string): boolean;
  overlaps?(left: string, right: string): boolean;
  polygonGaps?(keys: readonly string[], controls: TopologyOperationControls): Promise<PolygonalGeometry[]>;
  qgisEquals?(left: string, right: string, digits: number): boolean;
  qgisContains?(container: string, subject: string, digits: number): boolean;
  qgisOverlaps?(left: string, right: string, digits: number): boolean;
  centroid?(key: string): Location;
  polygonIntersections?(left: string, right: string, digits: number, controls: TopologyOperationControls): Promise<PolygonalGeometry[]>;
  qgisPolygonGaps?(keys: readonly string[], digits: number, controls: TopologyOperationControls): Promise<PolygonalGeometry[]>;
  dispose(): void;
}
export type TopologyParticipant = Pick<RecordRef, 'recordKey' | 'featureIndex' | 'featureId' | 'featureIdType' | 'geometryType'>;
export type TopologyScope = 'record' | 'pair' | 'dataset';
export type TopologyInput = NormalizedRecord & { disposition: 'check' };
export interface TopologyOperationControls {
  checkpoint(): void;
  yield(): Promise<void>;
  reservePositions(count: number): void;
}
export interface TopologyDatasetContext {
  records: readonly TopologyInput[];
  preflightRecords: readonly NormalizedRecord[];
  parameters: RuleParameters;
  session: TopologySession;
  controls: TopologyOperationControls;
  checked(): void;
  emit(finding: TopologyFinding, recordKeys: readonly string[], scope?: TopologyScope): void;
}
export interface TopologyFinding { reasonCode: string; reason: string; location: Location | null; geometry?: PolygonalGeometry; occurrence?: Occurrence; measurements?: Measurements }
interface CheckerBase {
  id: string; geometryTypes: readonly Geometry['type'][]; acceptsInvalid?: boolean;
  inputPolicy?: 'valid' | 'normalized' | 'preflight';
  outputSchema?: RuleOutputSchema;
  parseParameters(value: unknown): RuleParameters;
}
export type TopologyChecker = CheckerBase & (
  { candidateMode: 'bbox-intersects'; check(session: TopologySession, left: TopologyParticipant, right: TopologyParticipant): TopologyFinding | null }
  | { candidateMode: 'feature'; checkFeature(record: TopologyInput): TopologyFinding | null }
  | { candidateMode: 'dataset'; checkDataset(context: TopologyDatasetContext): Promise<void> }
);
export interface TopologyIssue extends TopologyFinding { issueId: string; ruleId: string; participants: TopologyParticipant[]; scope?: TopologyScope }
export interface TopologyExclusion { recordKey: string; reasonCode: string; affectsCoverage: boolean }
export interface TopologyRuleResult {
  ruleId: string; status: 'passed' | 'violated' | 'skipped' | 'failed'; coverage: 'complete' | 'partial' | 'none';
  participantCount: number; exclusions: TopologyExclusion[]; candidateCount: number; checkCount: number; issues: TopologyIssue[];
}
export interface TopologySummary { total: number; passed: number; violated: number; skipped: number; failed: number; candidates: number; checks: number; issues: number }
export interface TopologyResult { status: 'disabled' | 'completed' | 'failed'; options: TopologyOptions; rules: TopologyRuleResult[]; summary: TopologySummary }
export interface TopologyProgress { phase: 'topology-preparing' | 'topology-checking'; candidates: number; checks: number }
export interface TopologyControls { signal?: AbortSignal; now?: () => number; onProgress?: (progress: TopologyProgress) => void }

export interface RuleOutputSchema {
  scopes: readonly TopologyScope[]; participants: { min: number; max: number | null };
  location: 'required' | 'optional'; geometry: 'required' | 'optional' | 'forbidden';
  measurementKeys: readonly string[]; occurrence: 'required' | 'optional';
  validate?(issue: TopologyIssue, records: ReadonlyMap<string, import('../contracts.ts').InspectionRecord>, parameters: RuleParameters): void;
}
