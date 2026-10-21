import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from '../public/result-status.js';
const clean = { total: 2, checked: 2, valid: 2, invalid: 0, skipped: 0, parseFailed: 0, engineFailed: 0 };
const attributes = { total: 2, checked: 0, valid: 0, invalid: 0, skipped: 0, failed: 0, disabled: 2, issueCount: 0 };
const disabled = { status: 'disabled', rules: [], summary: { issues: 0, failed: 0 } };

for (const [name, summary, attrs, topology, expected] of [
  ['complete clean data', clean, attributes, disabled, 'success'],
  ['invalid geometry', { ...clean, invalid: 1, valid: 1 }, attributes, disabled, 'error'],
  ['malformed geometry with nothing checked', { ...clean, checked: 0, valid: 0, parseFailed: 2 }, attributes, disabled, 'error'],
  ['geometry engine failure', { ...clean, checked: 1, valid: 1, engineFailed: 1 }, attributes, disabled, 'error'],
  ['attribute problems with valid geometries', clean, { ...attributes, invalid: 1, issueCount: 3 }, disabled, 'error'],
  ['attribute failure', clean, { ...attributes, failed: 1 }, disabled, 'error'],
  ['duplicate geometries with valid geometries', clean, attributes, { status: 'completed', rules: [{ status: 'violated', coverage: 'complete' }], summary: { issues: 1, failed: 0 } }, 'error'],
  ['fully checked clean topology', clean, attributes, { status: 'completed', rules: [{ status: 'passed', coverage: 'complete' }], summary: { issues: 0, failed: 0 } }, 'success'],
  ['skipped geometries', { ...clean, checked: 1, valid: 1, skipped: 1 }, attributes, disabled, 'warning'],
  ['skipped attributes', clean, { ...attributes, skipped: 1 }, disabled, 'warning'],
  ['partial topology coverage', clean, attributes, { status: 'completed', rules: [{ status: 'passed', coverage: 'partial' }], summary: { issues: 0, failed: 0 } }, 'warning'],
  ['topology without comparisons', clean, attributes, { status: 'completed', rules: [{ status: 'skipped', coverage: 'complete' }], summary: { issues: 0, failed: 0 } }, 'warning'],
  ['empty input', { ...clean, total: 0, checked: 0, valid: 0 }, attributes, disabled, 'warning'],
]) {
  test(`result verdict distinguishes ${name}`, () => {
    const result = module.resultVerdict(summary, attrs, topology);
    assert.equal(result.tone, expected);
    if (expected !== 'success') assert.notEqual(result.title, 'No errors found');
  });
}
