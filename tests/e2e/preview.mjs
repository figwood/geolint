import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { routeSite, ORIGIN } from '../../scripts/browser-site.mjs';
import { shapefile, shapeRecord } from '../helpers/shapefile.mjs';
const upload = (page, input, name = 'preview.geojson') => page.locator('#file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });

test('local preview bounds rows, automatically shows geometry, resets on replacement and handles errors', { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true, timeout: 10000 });
  try {
    const context = await browser.newContext(), requests = [];
    await routeSite(context, requests);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN);
    assert.match(await page.locator('#file-drop-zone').textContent(), /Drag and drop a file here/);
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#file-drop-zone').click();
    assert.equal((await chooser).isMultiple(), false);
    const input = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'EPSG:3857' } }, features: Array.from({ length: 1500 }, (_, i) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [i, i] }, properties: { name: '<script>alert(1)</script>' },
    })) };
    await page.locator('#file-drop-zone').dispatchEvent('dragover', { dataTransfer: { files: [] } });
    assert.equal(await page.locator('#file-drop-zone').getAttribute('data-dragging'), 'true');
    await page.evaluate(input => {
      const file = new File([JSON.stringify(input)], 'preview.geojson', { type: 'application/json' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document.getElementById('file-drop-zone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, input);
    await page.waitForFunction(() => document.getElementById('preview-data')?.hidden === false);
    assert.equal(await page.locator('#preview-summary').count(), 0);
    assert.match(await page.locator('#preview-caption').textContent(), /20 of 1,500 records/);
    assert.equal(await page.evaluate(() => document.getElementById('preview-table').getBoundingClientRect().bottom <= document.getElementById('preview-caption').getBoundingClientRect().top), true);
    assert.equal(await page.locator('#preview-rows tr').count(), 20);
    assert.match(await page.locator('#preview-rows').textContent(), /<script>alert\(1\)<\/script>/);
    assert.equal(await page.locator('#preview-rows script').count(), 0);
    assert.equal(await page.locator('#preview-toggle').count(), 0);
    assert.equal(await page.locator('#preview-geometry').isVisible(), true);
    assert.equal(await page.locator('#preview-attributes-title').count(), 0);
    assert.equal(await page.evaluate(() => {
      const actions = document.querySelector('#step-file .wizard-actions').getBoundingClientRect();
      const button = document.getElementById('file-next').getBoundingClientRect();
      return Math.abs(actions.right - button.right) < 2;
    }), true);
    assert.equal(await page.evaluate(() => {
      const geometry = document.getElementById('preview-geometry').getBoundingClientRect();
      const data = document.getElementById('preview-data').getBoundingClientRect();
      return geometry.right <= data.left && Math.abs(geometry.top - data.top) < 2;
    }), true);
    assert.equal(requests.some(request => request.url.includes('/vendor/geos/')), false);
    await page.waitForFunction(() => document.getElementById('preview-geometry-status').textContent === '');
    await mkdir('.cache', { recursive: true });
    await page.screenshot({ path: '.cache/file-preview-desktop.png', fullPage: true });
    await upload(page, { type: 'Point', coordinates: [0, 0] }, 'replacement.geojson');
    await page.waitForFunction(() => document.getElementById('preview-caption').textContent.startsWith('First 1 of 1 records'));
    assert.equal(await page.locator('#preview-geometry').isVisible(), true);
    assert.equal(await page.locator('#preview-table').isVisible(), true);
    assert.deepEqual(await page.locator('#preview-head th').allTextContents(), ['geometry']);
    assert.match(await page.locator('#preview-rows').textContent(), /Point/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.cache/file-preview-mobile.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.getElementById('preview-geometry').getBoundingClientRect().bottom <= document.getElementById('preview-data').getBoundingClientRect().top), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#file').setInputFiles({ name: 'broken.geojson', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await page.waitForFunction(() => document.getElementById('preview-status').textContent.includes('INVALID_JSON'));
    assert.equal(await page.locator('#preview-geometry').isVisible(), false);
    assert.equal(await page.locator('#preview-data').isVisible(), false);
    await upload(page, { type: 'FeatureCollection', features: [] });
    await page.waitForFunction(() => document.getElementById('preview-caption').textContent.startsWith('First 0 of 0 records'));
    await page.waitForFunction(() => document.getElementById('preview-geometry-status').textContent.includes('No drawable'));
    await page.locator('#file').setInputFiles({ name: 'standalone.shp', mimeType: 'application/octet-stream', buffer: Buffer.from(shapefile([shapeRecord([[[0,0],[4,0],[4,4],[0,0]]])])) });
    await page.waitForFunction(() => document.getElementById('preview-caption').textContent.startsWith('First 1 of 1 records'));
    assert.equal(await page.locator('#preview-table').isVisible(), true);
    assert.deepEqual(await page.locator('#preview-head th').allTextContents(), ['geometry']);
    assert.match(await page.locator('#preview-rows').textContent(), /Polygon/);
    assert.deepEqual(errors, []);
    assert.ok(requests.every(request => request.url.startsWith(ORIGIN) && request.method === 'GET' && !request.body));
  } finally { await browser.close(); }
});
