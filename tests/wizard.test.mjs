import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from '../public/wizard.js';

test('step indicators distinguish completed, current and upcoming steps across navigation and reset', () => {
  const wizard = module.createWizardState();
  const statuses = () => ['file', 'rules', 'review', 'results'].map(step => wizard.stepStatus(step));
  assert.deepEqual(statuses(), ['current', 'upcoming', 'upcoming', 'upcoming']);
  wizard.setFile(true);
  wizard.navigate('rules');
  assert.deepEqual(statuses(), ['completed', 'current', 'upcoming', 'upcoming']);
  wizard.navigate('review');
  assert.deepEqual(statuses(), ['completed', 'completed', 'current', 'upcoming']);
  wizard.start(); wizard.finish(false);
  assert.deepEqual(statuses(), ['completed', 'completed', 'current', 'upcoming']);
  wizard.start(); wizard.finish(true);
  assert.deepEqual(statuses(), ['completed', 'completed', 'completed', 'current']);
  wizard.navigate('rules');
  assert.deepEqual(statuses(), ['completed', 'current', 'upcoming', 'upcoming']);
  wizard.setFile(true);
  assert.deepEqual(statuses(), ['current', 'upcoming', 'upcoming', 'upcoming']);
});

test('wizard requires a file, allows returning without resetting it, and gates results on completion', () => {
  const wizard = module.createWizardState();
  assert.equal(wizard.current, 'file');
  assert.equal(wizard.navigate('rules'), false);
  wizard.setFile(true);
  assert.equal(wizard.navigate('rules'), true);
  assert.equal(wizard.navigate('review'), true);
  assert.equal(wizard.navigate('file'), true);
  assert.equal(wizard.navigate('review'), true);
  assert.equal(wizard.navigate('results'), false);
  wizard.start();
  assert.equal(wizard.current, 'review');
  assert.equal(wizard.navigate('rules'), false);
  wizard.finish(true);
  assert.equal(wizard.current, 'results');
  assert.equal(wizard.navigate('rules'), true);
  assert.equal(wizard.navigate('results'), true);
});

test('cancelled runs stay on confirmation and selecting a new file invalidates the old results', () => {
  const wizard = module.createWizardState();
  assert.equal(wizard.start(), false);
  wizard.setFile(true);
  wizard.start();
  wizard.finish(false);
  assert.equal(wizard.current, 'review');
  assert.equal(wizard.navigate('results'), false);
  wizard.start(); wizard.finish(true);
  wizard.setFile(true);
  assert.equal(wizard.current, 'file');
  assert.equal(wizard.navigate('results'), false);
  wizard.setFile(false);
  assert.equal(wizard.navigate('review'), false);
});
