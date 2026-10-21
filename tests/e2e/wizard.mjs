import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { routeSite, ORIGIN } from '../../scripts/browser-site.mjs';

test('wizard shows one step, preserves choices when returning, and recovers from cancellation', { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true, timeout: 10000 });
  try {
    const context = await browser.newContext(); await routeSite(context, []);
    const page = await context.newPage(); await page.goto(ORIGIN);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    assert.equal(await page.locator('.wizard-page:visible').count(), 1);
    assert.equal(await page.locator('#file-next').isDisabled(), true);
    assert.equal(await page.locator('#wizard-steps [data-status="completed"]').count(), 0);
    const input = { type: 'Point', coordinates: [0, 0] };
    await page.locator('#file').setInputFiles({ name: 'point.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
    await page.locator('#file-next').click();
    assert.equal(await page.locator('[data-step="file"]').getAttribute('data-status'), 'completed');
    assert.equal(await page.locator('[data-step="file"] span').textContent(), '✓');
    assert.equal(await page.locator('[data-step="rules"]').getAttribute('aria-current'), 'step');
    await page.locator('#topology-duplicates').check();
    await page.locator('#rules-back').click(); await page.locator('#file-next').click();
    assert.equal(await page.locator('#topology-duplicates').isChecked(), true);
    await page.locator('#rules-next').click();
    assert.match(await page.locator('#confirmation-file').textContent(), /point.geojson/);
    assert.match(await page.locator('#selected-rules').textContent(), /Must not have duplicates/);
    await mkdir('.cache', { recursive: true });
    await page.screenshot({ path: '.cache/wizard-confirm.png', fullPage: true });
    await page.evaluate(() => { document.getElementById('recheck').click(); document.getElementById('cancel').click(); });
    assert.match(await page.locator('#status').textContent(), /Cancelled/);
    assert.equal(await page.locator('#step-review').isVisible(), true);
    assert.equal(await page.locator('[data-step="results"]').isDisabled(), true);
    assert.equal(await page.locator('[data-step="results"]').getAttribute('data-status'), 'upcoming');
    await page.locator('#recheck').click();
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Inspection completed.');
    assert.equal(await page.locator('#step-results').isVisible(), true);
    await page.screenshot({ path: '.cache/results-simplified.png', fullPage: true });
    assert.equal(await page.locator('#wizard-steps [data-status="completed"]').count(), 3);
    assert.equal(await page.locator('.wizard-page:visible').count(), 1);
    await page.locator('#edit-checks').click();
    assert.equal(await page.locator('#topology-duplicates').isChecked(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: '.cache/wizard-checks-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
