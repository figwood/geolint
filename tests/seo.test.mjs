import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/package-site.mjs', import.meta.url));
const pages = ['index.html', 'help.html', 'rules.html', 'about.html'];

// Exercise the real packager in isolation; core compilation is unrelated to SEO.
async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), 'geolint-seo-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await cp('public', join(cwd, 'public'), { recursive: true });
  await mkdir(join(cwd, 'sample_data'));
  await cp('sample_data/sample.geojson', join(cwd, 'sample_data/sample.geojson'));
  await mkdir(join(cwd, 'dist/core/shapefile'), { recursive: true });
  await writeFile(join(cwd, 'dist/core/shapefile/archive.js'), "import { unzipSync } from 'fflate';\n");
  return cwd;
}

function build(cwd, siteURL = '') {
  const env = { ...process.env, SITE_URL: siteURL };
  if (siteURL === null) delete env.SITE_URL;
  execFileSync(process.execPath, [script], { cwd, env, stdio: 'pipe' });
}

function meta(html, key) {
  return html.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`))?.[1];
}

function application(html) {
  return JSON.parse(html.match(/<script type="application\/ld\+json">([^]*?)<\/script>/)?.[1] ?? 'null');
}

test('home explains the tool in visible static HTML with one primary heading', async () => {
  const html = await readFile('public/index.html', 'utf8');
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<h1[^>]*>[^<]*GeoJSON[^<]*Shapefile[^<]*<\/h1>/);
  assert.match(html, /<noscript>[^]*?JavaScript[^]*?<\/noscript>/);
});

test('packaged pages share their descriptive metadata and expose parseable application data without a domain', async t => {
  const cwd = await fixture(t);
  build(cwd);
  const titles = new Set();
  const descriptions = new Set();
  for (const page of pages) {
    const html = await readFile(join(cwd, 'dist', page), 'utf8');
    const title = html.match(/<title>([^<]+)<\/title>/)[1];
    const description = meta(html, 'description');
    titles.add(title);
    descriptions.add(description);
    assert.equal(meta(html, 'og:title'), title);
    assert.equal(meta(html, 'og:description'), description);
    assert.equal(meta(html, 'twitter:card'), 'summary');
    assert.equal(meta(html, 'twitter:title'), title);
    assert.equal(meta(html, 'twitter:description'), description);
    assert.doesNotMatch(html, /rel="canonical"|property="og:url"|property="og:image"/);
  }
  assert.equal(titles.size, 4);
  assert.equal(descriptions.size, 4);
  const data = application(await readFile(join(cwd, 'dist/index.html'), 'utf8'));
  assert.equal(data['@context'], 'https://schema.org');
  assert.equal(data['@type'], 'WebApplication');
  assert.equal(data.name, 'GeoLint');
  assert.equal(data.url, undefined);
  assert.match(data.description, /GeoJSON.*Shapefile/);
});

test('absolute sharing URLs, canonicals and sitemap respect a deployment prefix and rebuild cleanly', async t => {
  const cwd = await fixture(t);
  build(cwd, 'https://example.com/tools/geolint');
  for (const [page, location] of [
    ['index.html', 'https://example.com/tools/geolint/'],
    ['help.html', 'https://example.com/tools/geolint/help.html'],
    ['rules.html', 'https://example.com/tools/geolint/rules.html'],
    ['about.html', 'https://example.com/tools/geolint/about.html']
  ]) {
    const html = await readFile(join(cwd, 'dist', page), 'utf8');
    assert.ok(html.includes(`<link rel="canonical" href="${location}">`));
    assert.equal(meta(html, 'og:url'), location);
    assert.equal(meta(html, 'og:image'), 'https://example.com/tools/geolint/site-icon-512.png');
    assert.equal(meta(html, 'twitter:image'), meta(html, 'og:image'));
    assert.equal((html.match(/rel="canonical"/g) ?? []).length, 1);
  }
  assert.equal(application(await readFile(join(cwd, 'dist/index.html'), 'utf8')).url, 'https://example.com/tools/geolint/');
  const sitemap = await readFile(join(cwd, 'dist/sitemap.xml'), 'utf8');
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 4);
  assert.ok(sitemap.includes('<loc>https://example.com/tools/geolint/</loc>'));
  assert.doesNotMatch(sitemap, /privacy|methodology|limitations|NOTICE/);
  assert.match(await readFile(join(cwd, 'dist/robots.txt'), 'utf8'), /Sitemap: https:\/\/example.com\/tools\/geolint\/sitemap.xml/);
  build(cwd);
  await assert.rejects(readFile(join(cwd, 'dist/sitemap.xml')), { code: 'ENOENT' });
  const home = await readFile(join(cwd, 'dist/index.html'), 'utf8');
  assert.doesNotMatch(home, /example\.com/);
  assert.equal(application(home).url, undefined);
  assert.doesNotMatch(await readFile(join(cwd, 'dist/robots.txt'), 'utf8'), /Sitemap:/);
});


test('build defaults to the confirmed production domain when SITE_URL is unset', async t => {
  const cwd = await fixture(t);
  build(cwd, null);
  for (const [page, url] of [
    ['index.html', 'https://geolint.app/'],
    ['help.html', 'https://geolint.app/help.html'],
    ['rules.html', 'https://geolint.app/rules.html'],
    ['about.html', 'https://geolint.app/about.html']
  ]) {
    const html = await readFile(join(cwd, 'dist', page), 'utf8');
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
    assert.equal(meta(html, 'og:url'), url);
    assert.equal(meta(html, 'og:image'), 'https://geolint.app/site-icon-512.png');
  }
  const home = await readFile(join(cwd, 'dist/index.html'), 'utf8');
  assert.equal(application(home).url, 'https://geolint.app/');
  const sitemap = await readFile(join(cwd, 'dist/sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes('<loc>https://geolint.app/</loc>'));
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 4);
  assert.match(await readFile(join(cwd, 'dist/robots.txt'), 'utf8'), /Sitemap: https:\/\/geolint\.app\/sitemap.xml/);
});

test('packaged site includes the project license and dependency distribution notices', async t => {
  const cwd = await fixture(t);
  build(cwd);
  assert.equal(await readFile(join(cwd, 'dist/LICENSE.txt'), 'utf8'), await readFile('LICENSE', 'utf8'));
  assert.equal(await readFile(join(cwd, 'dist/licenses/THIRD-PARTY-NOTICES.md'), 'utf8'), await readFile('public/licenses/THIRD-PARTY-NOTICES.md', 'utf8'));
  const about = await readFile(join(cwd, 'dist/about.html'), 'utf8');
  assert.ok(about.includes('href="./LICENSE.txt"'));
  assert.ok(about.includes('href="./licenses/THIRD-PARTY-NOTICES.md"'));
  assert.ok(about.includes('href="./vendor/fflate/LICENSE.txt"'));
  const original = await readFile(join(cwd, 'dist/vendor/fflate/LICENSE'), 'utf8');
  assert.equal(await readFile(join(cwd, 'dist/vendor/fflate/LICENSE.txt'), 'utf8'), original);
  await assert.rejects(readFile(join(cwd, 'dist/vendor/fflate/license.html')), { code: 'ENOENT' });
});

test('preview rebuild removes stale candidate source kits and unbundled engine dependencies', async t => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, 'dist/sources'), { recursive: true });
  await writeFile(join(cwd, 'dist/sources/manifest.json'), '{"stale":true}');
  await mkdir(join(cwd, 'dist/vendor/geos/src'), { recursive: true });
  await writeFile(join(cwd, 'dist/vendor/geos/src/index.mjs'), 'stale candidate');
  build(cwd);
  await assert.rejects(readFile(join(cwd, 'dist/sources/manifest.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(cwd, 'dist/vendor/geos/src/index.mjs')), { code: 'ENOENT' });
});

test('candidate packaging fails before modifying dist when release materials are missing', async t => {
  const cwd = await fixture(t);
  const path = join(cwd, 'dist/core/shapefile/archive.js');
  const before = await readFile(path, 'utf8');
  assert.throws(() => execFileSync(process.execPath, [script, '--release-dir', 'missing'], { cwd, stdio: 'pipe' }));
  assert.equal(await readFile(path, 'utf8'), before);
  await assert.rejects(readFile(join(cwd, 'dist/vendor/geos/geos.esm.js')), { code: 'ENOENT' });
});
