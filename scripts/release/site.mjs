import { rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

// TypeScript and static copying do not remove obsolete output. A validated
// release must be assembled from current sources in an empty generated tree.
export async function cleanSiteOutput(projectRoot, releaseDir) {
  const distDir = resolve(projectRoot, 'dist');
  const candidate = relative(distDir, resolve(releaseDir));
  if (candidate === '' || (!isAbsolute(candidate) && candidate !== '..' && !candidate.startsWith('../'))) {
    throw new Error('Keep the engine candidate outside dist before rebuilding the site.');
  }
  await rm(distDir, { recursive: true, force: true });
}
