import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { shapefile, shapeRecord, square } from './helpers/shapefile.mjs';

const root = new URL('../', import.meta.url);
const record = (index, status, reason = 'reason') => ({ featureIndex: index, recordKey: `feature:${index}`, status, reason, location: null });
const output = records => ({ status: 'completed', engine: { version: '3.13.0' }, files: [{ file: 'a.geojson', sha256: 'abc', status: 'completed', records }] });
test('attribute batch CLI excludes configuration from input discovery and uses real product rules',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'geolint-attribute-batch-'));
  try{
    const rulesPath=join(directory,'rules.json');
    await writeFile(rulesPath,await readFile('examples/attribute-rules.json'));
    await writeFile(join(directory,'data.geojson'),await readFile('tests/fixtures/attributes/data.geojson'));
    const {prepareBatch}=await import('../validation/prepare.mjs');
    const batch=await prepareBatch(directory,{attributeRulesPath:rulesPath});
    assert.deepEqual(batch.files.map(f=>f.file),['data.geojson']);assert.equal(batch.attributeRules.rules[0].id,'pid-required');
    const out=join(directory,'report');
    const result=spawnSync(process.execPath,['validation/geolint/run.mjs',directory,'--attribute-rules',rulesPath,'--output',out],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(await readFile(join(out,'geolint.json'),'utf8'));
    assert.equal(report.schemaVersion,'5.0');assert.equal(report.files[0].attributeSummary.issueCount,6);
    assert.equal(report.files[0].records[3].attributeResult.status,'failed');
    await writeFile(rulesPath,'{bad');await assert.rejects(()=>prepareBatch(directory,{attributeRulesPath:rulesPath}),/JSON/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('fixed attribute regression checks hand-authored expectations independently of QGIS',async()=>{
  const {checkAttributeRegression}=await import('../validation/attributes/check.mjs');
  const result=await checkAttributeRegression();assert.equal(result.records,4);assert.equal(result.problems,6);
  assert.equal(result.identityCases,4);assert.equal(result.identityProblems,3);
});

test('preparation failures identify input rejection without inventing missing results', async () => {
  const { compareResults } = await import('../validation/compare.mjs');
  const file = { file: 'bad.geojson', sha256: 'abc', status: 'failed', records: [], error: { code: 'INVALID_ROOT', message: 'Input could not be read or normalized.' } };
  const report = { ...output([]), status: 'failed', files: [file] };
  const result = compareResults(report, report, { files: [file] });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.inputFailures, [{ file: 'bad.geojson', code: 'INVALID_ROOT' }]);
  assert.ok(result.errors.some(error => error.includes('INVALID_ROOT')));
  assert.ok(!result.errors.some(error => /missing or incomplete file|results do not match/.test(error)));
  const missing = { ...report, files: [] };
  assert.ok(compareResults(report, missing, { files: [file] }).errors.some(error => error.includes('missing or inconsistent input rejection')));
});

test('only explicitly expected rejections can pass and unexpected acceptance fails', async () => {
  const { compareResults } = await import('../validation/compare.mjs');
  const source = { file: 'a.geojson', sha256: 'abc', status: 'failed', records: [], error: { code: 'INVALID_ROOT' }, expectedErrorCode: 'INVALID_ROOT' };
  const report = { ...output([]), files: [{ ...source, status: 'rejected' }] };
  assert.equal(compareResults(report, report, { files: [source] }).status, 'matched');
  const changed = { ...source, error: { code: 'READ_ERROR' } };
  assert.equal(compareResults(report, report, { files: [changed] }).status, 'failed');
  const accepted = { ...source, status: 'prepared' };
  assert.equal(compareResults(output([]), output([]), { files: [accepted] }).status, 'failed');
  assert.equal(compareResults(report, { ...report, files: [] }, { files: [source] }).status, 'failed');
});

test('QGIS batch handling preserves skips, indexes and engine failure statuses', () => {
  const result = spawnSync('python3', [new URL('./validation_qgis_test.py', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('batch preserves nested file identity, malformed inputs, SHP and skipped GeoJSON records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geolint validation '));
  try {
    await mkdir(join(directory, 'nested'));
    await writeFile(join(directory, 'nested', 'a.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'same', geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', id: 'same', geometry: null },
    ] }));
    await writeFile(join(directory, 'bad.geojson'), '{broken');
    await writeFile(join(directory, 'shape.shp'), shapefile([shapeRecord([square])]));
    const { prepareBatch } = await import('../validation/prepare.mjs');
    const batch = await prepareBatch(directory);
    assert.deepEqual(batch.files.map(f => f.file), ['bad.geojson', 'nested/a.geojson', 'shape.shp']);
    assert.equal(batch.files[0].status, 'failed');
    assert.deepEqual(batch.files[1].records.map(r => r.disposition), ['check', 'skipped']);
    assert.deepEqual(batch.files[1].records.map(r => r.featureIndex), [0, 1]);
    assert.equal(batch.files[2].records[0].disposition, 'check');
    assert.match(batch.files[2].sha256, /^[a-f0-9]{64}$/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('geolint batch runner checks every sample_data dataset by default with the actual WASM engine', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geolint-validation-'));
  try {
    const { prepareBatch } = await import('../validation/prepare.mjs');
    const batch = await prepareBatch();
    const manifest = JSON.parse(await readFile(new URL('../sample_data/.config/manifest.json', import.meta.url), 'utf8'));
    for (const entry of manifest.entries) assert.ok(batch.files.some(file => file.file === entry.file));
    assert.ok(batch.files.every(file => !file.file.startsWith('.config/')));
    assert.equal(batch.files.length, 43);
    assert.ok(batch.files.some(file => file.file === 'Rule-001.geojson' && file.status === 'prepared'));
    assert.ok(batch.files.every(file => file.status === 'prepared' && !file.expectedErrorCode));
    await writeFile(join(directory, 'batch.json'), JSON.stringify(batch));
    const result = spawnSync(process.execPath, ['validation/geolint/run.mjs', join(directory, 'batch.json'), join(directory, 'out.json')], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(await readFile(join(directory, 'out.json'), 'utf8'));
    assert.equal(data.status, 'completed');
    assert.deepEqual(data.files.map(file => file.file), batch.files.map(file => file.file));
    for (const file of batch.files.filter(file => file.status === 'failed')) {
      assert.deepEqual(data.files.find(result => result.file === file.file), { ...file, status: 'rejected' });
    }
    assert.deepEqual(data.files.find(file => file.file === 'sample.geojson').records.map(r => r.status), ['valid', 'invalid', 'skipped']);
    assert.equal(data.engine.version.split('-')[0], '3.13.0');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('comparison joins by index, counts diagnostic differences separately and never matches missing records', async () => {
  const { compareResults } = await import('../validation/compare.mjs');
  const left = output([record(0, 'valid'), record(1, 'invalid'), record(2, 'skipped')]);
  const right = output([record(1, 'invalid', 'another reason'), record(0, 'valid')]);
  const result = compareResults(left, right);
  assert.equal(result.status, 'different');
  assert.equal(result.summary.matched, 2);
  assert.equal(result.summary.different, 1);
  assert.equal(result.summary.diagnosticDifferences, 1);
  assert.equal(result.rows[2].qgisStatus, 'missing');
});

test('identical input or engine failures and incompatible GEOS versions cannot pass comparison', async () => {
  const { compareResults } = await import('../validation/compare.mjs');
  assert.equal(compareResults(output([record(0, 'engine_failed')]), output([record(0, 'engine_failed')])).status, 'failed');
  const failed = { status: 'failed', files: [], error: 'unavailable' };
  assert.equal(compareResults(failed, failed).status, 'failed');
  const left = output([record(0, 'valid')]);
  const right = output([record(0, 'valid')]);
  right.engine.version = '3.15.0';
  assert.equal(compareResults(left, right).status, 'failed');
  right.engine.version = '3.13.0';
  right.files[0].sha256 = 'different-input';
  assert.equal(compareResults(left, right).status, 'failed');
  right.files[0].sha256 = 'abc';
  right.files[0].records.push(record(0, 'invalid'));
  assert.equal(compareResults(left, right).status, 'failed');
});

test('missing arrays and jointly omitted records fail while legitimate empty collections match', async () => {
  const { compareResults } = await import('../validation/compare.mjs');
  const data = output([]);
  const emptyBatch = { files: [{ file: 'a.geojson', sha256: 'abc', status: 'prepared', records: [] }] };
  assert.equal(compareResults(data, data, emptyBatch).status, 'matched');
  const batch = { files: [{ file: 'a.geojson', sha256: 'abc', status: 'prepared', records: [{ featureIndex: 0 }] }] };
  assert.equal(compareResults(data, data, batch).status, 'failed');
  delete data.files[0].records;
  assert.equal(compareResults(data, data).status, 'failed');
  const omitted = { status: 'completed', engine: { version: '3.13.0' }, files: [] };
  assert.equal(compareResults(omitted, omitted, batch).status, 'failed');
});

test('installer dry run performs no installation and top-level help works outside the repository', () => {
  const setup = spawnSync('bash', [new URL('../validation/qgis/setup-env.sh', import.meta.url).pathname, '--dry-run'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(setup.status, 0, setup.stderr);
  assert.match(setup.stdout, /geos=3\.13\.0/);
  const help = spawnSync('bash', [new URL('../validation/test-all.sh', import.meta.url).pathname, '--help'], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--output/);
  assert.match(help.stdout, /sample_data/);
});

test('CSV escapes diagnostic text and formula IDs while preserving JSON values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geolint-validation-csv-'));
  try {
    const { compareResults, writeComparison } = await import('../validation/compare.mjs');
    const data = output([{ ...record(0, 'invalid', 'line 1,"quoted"\nline 2'), featureId: '=1+1' }]);
    await writeComparison(compareResults(data, data), directory);
    const csv = await readFile(join(directory, 'comparison.csv'), 'utf8');
    assert.ok(csv.includes('"\'=1+1"'));
    assert.ok(csv.includes('"line 1,""quoted""\nline 2"'));
    const json = JSON.parse(await readFile(join(directory, 'comparison.json'), 'utf8'));
    assert.equal(json.rows[0].featureId, '=1+1');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('one-key workflow keeps geolint output and failure reports when QGIS cannot start; refuses old output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geolint validation flow '));
  try {
    const destination = join(directory, 'reports');
    const result = spawnSync('bash', [new URL('../validation/test-all.sh', import.meta.url).pathname, new URL('../sample_data/sample.geojson', import.meta.url).pathname, '--output', destination], {
      cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, QGIS_PYTHON: join(directory, 'missing-python') },
    });
    assert.equal(result.status, 2, result.stderr);
    const comparison = JSON.parse(await readFile(join(destination, 'comparison.json'), 'utf8'));
    assert.equal(comparison.status, 'failed');
    assert.equal(comparison.summary.files, 1);
    assert.equal(comparison.summary.records, 3);
    const geolint = JSON.parse(await readFile(join(destination, 'geolint.json'), 'utf8'));
    assert.equal(geolint.status, 'completed');
    assert.deepEqual(geolint.files.map(file => file.file), ['sample.geojson']);
    const before = await readFile(join(destination, 'comparison.json'), 'utf8');
    const rerun = spawnSync('bash', [new URL('../validation/test-all.sh', import.meta.url).pathname, '--output', destination], { encoding: 'utf8' });
    assert.equal(rerun.status, 2);
    assert.equal(await readFile(join(destination, 'comparison.json'), 'utf8'), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('standalone geolint defaults to sample_data outside the repository and accepts raw data paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'geolint standalone '));
  try {
    const script = new URL('../validation/geolint/run.mjs', import.meta.url).pathname;
    const result = spawnSync(process.execPath, [script, '--output', join(directory, 'all')], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(await readFile(join(directory, 'all', 'geolint.json'), 'utf8'));
    assert.equal(report.files.length, 43);
    assert.ok(report.files.some(file => file.file === 'Rule-001.geojson' && file.status === 'completed'));
    const sample = new URL('../sample_data/sample.geojson', import.meta.url).pathname;
    const single = spawnSync(process.execPath, [script, sample, '--output', join(directory, 'single')], { cwd: tmpdir(), encoding: 'utf8' });
    assert.equal(single.status, 0, single.stderr);
    const singleReport = JSON.parse(await readFile(join(directory, 'single', 'geolint.json'), 'utf8'));
    assert.deepEqual(singleReport.files.map(file => file.file), ['sample.geojson']);
    assert.deepEqual(singleReport.files[0].records.map(record => record.status), ['valid', 'invalid', 'skipped']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('standalone QGIS help needs no environment and unavailable QGIS still emits a failed report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qgis standalone '));
  try {
    const script = new URL('../validation/qgis/run.sh', import.meta.url).pathname;
    const env = { ...process.env, QGIS_PYTHON: join(directory, 'missing-python') };
    const help = spawnSync('bash', [script, '--help'], { cwd: tmpdir(), encoding: 'utf8', env });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /sample_data/);
    const result = spawnSync('bash', [script, '--output', join(directory, 'reports')], { cwd: tmpdir(), encoding: 'utf8', env });
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(await readFile(join(directory, 'reports', 'qgis.json'), 'utf8'));
    assert.equal(report.status, 'failed');
    const batch = JSON.parse(await readFile(join(directory, 'reports', 'batch.json'), 'utf8'));
    assert.equal(batch.files.length, 43);
    assert.ok(batch.files.some(file => file.file === 'Rule-001.geojson' && file.status === 'prepared'));
    assert.ok(batch.files.every(file => file.status === 'prepared' && !file.expectedErrorCode));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
