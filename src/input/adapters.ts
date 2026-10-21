import type { NormalizedRecord } from '../contracts.ts';
import { assertFileSize } from '../config.ts';
import { InspectionError } from '../errors.ts';
import { normalizeRoot } from '../geojson/normalize.ts';
import { extractShapefileBundle } from '../shapefile/archive.ts';
import { parseDbf } from '../shapefile/dbf.ts';
import { parseShapefile } from '../shapefile/parse.ts';

interface InputAdapter {
  extensions: readonly string[];
  parse(bytes: Uint8Array): NormalizedRecord[];
}

function parseGeoJson(bytes: Uint8Array): NormalizedRecord[] {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new InspectionError('READ_ERROR', 'Could not read this file as UTF-8.'); }
  let root: unknown;
  try { root = JSON.parse(text); }
  catch { throw new InspectionError('INVALID_JSON', 'The file is not valid JSON.'); }
  return normalizeRoot(root);
}

// Register new readers here; inspection and batch preparation do not select formats.
const adapters: readonly InputAdapter[] = [
  { extensions: ['.geojson', '.json'], parse: parseGeoJson },
  { extensions: ['.shp'], parse: bytes => parseShapefile(bytes).map(record => ({ ...record, attributes: {
    status: 'skipped', reasonCode: 'ATTRIBUTES_UNAVAILABLE', reason: 'Upload a Shapefile ZIP with a matching DBF to inspect attributes.',
  } })) },
  { extensions: ['.zip'], parse: bytes => {
    const bundle = extractShapefileBundle(bytes), records = parseShapefile(bundle.shp);
    const attributes = bundle.dbf ? parseDbf(bundle.dbf, records.length, bundle.cpg) : undefined;
    return records.map((record, index) => ({ ...record, attributes: attributes?.[index] ?? {
      status: 'skipped', reasonCode: 'ATTRIBUTES_UNAVAILABLE', reason: 'ZIP has no matching DBF attribute file.',
    } }));
  } },
];

function adapterFor(fileName: string): InputAdapter | undefined {
  const name = fileName.toLowerCase();
  return adapters.find(adapter => adapter.extensions.some(extension => name.endsWith(extension)));
}

export function supportsInput(fileName: string): boolean {
  return adapterFor(fileName) !== undefined;
}

export function parseInput(fileName: string, bytes: Uint8Array): NormalizedRecord[] {
  assertFileSize(bytes.byteLength);
  const adapter = adapterFor(fileName);
  if (!adapter) throw new InspectionError('UNSUPPORTED_FORMAT', 'Choose a GeoJSON (.geojson or .json), Shapefile (.shp), or Shapefile ZIP (.zip) file.');
  return adapter.parse(bytes);
}
