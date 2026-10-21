import type { NormalizedRecord } from '../contracts.ts';
import { assertFileSize } from '../config.ts';
import { InspectionError } from '../errors.ts';
import { parseInput } from '../input/adapters.ts';
import { summarizePreview, thumbnailPreview } from '../preview/data.ts';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ type: 'load'; file: File } | { type: 'thumbnail'; requestId: number }>) => void) | null;
  postMessage(message: unknown): void;
};
let records: NormalizedRecord[] | undefined;
scope.onmessage = event => {
  const request = event.data;
  if (request.type === 'thumbnail') {
    if (records) scope.postMessage({ type: 'thumbnail', requestId: request.requestId, result: thumbnailPreview(records) });
    return;
  }
  void (async () => {
    try {
      assertFileSize(request.file.size);
      const bytes = new Uint8Array(await request.file.arrayBuffer());
      records = parseInput(request.file.name, bytes);
      scope.postMessage({ type: 'summary', result: summarizePreview(records) });
    } catch (error) {
      records = undefined;
      scope.postMessage({ type: 'failed', message: error instanceof InspectionError ? `${error.code}: ${error.message}` : 'Could not read this file for preview.' });
    }
  })();
};
