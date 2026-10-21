import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilePreview } from '../public/file-preview.js';
class Element {
  children = []; textContent = ''; hidden = false; checked = false; disabled = false;
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this[type] = handler; }
  setAttribute(name, value) { this[name] = value; }
  getContext() { return { clearRect() {} }; }
}
const summary = { total: 1, geometryTypes: [['Point', 1]], skipped: 0, parseFailed: 0, fields: [], fieldsTruncated: false, rows: [] };
test('preview automatically requests geometry after parsing and ignores replaced file replies', () => {
  const elements = new Map(), workers = [];
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const createWorker = () => {
    const worker = { messages: [], terminated: false, postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; } };
    workers.push(worker); return worker;
  };
  const preview = createFilePreview(get, { document: { createElement: () => new Element() }, createWorker });
  preview.select({ name: 'first' });
  assert.deepEqual(workers[0].messages.map(message => message.type), ['load']);
  assert.equal(get('preview-geometry').hidden, true);
  workers[0].onmessage({ data: { type: 'summary', result: summary } });
  assert.deepEqual(workers[0].messages.map(message => message.type), ['load', 'thumbnail']);
  assert.equal(get('preview-geometry').hidden, false);
  assert.equal(get('preview-data').hidden, false);
  assert.match(get('preview-geometry-status').textContent, /Preparing/);
  preview.select({ name: 'second' });
  workers[0].onmessage({ data: { type: 'thumbnail', requestId: workers[0].messages[1].requestId, result: { paths: [] } } });
  workers[0].onmessage({ data: { type: 'summary', result: summary } });
  assert.equal(get('preview-geometry').hidden, true);
  assert.equal(get('preview-data').hidden, true);
  assert.equal(workers[0].terminated, true);
  workers[1].onmessage({ data: { type: 'summary', result: summary } });
  assert.equal(get('preview-geometry').hidden, false);
  workers[1].onmessage({ data: { type: 'thumbnail', requestId: workers[1].messages[1].requestId, result: { paths: [] } } });
  assert.match(get('preview-geometry-status').textContent, /No drawable/);
  workers[1].onmessage({ data: { type: 'failed', message: 'INVALID_JSON' } });
  assert.match(get('preview-status').textContent, /INVALID_JSON/);
  assert.equal(workers[1].terminated, true);
  assert.equal(get('preview-data').hidden, true);
  assert.equal(get('preview-geometry').hidden, true);
});

test('thumbnail projects finite extreme, tiny and coincident coordinates into the canvas', async () => {
  const { drawThumbnail } = await import('../public/file-preview.js');
  for (const points of [[[1e308, 1e308], [-1e308, -1e308]], [[0, 0], [1e-320, 1e-320]], [[5, 5]]]) {
    const positions = [];
    const context = { clearRect() {}, beginPath() {}, stroke() {}, fill() {}, closePath() {},
      moveTo(x, y) { positions.push([x, y]); }, lineTo(x, y) { positions.push([x, y]); }, arc(x, y) { positions.push([x, y]); } };
    drawThumbnail({ width: 720, height: 320, getContext: () => context }, [{ points, closed: false }]);
    assert.ok(positions.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 720 && y >= 0 && y <= 320));
    if (points.length > 1) assert.ok(Math.abs(positions[0][1] - positions[1][1]) > 100);
    else assert.deepEqual(positions[0], [360, 160]);
  }
});

test('preview table contains source geometry type and original attributes without inspection columns', () => {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const worker = { postMessage() {}, terminate() {} };
  const preview = createFilePreview(get, { document: { createElement: () => new Element() }, createWorker: () => worker });
  preview.select({ name: 'attributes.geojson' });
  worker.onmessage({ data: { type: 'summary', result: { ...summary, fields: ['name', 'count'], rows: [
    { index: 1, id: 'generated', geometryType: 'Point', disposition: 'check', attributeStatus: 'available', values: ['sample', '2'] },
  ] } } });
  assert.deepEqual(get('preview-head').children[0].children.map(cell => cell.textContent), ['geometry', 'name', 'count']);
  assert.deepEqual(get('preview-rows').children[0].children.map(cell => cell.textContent), ['Point', 'sample', '2']);
});

test('standalone SHP without attributes shows geometry types and caps rendered rows at twenty', () => {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const worker = { postMessage() {}, terminate() {} };
  const preview = createFilePreview(get, { document: { createElement: () => new Element() }, createWorker: () => worker });
  preview.select({ name: 'geometry.shp' });
  worker.onmessage({ data: { type: 'summary', result: { ...summary, total: 25, rows: Array.from({ length: 25 }, () => ({ geometryType: 'Polygon', values: [] })) } } });
  assert.deepEqual(get('preview-head').children[0].children.map(cell => cell.textContent), ['geometry']);
  assert.equal(get('preview-rows').children.length, 20);
  assert.deepEqual(get('preview-rows').children[0].children.map(cell => cell.textContent), ['Polygon']);
  assert.equal(get('preview-table').hidden, false);
  assert.match(get('preview-caption').textContent, /First 20 of 25/);
});

test('thumbnail uses full source bounds even when point reduction removes an extremum', async () => {
  const { drawThumbnail } = await import('../public/file-preview.js');
  const positions = [];
  const context = { clearRect() {}, beginPath() {}, stroke() {}, fill() {}, closePath() {},
    arc(x, y) { positions.push([x, y]); } };
  drawThumbnail({ width: 720, height: 320, getContext: () => context },
    [{ points: [[0, 0]], closed: false }], [0, 0, 10, 0]);
  assert.deepEqual(positions, [[16, 160]]);
});
