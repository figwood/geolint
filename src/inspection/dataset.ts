import { geometryShape } from '../topology/occurrence.ts';
import { topologyCheckers } from '../topology/registry.ts';
import type { GeometryEngine, InspectionRecord, NormalizedRecord } from '../contracts.ts';
import type { AttributeRuleFile } from '../attributes/contracts.ts';
import { parseAttributeRuleFile } from '../attributes/config.ts';
import { summarizeAttributes } from '../attributes/summary.ts';
import { InspectionError } from '../errors.ts';
import { selectedRuleIds } from '../diagnostics.ts';
import type { TopologyChecker, TopologyOptions, TopologyProgress } from '../topology/contracts.ts';
import { parseTopologyOptions } from '../topology/config.ts';
import { resolveTopologyCheckers, runTopology } from '../topology/run.ts';
import { inspectRecord } from './inspect.ts';
import { summarize } from './summary.ts';

export type DatasetProgress = { phase: 'checking' | TopologyProgress['phase']; processed: number; total: number; topology?: { candidates: number; checks: number } };
export interface DatasetControls {
  topology?: Partial<Omit<TopologyOptions, 'limits'>> & { limits?: Partial<TopologyOptions['limits']> };
  checkers?: readonly TopologyChecker[]; signal?: AbortSignal; onProgress?: (progress: DatasetProgress) => void;
}
export class DatasetInspectionError extends InspectionError {
  readonly partialRecords: InspectionRecord[];
  constructor(error: unknown, records: InspectionRecord[]) {
    super(error instanceof InspectionError ? error.code : 'ENGINE_FATAL_ERROR', error instanceof InspectionError ? error.message : 'Dataset inspection stopped because of an unrecoverable error.');
    this.partialRecords = records;
  }
}
export async function inspectDataset(normalized: readonly NormalizedRecord[], engine: GeometryEngine, attributeRules: AttributeRuleFile, controls: DatasetControls = {}) {
  const records: InspectionRecord[] = [];
  try {
    const assertActive = () => { if (controls.signal?.aborted) throw new InspectionError('TOPOLOGY_CANCELLED', 'Dataset inspection was cancelled.'); };
    assertActive();
    const attributes = parseAttributeRuleFile(attributeRules);
    const checkers = controls.checkers ?? topologyCheckers;
    const topologyOptions = parseTopologyOptions(controls.topology, checkers);
    resolveTopologyCheckers(topologyOptions, checkers);
    const progress = () => controls.onProgress?.({ phase: 'checking', processed: records.length, total: normalized.length });
    let lastProgress = performance.now(); progress();
    for (const record of normalized) {
      assertActive();
      const inspected = inspectRecord(record, engine, attributes.rules);
      if (record.disposition === 'check' && checkers.some(checker => checker.outputSchema && topologyOptions.rules.some(rule => rule.id === checker.id))) inspected.geometryShape = geometryShape(record.geometry);
      records.push(inspected);
      if (performance.now() - lastProgress >= 50) {
        progress(); await new Promise<void>(resolve => setTimeout(resolve, 0)); lastProgress = performance.now();
      }
    }
    progress();
    assertActive();
    const topology = await runTopology(normalized, records, engine, topologyOptions, checkers, {
      signal: controls.signal,
      onProgress: update => controls.onProgress?.({ phase: update.phase, processed: records.length, total: normalized.length, topology: { candidates: update.candidates, checks: update.checks } }),
    });
    assertActive();
    return { records, summary: summarize(records), attributeSummary: summarizeAttributes(records), topology,
      ruleSelection: selectedRuleIds(attributes.rules.some(rule => rule.enabled), topologyOptions.rules.map(rule => rule.id)) };
  } catch (error) { throw new DatasetInspectionError(error, records); }
}
