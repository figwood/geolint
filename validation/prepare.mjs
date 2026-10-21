import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseInput, supportsInput } from '../src/input/adapters.ts';
import { assertFileSize } from '../src/config.ts';
import { emptyAttributeRuleFile, readAttributeRuleFile, MAX_RULE_FILE_BYTES } from '../src/attributes/config.ts';

async function discover(path) {
  if (!(await stat(path)).isDirectory()) return [path];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await discover(child));
    else if (entry.isFile() && supportsInput(entry.name)) files.push(child);
  }
  return files.sort();
}

export async function prepareBatch(input, { attributeRulesPath } = {}) {
  let attributeRules = emptyAttributeRuleFile();
  if (attributeRulesPath) {
    if ((await stat(attributeRulesPath)).size > MAX_RULE_FILE_BYTES) throw new Error('Rule file exceeds 1 MiB.');
    attributeRules = readAttributeRuleFile(await readFile(attributeRulesPath, 'utf8'));
  }
  const path = input ? resolve(input) : fileURLToPath(new URL('../sample_data/', import.meta.url));
  const directory = (await stat(path)).isDirectory();
  const samplePath = fileURLToPath(new URL('../sample_data/', import.meta.url));
  const expectations = resolve(path) === resolve(samplePath)
    ? JSON.parse(await readFile(new URL('./expected-input-failures.json', import.meta.url), 'utf8')) : {};
  const paths = (await discover(path)).filter(source => !attributeRulesPath || resolve(source) !== resolve(attributeRulesPath));
  if (!paths.length) throw new Error('No .geojson, .json, .shp or .zip inputs found.');
  const files = [];
  for (const source of paths) {
    const file = directory ? relative(path, source).split('\\').join('/') : basename(source);
    let sha256 = null;
    try {
      assertFileSize((await stat(source)).size);
      const bytes = await readFile(source);
      assertFileSize(bytes.length);
      sha256 = createHash('sha256').update(bytes).digest('hex');
      const records = parseInput(source, bytes);
      files.push({ file, sha256, status: 'prepared', records });
    } catch (error) {
      files.push({ file, sha256, status: 'failed', error: { code: error.code ?? 'INPUT_ERROR', message: 'Input could not be read or normalized.' }, records: [] });
    }
  }
  for (const [file, expectedErrorCode] of Object.entries(expectations)) {
    const source = files.find(source => source.file === file);
    if (!source) throw new Error(`Expected rejection fixture is missing: ${file}`);
    source.expectedErrorCode = expectedErrorCode;
  }
  return { schemaVersion: '1.0', attributeRules, files };
}
