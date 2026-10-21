import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { routeSite, ORIGIN } from '../../scripts/browser-site.mjs';
import { legacyRuleIds } from '../../src/rule-identifiers.ts';

test('legacy rule bookmarks land on canonical sections and new selections use uniform IDs', {timeout:30000}, async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const context = await browser.newContext();
    await routeSite(context);
    const page = await context.newPage();
    for (const [old, current] of Object.entries(legacyRuleIds).slice(0, 17)) {
      for (const fragment of [old, current]) {
        await page.goto(`${ORIGIN}/rules.html#${fragment}`);
        assert.equal(await page.locator(':target').evaluate(el => el.closest('section').id), current);
        // Observe native fragment navigation; scrolling here would hide broken bookmarks.
        await page.waitForFunction(id => {
          const heading = document.querySelector(`#${id} h2`).getBoundingClientRect();
          return heading.top >= 0 && heading.bottom <= innerHeight;
        }, current);
        assert.match(await page.locator(`#${current} h2`).textContent(), new RegExp(`^${current} ·`));
      }
    }
    await page.goto(ORIGIN);
    const ids = await page.locator('.rule-row').evaluateAll(rows=>rows.map(row=>row.dataset.ruleId));
    assert.deepEqual(ids,[...Array.from({length:17},(_,i)=>`Rule-${String(i+1).padStart(3,'0')}`),...Array.from({length:17},(_,i)=>`Rule-${String(i+24).padStart(3,'0')}`)]);
    assert.equal(await page.locator('[data-topology-rule="Rule-013"]').count(),1);
  } finally { await browser.close(); }
});
