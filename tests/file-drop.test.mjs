import { test } from 'node:test';
import assert from 'node:assert/strict';

const fileDrop = await import('../public/file-drop.js').catch(() => ({}));

class Element {
  constructor() { this.listeners = new Map(); this.dataset = {}; this.clicks = 0; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.clicks += 1; }
  dispatch(type, event = {}) {
    this.listeners.get(type)?.({ preventDefault() {}, dataTransfer: { files: [] }, ...event });
  }
}

test('file drop zone opens the picker, exposes drag state and selects the dropped file', () => {
  assert.equal(typeof fileDrop.bindFileDrop, 'function');
  const zone = new Element(), input = new Element(), selected = [];
  fileDrop.bindFileDrop(zone, input, file => selected.push(file));

  zone.dispatch('click');
  assert.equal(input.clicks, 1);

  zone.dispatch('dragover');
  assert.equal(zone.dataset.dragging, 'true');

  const file = { name: 'dropped.geojson' };
  zone.dispatch('drop', { dataTransfer: { files: [file] } });
  assert.equal(zone.dataset.dragging, undefined);
  assert.deepEqual(selected, [file]);
});

