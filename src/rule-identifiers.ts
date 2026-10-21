// Exact aliases for the previous catalog. Never infer a rule from its prefix.
// Values are permanent: append new rules, never renumber or reuse identifiers.
export const legacyRuleIds: Readonly<Record<string, string>> = Object.freeze({
  'GR-001': 'Rule-001',
  'GR-002': 'Rule-002',
  'GR-003': 'Rule-003',
  'GR-004': 'Rule-004',
  'SR-001': 'Rule-005',
  'SR-002': 'Rule-006',
  'SR-003': 'Rule-007',
  'SR-004': 'Rule-008',
  'SR-005': 'Rule-009',
  'SR-006': 'Rule-010',
  'SR-007': 'Rule-011',
  'TR-001': 'Rule-012',
  'TR-002': 'Rule-013',
  'TR-003': 'Rule-014',
  'TR-004': 'Rule-015',
  'TR-005': 'Rule-016',
  'TR-006': 'Rule-017',
  'AR-001': 'Rule-018',
  'AR-002': 'Rule-019',
  'AR-003': 'Rule-020',
  'AR-004': 'Rule-021',
  'AR-005': 'Rule-022',
  'AR-006': 'Rule-023',
 });
export function canonicalRuleId(id: string): string {
  return Object.hasOwn(legacyRuleIds, id) ? legacyRuleIds[id]! : id;
}
