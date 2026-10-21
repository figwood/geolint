import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {routeSite,ORIGIN} from '../../scripts/browser-site.mjs';

test('duplicate rule runs in the real Worker with opt-in snapshots, visible pairs and matching exports',{timeout:45000},async()=>{
  const {chromium}=await import(process.env.GEOLINT_PLAYWRIGHT_MODULE??'playwright');
  const browser=await chromium.launch({headless:true,timeout:10000});
  try{
    const context=await browser.newContext({acceptDownloads:true});
    const requests=[];await routeSite(context,requests);
    const page=await context.newPage();await page.goto(ORIGIN);
    const input={type:'FeatureCollection',features:[0,1,2].map(()=>({type:'Feature',id:'same-id',geometry:{type:'Point',coordinates:[0,0]},properties:{secret:'PRIVATE_VALUE'}}))};
    await page.locator('#file').setInputFiles({name:'duplicates.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(input))});
    const inspect=async()=>{
      await page.locator('[data-step="review"]').click();
      await page.locator('#recheck').click();
      await page.waitForFunction(()=>document.getElementById('status').textContent==='Inspection completed.',{},{timeout:15000});
      await page.locator('#stats [data-filter=all]').click();
    };
    await inspect();assert.equal(await page.locator('#rows .status-valid').count(),3);
    await page.locator('[data-step="rules"]').click();
    await page.locator('#topology-duplicates').check();await inspect();
    assert.equal(await page.locator('#rows tr').count(),3);
    assert.equal(await page.locator('#topology-results, #results th:text-is("Topology")').count(),0);
    assert.equal(await page.locator('#stats [data-filter=invalid] strong').textContent(),'3');
    assert.equal(await page.locator('#stats [data-filter=valid] strong').textContent(),'0');
    assert.equal(await page.locator('#rows .status-invalid').count(),3);
    assert.equal(await page.locator('#notice').isVisible(),false);
    assert.equal(await page.locator('.verdict-error:visible').count(),1);
    assert.match(await page.locator('#verdict-description').textContent(),/3 optional check problems/);
    assert.equal(await page.locator('#rows .topology-problems li').count(),6);
    assert.doesNotMatch(await page.locator('#rows .result-reasons').allTextContents().then(text => text.join(' ')), /Rule-\d{3}/);
    assert.equal(await page.locator('#rows tr').first().locator('td').nth(3).locator('a[href="./rules.html#Rule-012"]').count(),1);
    assert.equal(new Set(await page.locator('#rows .topology-problems li').evaluateAll(items=>items.map(item=>item.dataset.issueId))).size,3);
    assert.match(await page.locator('#rows tr').first().textContent(),/feature:0.*feature:1/);
    await page.locator('#rows a[href="#record-1"]').first().click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'record-1');
    await page.locator('#stats [data-filter=valid]').click();
    assert.equal(await page.locator('#rows tr').count(),0);
    await page.locator('#stats [data-filter=invalid]').click();
    assert.equal(await page.locator('#rows .topology-problems li').count(),6);
    await mkdir('.cache',{recursive:true});
    await page.screenshot({path:'.cache/unified-results.png',fullPage:true});
    await page.locator('[data-step="rules"]').click();
    await page.locator('#topology-duplicates').uncheck();
    assert.match(await page.locator('#selection-notice').textContent(),/another inspection/i);
    await page.locator('[data-step="results"]').click();
    await page.locator('#download').click();
    const download=page.waitForEvent('download');await page.locator('#json').click();
    const file=await download;
    assert.equal(file.suggestedFilename(),'duplicates_check_result.json');
    const report=JSON.parse(await readFile(await file.path(),'utf8'));
    assert.equal(report.topology.summary.issues,3);
    assert.deepEqual(report.topology.options.rules,[{id:'Rule-012',parameters:{}}]);
    assert.equal(JSON.stringify(report).includes('PRIVATE_VALUE'),false);
    assert.equal(JSON.stringify(report).includes('"coordinates":'),false);
    await inspect();assert.equal(await page.locator('#rows .status-valid').count(),3);
    assert.equal(await page.locator('#rows .topology-problems li').count(),0);
    assert.ok(requests.every(r=>r.method==='GET'&&r.url.startsWith(ORIGIN+'/')));
  }finally{await browser.close();}
});

test('single-layer gap remains visible and exportable without source participants',{timeout:45000},async()=>{
  const {chromium}=await import(process.env.GEOLINT_PLAYWRIGHT_MODULE??'playwright');
  const browser=await chromium.launch({headless:true,timeout:10000});
  try{
    const context=await browser.newContext({acceptDownloads:true});await routeSite(context,[]);
    const page=await context.newPage();await page.goto(ORIGIN);
    const geometry={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]]]};
    await page.locator('#file').setInputFiles({name:'gap.geojson',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(geometry))});
    await page.locator('#file-next').click();await page.locator('#topology-gaps').check();
    assert.equal(await page.locator('[data-topology-rule]').count(),6);
    await page.locator('[data-step="review"]').click();assert.match(await page.locator('#selected-rules').textContent(),/Rule-017/);
    await page.locator('#recheck').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Inspection completed.');
    assert.equal(await page.locator('#stats [data-filter=invalid] strong').textContent(),'1');
    assert.equal(await page.locator('#stats [data-filter=all] strong').textContent(),'2');
    assert.equal(await page.locator('#rows tr').count(),1);
    assert.match(await page.locator('#rows').textContent(),/Dataset.*invalid.*Rule-017.*enclosed gap/s);
    assert.equal(await page.locator('#rows .topology-problems li').count(),1);
    const row = page.locator('#rows tr').first();
    const location = await row.locator('td').last().textContent();
    assert.notEqual(location, 'Not provided');
    assert.ok(!(await row.locator('.result-reasons').textContent()).includes(` · ${location}`));
    await page.locator('#rows details').click();assert.match(await page.locator('#rows pre').textContent(),/coordinates/);
    await page.locator('#stats [data-filter=valid]').click();
    assert.equal(await page.locator('#rows tr').count(),1);
    assert.equal(await page.locator('#rows .topology-problems li').count(),0);
    await page.locator('#stats [data-filter=invalid]').click();
    await mkdir('.cache',{recursive:true});await page.screenshot({path:'.cache/single-layer-gaps.png',fullPage:true});
    for(const format of ['json','csv']){
      await page.locator('#download').click();const download=page.waitForEvent('download');await page.locator(`#${format}`).click();
      const content=await readFile(await (await download).path(),'utf8');
      if(format==='json'){const data=JSON.parse(content);assert.equal(data.issues[0].scope,'dataset');assert.deepEqual(data.issues[0].participants,[]);assert.equal(data.issues[0].geometry.type,'Polygon');}
      else {assert.match(content,/issue_geometry/);assert.match(content,/TOPOLOGY_AREA_GAP/);}
    }
  }finally{await browser.close();}
});
