import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { checkRules } from '../src/diagnostics.ts';
import { supportsInput } from '../src/input/adapters.ts';

test('sample manifest uses current built-in references while retaining sample and configuration paths', async () => {
  const manifest = JSON.parse(await readFile('sample_data/.config/manifest.json', 'utf8'));
  const readme = await readFile('sample_data/README.md', 'utf8');
  const catalog = new Map(checkRules.map(rule => [rule.id, rule]));
  assert.equal(manifest.entries.length, 43);
  assert.deepEqual(manifest.entries.map(entry => entry.file).sort(), (await readdir('sample_data')).filter(supportsInput).sort());
  assert.equal(new Set(manifest.entries.map(entry => entry.file)).size, 43);
  assert.deepEqual(manifest.entries.filter(entry => entry.file.endsWith('.geojson') && entry.ruleId).map(entry => entry.ruleId), [...catalog.keys()]);
  for (const entry of manifest.entries) {
    assert.equal((await stat(`sample_data/${entry.file}`)).size, entry.fileBytes, entry.file);
    await stat(`sample_data/${entry.attributeRules}`);
    if (entry.ruleId) {
      assert.equal(entry.ruleId, entry.file.replace(/\.(geojson|shp|zip)$/, ''), entry.file);
      assert.equal(entry.title, catalog.get(entry.ruleId)?.title, entry.file);
      const row = readme.split('\n').find(line => line.startsWith(`| ${entry.file} |`));
      assert.ok(row?.includes(entry.ruleId), entry.file);
      assert.equal(entry.observedIssueCounts[entry.ruleId] ?? 0, entry.expectedIssueCount, entry.file);
    }
    assert.deepEqual(entry.topologyRules, catalog.get(entry.ruleId)?.executionGroup === 'topology' ? [entry.ruleId] : [], entry.file);
    if (entry.topologyOptions) {
      const config = JSON.parse(await readFile(`sample_data/${entry.topologyConfig}`, 'utf8'));
      assert.deepEqual(config, entry.topologyOptions);
      assert.deepEqual(config.rules.map(rule => rule.id), entry.topologyRules);
    }
    for (const id of Object.keys(entry.observedIssueCounts)) assert.ok(catalog.has(id), id);
    assert.doesNotMatch(entry.note, /(?:GR|SR|TR|AR|BR)-\d{3}/, entry.file);
  }
});
