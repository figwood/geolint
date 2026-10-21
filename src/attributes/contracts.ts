export type AttributeType = 'string' | 'int' | 'double' | 'boolean' | 'date';
export interface AttributeConstraints {
  minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number;
  enum?: (string | number | boolean)[];
  minLength?: number; maxLength?: number; pattern?: string;
}
export interface AttributeRule {
  id: string; field: string; enabled: boolean; required: boolean; allowNull: boolean; allowEmpty: boolean;
  type?: AttributeType; constraints?: AttributeConstraints;
}
export interface AttributeRuleFile {
  kind: 'geolint-attribute-rules'; schemaVersion: '1.0'; rules: AttributeRule[];
}
export type AttributeSource = { status: 'available'; values: Record<string, unknown> }
  | { status: 'skipped' | 'failed'; reasonCode: string; reason: string };
export interface AttributeIssue {
  ruleId: 'Rule-018' | 'Rule-019' | 'Rule-020';
  configuredRuleId: string; field: string; constraint: string; reasonCode: string;
  expected: string; reason: string;
}
export interface AttributeResult {
  status: 'disabled' | 'valid' | 'invalid' | 'skipped' | 'failed'; issues: AttributeIssue[];
  identityIssues: IdentityIssue[];
  reasonCode?: string; reason?: string;
}
export interface IdentityIssue {
  ruleId: 'Rule-023'; reasonCode: 'INVALID_FEATURE_ID'; reason: string;
}
export interface AttributeSummary {
  total: number; checked: number; valid: number; invalid: number; skipped: number;
  failed: number; disabled: number; issueCount: number;
}
