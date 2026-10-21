import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { routeSite, ORIGIN } from '../../scripts/browser-site.mjs';

// Virtual HTTPS routing serves the actual static build without a listening server.
// Use a secure origin, as in deployment, so crypto.randomUUID is available.
// No replacement geometry engine is injected into these browser tests.
test('real browser Worker handles failure, cancel/restart, checks geometry, and exports matching reports', {timeout:45000}, async()=>{
  const {chromium}=await import(process.env.GEOLINT_PLAYWRIGHT_MODULE ?? 'playwright');
  const browser=await chromium.launch({headless:true,timeout:10000});
  const scratch=await mkdtemp(join(tmpdir(),'geolint-e2e-'));
  try {
    const context=await browser.newContext({acceptDownloads:true});
    const requests=[];
    await routeSite(context, requests);
    const page=await context.newPage();await page.goto('https://geolint.test/');
    assert.deepEqual(await page.evaluate(()=>({secure:isSecureContext,randomUUID:typeof crypto.randomUUID})),
      {secure:true,randomUUID:'function'},'The browser test must provide a secure origin with crypto.randomUUID');
    const messages=await page.evaluate(async()=>{
      const {startInspection}=await import('/core/worker/client.js');
      const seen=[];
      const first=startInspection(new File(['{}'],'cancel.geojson'),m=>seen.push(m));first.cancel();
      await new Promise(resolve=>startInspection(new File(['{'],'bad.geojson'),m=>{seen.push(m);if(m.type==='failed')resolve()}));
      return seen;
    });
    assert.equal(messages.filter(m=>m.type==='cancelled').length,1);
    assert.equal(Object.hasOwn(messages.find(m=>m.type==='cancelled'),'errorId'),false);
    assert.equal(messages.at(-1).code,'INVALID_JSON');
    assert.equal(messages.some(m=>m.type==='completed'),false);
    const input={type:'FeatureCollection',features:[
      {type:'Feature',id:'private-sentinel-café',properties:{private:'DO_NOT_UPLOAD'},geometry:{type:'Polygon',coordinates:[[[0,0],[4,4],[0,4],[4,0],[0,0]]]}},
      {type:'Feature',geometry:null,properties:{}},
      {type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,0]]]},properties:{}},
    ]};
    await page.locator('#file').setInputFiles({name:'mixed.geojson',mimeType:'application/geo+json',buffer:Buffer.from(JSON.stringify(input))});
    await page.locator('[data-step="review"]').click();
    await page.locator('#recheck').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent.startsWith('Inspection completed'),{},{timeout:15000});
    const summary=await page.locator('#stats .stat').evaluateAll(cards => Object.fromEntries(cards.map((card, index) => [['total','checked','valid','invalid','skipped','parseFailed','engineFailed'][index], Number(card.querySelector('strong').textContent)])));
    assert.deepEqual(summary,{total:3,checked:2,valid:1,invalid:1,skipped:1,parseFailed:0,engineFailed:0});
    const exports={};
    for(const kind of ['json','csv']){
      await page.locator('#download').click();
      const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#'+kind).click()]);
      const path=join(scratch,'report.'+kind);await download.saveAs(path);exports[kind]=await readFile(path,'utf8');
    }
    const report=JSON.parse(exports.json);
    assert.equal(report.issues.length,2);assert.equal(report.issues[0].featureId,'private-sentinel-café');
    assert.equal(exports.csv.includes('private-sentinel-café'),true);
    assert.equal(exports.json.includes('DO_NOT_UPLOAD'),false);
    assert.ok(requests.every(r=>r.method==='GET'&&r.url.startsWith('https://geolint.test/')&&!r.url.includes('private-sentinel')));
  }finally{await browser.close();await rm(scratch,{recursive:true,force:true})}
});
