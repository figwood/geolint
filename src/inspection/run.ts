import { topologyCheckers } from '../topology/registry.ts';
import type { GeometryEngine, InspectionRecord, WorkerMessage, InspectionPhase } from '../contracts.ts';
import { assertFileSize } from '../config.ts';
import { InspectionError } from '../errors.ts';
import { parseInput } from '../input/adapters.ts';
import { DatasetInspectionError, inspectDataset } from './dataset.ts';
import type { AttributeRuleFile } from '../attributes/contracts.ts';
import { AttributeConfigError, emptyAttributeRuleFile, parseAttributeRuleFile } from '../attributes/config.ts';
import { parseTopologyOptions } from '../topology/config.ts';
import { resolveTopologyCheckers } from '../topology/run.ts';
export interface LocalFile { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
export async function runInspection(file: LocalFile, runId: string, emit: (message: WorkerMessage) => void, load: () => Promise<GeometryEngine>, attributeRules?: AttributeRuleFile, topology?: unknown, signal?: AbortSignal): Promise<void> {
  let records: InspectionRecord[] = [];
  let engine: GeometryEngine | undefined;
  let phase: InspectionPhase = 'reading';
  let total: number | null = null;
  const progress = () => emit({ type: 'progress', runId, phase, processed: records.length, total });
  const assertActive = () => { if (signal?.aborted) throw new InspectionError('TOPOLOGY_CANCELLED', 'Inspection was cancelled.'); };
  try {
    assertActive();
    const config = parseAttributeRuleFile(attributeRules ?? emptyAttributeRuleFile());
    const topologyOptions = parseTopologyOptions(topology);
    resolveTopologyCheckers(topologyOptions, topologyCheckers);
    assertFileSize(file.size);
    progress();
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch { throw new InspectionError('READ_ERROR', 'Could not read this file.'); }
    assertActive(); assertFileSize(bytes.length);
    phase = 'parsing'; progress();
    assertActive();
    const normalized = parseInput(file.name, bytes);
    bytes = new Uint8Array(0);
    total = normalized.length;
    phase = 'loading-engine'; progress();
    assertActive();
    engine = await load();
    assertActive();
    const result = await inspectDataset(normalized, engine, config, { signal, topology: topologyOptions, onProgress: update => {
      phase = update.phase;
      emit({ type: 'progress', runId, ...update });
    } });
    records = result.records;
    assertActive();
    const info = engine.info;
    engine.dispose();
    engine = undefined;
    assertActive();
    emit({ type: 'completed', runId, result: {
      schemaVersion: '5.0', run: { fileName: file.name, fileBytes: file.size, completedAt: new Date().toISOString(), status: 'completed' },
      engine: info, ...result, attributeRules: config,
    } });
  } catch (error) {
    if (error instanceof DatasetInspectionError) records = error.partialRecords;
    const code = error instanceof InspectionError || error instanceof AttributeConfigError ? error.code : phase === 'loading-engine' ? 'ENGINE_INIT_ERROR' : 'ENGINE_FATAL_ERROR';
    const message = error instanceof InspectionError || error instanceof AttributeConfigError ? error.message : phase === 'loading-engine' ? 'The geometry engine could not be loaded.' : 'Inspection stopped because of an unrecoverable error.';
    if (signal?.aborted || code === 'TOPOLOGY_CANCELLED') emit({ type: 'cancelled', runId, code: 'TOPOLOGY_CANCELLED', processed: records.length, summary: null });
    else emit({ type: 'failed', runId, code, message, processed: records.length, summary: null, partialRecords: records });
  } finally {
    if (engine) { try { engine.dispose(); } catch { /* Failed run already has no report. */ } }
  }
}
