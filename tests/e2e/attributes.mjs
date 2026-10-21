import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { routeSite, ORIGIN } from '../../scripts/browser-site.mjs';

test('attribute checks are absent from the UI and disabled in reports while preview values remain available', { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true, timeout: 10000 });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await routeSite(context, []);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN);
    assert.equal(await page.locator('[data-attribute-rule], #attribute-editor, #attribute-results').count(), 0);
    const input = { type: 'Feature', id: [], properties: { name: 'preview value' }, geometry: { type: 'Point', coordinates: [1, 2] } };
    await page.locator('#file').setInputFiles({ name: 'attributes.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
    await page.waitForFunction(() => document.getElementById('preview-rows').textContent.includes('preview value'));
    await page.locator('#file-next').click();
    for (const checkbox of await page.locator('[data-topology-rule]').all()) await checkbox.check();
    assert.equal(await page.locator('[data-topology-rule]:checked').count(), 23);
    await page.locator('#rules-next').click();
    assert.equal(await page.locator('#selected-rules li').count(), 34);
    assert.doesNotMatch(await page.locator('#selected-rules').textContent(), /Rule-0(?:18|19|2[0-3])/);
    await page.locator('#recheck').click();
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Inspection completed.');
    await page.locator('#stats [data-filter=all]').click();
    assert.equal(await page.locator('#results thead th').count(), 6);
    assert.doesNotMatch(await page.locator('#results').textContent(), /Attributes|Rule-023|INVALID_FEATURE_ID|TOPOLOGY_NOT_APPLICABLE/);
    await page.locator('#download').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#json').click()]);
    const report = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(report.attributeRules.rules, []);
    assert.equal(report.attributeSummary.disabled, 1);
    assert.equal(report.attributeSummary.issueCount, 0);
    assert.ok(report.ruleCatalog.every(rule => rule.family !== 'attributes'));
    assert.ok(!JSON.stringify(report).includes('preview value'));
    await mkdir('.cache', { recursive: true });
    await page.screenshot({ path: '.cache/attributes-hidden-results.png', fullPage: true });
    for (const file of ['help.html', 'rules.html', 'about.html']) {
      await page.goto(`${ORIGIN}/${file}`);
      assert.doesNotMatch(await page.locator('main').textContent(), /Rule-0(?:18|19|2[0-3])|Attribute rules|Attribute method|Attribute scope/);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
