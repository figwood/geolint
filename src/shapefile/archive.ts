import { Inflate } from 'fflate';
import { InspectionError } from '../errors.ts';

interface Entry { name: string; size: number; compressed: number; offset: number; method: number; crc: number }
const invalid = () => new InspectionError('INVALID_ARCHIVE', 'ZIP is corrupt, encrypted, split, ZIP64, or uses unsupported compression.');
const tooLarge = () => new InspectionError('ARCHIVE_TOO_LARGE', 'ZIP contains more than 1,024 entries.');

function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function extractShapefileBundle(bytes: Uint8Array): { shp: Uint8Array; dbf?: Uint8Array; cpg?: Uint8Array } {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Require the central directory so truncated archives never become completed runs.
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) {
      if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
    }
    if (end < Math.max(0, bytes.length - 65557)) throw invalid();
    const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true);
    let offset = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
      || view.getUint16(end + 8, true) !== count || offset + directorySize !== end) throw invalid();
    if (count > 1024) throw tooLarge();
    const directoryStart = offset;
    const entries: Entry[] = [], names = new Set<string>();
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw invalid();
      const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
      const compressed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true);
      const next = offset + 46 + nameLength + extraLength + view.getUint16(offset + 32, true);
      const local = view.getUint32(offset + 42, true);
      if (next > end || !nameLength || (flags & 0x41) || (method !== 0 && method !== 8)
        || view.getUint16(offset + 34, true) || size === 0xffffffff || compressed === 0xffffffff || local >= directoryStart) throw invalid();
      const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
      const name = new TextDecoder().decode(nameBytes).replaceAll('\\', '/');
      if (names.has(name.toLowerCase())) throw invalid();
      names.add(name.toLowerCase());
      if (local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50
        || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method
        || view.getUint16(local + 26, true) !== nameLength) throw invalid();
      const dataOffset = local + 30 + nameLength + view.getUint16(local + 28, true);
      if (dataOffset + compressed > directoryStart
        || !nameBytes.every((byte, j) => byte === bytes[local + 30 + j])) throw invalid();
      const crc = view.getUint32(offset + 16, true);
      if (!(flags & 8)) {
        if (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressed
          || view.getUint32(local + 22, true) !== size) throw invalid();
      } else {
        let descriptor = dataOffset + compressed;
        if (descriptor + 12 > directoryStart) throw invalid();
        if (view.getUint32(descriptor, true) === 0x08074b50) descriptor += 4;
        if (descriptor + 12 > directoryStart || view.getUint32(descriptor, true) !== crc
          || view.getUint32(descriptor + 4, true) !== compressed || view.getUint32(descriptor + 8, true) !== size) throw invalid();
      }
      entries.push({name, size, compressed, offset:dataOffset, method, crc});
      offset = next;
    }
    if (offset !== end) throw invalid();
    const layers = entries.filter(entry => /\.shp$/i.test(entry.name) && !entry.name.startsWith('__MACOSX/')
      && !entry.name.split('/').at(-1)!.startsWith('._'));
    if (!layers.length) throw new InspectionError('MISSING_SHAPEFILE', 'ZIP must contain one .shp layer.');
    if (layers.length !== 1) throw new InspectionError('MULTIPLE_SHAPEFILES', 'ZIP contains multiple .shp layers. Create a ZIP with just one layer.');
    let shp: Uint8Array | undefined, dbf: Uint8Array | undefined, cpg: Uint8Array | undefined;
    const stem = layers[0]!.name.slice(0, -4).toLowerCase();
    // Validate all content, retaining the selected geometry and matching attributes.
    for (const entry of entries) {
      const input = bytes.subarray(entry.offset, entry.offset + entry.compressed);
      const output = new Uint8Array(entry.size);
      if (entry.method === 0) {
        if (input.length !== output.length) throw invalid();
        output.set(input);
      } else {
        let written = 0, finished = false;
        const inflater = new Inflate((chunk, final) => {
          if (written + chunk.length > entry.size) throw invalid();
          output.set(chunk, written); written += chunk.length; finished = final;
        });
        // Small compressed chunks bound transient expansion even when the declared size lies.
        for (let i = 0; i < input.length; i += 256) inflater.push(input.subarray(i, i + 256), i + 256 >= input.length);
        if (!finished || written !== entry.size) throw invalid();
      }
      if (checksum(output) !== entry.crc) throw invalid();
      if (entry === layers[0]) shp = output;
      if (entry.name.toLowerCase() === `${stem}.dbf`) dbf = output;
      if (entry.name.toLowerCase() === `${stem}.cpg`) cpg = output;
    }
    return { shp: shp!, ...(dbf ? { dbf } : {}), ...(cpg ? { cpg } : {}) };
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    throw invalid();
  }
}
export function extractShapefile(bytes: Uint8Array): Uint8Array {
  return extractShapefileBundle(bytes).shp;
}
