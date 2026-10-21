import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkRules, selectedRuleIds } from '../src/diagnostics.ts';
import { createRuleSelection } from '../public/rule-selection.js';

const expected = {
  structure: ['Rule-002', 'Rule-003', 'Rule-004', 'Rule-005', 'Rule-009', 'Rule-021'],
  validity: ['Rule-006', 'Rule-011', 'Rule-027'],
  geometry: ['Rule-008', 'Rule-013', 'Rule-024', 'Rule-025', 'Rule-026', 'Rule-028', 'Rule-029', 'Rule-031', 'Rule-032', 'Rule-033', 'Rule-034', 'Rule-040'],
  topology: ['Rule-012', 'Rule-014', 'Rule-015', 'Rule-016', 'Rule-017', 'Rule-030', 'Rule-035', 'Rule-036', 'Rule-037', 'Rule-038', 'Rule-039'],
  attributes: ['Rule-018', 'Rule-019', 'Rule-020', 'Rule-023'],
  diagnostics: ['Rule-001', 'Rule-007', 'Rule-010', 'Rule-022'],
};
test('five quality categories and run diagnostics assign every existing rule exactly once', () => {
  assert.equal(checkRules.length, 40);
  for (const [family, ids] of Object.entries(expected)) {
    assert.deepEqual(checkRules.filter(rule => rule.family === family).map(rule => rule.id), ids);
  }
});
test('attribute execution retains source and configuration diagnostics after reclassification', () => {
  assert.deepEqual(selectedRuleIds(true, ['Rule-013']).optional,
    ['Rule-013', 'Rule-018', 'Rule-019', 'Rule-020', 'Rule-021', 'Rule-022', 'Rule-023']);
});
test('confirmation includes all attribute checks independently of their categories', () => {
  const appended = [];
  const root = {querySelectorAll: () => []};
  const elements = {
    'rules-title': {closest: () => root}, 'attribute-enabled': {checked: true},
    'selection-summary': {}, 'selection-notice': {},
    'selected-rules': {replaceChildren() {}, append: item => appended.push(item.textContent)},
  };
  const previous = globalThis.document;
  globalThis.document = {createElement: () => ({})};
  try {
    const rules = checkRules.map(rule => ({...rule,
      family: Object.entries(expected).find(([, ids]) => ids.includes(rule.id))[0]}));
    createRuleSelection(id => elements[id], {getConfig: () => ({rules: [{enabled: true}]})}, rules).render();
    for (const id of ['Rule-021', 'Rule-022']) assert.ok(appended.some(text => text.startsWith(id)), id);
  } finally { globalThis.document = previous; }
});
test('multipart remains independently selectable under geometry constraints', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const row = html.match(/<tr class="rule-row"[^>]*data-rule-id="Rule-013"[^>]*>[^]*?<\/tr>/)?.[0];
  assert.match(row, /data-rule-category="geometry"/);
  assert.match(row, /Geometry constraints/);
  assert.match(row, /data-topology-rule="Rule-013"/);
});
test('result summaries do not label multipart constraint findings as topology errors', async () => {
  const { resultVerdict } = await import('../public/result-status.js');
  const summary = {total: 1, checked: 1, invalid: 1, parseFailed: 0, engineFailed: 0, skipped: 0};
  const result = resultVerdict(summary, undefined, {status: 'completed', summary: {issues: 1, failed: 0}, rules: []});
  assert.match(result.description, /1 optional check problems/);
  assert.doesNotMatch(result.description, /topology problems/);
});
