// Release checks must execute the newly built engine. The public application
// keeps its existing module URL; only Node validation imports are redirected.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const releaseDir = process.env.GEOLINT_RELEASE_DIR;
if (!releaseDir) throw new Error('GEOLINT_RELEASE_DIR is required for release engine checks.');
const entry = resolve(releaseDir, 'engine/geos.esm.js');
if (!existsSync(entry)) throw new Error(`Release engine entry does not exist: ${entry}`);
const engineURL = pathToFileURL(entry).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'geos-wasm') return { url: engineURL, format: 'module', shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
