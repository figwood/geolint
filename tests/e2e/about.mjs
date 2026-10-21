import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { routeSite, ORIGIN } from '../../scripts/browser-site.mjs';

test('About navigation, unified branding and legacy links work on desktop and mobile', { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ headless: true, timeout: 10000 });
  try {
    const context = await browser.newContext();
    await routeSite(context, []);
    const page = await context.newPage();
    await page.goto(ORIGIN);
    const brand = await page.locator('header .brand').innerHTML();
    for (const file of ['help.html', 'rules.html', 'about.html']) {
      await page.goto(`${ORIGIN}/${file}`);
      assert.equal(await page.locator('header .brand').innerHTML(), brand);
      assert.deepEqual(await page.locator('header nav a').allTextContents(), ['Help', 'Rules', 'About']);
    }
    assert.equal(await page.locator('.about-page>section').count(), 4);
    assert.equal(await page.locator('.about-sections').count(), 0);
    const license = page.locator('#third-party-notices a[href="./licenses/GEOS-COPYING.txt"]');
    // The browser routing harness serves local license assets through page requests.
    await page.goto(new URL(await license.getAttribute('href'), page.url()).href);
    assert.match(await page.locator('body').textContent(), /GNU|LESSER/);
    await page.goto(`${ORIGIN}/about.html#third-party-notices`);
    const downloads = [];
    page.on('download', download => downloads.push(download));
    await page.getByRole('link', { name: 'fflate license', exact: true }).click();
    await page.waitForURL(`${ORIGIN}/vendor/fflate/LICENSE.txt`);
    assert.match(await page.locator('pre').textContent(), /MIT License[\s\S]*Arjun Barrett[\s\S]*THE SOFTWARE IS PROVIDED/);
    assert.equal(downloads.length, 0);
    await page.goBack();
    assert.equal(new URL(page.url()).hash, '#third-party-notices');
    for (const [file, anchor] of [['methodology.html','method'],['privacy.html','privacy'],['limitations.html','limits'],['licenses/NOTICE.html','third-party-notices']]) {
      await page.goto(`${ORIGIN}/${file}`);
      await page.waitForURL(`${ORIGIN}/about.html#${anchor}`);
      assert.equal(await page.locator('h1').textContent(), 'About');
    }
    await mkdir('.cache', { recursive: true });
    await page.goto(`${ORIGIN}/about.html`);
    await page.screenshot({ path: '.cache/about-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: '.cache/about-mobile.png', fullPage: true });
    await page.locator('header .brand').click();
    assert.equal(page.url(), `${ORIGIN}/`);
  } finally { await browser.close(); }
});
