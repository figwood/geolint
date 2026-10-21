import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { prepareBatch } from './prepare.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function runStandalone(engine, args) {
  try {
    let input, output, attributeRulesPath;
    const entry = engine === 'qgis' ? './validation/qgis/run.sh' : 'node validation/geolint/run.mjs';
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--help' || args[i] === '-h') {
        console.log(`Usage: ${entry} [DATA_FILE_OR_DIRECTORY] [--attribute-rules FILE] [--output DIRECTORY]\nDefault data: all supported files under the repository sample_data/ directory (recursive).\nAttribute rules: versioned JSON file; QGIS still checks only spatial results.\nReports: fresh directory under .cache/validation (or a new DIRECTORY).\nBatch mode: ${entry} BATCH.json OUTPUT.json\nExit: 0=completed, 2=failed.`);
        return 0;
      }
      if (args[i] === '--attribute-rules' && args[i + 1] && !args[i + 1].startsWith('-')) attributeRulesPath = resolve(args[++i]);
      else if (args[i] === '--output' && args[i + 1] && !args[i + 1].startsWith('-')) output = resolve(args[++i]);
      else if (!args[i].startsWith('-') && !input) input = args[i];
      else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
    }
    const batch = await prepareBatch(input, { attributeRulesPath });
    if (output) await mkdir(output, { recursive: false, mode: 0o700 });
    else {
      const base = join(root, '.cache', 'validation');
      await mkdir(base, { recursive: true });
      output = await mkdtemp(join(base, `${engine}-`));
    }
    const batchPath = join(output, 'batch.json');
    const reportPath = join(output, `${engine}.json`);
    await writeFile(batchPath, JSON.stringify(batch), { mode: 0o600 });
    console.log(`Prepared ${batch.files.length} file(s); running ${engine}.`);
    const command = engine === 'qgis' ? 'bash' : process.execPath;
    const script = join(root, engine === 'qgis' ? 'validation/qgis/run.sh' : 'validation/geolint/run.mjs');
    const child = spawn(command, [script, batchPath, reportPath], { cwd: root, stdio: 'inherit' });
    const interrupt = signal => {
      child.kill(signal);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    const onInterrupt = () => interrupt('SIGINT');
    const onTerminate = () => interrupt('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    const code = await new Promise(resolveExit => {
      child.once('error', () => resolveExit(2));
      child.once('exit', code => resolveExit(code ?? 2));
    });
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    let report;
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
    catch { report = { schemaVersion: '1.0', status: 'failed', files: [], error: 'Runner did not produce a report.' }; }
    if (code !== 0) { report.status = 'failed'; report.exitCode = code; }
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    const records = report.files.flatMap(file => file.records ?? []);
    const counts = Object.fromEntries(['valid', 'invalid', 'skipped', 'parse_failed', 'engine_failed'].map(status => [status, records.filter(record => record.status === status).length]));
    console.log(`${engine}: ${report.status}; files=${batch.files.length}, records=${records.length}; ${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(', ')}`);
    console.log(`Reports: ${output}`);
    return report.status === 'completed' ? 0 : 2;
  } catch (error) { console.error(error.message); return 2; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [engine, ...args] = process.argv.slice(2);
  if (!['qgis', 'geolint'].includes(engine)) { console.error('Engine must be qgis or geolint.'); process.exitCode = 2; }
  else process.exitCode = await runStandalone(engine, args);
}
