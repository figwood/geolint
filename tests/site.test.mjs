import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sitePages = ['index.html','help.html','rules.html','about.html'];
const legacyPages = ['methodology.html','privacy.html','limitations.html','licenses/NOTICE.html'];

test('tool and supporting pages have English metadata and accessible local navigation', async () => {
  for (const file of [...sitePages, ...legacyPages]) {
    const html = await readFile('public/' + file, 'utf8');
    assert.match(html, /lang="en"/);
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.match(html, /name="description"/);
    assert.match(html, /<main/);
    assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)="https?:/);
  }
});

test('site pages publish correctly sized local icons', async () => {
  for (const file of sitePages) {
    const html = await readFile('public/' + file, 'utf8');
    assert.match(html, /<link rel="icon" type="image\/png" sizes="32x32" href="\.\/favicon-32\.png">/);
    assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\.\/apple-touch-icon\.png">/);
  }

  for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180]]) {
    const png = await readFile('public/' + file);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test('every page uses the home page brand and Help, Rules, About navigation', async () => {
  const home = await readFile('public/index.html', 'utf8');
  const header = home.match(/<header>([^]*?)<\/header>/)[1];
  assert.match(header, /<img src="\.\/site-icon-512\.png" alt="" width="44" height="44">/);
  for (const file of [...sitePages, ...legacyPages]) {
    const html = await readFile('public/' + file, 'utf8');
    const actual = html.match(/<header>([^]*?)<\/header>/)[1].replaceAll('../', './');
    assert.equal(actual, header, file);
    assert.doesNotMatch(actual, /nav-more|methodology\.html|privacy\.html|limitations\.html|NOTICE\.html/);
  }
});

test('pages do not repeat the retired About navigation sentence', async () => {
  const sentence = 'See the geometry validation rules, file inspection guide and known limitations.';
  for (const file of [...sitePages, ...legacyPages]) {
    const html = await readFile('public/' + file, 'utf8');
    assert.doesNotMatch(html, /See the geometry validation rules,? file inspection guide and known limitations\./);
    assert.doesNotMatch(html, /geometry validation rules<\/a>[\s\S]*file inspection guide<\/a>[\s\S]*known limitations/);
    assert.ok(!html.includes(sentence), file);
  }
});

test('About presents operation, dependency versions, privacy and known limitations', async () => {
  const html = await readFile('public/about.html', 'utf8');
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  for (const [id, title] of [['method','How it works'],['third-party-notices','Third-party libraries'],['privacy','Privacy'],['limits','Known limitations']]) {
    assert.ok(html.includes(`id="${id}"`));
    assert.ok(html.includes(`<h2 id="${id}-title">${title}</h2>`));
  }
  assert.doesNotMatch(html, /about-sections|aria-label="On this page"/);
  assert.equal((html.match(/<section /g) ?? []).length, 4);
  assert.equal((html.match(/<h2 /g) ?? []).length, 4);
  const { dependencies } = JSON.parse(await readFile('package.json', 'utf8'));
  for (const name of ['geos-wasm', 'fflate']) {
    assert.ok(html.includes(`<th scope="row">${name}</th><td>${dependencies[name]}</td>`));
  }
  assert.ok(html.includes('<th scope="row">GEOS</th><td>3.13.0</td>'));
  assert.match(html, /QGIS Topology Checker and Geometry Checker/);
  assert.match(html, /GeoLint does not upload them to a server/);
  assert.match(html, /Extreme Shapefile coordinates/);
  for (const path of ['licenses/geos-wasm-LICENSE.txt','licenses/GEOS-COPYING.txt']) {
    assert.ok(html.includes(`href="./${path}"`));
    assert.ok((await readFile('public/' + path)).length > 0);
  }
  assert.ok(html.includes('href="./vendor/fflate/LICENSE.txt"'));
  const packaging = await readFile('scripts/package-site.mjs', 'utf8');
  assert.match(packaging, /const pages = \['index.html', 'help.html', 'rules.html', 'about.html'\]/);
});

test('legacy supporting page URLs forward to the corresponding About sections', async () => {
  for (const [file, anchor] of [['methodology.html','method'],['privacy.html','privacy'],['limitations.html','limits'],['licenses/NOTICE.html','third-party-notices']]) {
    const html = await readFile('public/' + file, 'utf8');
    const prefix = file.startsWith('licenses/') ? '../' : './';
    assert.ok(html.includes(`content="0; url=${prefix}about.html#${anchor}"`));
    assert.ok(html.includes(`href="${prefix}about.html#${anchor}"`));
    assert.ok(html.includes('name="robots" content="noindex"'));
  }
});

// Removing a published reference or changing its meaning must fail this check.
test('published diagnostic references cover runtime codes and resolve to explanations', async () => {
  const { checkRules, reasonRules, ruleIdsForReason } = await import('../src/diagnostics.ts');
  const rules = await readFile('public/rules.html', 'utf8');
  assert.equal(new Set(reasonRules.map(item => item.code)).size, reasonRules.length);
  for (const rule of checkRules.filter(rule => rule.executionGroup !== 'attributes')) {
    assert.ok(rules.includes(`id="${rule.id}"`));
    assert.ok(rules.includes(rule.description));
  }
  for (const entry of reasonRules) {
    for (const id of entry.ruleIds) assert.ok(checkRules.some(rule => rule.id === id));
  }
  const sources = ['config.ts','errors.ts','geometry/normalize.ts','geojson/normalize.ts','input/adapters.ts','shapefile/parse.ts','shapefile/archive.ts','engine/geos.ts','worker/client.ts','inspection/run.ts'];
  for (const source of sources) {
    const text = await readFile('src/' + source, 'utf8');
    for (const [code] of text.matchAll(/(?<=[\x27])[A-Z][A-Z_]+(?=[\x27])/g)) {
      if (code === 'GEOS') continue;
      assert.ok(reasonRules.some(entry => entry.code === code), `Missing reference for ${code}`);
    }
  }
  assert.deepEqual(ruleIdsForReason('FUTURE_CODE'), []);
  assert.deepEqual(ruleIdsForReason('VALID'), ['Rule-011']);
  assert.ok(!rules.includes('id="R010"'));
});
