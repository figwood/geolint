# Sample datasets

This directory contains 43 supported inputs: 40 Rule-001 through Rule-040 GeoJSON files, a Shapefile, a Shapefile ZIP, and the small upload example. Sidecars for Rule-003.shp are included. Files contain fixed data; their names do not guarantee that they violate the named rule. Rows with a target issue count of zero are non-triggering controls, not evidence of positive detection coverage. No geometry is repaired or reprojected.

The hidden .config directory contains attribute and topology configurations and manifest.json. Default batch discovery skips this directory. The manifest records actual byte sizes, selected configurations, and observations from GEOS WASM 3.13.0. Its counts are fixture observations, while validation's hand-authored cases independently check correctness.

Default batch validation runs geometry checks on all 43 files; all currently pass input preparation. Optional attribute and topology rules require the configurations listed below and are not automatically enabled by the file name. Rule-022 uses an intentionally invalid attribute configuration, which fails before a run can start. Rule-001 is supported GeoJSON and does not demonstrate a size limit. GeoJSON controls for Shapefile and archive rules do not exercise those readers. Rule-003.shp and Rule-004.zip exercise the actual formats.

The upload example includes a non-ASCII Latin feature ID to exercise UTF-8 handling. All geometry is processed locally.

| File | Built-in rule | Target issue count | Run status | Attribute configuration | Topology configuration |
| --- | --- | ---: | --- | --- | --- |
| Rule-001.geojson | Rule-001 | 0 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-002.geojson | Rule-002 | 0 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-003.geojson | Rule-003 | 0 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-003.shp | Rule-003 | 0 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-004.geojson | Rule-004 | 0 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-004.zip | Rule-004 | 0 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-005.geojson | Rule-005 | 1 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-006.geojson | Rule-006 | 6 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-007.geojson | Rule-007 | 6 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-008.geojson | Rule-008 | 6 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-009.geojson | Rule-009 | 0 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-010.geojson | Rule-010 | 6 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-011.geojson | Rule-011 | 6 | completed | .config/geometry-only-attributes.json | Disabled |
| Rule-012.geojson | Rule-012 | 21 | completed | .config/geometry-only-attributes.json | Rule-012 |
| Rule-013.geojson | Rule-013 | 6 | completed | .config/geometry-only-attributes.json | Rule-013 |
| Rule-014.geojson | Rule-014 | 12 | completed | .config/geometry-only-attributes.json | Rule-014 |
| Rule-015.geojson | Rule-015 | 6 | completed | .config/geometry-only-attributes.json | Rule-015 |
| Rule-016.geojson | Rule-016 | 9 | completed | .config/geometry-only-attributes.json | Rule-016 |
| Rule-017.geojson | Rule-017 | 0 | completed | .config/geometry-only-attributes.json | Rule-017 |
| Rule-018.geojson | Rule-018 | 6 | completed | .config/attribute-rules.json | Disabled |
| Rule-019.geojson | Rule-019 | 6 | completed | .config/attribute-rules.json | Disabled |
| Rule-020.geojson | Rule-020 | 45 | completed | .config/attribute-rules.json | Disabled |
| Rule-021.geojson | Rule-021 | 0 | completed | .config/attribute-rules.json | Disabled |
| Rule-022.geojson | Rule-022 | 1 | failed | .config/AR-005.rules.json | Disabled |
| Rule-023.geojson | Rule-023 | 6 | completed | .config/attribute-rules.json | Disabled |
| Rule-024.geojson | Rule-024 | 6 | completed | .config/geometry-only-attributes.json | .config/Rule-024.rules.json |
| Rule-025.geojson | Rule-025 | 6 | completed | .config/geometry-only-attributes.json | .config/Rule-025.rules.json |
| Rule-026.geojson | Rule-026 | 0 | completed | .config/geometry-only-attributes.json | .config/Rule-026.rules.json |
| Rule-027.geojson | Rule-027 | 6 | completed | .config/geometry-only-attributes.json | .config/Rule-027.rules.json |
| Rule-028.geojson | Rule-028 | 6 | completed | .config/geometry-only-attributes.json | .config/Rule-028.rules.json |
| Rule-029.geojson | Rule-029 | 6 | completed | .config/geometry-only-attributes.json | .config/Rule-029.rules.json |
| Rule-030.geojson | Rule-030 | 12 | completed | .config/geometry-only-attributes.json | .config/Rule-030.rules.json |
| Rule-031.geojson | Rule-031 | 12 | completed | .config/geometry-only-attributes.json | .config/Rule-031.rules.json |
| Rule-032.geojson | Rule-032 | 0 | completed | .config/geometry-only-attributes.json | .config/Rule-032.rules.json |
| Rule-033.geojson | Rule-033 | 6 | completed | .config/geometry-only-attributes.json | .config/Rule-033.rules.json |
| Rule-034.geojson | Rule-034 | 0 | completed | .config/geometry-only-attributes.json | .config/Rule-034.rules.json |
| Rule-035.geojson | Rule-035 | 6 | completed | .config/geometry-only-attributes.json | .config/Rule-035.rules.json |
| Rule-036.geojson | Rule-036 | 0 | completed | .config/geometry-only-attributes.json | .config/Rule-036.rules.json |
| Rule-037.geojson | Rule-037 | 0 | completed | .config/geometry-only-attributes.json | .config/Rule-037.rules.json |
| Rule-038.geojson | Rule-038 | 0 | completed | .config/geometry-only-attributes.json | .config/Rule-038.rules.json |
| Rule-039.geojson | Rule-039 | 0 | completed | .config/geometry-only-attributes.json | .config/Rule-039.rules.json |
| Rule-040.geojson | Rule-040 | 6 | completed | .config/geometry-only-attributes.json | .config/Rule-040.rules.json |
| sample.geojson | General example | 2 | completed | .config/geometry-only-attributes.json | Disabled |


