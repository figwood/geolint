import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordPage, completionNotice, topologyRecordResults } from '../src/ui/results.ts';

test('results paginate without dropping records and clamp page after filtering', () => {
  const records = Array.from({length:205}, (_, i) => ({featureIndex:i, status:i===204?'skipped':'valid'}));
  assert.deepEqual(recordPage(records, 'all', 2).records.map(r=>r.featureIndex), [200,201,202,203,204]);
  const filtered = recordPage(records, 'issues', 2);
  assert.equal(filtered.page, 0);
  assert.equal(filtered.total, 1);
  assert.equal(filtered.records[0].featureIndex, 204);
  assert.equal(recordPage([], 'all', 8).pages, 1);
  assert.equal(recordPage(records, 'valid', 0).records.length, 100);
});
test('attribute-only issues remain visible and cannot produce an all-clear notice',()=>{
  const records=[{status:'valid',attributeResult:{status:'invalid',issues:[{}]}},{status:'valid',attributeResult:{status:'skipped',issues:[]}},{status:'valid',attributeResult:{status:'failed',issues:[]}},{status:'valid',attributeResult:{status:'valid',issues:[]}}];
  assert.equal(recordPage(records,'issues',0).total,3);
  assert.equal(recordPage(records,'attribute-invalid',0).total,1);
  assert.equal(recordPage(records,'attribute-skipped',0).total,1);
  assert.equal(recordPage(records,'attribute-failed',0).total,1);
  const summary={total:4,checked:4,valid:4,invalid:0,skipped:0,parseFailed:0,engineFailed:0};
  assert.doesNotMatch(completionNotice(summary,{total:4,checked:2,valid:1,invalid:1,failed:1,skipped:1,disabled:0,issueCount:1}),/^All/);
});
test('completion notice does not imply skipped, empty or failed records are valid', () => {
  const summary={total:1,checked:1,valid:1,invalid:0,skipped:0,parseFailed:0,engineFailed:0};
  assert.match(completionNotice(summary), /All 1 checked/);
  assert.match(completionNotice({...summary,total:0,checked:0,valid:0}), /No records/);
  assert.match(completionNotice({...summary,checked:0,valid:0,skipped:1}), /No geometries were checked/);
  assert.equal(completionNotice({...summary,total:2,engineFailed:1}), '');
});

test('summary filters distinguish checked geometry and attribute states from unchecked records', () => {
  const records = [
    {featureIndex:0,status:'valid',attributeResult:{status:'invalid'}},
    {featureIndex:1,status:'invalid',attributeResult:{status:'valid'}},
    {featureIndex:2,status:'skipped',attributeResult:{status:'skipped'}},
    {featureIndex:3,status:'parse_failed',attributeResult:{status:'failed'}},
    {featureIndex:4,status:'engine_failed',attributeResult:{status:'disabled'}},
  ];
  for (const [filter, indexes] of [
    ['all',[0,1,2,3,4]],['checked',[0,1]],['valid',[0]],['invalid',[1]],
    ['skipped',[2]],['parse_failed',[3]],['engine_failed',[4]],
    ['attribute-checked',[0,1]],['attribute-valid',[1]],['attribute-invalid',[0]],
    ['attribute-skipped',[2]],['attribute-failed',[3]],['attribute-disabled',[4]],
  ]) assert.deepEqual(recordPage(records,filter,0).records.map(record=>record.featureIndex),indexes);
});

