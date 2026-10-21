import { topologyCheckers } from '../topology/registry.ts';
import type { WorkerMessage } from '../contracts.ts';
import type { AttributeRuleFile } from '../attributes/contracts.ts';
import { parseAttributeRuleFile, emptyAttributeRuleFile } from '../attributes/config.ts';
import { parseTopologyOptions } from '../topology/config.ts';
import { resolveTopologyCheckers } from '../topology/run.ts';
let cancelActive: (() => void) | undefined;

export function startInspection(file: File, onMessage: (message: WorkerMessage) => void, attributeRules?: AttributeRuleFile, topology?: unknown): { runId: string; cancel(): void } {
  const config = parseAttributeRuleFile(attributeRules ?? emptyAttributeRuleFile());
  const topologyOptions = parseTopologyOptions(topology);
  resolveTopologyCheckers(topologyOptions, topologyCheckers);
  cancelActive?.();
  const runId = crypto.randomUUID();
  let worker: Worker;
  let terminal = false, processed = 0;
  const cleanup = () => {
    terminal = true;
    worker?.terminate();
    if (cancelActive === cancel) cancelActive = undefined;
  };
  const cancel = () => {
    if (terminal) return;
    cleanup();
    onMessage({ type: 'cancelled', runId, code: 'TOPOLOGY_CANCELLED', processed, summary: null });
  };
  const fail = () => {
    if (terminal) return;
    cleanup();
    onMessage({ type: 'failed', runId, processed, summary: null, code: 'WORKER_ERROR', message: 'The inspection worker stopped unexpectedly.' });
  };
  cancelActive = cancel;
  try {
    worker = new Worker(new URL('./inspection.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (terminal || message.runId !== runId) return;
      if (message.type === 'progress') processed = message.processed;
      else cleanup();
      onMessage(message);
    };
    worker.onerror = event => { event.preventDefault(); fail(); };
    worker.onmessageerror = fail;
    worker.postMessage({ type: 'start', runId, file, attributeRules: config, topology: topologyOptions, engineUrl: new URL('../../vendor/geos/geos.esm.js', import.meta.url).href });
  } catch { fail(); }
  return { runId, cancel };
}
