import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { routeSite, ORIGIN } from '../browser-site.mjs';
let browser, server, launching;
// Await in-flight launch so an abort during startup also closes the browser.
process.once('SIGTERM', async () => {
  try { await launching; await browser?.close(); await server?.close(); }
  finally { process.exit(1); }
});
try {
  launching=chromium.launchServer({headless:true,timeout:10000}).then(value => {
    server=value;
    process.send?.({browserPid:server.process().pid});
  });
  await launching;
  browser=await chromium.connect(server.wsEndpoint());
  const context=await browser.newContext();
  await routeSite(context);
  // Isolated benchmark entry intentionally bypasses the product file-size limit.
  await context.route(ORIGIN+'/benchmark-worker.js', async route=>route.fulfill({status:200,contentType:'text/javascript',body:await readFile(new URL('./worker.js',import.meta.url))}));
  const page=await context.newPage(); await page.goto(ORIGIN);
  const result=await page.evaluate(sizeMiB=>new Promise((resolve,reject)=>{
    const worker=new Worker('/benchmark-worker.js',{type:'module'});
    worker.onmessage=({data})=>{worker.terminate();resolve(data);};
    worker.onerror=()=>{worker.terminate();reject(new Error('Worker failed'));};
    worker.postMessage({sizeMiB});
  }),Number(process.argv[2]));
  console.log(JSON.stringify({...result,browser:browser.version()}));
} catch { console.log(JSON.stringify({status:'blocked',reason:'Browser startup or execution unavailable; run outside restricted environments.'})); }
finally { await browser?.close(); await server?.close(); }
