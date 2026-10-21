import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
export const ORIGIN = 'https://geolint.test';
export async function routeSite(context, requests = []) {
  const root = resolve('dist');
  const types = {'.js':'text/javascript', '.mjs':'text/javascript', '.html':'text/html', '.css':'text/css', '.geojson':'application/geo+json', '.txt':'text/plain', '.xml':'application/xml'};
  await context.route('**/*', async route => {
    const request = route.request();
    requests.push({url:request.url(), method:request.method(), body:request.postData()});
    const url = new URL(request.url());
    if (url.origin !== ORIGIN || request.method() !== 'GET' || url.search) { await route.abort(); return; }
    let path;
    try { path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
    catch { await route.abort(); return; }
    if (!path.startsWith(root + sep)) { await route.abort(); return; }
    try { await route.fulfill({status:200, contentType:types[extname(path)] ?? 'application/octet-stream', body:await readFile(path)}); }
    catch { await route.fulfill({status:404, body:'Not found'}); }
  });
}
