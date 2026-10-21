import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const version = value => value?.match(/^\d+\.\d+\.\d+/)?.[0];
const statuses = new Set(['valid', 'invalid', 'skipped', 'parse_failed', 'engine_failed']);

export function compareResults(geolint, qgis, batch) {
  const errors = [];
  if (geolint.status !== 'completed') errors.push('geolint did not complete.');
  if (qgis.status !== 'completed') errors.push('QGIS did not complete.');
  const leftVersion = version(geolint.engine?.version);
  const rightVersion = version(qgis.engine?.version);
  if (!leftVersion || leftVersion !== rightVersion) errors.push('GEOS versions are missing or differ.');
  function index(values, key, label) {
    const result = new Map();
    if (!Array.isArray(values)) { errors.push(`${label}: result array is missing or malformed.`); return result; }
    for (const value of values) {
      if (!value || typeof value !== 'object') { errors.push(`${label}: malformed result.`); continue; }
      if (value[key] === undefined || result.has(value[key])) errors.push(`${label}: missing or duplicate ${key}.`);
      result.set(value[key], value);
    }
    return result;
  }
  const leftFiles = index(geolint.files, 'file', 'geolint');
  const rightFiles = index(qgis.files, 'file', 'QGIS');
  const expectedFiles = batch ? index(batch.files, 'file', 'batch') : new Map();
  const fileNames = new Set([...expectedFiles.keys(), ...leftFiles.keys(), ...rightFiles.keys()]);
  const rows = [];
  const inputFailures = [];
  for (const file of fileNames) {
    const left = leftFiles.get(file), right = rightFiles.get(file);
    const expected = expectedFiles.get(file);
    if (expected?.status === 'failed') {
      const code = expected.error?.code ?? 'INPUT_ERROR';
      const anticipated = Boolean(expected.expectedErrorCode && expected.expectedErrorCode === code);
      inputFailures.push(anticipated ? { file, code, expected: true } : { file, code });
      if (!anticipated) errors.push(`${file}: input preparation failed (${code}); no geometry engine comparison was performed.`);
      for (const [label, result] of [['geolint', left], ['QGIS', right]]) {
        if (!result || result.status !== (anticipated ? 'rejected' : 'failed') || result.sha256 !== expected.sha256
          || !isDeepStrictEqual(result.error, expected.error)
          || !Array.isArray(result.records) || result.records.length !== 0) {
          errors.push(`${file}: ${label} has a missing or inconsistent input rejection.`);
        }
      }
      continue;
    }
    if (expected?.expectedErrorCode) errors.push(`${file}: expected input rejection (${expected.expectedErrorCode}) but preparation succeeded.`);
    if (batch && (!expected || expected.status !== 'prepared' || expected.sha256 !== left?.sha256 || expected.sha256 !== right?.sha256)) errors.push(`${file}: results do not match the prepared input.`);
    if (!left || !right || left.status !== 'completed' || right.status !== 'completed') errors.push(`${file}: missing or incomplete file.`);
    if (!left?.sha256 || left.sha256 !== right?.sha256) errors.push(`${file}: input fingerprints differ or are missing.`);
    const leftRecords = index(left?.records, 'featureIndex', `geolint ${file}`);
    const rightRecords = index(right?.records, 'featureIndex', `QGIS ${file}`);
    const expectedRecords = expected ? index(expected.records, 'featureIndex', `batch ${file}`) : new Map();
    if (expected && (leftRecords.size !== expectedRecords.size || rightRecords.size !== expectedRecords.size)) errors.push(`${file}: result counts do not match the prepared input.`);
    for (const featureIndex of [...new Set([...expectedRecords.keys(), ...leftRecords.keys(), ...rightRecords.keys()])].sort((a, b) => a - b)) {
      const a = leftRecords.get(featureIndex), b = rightRecords.get(featureIndex);
      if (expected && (!expectedRecords.has(featureIndex) || !a || !b)) errors.push(`${file} ${featureIndex}: missing or unexpected result.`);
      if ((a && !statuses.has(a.status)) || (b && !statuses.has(b.status))) errors.push(`${file} ${featureIndex}: unknown record status.`);
      if (a?.status === 'engine_failed' || b?.status === 'engine_failed') errors.push(`${file} ${featureIndex}: engine failure.`);
      const match = Boolean(a && b && a.status === b.status && (a.status !== 'skipped' && a.status !== 'parse_failed' || a.reasonCode === b.reasonCode));
      const diagnosticDifference = Boolean(a && b && (a.reason !== b.reason || !isDeepStrictEqual(a.location, b.location)));
      rows.push({ file, featureIndex, featureId: a?.featureId ?? b?.featureId ?? null,
        geolintStatus: a?.status ?? 'missing', qgisStatus: b?.status ?? 'missing', match, diagnosticDifference,
        geolintReason: a?.reason ?? '', qgisReason: b?.reason ?? '',
        geolintLocation: a?.location ?? null, qgisLocation: b?.location ?? null });
    }
  }
  if (!leftFiles.size || !rightFiles.size) errors.push('No file results to compare.');
  const summary = { files: fileNames.size, records: rows.length,
    matched: rows.filter(row => row.match).length, different: rows.filter(row => !row.match).length,
    diagnosticDifferences: rows.filter(row => row.diagnosticDifference).length, errors: errors.length };
  return { schemaVersion: '1.0', status: errors.length ? 'failed' : summary.different ? 'different' : 'matched',
    engines: { geolint: geolint.engine ?? null, qgis: qgis.engine ?? null }, summary, inputFailures, errors, rows };
}

export async function writeComparison(result, directory) {
  await writeFile(resolve(directory, 'comparison.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  const keys = ['file', 'featureIndex', 'featureId', 'geolintStatus', 'qgisStatus', 'match', 'diagnosticDifference', 'geolintReason', 'qgisReason', 'geolintLocation', 'qgisLocation'];
  const cell = value => {
    let text = String(typeof value === 'object' && value !== null ? JSON.stringify(value) : value ?? '');
    if (typeof value === 'string' && (/^[\x00-\x1f\x7f]/.test(text) || /^\s*[=+\-@]/.test(text))) text = `'${text}`;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  await writeFile(resolve(directory, 'comparison.csv'), [keys.map(cell).join(','), ...result.rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\r\n') + '\r\n', { mode: 0o600 });
  console.log(`Comparison: ${result.status}; files=${result.summary.files}, records=${result.summary.records}, matched=${result.summary.matched}, different=${result.summary.different}, diagnostic differences=${result.summary.diagnosticDifferences}, expected input rejections=${result.inputFailures.filter(file => file.expected).length}`);
  for (const error of result.errors) console.error(error);
  console.log(`Reports: ${directory}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [left, right, directory, batchPath] = process.argv.slice(2);
    if (!left || !right || !directory) throw new Error('Usage: node validation/compare.mjs GEOLINT.json QGIS.json OUTPUT_DIRECTORY [BATCH.json]');
    const results = await Promise.all([left, right].map(async path => JSON.parse(await readFile(path, 'utf8'))));
    const batch = batchPath ? JSON.parse(await readFile(batchPath, 'utf8')) : undefined;
    const comparison = compareResults(...results, batch);
    await writeComparison(comparison, directory);
    process.exitCode = comparison.status === 'matched' ? 0 : comparison.status === 'different' ? 1 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