test('unified record results retain every topology pair, exclusions and unchecked rules', () => {
  const records = [0,1,2,3].map(index=>({recordKey:`feature:${index}`}));
  const participants = records.slice(0,3).map((record,index)=>({...record,featureIndex:index,featureId:'same-id',featureIdType:'string',geometryType:'Point'}));
  const issues = [[0,1],[0,2],[1,2]].map(([left,right])=>({issueId:`pair:${left}:${right}`,ruleId:'duplicate',reasonCode:'TOPOLOGY_DUPLICATE_GEOMETRY',reason:'Equal geometries',location:null,participants:[participants[left],participants[right]]}));
  const topology = {status:'completed',rules:[{ruleId:'duplicate',status:'violated',issues,exclusions:[{recordKey:'feature:3',reasonCode:'TOPOLOGY_SPATIAL_UNCHECKED'}]}]};
  const results = topologyRecordResults(records,topology);
  assert.deepEqual(results.get('feature:0').issues.map(issue=>issue.issueId),['pair:0:1','pair:0:2']);
  assert.deepEqual(results.get('feature:1').issues.map(issue=>issue.issueId),['pair:0:1','pair:1:2']);
  assert.deepEqual(results.get('feature:2').issues.map(issue=>issue.issueId),['pair:0:2','pair:1:2']);
  assert.deepEqual(results.get('feature:3').exclusions,[{ruleId:'duplicate',reasonCode:'TOPOLOGY_SPATIAL_UNCHECKED'}]);
  assert.equal(results.get('feature:3').issues.length,0);
  topology.rules[0].status='skipped';topology.rules[0].issues=[];
  assert.deepEqual(topologyRecordResults(records,topology).get('feature:0').uncheckedRuleIds,['duplicate']);
  topology.status='disabled';topology.rules=[];
  assert.equal(topologyRecordResults(records,topology).get('feature:0').issues.length,0);
});

test('source record navigation resolves late pages by recordKey despite duplicate IDs',async()=>{
  const module=await import('../src/ui/results.ts');
  assert.equal(typeof module.sourceRecordPage,'function');
  const records=Array.from({length:201},(_,index)=>({recordKey:`feature:${index}`,featureId:'duplicate'}));
  assert.equal(module.sourceRecordPage(records,'feature:0'),0);
  assert.equal(module.sourceRecordPage(records,'feature:100'),1);
  assert.equal(module.sourceRecordPage(records,'feature:200'),2);
  assert.equal(module.sourceRecordPage(records,'missing'),null);
});

function source(index, status = 'valid') {
  return { recordKey: `feature:${index}`, featureIndex: index, featureId: null, featureIdType: 'missing', geometryType: 'Point', status, reasonCode: status === 'valid' ? 'VALID' : 'GEOMETRY_INVALID', reason: 'Geometry result', warnings: [], location: null };
}
function topologyRule(issues = [], extras = {}) {
  return { ruleId: 'Rule-012', status: issues.length ? 'violated' : 'passed', coverage: 'complete', issues, exclusions: [], ...extras };
}
function finding(id, participants, extras = {}) {
  return { issueId: id, ruleId: 'Rule-012', reasonCode: 'TOPOLOGY_DUPLICATE_GEOMETRY', reason: 'Duplicate geometries', location: null, participants, ...extras };
}

test('unified results count affected records once across geometry and multiple topology errors without changing the report', async () => {
  const { unifiedResults } = await import('../src/ui/results.ts');
  const records = [source(0), source(1, 'invalid'), source(2), source(3)];
  const issues = [finding('pair:0:1', records.slice(0, 2), { location: { x: 1, y: 2 } }), finding('pair:0:2', [records[0], records[2]])];
  const run = { records, topology: { status: 'completed', rules: [topologyRule(issues)] } };
  const before = structuredClone(run);
  const view = unifiedResults(run);
  assert.deepEqual(view.summary, { total: 4, checked: 4, valid: 1, invalid: 3, skipped: 0, parseFailed: 0, engineFailed: 0 });
  assert.deepEqual(recordPage(view.records, 'invalid', 0).records.map(record => record.recordKey), ['feature:0','feature:1','feature:2']);
  assert.deepEqual(recordPage(view.records, 'valid', 0).records.map(record => record.recordKey), ['feature:3']);
  assert.equal(view.records[0].issues.length, 2);
  assert.deepEqual(view.records[0].location, { x: 1, y: 2 });
  assert.equal(view.datasetIssues, 0);
  assert.deepEqual(run, before);
});