## Reproduce an optional-rule observation

Run from the repository root with Node.js 24+ and dependencies installed by `npm ci`.
Default `node validation/geolint/run.mjs` and `bash validation/test-all.sh` batch
inspection does not enable the optional topology configurations in this table.
The full validation command separately runs its fixed topology regression fixtures.
The standalone CLI accepts `--attribute-rules`, but has no `--topology-rules` option.

Use the existing dataset API to apply a sample's topology configuration explicitly.
This example reads the configuration for Rule-024 and asserts the six findings
recorded in the sample inventory:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInput } from './src/input/adapters.ts';
import { createEngine } from './src/engine/geos.ts';
import { inspectDataset } from './src/inspection/dataset.ts';

const file = 'Rule-024.geojson';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const manifest = await readJson('sample_data/.config/manifest.json');
const entry = manifest.entries.find(entry => entry.file === file);
assert.ok(entry?.topologyConfig, 'Select a sample with a topology configuration file');
const attributes = await readJson(`sample_data/${entry.attributeRules}`);
const topology = await readJson(`sample_data/${entry.topologyConfig}`);
const bytes = new Uint8Array(await readFile(`sample_data/${file}`));
const engine = await createEngine();
try {
  const result = await inspectDataset(parseInput(file, bytes), engine, attributes, { topology });
  const rule = result.topology.rules.find(rule => rule.ruleId === entry.ruleId);
  assert.ok(rule, 'The selected rule must execute');
  assert.equal(rule.coverage, 'complete');
  assert.equal(rule.issues.length, entry.expectedIssueCount);
  console.log(`${file}: ${rule.ruleId}; coverage=${rule.coverage}; issues=${rule.issues.length}`);
} finally {
  engine.dispose();
}
JS
```

Expected output: `Rule-024.geojson: Rule-024; coverage=complete; issues=6`.
Change `file` to another Rule-024 through Rule-040 sample to load its own configuration
and assert its recorded count. A zero count is a non-triggering control. These are
product fixture observations using the npm preview engine; they do not independently
establish QGIS parity or verify a rebuilt release candidate. For release acceptance,
run the complete release workflow described in the repository README.
