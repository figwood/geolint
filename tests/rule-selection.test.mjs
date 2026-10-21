import test from 'node:test';
import assert from 'node:assert/strict';

import * as module from '../public/rule-selection.js';

test('disabled attribute checks do not validate or send retained drafts', () => {
  const selected = module.inspectionSelection(false, ['Rule-012'], () => { throw new Error('Invalid draft'); });
  assert.deepEqual(selected.attributes.rules, []);
  assert.deepEqual(selected.topology.rules, [{ id: 'Rule-012', parameters: {} }]);
});

test('selection without attribute controls never enables attributes and still renders topology changes', () => {
  const topology = [{ dataset: { topologyRule: 'Rule-012' } }];
  const items = [];
  const elements = {
    'rules-title': { closest: () => ({ querySelectorAll: selector => selector === '[data-attribute-rule]' ? [] : topology }) },
    'selection-summary': {}, 'selection-notice': {},
    'selected-rules': { replaceChildren: () => { items.length = 0; }, append: item => items.push(item) },
  };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    const selection = module.createRuleSelection(id => elements[id], undefined, [
      { id: 'Rule-001', title: 'Input', required: true, family: 'general' },
      { id: 'Rule-012', title: 'Duplicates', required: false, family: 'topology' },
      { id: 'Rule-018', title: 'Fields', required: false, family: 'attributes', executionGroup: 'attributes' },
    ]);
    selection.setAttributes(true);
    selection.render();
    assert.deepEqual(selection.config().attributes.rules, []);
    assert.match(elements['selection-summary'].textContent, /1 optional rules$/);
    assert.deepEqual(items.map(item => item.textContent), ['Rule-001 · Input', 'Rule-012 · Duplicates']);
    selection.render({ attributeRules: selection.config().attributes, topology: { options: { rules: [] } } });
    assert.match(elements['selection-notice'].textContent, /Rules changed/);
  } finally { globalThis.document = previousDocument; }
});

test('enabled attribute checks validate the editor and preserve the run snapshot', () => {
  assert.throws(() => module.inspectionSelection(true, [], () => { throw new Error('Invalid draft'); }), /Invalid draft/);
  const config = { kind: 'geolint-attribute-rules', schemaVersion: '1.0', rules: [{ id: 'required', field: 'name', enabled: true }] };
  const selected = module.inspectionSelection(true, [], () => config);
  config.rules[0].field = 'changed';
  assert.equal(selected.attributes.rules[0].field, 'name');
  assert.deepEqual(selected.topology.rules, []);
});

test('field rule results count issues separately from affected source records', () => {
  const result = module.fieldRuleResults({ attributeRules: { rules: [
    { id: 'name-rule', field: 'name', enabled: true },
    { id: 'off', field: 'off', enabled: false },
    { id: 'area-rule', field: 'area', enabled: true },
  ] }, records: [
    { attributeResult: { issues: [{ configuredRuleId: 'name-rule' }, { configuredRuleId: 'name-rule' }] } },
    { attributeResult: { issues: [{ configuredRuleId: 'name-rule' }] } },
  ] });
  assert.deepEqual(result, [
    { id: 'name-rule', field: 'name', issues: 3, records: 2 },
    { id: 'area-rule', field: 'area', issues: 0, records: 0 },
  ]);
});

test('selection snapshots every independently selected topology rule',()=>{
  const ids=['Rule-013','Rule-017'];
  const selected=module.inspectionSelection(false,ids,()=>{throw new Error('disabled');});
  ids.push('Rule-014');
  assert.deepEqual(selected.topology.rules,[{id:'Rule-013',parameters:{}},{id:'Rule-017',parameters:{}}]);
});
