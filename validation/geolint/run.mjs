#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createEngine } from '../../src/engine/geos.ts';
import { inspectDataset, DatasetInspectionError } from '../../src/inspection/dataset.ts';
import { runStandalone } from '../run-single.mjs';
import { parseAttributeRuleFile, emptyAttributeRuleFile } from '../../src/attributes/config.ts';

const args = process.argv.slice(2);
if (args.length !== 2 || args.some(arg => arg.startsWith('-'))) {
  process.exit(await runStandalone('geolint', args));
}
const [input, output] = args;
let engine;
let report = { schemaVersion: '5.0', status: 'failed', files: [] };
try {
  const batch = JSON.parse(await readFile(input, 'utf8'));
  const attributeRules = parseAttributeRuleFile(batch.attributeRules ?? emptyAttributeRuleFile());
  report.attributeRules = attributeRules;
  engine = await createEngine();
  report.engine = engine.info;
  for (const file of batch.files) {
    if (file.status === 'failed') {
      report.files.push({ ...file, status: file.expectedErrorCode && file.error?.code === file.expectedErrorCode ? 'rejected' : 'failed' });
      continue;
    }
    try {
      const result = await inspectDataset(file.records, engine, attributeRules, {topology:batch.topology});
      report.files.push({ file: file.file, sha256: file.sha256, status: 'completed', ...result });
    } catch(error) {
      report.files.push({ file: file.file, sha256: file.sha256, status: 'failed', error: 'Dataset inspection stopped.', records:error instanceof DatasetInspectionError?error.partialRecords:[] });
    }
  }
  report.status = report.files.every(file => ['completed', 'rejected'].includes(file.status) && file.records.every(r => r.status !== 'engine_failed')) ? 'completed' : 'failed';
} catch {
  report.error = 'GEOS WASM initialization or batch loading failed.';
} finally { engine?.dispose(); }
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
process.exitCode = report.status === 'completed' ? 0 : 2;
