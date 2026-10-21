import type { AttributeSource } from '../attributes/contracts.ts';
import { validDate } from '../attributes/values.ts';

interface Field { name: string; type: string; length: number }
class DbfError extends Error {
  readonly code: string;
  constructor(code: string, reason: string) { super(reason); this.code = code; }
}
const bad = (reason: string): never => { throw new DbfError('INVALID_DBF', reason); };
function encoding(bytes: Uint8Array, cpg?: Uint8Array): string {
  let label: string | undefined;
  if (cpg) {
    try { label = new TextDecoder('utf-8', { fatal: true }).decode(cpg).trim().toLowerCase(); }
    catch { throw new DbfError('DBF_ENCODING_ERROR', 'CPG must be readable UTF-8 text.'); }
    const aliases: Record<string, string> = { 'utf-8': 'utf-8', utf8: 'utf-8', '65001': 'utf-8', ascii: 'ascii', 'us-ascii': 'ascii',
      'windows-1252': 'windows-1252', cp1252: 'windows-1252', '1252': 'windows-1252', gbk: 'gbk', cp936: 'gbk', '936': 'gbk' };
    if (!Object.hasOwn(aliases, label)) throw new DbfError('DBF_ENCODING_ERROR', 'CPG encoding is not supported.');
    return aliases[label]!;
  }
  const drivers: Record<number, string> = { 0x03: 'windows-1252', 0x57: 'windows-1252', 0x4d: 'gbk', 0x7a: 'gbk' };
  return drivers[bytes[29]!] ?? 'ascii';
}
export function parseDbf(bytes: Uint8Array, recordCount: number, cpg?: Uint8Array): AttributeSource[] {
  try {
    if (bytes.length < 33 || ![0x03, 0x83].includes(bytes[0]!)) bad('Unsupported or truncated DBF header.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(4, true), header = view.getUint16(8, true), length = view.getUint16(10, true);
    if (count !== recordCount) bad('DBF and SHP record counts do not match.');
    const end = header + count * length;
    if (header < 33 || (header - 33) % 32 || header > bytes.length || bytes[header - 1] !== 13 || !length
      || (bytes.length !== end && !(bytes.length === end + 1 && bytes[end] === 26))) bad('DBF header, lengths or record boundaries are invalid.');
    const label = encoding(bytes, cpg);
    let decoder: TextDecoder;
    try { decoder = new TextDecoder(label === 'ascii' ? 'utf-8' : label, { fatal: true }); }
    catch { throw new DbfError('DBF_ENCODING_ERROR', 'This runtime cannot decode the DBF encoding.'); }
    const decode = (value: Uint8Array): string => {
      if (label === 'ascii' && value.some(byte => byte > 127)) throw new DbfError('DBF_ENCODING_ERROR', 'Non-ASCII DBF text needs a supported CPG or encoding marker.');
      try { return decoder.decode(value); } catch { throw new DbfError('DBF_ENCODING_ERROR', 'DBF text could not be decoded.'); }
    };
    const fields: Field[] = [], names = new Set<string>();
    let expectedLength = 1;
    for (let offset = 32; offset < header - 1; offset += 32) {
      const rawName = bytes.subarray(offset, offset + 11), zero = rawName.indexOf(0);
      if (zero < 1) bad('DBF field names must be nonempty and terminated.');
      const name = decode(rawName.subarray(0, zero)), type = String.fromCharCode(bytes[offset + 11]!), fieldLength = bytes[offset + 16]!;
      if (names.has(name) || !fieldLength || bytes[offset + 17]! >= fieldLength) bad('DBF field descriptors are invalid or duplicated.');
      if (!['C', 'N', 'F', 'L', 'D'].includes(type)) throw new DbfError('UNSUPPORTED_DBF_FIELD', 'DBF contains a field type outside C/N/F/L/D.');
      if ((type === 'L' && fieldLength !== 1) || (type === 'D' && fieldLength !== 8)) bad('DBF logical or date field length is invalid.');
      names.add(name); fields.push({ name, type, length: fieldLength }); expectedLength += fieldLength;
    }
    if (expectedLength !== length) bad('DBF field lengths do not match record length.');
    const result: AttributeSource[] = [];
    for (let i = 0; i < count; i++) {
      let offset = header + i * length;
      const marker = bytes[offset++]!;
      if (marker !== 32 && marker !== 42) bad('DBF deletion marker is invalid.');
      if (marker === 42) { result.push({ status: 'skipped', reasonCode: 'DBF_DELETED_RECORD', reason: 'DBF record is marked deleted; source indexes are preserved.' }); continue; }
      const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const field of fields) {
        const raw = bytes.subarray(offset, offset + field.length); offset += field.length;
        const text = decode(raw);
        let value: string | number | boolean | null;
        if (field.type === 'C') value = text.replace(/ +$/, '');
        else {
          const content = text.trim();
          if (!content || (field.type === 'L' && content === '?')) value = null;
          else if (field.type === 'N' || field.type === 'F') {
            if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(content) || !Number.isFinite(Number(content))) bad('DBF numeric value is malformed or nonfinite.');
            value = Number(content);
          } else if (field.type === 'L') {
            if (!/^[YNTF]$/i.test(content)) bad('DBF logical value is malformed.');
            value = /^[YT]$/i.test(content);
          } else {
            value = `${content.slice(0, 4)}-${content.slice(4, 6)}-${content.slice(6)}`;
            if (!/^\d{8}$/.test(content) || !validDate(value)) bad('DBF date value is malformed.');
          }
        }
        values[field.name] = value;
      }
      result.push({ status: 'available', values });
    }
    return result;
  } catch (error) {
    const code = error instanceof DbfError ? error.code : 'INVALID_DBF';
    const reason = error instanceof DbfError ? error.message : 'DBF could not be parsed.';
    return Array.from({ length: recordCount }, () => ({ status: 'failed', reasonCode: code, reason }));
  }
}
