import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { routeSite, ORIGIN } from '../../scripts/browser-site.mjs';

test('results show green for clean input, red for invalid geometry and amber for unchecked input', { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true, timeout: 10000 });
  try {
    const context = await browser.newContext(); await routeSite(context, []);
    const page = await context.newPage(); await page.goto(ORIGIN);
    const inspect = async data => {
      await page.locator('#file').setInputFiles({ name: 'result.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.locator('[data-step="review"]').click(); await page.locator('#recheck').click();
      await page.waitForFunction(() => document.getElementById('status').textContent === 'Inspection completed.');
    };
    await inspect({ type: 'Point', coordinates: [0, 0] });
    assert.equal(await page.locator('.verdict-success:visible').count(), 1);
    assert.match(await page.locator('#verdict-title').textContent(), /No errors found/);
    assert.equal(await page.locator('#stats [data-filter=invalid]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#rows tr').count(), 0);
    assert.equal(await page.locator('#page-position').textContent(), '1/1');
    await page.locator('#stats [data-filter=valid]').click();
    assert.equal(await page.locator('#rows .status-valid').count(), 1);
    await mkdir('.cache', { recursive: true });
    await page.screenshot({ path: '.cache/results-clean.png', fullPage: true });
    await inspect({ type: 'Polygon', coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]] });
    assert.equal(await page.locator('.verdict-error:visible').count(), 1);
    assert.match(await page.locator('#verdict-description').textContent(), /1 invalid results/);
    assert.equal(await page.locator('#stats [data-filter=invalid]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#rows .status-invalid').count(), 1);
    await page.screenshot({ path: '.cache/results-errors.png', fullPage: true });
    await inspect({ type: 'Feature', geometry: null, properties: {} });
    assert.equal(await page.locator('.verdict-warning:visible').count(), 1);
    assert.equal(await page.locator('.verdict-success').count(), 0);
  } finally { await browser.close(); }
});
