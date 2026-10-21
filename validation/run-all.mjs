import {checkGeometryCheckerRegression,compareGeometryChecker,geometryCheckerFixture} from './topology/geometry-checker.mjs';
import { checkTopologyWorkBudgetRegression } from './topology/work-budget.mjs';
import { checkSingleLayerRegression, compareSingleLayerTopology, singleLayerFixture } from './topology/single-layer.mjs';
import { checkDuplicateRegression, duplicateFixture } from './topology/duplicates.mjs';
import { compareDuplicateTopology } from './topology/compare.mjs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareBatch } from './prepare.mjs';
import { compareResults, writeComparison } from './compare.mjs';
import { checkAttributeRegression } from './attributes/check.mjs';
import { checkTopologyRegression, compareTopology, topologyFixture } from './topology/check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  for (const child of children) child.kill(signal);
  process.exit(signal === 'SIGINT' ? 130 : 143);
});

async function run(command, args, output) {
  const code = await new Promise(resolveExit => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    children.add(child);
    child.once('error', () => { children.delete(child); resolveExit(2); });
    child.once('exit', code => { children.delete(child); resolveExit(code ?? 2); });
  });
  let result;
  try { result = JSON.parse(await readFile(output, 'utf8')); }
  catch { result = { schemaVersion: '1.0', status: 'failed', files: [], error: 'Runner did not produce a report.' }; }
  if (code !== 0) { result.status = 'failed'; result.exitCode = code; }
  await writeFile(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  return result;
}