test('dataset gap issues join Invalid and pagination without inventing source participants', async () => {
  const { unifiedResults } = await import('../src/ui/results.ts');
  const records = Array.from({ length: 100 }, (_, index) => source(index));
  const gap = finding('gap:1', [], { ruleId: 'Rule-017', scope: 'dataset', reasonCode: 'TOPOLOGY_AREA_GAP', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } });
  const view = unifiedResults({ records, topology: { status: 'completed', rules: [topologyRule([gap], { ruleId: 'Rule-017' })] } });
  assert.equal(view.summary.total, 101);
  assert.equal(view.summary.valid, 100);
  assert.equal(view.summary.invalid, 1);
  assert.equal(view.datasetIssues, 1);
  const invalid = recordPage(view.records, 'invalid', 1);
  assert.equal(invalid.page, 0);
  assert.equal(invalid.records[0].sourceRecord, null);
  assert.equal(invalid.records[0].issues[0], gap);
  assert.equal(recordPage(view.records, 'all', 1).records[0].recordKey, 'gap:1');
  assert.equal(recordPage(view.records, 'checked', 0).total, 101);
});

test('disabled, excluded and unchecked topology never creates invalid results', async () => {
  const { unifiedResults } = await import('../src/ui/results.ts');
  const records = [source(0), source(1, 'skipped'), source(2, 'parse_failed'), source(3, 'engine_failed')];
  for (const topology of [
    { status: 'disabled', rules: [] },
    { status: 'completed', rules: [topologyRule([], { status: 'skipped', coverage: 'none', exclusions: [{ recordKey: 'feature:1', reasonCode: 'TOPOLOGY_SPATIAL_UNCHECKED' }] })] },
  ]) {
    const view = unifiedResults({ records, topology });
    assert.deepEqual(view.summary, { total: 4, checked: 1, valid: 1, invalid: 0, skipped: 1, parseFailed: 1, engineFailed: 1 });
    assert.equal(recordPage(view.records, 'invalid', 0).total, 0);
    if (topology.status === 'completed') {
      assert.deepEqual(view.records[0].uncheckedRuleIds, ['Rule-012']);
      assert.equal(view.records[1].exclusions.length, 1);
    }
  }
});

test('real duplicate and gap checks project to Invalid while exported geometry summaries retain their meaning', async () => {
  const { unifiedResults } = await import('../src/ui/results.ts');
  const { createEngine } = await import('../src/engine/geos.ts');
  const { runInspection } = await import('../src/inspection/run.ts');
  const { buildJsonReport } = await import('../src/report/export.ts');
  for (const [input, ruleId, expected] of [
    [{ type: 'FeatureCollection', features: [0,1,2].map(index => ({ type: 'Feature', id: index, properties: {}, geometry: { type: 'Point', coordinates: [0,0] } })) }, 'Rule-012', { total: 3, invalid: 3, valid: 0, dataset: 0 }],
    [{ type: 'Polygon', coordinates: [[[0,0],[4,0],[4,4],[0,4],[0,0]], [[1,1],[2,1],[2,2],[1,2],[1,1]]] }, 'Rule-017', { total: 2, invalid: 1, valid: 1, dataset: 1 }],
  ]) {
    const bytes = new TextEncoder().encode(JSON.stringify(input)), messages = [];
    await runInspection({ name: 'unified.geojson', size: bytes.length, arrayBuffer: async () => bytes.buffer }, ruleId, message => messages.push(message), () => createEngine(), undefined, { rules: [{ id: ruleId }] });
    assert.equal(messages.at(-1).type, 'completed');
    const run = messages.at(-1).result, before = buildJsonReport(run), view = unifiedResults(run);
    assert.equal(view.summary.total, expected.total);
    assert.equal(view.summary.invalid, expected.invalid);
    assert.equal(view.summary.valid, expected.valid);
    assert.equal(view.datasetIssues, expected.dataset);
    assert.equal(run.summary.invalid, 0);
    assert.equal(buildJsonReport(run), before);
    assert.equal(recordPage(view.records, 'invalid', 0).total, expected.invalid);
  }
});

