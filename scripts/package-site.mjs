import { mkdir, copyFile, access, cp, writeFile, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { validateReleaseArtifacts, packageReleaseArtifacts } from './release/artifacts.mjs';

const allowMissing = process.argv.includes('--allow-missing-engine');
const releaseIndex = process.argv.indexOf('--release-dir');
const releaseDir = releaseIndex === -1 ? undefined : process.argv[releaseIndex + 1];
if (releaseIndex !== -1 && (!releaseDir || releaseDir.startsWith('--'))) throw new Error('--release-dir requires an artifact directory');
if (releaseDir && allowMissing) throw new Error('--release-dir cannot allow a missing engine');
// Validate before mutating dist; candidate packaging must never fall back to npm.
if (releaseDir) await validateReleaseArtifacts({ releaseDir: resolve(releaseDir) });
// Confirmed production domain; an explicit empty SITE_URL disables absolute SEO URLs.
const configuredSiteURL = process.env.SITE_URL ?? 'https://geolint.app';
let siteURL;
if (configuredSiteURL) {
  siteURL = new URL(configuredSiteURL);
  if (!['https:', 'http:'].includes(siteURL.protocol) || siteURL.search || siteURL.hash || siteURL.username || siteURL.password) throw new Error('SITE_URL must be an HTTP(S) base URL without credentials, query or fragment.');
  if (!siteURL.pathname.endsWith('/')) siteURL.pathname += '/';
}
const require = createRequire(import.meta.url);
// Ship the browser ESM locally; Workers must never depend on a CDN or bare imports.
const compressionRoot = dirname(dirname(require.resolve('fflate')));
await mkdir('dist/vendor/fflate', { recursive: true });
await copyFile(join(compressionRoot, 'esm', 'browser.js'), 'dist/vendor/fflate/fflate.js');
await copyFile(join(compressionRoot, 'LICENSE'), 'dist/vendor/fflate/LICENSE');
// A .txt asset displays inline like the GEOS license on static hosts.
await copyFile(join(compressionRoot, 'LICENSE'), 'dist/vendor/fflate/LICENSE.txt');
await rm('dist/vendor/fflate/license.html', { force: true });
const archivePath = 'dist/core/shapefile/archive.js';
const archiveModule = await readFile(archivePath, 'utf8');
await writeFile(archivePath, archiveModule.replace("from 'fflate'", "from '../../vendor/fflate/fflate.js'"));
let enginePath;
try {
  enginePath = releaseDir ? undefined : require.resolve('geos-wasm');
  if (enginePath) await access(enginePath);
} catch {
  if (!allowMissing) {
    console.error('Build blocked: geos-wasm 3.1.1 is not installed. Run npm install with registry access.');
    process.exit(1);
  }
  console.warn('Core smoke harness only: WASM missing. Geometry checks will fail explicitly.');
}
await rm('dist/vendor/geos', { recursive: true, force: true });
await mkdir('dist/vendor/geos', { recursive: true });
if (enginePath) {
  await copyFile(enginePath, 'dist/vendor/geos/geos.esm.js');
  // Some future builds may split out WASM; this pinned package is single-file.
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    try { await copyFile(join(dirname(enginePath), '..', '..', name), join('dist/vendor/geos', name)); } catch {}
  }
}
await cp('public', 'dist', { recursive: true });
await copyFile(new URL('../LICENSE', import.meta.url), 'dist/LICENSE.txt');
if (releaseDir) await packageReleaseArtifacts({ releaseDir: resolve(releaseDir), distDir: resolve('dist') });
else await rm('dist/sources', { recursive: true, force: true });
await copyFile('sample_data/sample.geojson', 'dist/sample.geojson');
await rm('dist/errors.html', { force: true });
await rm('dist/smoke.js', { force: true });
await rm('dist/sitemap.xml', { force: true });
const pages = ['index.html', 'help.html', 'rules.html', 'about.html'];
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const locations = siteURL ? pages.map(page => new URL(page === 'index.html' ? './' : page, siteURL).href) : [];
for (const [index, page] of pages.entries()) {
  const path = join('dist', page);
  const html = await readFile(path, 'utf8');
  // These values are already HTML-escaped in the source; preserve them in attributes.
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1];
  if (!title || !description) throw new Error(`Missing SEO metadata in ${page}`);
  const tags = [
    '<meta property="og:site_name" content="GeoLint">',
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="en_US">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`
  ];
  if (siteURL) {
    const image = escape(new URL('site-icon-512.png', siteURL).href);
    tags.push(
      `<link rel="canonical" href="${escape(locations[index])}">`,
      `<meta property="og:url" content="${escape(locations[index])}">`,
      `<meta property="og:image" content="${image}">`,
      '<meta property="og:image:width" content="512">',
      '<meta property="og:image:height" content="512">',
      '<meta property="og:image:alt" content="GeoLint app icon">',
      `<meta name="twitter:image" content="${image}">`,
      '<meta name="twitter:image:alt" content="GeoLint app icon">'
    );
  }
  if (page === 'index.html') {
    const application = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'GeoLint',
      description: 'Validate 2D GeoJSON and Shapefile geometry locally in your browser and export CSV or JSON issue reports.',
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript, WebAssembly and Web Workers.',
      inLanguage: 'en',
      ...(siteURL ? { url: locations[index] } : {})
    };
    tags.push(`<script type="application/ld+json">${JSON.stringify(application).replaceAll('<', '\\u003c')}</script>`);
  }
  await writeFile(path, html.replace('</head>', `${tags.join('\n')}\n</head>`));
}
if (siteURL) {
  await writeFile('dist/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locations.map(url => `<url><loc>${escape(url)}</loc></url>`).join('')}</urlset>\n`);
}
await writeFile('dist/robots.txt', `User-agent: *\nAllow: /\n${siteURL ? `Sitemap: ${new URL('sitemap.xml', siteURL).href}\n` : ''}`);
console.log('Static preview packaged in dist/. Browser acceptance and distribution review are required before release.');
