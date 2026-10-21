import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import { routeSite, ORIGIN } from '../../scripts/browser-site.mjs';
import { shapefile, shapeRecord, square } from '../helpers/shapefile.mjs';

test('Shapefile imports, exports, failures and restart stay local in a real browser Worker', {timeout:60000}, async () => {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({headless:true, timeout:10000});
  try {
    const context = await browser.newContext({acceptDownloads:true});
    const requests = [], logs = [], errors = [];
    await routeSite(context, requests);
    const page = await context.newPage();
    page.on('console', message => logs.push(message.text()));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN);
    assert.match(await page.locator('#file').getAttribute('accept'), /\.shp/);
    assert.match(await page.locator('#file').getAttribute('accept'), /\.zip/);
    const crossed = [[500000,3000000],[500010,3000010],[500000,3000010],[500010,3000000],[500000,3000000]];
    const bytes = shapefile([shapeRecord([square]),shapeRecord([],0),shapeRecord([crossed])]);
    for (const [name, buffer] of [['PRIVATE_layer.shp',bytes],['PRIVATE_layer.zip',zipSync({'folder/layer.shp':bytes,'folder/layer.prj':new TextEncoder().encode('PRIVATE_PROJECTION')})]]) {
      await page.locator('#file').setInputFiles({name,mimeType:'application/octet-stream',buffer:Buffer.from(buffer)});
      await page.locator('[data-step="review"]').click();
      await page.locator('#recheck').click();
      await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Inspection completed'), {}, {timeout:20000});
      assert.deepEqual(await page.locator('#stats .stat').evaluateAll(cards => Object.fromEntries(cards.map((card, index) => [['total','checked','valid','invalid','skipped','parseFailed','engineFailed'][index], Number(card.querySelector('strong').textContent)]))), {total:3,checked:2,valid:1,invalid:1,skipped:1,parseFailed:0,engineFailed:0});
      await page.locator('#download').click();
      const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#json').click()]);
      const report = JSON.parse(await readFile(await download.path(),'utf8'));
      assert.equal(report.run.fileName,name);
      assert.deepEqual(report.issues[1].location,{x:500005,y:3000005});
      assert.equal(report.issues[1].featureIndex,2);
    }
    await mkdir('.cache',{recursive:true});
    await page.screenshot({path:'.cache/shapefile-ui.png',fullPage:true});
    for (const [type, parts, geometryType] of [[1, [], 'Point'], [8, [[[0, 0], [1, 2]]], 'MultiPoint'], [3, [[[0, 0], [1, 2]], [[2, 3], [4, 5]]], 'MultiLineString']]) {
      const shapes = shapefile([shapeRecord([], 0), shapeRecord(parts, type)], type);
      for (const [name, buffer] of [['geometry.shp', shapes], ['geometry.zip', zipSync({ 'layer.shp': shapes })]]) {
        await page.locator('#file').setInputFiles({name, mimeType:'application/octet-stream', buffer:Buffer.from(buffer)});
        await page.locator('[data-step="review"]').click();
        await page.locator('#recheck').click();
        await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Inspection completed'));
        await page.locator('#stats [data-filter=all]').click();
        assert.deepEqual(await page.locator('#stats .stat').evaluateAll(cards => Object.fromEntries(cards.map((card, index) => [['total','checked','valid','invalid','skipped','parseFailed','engineFailed'][index], Number(card.querySelector('strong').textContent)]))), {total:2,checked:1,valid:1,invalid:0,skipped:1,parseFailed:0,engineFailed:0});
        assert.match(await page.locator('#rows').textContent(), new RegExp(geometryType));
      }
    }
    await page.locator('#file').setInputFiles({name:'bad.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({'a.shp':bytes,'b.shp':bytes}))});
    await page.locator('[data-step="review"]').click();
    await page.locator('#recheck').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('MULTIPLE_SHAPEFILES'));
    assert.equal(await page.locator('#json').isDisabled(),true);
    await page.locator('[data-step="file"]').click();
    await page.locator('#file').setInputFiles({name:'recovery.shp',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('File selected'));
    await page.locator('[data-step="review"]').click();
    await page.locator('#recheck').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Inspection completed'));
    assert.deepEqual(errors,[]);
    assert.equal(logs.some(value => /PRIVATE_|500000/.test(value)),false);
    assert.ok(requests.every(request => request.method === 'GET' && request.body === null && request.url.startsWith(ORIGIN+'/') && !/PRIVATE_|500000/.test(request.url)));
  } finally { await browser.close(); }
});
