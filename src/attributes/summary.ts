import type { InspectionRecord } from '../contracts.ts';
import type { AttributeSummary } from './contracts.ts';
export function summarizeAttributes(records: readonly InspectionRecord[]): AttributeSummary {
  const result: AttributeSummary = { total: records.length, checked: 0, valid: 0, invalid: 0, skipped: 0, failed: 0, disabled: 0, issueCount: 0 };
  for (const record of records) {
    const attribute = record.attributeResult;
    if (!attribute || !['disabled', 'valid', 'invalid', 'skipped', 'failed'].includes(attribute.status)) throw new Error('Missing or unknown attribute result.');
    result[attribute.status]++;
    result.issueCount += attribute.issues.length + attribute.identityIssues.length;
  }
  result.checked = result.valid + result.invalid;
  return result;
}
