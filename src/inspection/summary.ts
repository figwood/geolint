import type { InspectionRecord, Summary } from '../contracts.ts';
export function summarize(records: InspectionRecord[]): Summary {
  const result: Summary = { total: records.length, checked: 0, valid: 0, invalid: 0, skipped: 0, parseFailed: 0, engineFailed: 0 };
  for (const record of records) {
    switch (record.status) {
      case 'valid': result.valid++; break;
      case 'invalid': result.invalid++; break;
      case 'skipped': result.skipped++; break;
      case 'parse_failed': result.parseFailed++; break;
      case 'engine_failed': result.engineFailed++; break;
      default: throw new Error('Unknown record status.');
    }
  }
  result.checked = result.valid + result.invalid;
  return result;
}
