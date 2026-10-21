import { verifyRelease } from './artifacts.mjs';

const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a path`);
  return args[index + 1];
}
try {
  const result = await verifyRelease({ releaseDir: option('--release-dir', '.cache/release-engine'), projectRoot: option('--project-root', process.cwd()), distDir: option('--dist-dir', 'dist') });
  console.log(`Release source/binary integrity and recorded checks verified: ${result.manifestSha256}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
