import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';

// The host must never add a network-capable script, even if a deployment
// retains an obsolete analytics token. Static asset responses pass through.
test('hosting preserves static responses when an old analytics token is configured', async () => {
  const response = new Response('<html><head></head><body>Inspector</body></html>', {
    headers: { 'content-type': 'text/html' },
  });
  let rewrites = 0;
  const original = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = class {
    on() { rewrites++; return this; }
    transform(value) { return value; }
  };
  try {
    const result = await worker.fetch(new Request('https://geolint.test/'), {
      ASSETS: { fetch: async () => response },
      CF_WEB_ANALYTICS_TOKEN: 'obsolete-token',
    });
    assert.equal(result, response);
    assert.equal(rewrites, 0);
    assert.doesNotMatch(await result.text(), /cloudflareinsights|beacon|<script/);
  } finally {
    if (original === undefined) delete globalThis.HTMLRewriter;
    else globalThis.HTMLRewriter = original;
  }
});

test('development badge rewrites only its element and preserves response content', async () => {
  const selectors = [];
  const original = globalThis.HTMLRewriter;
  globalThis.HTMLRewriter = class {
    on(selector, handler) {
      selectors.push(selector);
      handler.element({ removeAttribute(name) { assert.equal(name, 'hidden'); } });
      return this;
    }
    transform(response) { return response; }
  };
  try {
    const response = new Response('Preview');
    assert.equal(await worker.fetch(new Request('https://geolint.test/'), {
      ASSETS: { fetch: async () => response },
      GEOLINT_ENV: 'develop',
    }), response);
    assert.deepEqual(selectors, ['.environment-badge']);
  } finally {
    if (original === undefined) delete globalThis.HTMLRewriter;
    else globalThis.HTMLRewriter = original;
  }
});