try {
  let input, output, attributeRulesPath;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: validation/test-all.sh [DATA_FILE_OR_DIRECTORY] [--attribute-rules FILE] [--output DIRECTORY]\nDefault data: all supported files under the repository sample_data/ directory (recursive).\nAttribute rules: versioned JSON file; excluded from data discovery.\nReports: fresh run directory under .cache/validation (or DIRECTORY).\nExit: 0=matched, 1=different, 2=failed.\nQGIS setup: validation/qgis/setup-env.sh');
      process.exit(0);
    }
    if (args[i] === '--attribute-rules' && args[i + 1] && !args[i + 1].startsWith('-')) attributeRulesPath = resolve(args[++i]);
    else if (args[i] === '--output' && args[i + 1]) output = resolve(args[++i]);
    else if (!args[i].startsWith('-') && !input) input = args[i];
    else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
  }
  const workBudget = await checkTopologyWorkBudgetRegression();
  console.log(`Topology work regression: completed ${workBudget.checks} checks; explicit limit ${workBudget.explicitLimit}.`);
  const regression = await checkAttributeRegression();
  console.log(`Attribute regression: matched ${regression.records} records and ${regression.problems} expected problems.`);
  console.log(`Attribute identity regression: matched ${regression.identityCases} cases and ${regression.identityProblems} expected problems.`);
  const batch = await prepareBatch(input, { attributeRulesPath });
  if (output) await mkdir(output, { recursive: false, mode: 0o700 });
  else {
    const base = join(root, '.cache', 'validation');
    await mkdir(base, { recursive: true });
    output = await mkdtemp(join(base, 'run-'));
  }
  const batchPath = join(output, 'batch.json');
  await writeFile(batchPath, JSON.stringify(batch), { mode: 0o600 });
  const topology = await checkTopologyRegression();
  await writeFile(join(output, 'topology-geolint.json'), JSON.stringify(topology.report, null, 2) + '\n', { mode: 0o600 });
  const topologyQgis = await run('bash', [join(root, 'validation/qgis/run.sh'), '--topology', fileURLToPath(topologyFixture), join(output, 'topology-qgis.json')], join(output, 'topology-qgis.json'));
  const topologyComparison = compareTopology(topology.report, topologyQgis, topology.expected);
  await writeFile(join(output, 'topology-comparison.json'), JSON.stringify(topologyComparison, null, 2) + '\n', { mode: 0o600 });
  console.log(`Topology regression: ${topologyComparison.status}; cases=${topology.cases}, expected problems=${topology.problems}.`);
  const duplicates = await checkDuplicateRegression();
  await writeFile(join(output, 'duplicates-geolint.json'), JSON.stringify(duplicates.report, null, 2) + '\n', { mode: 0o600 });
  const duplicateQgis = await run('bash', [join(root, 'validation/qgis/run.sh'), '--duplicates', fileURLToPath(duplicateFixture), join(output, 'duplicates-qgis.json')], join(output, 'duplicates-qgis.json'));
  const duplicateComparison = compareDuplicateTopology(duplicates.report, duplicateQgis, duplicates.expected);
  await writeFile(join(output, 'duplicates-comparison.json'), JSON.stringify(duplicateComparison, null, 2) + '\n', { mode: 0o600 });
  console.log(`Duplicate geometry regression: ${duplicateComparison.status}; cases=${duplicates.cases}, pairs=${duplicates.problems}; reference=PyQGIS equality, not plugin error rows.`);
  const singleLayer = await checkSingleLayerRegression();
  await writeFile(join(output, 'single-layer-geolint.json'), JSON.stringify(singleLayer.report, null, 2) + '\n', { mode: 0o600 });
  const singleLayerQgis = await run('bash', [join(root, 'validation/qgis/run.sh'), '--single-layer', fileURLToPath(singleLayerFixture), join(output, 'single-layer-qgis.json')], join(output, 'single-layer-qgis.json'));
  const singleLayerComparison = compareSingleLayerTopology(singleLayer.report, singleLayerQgis, singleLayer.expected);
  await writeFile(join(output, 'single-layer-comparison.json'), JSON.stringify(singleLayerComparison, null, 2) + '\n', { mode: 0o600 });
  console.log(`Single-layer topology regression: ${singleLayerComparison.status}; cases=${singleLayer.cases}, problems=${singleLayer.problems}; reference=PyQGIS algorithms, not GUI plugin rows.`);
  const geometryChecks = await checkGeometryCheckerRegression();
  await writeFile(join(output, 'geometry-checker-geolint.json'), JSON.stringify(geometryChecks.report, null, 2) + '\n', { mode: 0o600 });
  const geometryReference = await run('bash', [join(root, 'validation/qgis/run.sh'), '--geometry-checker', fileURLToPath(geometryCheckerFixture), join(output, 'geometry-checker-qgis.json')], join(output, 'geometry-checker-qgis.json'));
  const geometryComparison = compareGeometryChecker(geometryChecks.report, geometryReference, geometryChecks.expected);
  await writeFile(join(output, 'geometry-checker-comparison.json'), JSON.stringify(geometryComparison, null, 2) + '\n', { mode: 0o600 });
  console.log(`Geometry Checker regression: ${geometryComparison.status}; cases=${geometryChecks.report.cases.length}; reference=independent PyQGIS algorithms; pluginParity=false.`);
  console.log(`Prepared ${batch.files.length} file(s); running geolint and QGIS concurrently.`);
  const results = await Promise.all([
    run(process.execPath, [join(root, 'validation/geolint/run.mjs'), batchPath, join(output, 'geolint.json')], join(output, 'geolint.json')),
    run('bash', [join(root, 'validation/qgis/run.sh'), batchPath, join(output, 'qgis.json')], join(output, 'qgis.json')),
  ]);
  const comparison = compareResults(...results, batch);
  if (topologyComparison.status !== 'matched' || duplicateComparison.status !== 'matched' || singleLayerComparison.status !== 'matched' || geometryComparison.status !== 'matched') {
    comparison.errors.push(...topologyComparison.errors, ...duplicateComparison.errors, ...singleLayerComparison.errors, ...geometryComparison.errors);
    comparison.summary.errors = comparison.errors.length;
    comparison.status = 'failed';
  }
  await writeComparison(comparison, output);
  process.exitCode = comparison.status === 'matched' ? 0 : comparison.status === 'different' ? 1 : 2;
} catch (error) { console.error(error.message); process.exitCode = 2; }
