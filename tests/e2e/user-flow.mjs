import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeSite, ORIGIN } from '../../scripts/browser-site.mjs';

const selected = process.env.GEOLINT_BROWSER ?? 'chromium';
test(`complete UI, pagination, recovery and privacy (${selected})`, {timeout:60000}, async () => {
  const playwright = await import('playwright');
  if (!['chromium','firefox','webkit','chrome','msedge'].includes(selected)) throw new Error('Unsupported GEOLINT_BROWSER');
  const browserType = ['chrome','msedge'].includes(selected) ? playwright.chromium : playwright[selected];
  const browser = await browserType.launch({headless:true, timeout:10000, ...(['chrome','msedge'].includes(selected) ? {channel:selected} : {})});
  try {
    const context = await browser.newContext({acceptDownloads:true});
    const requests = [], logs = [], errors = [];
    await routeSite(context, requests);
    const page = await context.newPage();
    page.on('console', message => logs.push(message.text()));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(ORIGIN);
    const input = async (data, name='fixture.geojson') => {
      await page.locator('#file').setInputFiles({name, mimeType:'application/geo+json', buffer:Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))});
      await page.locator('[data-step="review"]').click();
      await page.locator('#recheck').click();
      await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('Inspection completed'), {}, {timeout:20000});
      assert.equal(await page.locator('#stats [data-filter=invalid]').getAttribute('aria-pressed'), 'true');
      const invalidCount = Number(await page.locator('#stats [data-filter=invalid] strong').textContent());
      assert.equal(await page.locator('#rows tr').count(), Math.min(100, invalidCount));
      assert.equal(await page.locator('#page-position').textContent(), `1/${Math.max(1, Math.ceil(invalidCount / 100))}`);
      await page.locator('#stats [data-filter=all]').click();
    };
    const valid = {type:'Feature',id:'PRIVATE_ID_café',properties:{secret:'PRIVATE_PROPERTY'},geometry:{type:'Polygon',coordinates:[[[82.125,0],[84,0],[84,4],[82.125,0]]]}};
    await input({type:'FeatureCollection',features:Array.from({length:205}, () => valid)});
    assert.equal(await page.locator('#attribute-results').count(),0);
    assert.equal(await page.locator('#rows .status-valid').count(),100);
    assert.equal(await page.locator('#rows tr').count(),100);
    assert.match(await page.locator('#notice').textContent(), /All 205 checked/);
    assert.equal(await page.locator('#page-position').textContent(), '1/3');
    await page.locator('#next').click();
    assert.equal(await page.locator('#page-position').textContent(), '2/3');
    await page.locator('#next').click();
    assert.equal(await page.locator('#page-position').textContent(), '3/3');
    assert.equal(await page.locator('#rows tr').count(),5);
    assert.match(await page.locator('#rows tr').first().textContent(), /^200/);
    await page.locator('#stats [data-filter=invalid]').click();
    assert.equal(await page.locator('#rows tr').count(),0);
    assert.equal(await page.locator('#page-position').textContent(), '1/1');
    assert.equal(await page.locator('#next').isDisabled(),true);
    await input({type:'FeatureCollection',features:[{type:'Feature',geometry:null,properties:{}}]});
    assert.match(await page.locator('#notice').textContent(), /No geometries were checked/);
    assert.match(await page.locator('#rows').textContent(), /Not provided/);
    assert.equal(await page.locator('#rows a[href="./rules.html#Rule-008"]').count(),1);
    assert.equal(await page.locator('#rows a[href*="errors.html"]').count(),0);
    await input({type:'FeatureCollection',features:[]});
    assert.match(await page.locator('#notice').textContent(), /No records/);
    await page.locator('#stats [data-filter=all]').click();
    await input(await readFile('tests/fixtures/all-geometries.geojson', 'utf8'));
    assert.deepEqual(await page.locator('#stats .stat').evaluateAll(cards => Object.fromEntries(cards.map((card, index) => [['total','checked','valid','invalid','skipped','parseFailed','engineFailed'][index], Number(card.querySelector('strong').textContent)]))), {total:19,checked:16,valid:8,invalid:8,skipped:2,parseFailed:1,engineFailed:0});
    assert.match(await page.locator('#rows').textContent(), /GeometryCollection/);
    for (const [filter,count] of [['all',19],['checked',16],['valid',8],['invalid',8],['skipped',2],['parse_failed',1],['engine_failed',0]]) {
      const button = page.locator(`#stats [data-filter="${filter}"]`);
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#rows tr').count(), count);
      if (!['all','checked'].includes(filter)) assert.ok((await page.locator('#rows tr td:nth-child(3)').allTextContents()).every(status=>status===filter));
    }
    await page.locator('#stats [data-filter=all]').click();

    await page.locator('#download').click();
    const [geometryDownload] = await Promise.all([page.waitForEvent('download'),page.locator('#json').click()]);
    assert.equal(await page.locator('#download-menu').getAttribute('open'), null);
    await page.locator('#download').click();
    const [csvDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#csv').click()]);
    assert.equal(csvDownload.suggestedFilename(), 'fixture_check_result.csv');
    assert.equal(await page.locator('#download-menu').getAttribute('open'), null);
    const geometryReport = JSON.parse(await readFile(await geometryDownload.path(), 'utf8'));
    assert.equal(geometryReport.issues.length, 11);
    assert.equal(Object.hasOwn(geometryReport, 'schemaVersion'), false);
    assert.deepEqual(Object.keys(geometryReport.engine), ['parameters']);
    assert.ok(geometryReport.issues.every(issue => !Object.hasOwn(issue, 'warnings') && !Object.hasOwn(issue, 'domain')));
    const csvHeader = (await readFile(await csvDownload.path(), 'utf8')).split('\r\n')[0].split(',');
    for (const field of ['schema_version','engine_name','engine_version','wasm_package_version','coordinate_semantics','warnings','domain']) assert.ok(!csvHeader.includes(field));
    assert.ok(geometryReport.issues.every(record => record.ruleIds.length && !Object.hasOwn(record,'errorId')));
    assert.equal(geometryReport.issues.find(record => record.featureId === 'invalid-collection-member').geometryType, 'GeometryCollection');
    await page.locator('#file').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});
    await page.locator('[data-step="review"]').click();
    await page.locator('#recheck').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('INVALID_JSON'));
    assert.equal(await page.locator('#status a').getAttribute('href'),'./rules.html#Rule-001');
    assert.equal(await page.locator('#json').isDisabled(),true);
    await input(JSON.stringify(valid) + ' '.repeat(11 * 1024 * 1024), 'large.geojson');
    assert.equal(await page.locator('#stats [data-filter=valid] strong').textContent(), '1');
    await page.locator('#file').setInputFiles({name:'large.json',mimeType:'application/json',buffer:Buffer.alloc(11*1024*1024,32)});
    await page.locator('[data-step="review"]').click();
    await page.locator('#recheck').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('INVALID_JSON'));
    assert.equal(await page.locator('#output').isVisible(),false);
    // Select a new file and cancel in the same browser task, without a timing race.
    await page.evaluate(() => {
      const input = document.getElementById('file'), transfer = new DataTransfer();
      transfer.items.add(new File(['{}'], 'cancel.json'));
      input.files = transfer.files; input.dispatchEvent(new Event('change'));
      document.getElementById('recheck').click();
      document.getElementById('cancel').click();
    });
    assert.match(await page.locator('#status').textContent(), /Cancelled/);
    assert.equal(await page.locator('#csv').isDisabled(),true);
    await input(valid);
    for (const name of ['json','csv']) {
      const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#'+name).click()]);
      assert.equal(download.suggestedFilename(), 'fixture_check_result.'+name);
      assert.equal(await download.failure(), null);
    }
    assert.equal(await page.evaluate(() => localStorage.length),0);
    assert.deepEqual(await page.evaluate(() => indexedDB.databases()),[]);
    assert.deepEqual(errors,[]);
    assert.equal(logs.some(value => /PRIVATE_|82\.125/.test(value)), false);
    assert.ok(requests.every(request => request.method === 'GET' && request.body === null && request.url.startsWith(ORIGIN+'/') && !/PRIVATE_|82\.125|\?/.test(request.url)));
    for (const file of ['help.html','rules.html','about.html']) {
      await page.goto(ORIGIN+'/'+file);
      assert.equal(await page.locator('h1').count(),1);
    }
    await page.goto(ORIGIN+'/rules.html#Rule-011');
    assert.match(await page.locator('#Rule-011').textContent(), /Must not have invalid geometries/);
    await page.screenshot({path:'.cache/rules-page.png',fullPage:true});
    console.log(JSON.stringify({browser:selected,version:browser.version(),status:'passed'}));
  } finally { await browser.close(); }
});