test('result table has one status and retains check coverage without a separate topology result table', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile('public/index.html', 'utf8');
  const table = html.match(/<table id="results"[^>]*>([^]*?)<\/table>/)[1];
  assert.deepEqual([...table.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(match => match[1]), ['Index / ID','Geometry','Status','Rule IDs','Reason / warnings','Location (x, y)']);
  assert.doesNotMatch(html, /id="topology-results"|id="topology-rule-results"|Topology check results/);
  assert.match(html, /<details id="check-coverage" hidden><summary>Check coverage<\/summary>/);
});

test('non-applicable and coverage-neutral exclusions stay out of displayed problems and unchecked notices', async () => {
  const { unifiedResults } = await import('../src/ui/results.ts');
  const records = [source(0), source(1), source(2, 'invalid')];
  const run = { records, topology: { status: 'completed', rules: [topologyRule([], {
    status: 'skipped', coverage: 'none', exclusions: [
      { recordKey: 'feature:0', reasonCode: 'TOPOLOGY_NOT_APPLICABLE', affectsCoverage: false },
      { recordKey: 'feature:1', reasonCode: 'OTHER_NOT_APPLICABLE', affectsCoverage: false },
      { recordKey: 'feature:2', reasonCode: 'GEOMETRY_INVALID', affectsCoverage: true },
    ],
  })] } };
  const before = structuredClone(run), view = unifiedResults(run);
  for (const row of view.records.slice(0, 2)) {
    assert.deepEqual(row.exclusions, []);
    assert.deepEqual(row.uncheckedRuleIds, []);
    assert.deepEqual(row.issues, []);
    assert.equal(row.status, 'valid');
  }
  assert.deepEqual(view.records[2].exclusions, [{ ruleId: 'Rule-012', reasonCode: 'GEOMETRY_INVALID' }]);
  assert.equal(view.summary.invalid, 1);
  assert.deepEqual(run, before);
});

test('real non-applicable checks do not appear in displayed rows but remain in the report snapshot', async () => {
  const { unifiedResults } = await import('../src/ui/results.ts');
  const { createEngine } = await import('../src/engine/geos.ts');
  const { runInspection } = await import('../src/inspection/run.ts');
  const { buildJsonReport } = await import('../src/report/export.ts');
  const bytes = new TextEncoder().encode(JSON.stringify({ type: 'Point', coordinates: [0,0] })), messages = [];
  await runInspection({ name: 'point.geojson', size: bytes.length, arrayBuffer: async () => bytes.buffer }, 'not-applicable', message => messages.push(message), () => createEngine(), undefined, { rules: [{ id: 'Rule-014' }, { id: 'Rule-016' }] });
  assert.equal(messages.at(-1).type, 'completed');
  const run = messages.at(-1).result, before = buildJsonReport(run), view = unifiedResults(run);
  assert.equal(run.topology.rules.flatMap(rule => rule.exclusions).length, 2);
  assert.ok(run.topology.rules.every(rule => rule.exclusions[0].reasonCode === 'TOPOLOGY_NOT_APPLICABLE'));
  assert.deepEqual(view.records[0].exclusions, []);
  assert.deepEqual(view.records[0].uncheckedRuleIds, []);
  assert.equal(view.summary.invalid, 0);
  assert.equal(buildJsonReport(run), before);
});

test('Reason / warnings omits topology identifiers while the Rule IDs column includes issues and unchecked rules', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile('public/app.js', 'utf8');
  const reasons = app.slice(app.indexOf('    const reasons ='), app.indexOf("    get('rows').append(row);"));
  assert.doesNotMatch(reasons, /issue\.ruleId|issue\.issueId(?!(?:;|\s*;))|exclusion\.ruleId|\$\{ruleId\}|item\.append\(reference\)/);
  assert.match(reasons, /item\.dataset\.issueId = issue\.issueId;/);
  assert.match(reasons, /issue\.reason/);
  assert.doesNotMatch(reasons, /issue\.location/);
  assert.match(app, /record\.location \? `\$\{record\.location\.x\}, \$\{record\.location\.y\}`/);
  assert.match(app, /record\.exclusions\.map\(exclusion => exclusion\.ruleId\)/);
  assert.match(app, /\.\.\.record\.uncheckedRuleIds/);
});
