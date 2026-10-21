import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';import {routeSite,ORIGIN} from '../../scripts/browser-site.mjs';
test('QGIS threshold editing, validation, results and exports retain the completed snapshot',{timeout:45000},async()=>{
 const browser=await chromium.launch({headless:true});try{
  const context=await browser.newContext({acceptDownloads:true});await routeSite(context);const page=await context.newPage();await page.goto(ORIGIN);
  await page.locator('#file').setInputFiles({name:'length.geojson',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({type:'LineString',coordinates:[[0,0],[1,0],[1,1]]}))});
  await page.locator('#file-next').click();await page.locator('[data-topology-rule="Rule-031"]').check();await page.locator('#rules-next').click();await page.locator('#recheck').click();
  assert.equal(await page.locator('#step-rules').isVisible(),true);assert.match(await page.locator('#error-Rule-031').textContent(),/configure/);
  await page.locator('#parameter-Rule-031-minLength').fill('2');await page.locator('#rules-next').click();assert.match(await page.locator('#selected-rules').textContent(),/minLength: 2/);
  await page.locator('#recheck').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Inspection completed.');
  await page.locator('#stats [data-filter="all"]').click();assert.equal(await page.locator('[data-issue-location]').count(),2);
  await page.locator('#edit-checks').click();await page.locator('#parameter-Rule-031-minLength').fill('0.5');
  await page.locator('[data-step="results"]').click();await page.locator('#download').click();const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#json').click()]);
  const report=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(report.topology.options.rules[0].parameters.minLength,2);assert.equal(report.topology.summary.issues,2);
  await mkdir('.cache',{recursive:true});await page.screenshot({path:'.cache/qgis-rules-desktop.png',fullPage:true});
  await page.locator('#edit-checks').click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.cache/qgis-rules-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }finally{await browser.close();}
});
