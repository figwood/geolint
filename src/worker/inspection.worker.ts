import type { StartRequest, WorkerMessage } from '../contracts.ts';
import { createEngine } from '../engine/geos.ts';
import { runInspection } from '../inspection/run.ts';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<StartRequest>) => void) | null;
  postMessage(message: WorkerMessage): void;
};
let started = false;
scope.onmessage = event => {
  const request = event.data;
  if (started || request.type !== 'start') return;
  started = true;
  void runInspection(request.file, request.runId, message => scope.postMessage(message), () => createEngine(request.engineUrl), request.attributeRules, request.topology);
};
