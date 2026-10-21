import type { AttributeIssue, AttributeResult, AttributeRule, AttributeSource, IdentityIssue } from './contracts.ts';
import { matchesType } from './values.ts';
import { attributeExpectation } from './expectation.ts';

const patterns = new WeakMap<AttributeRule, RegExp>();
export function inspectAttributes(source: AttributeSource | undefined, rules: readonly AttributeRule[], featureIdType?: string): AttributeResult {
  const enabled = rules.filter(rule => rule.enabled);
  if (!enabled.length) return { status: 'disabled', issues: [], identityIssues: [] };
  const identityIssues: IdentityIssue[] = featureIdType === 'invalid' ? [{ ruleId: 'Rule-023', reasonCode: 'INVALID_FEATURE_ID', reason: 'Feature ID is neither a finite number nor a string. The source index identifies this record.' }] : [];
  if (!source) return { status: 'skipped', issues: [], identityIssues, reasonCode: 'ATTRIBUTES_UNAVAILABLE', reason: 'No attribute source is available.' };
  if (source.status !== 'available') return { status: source.status, issues: [], identityIssues, reasonCode: source.reasonCode, reason: source.reason };
  const issues: AttributeIssue[] = [];
  for (const rule of enabled) {
    const add = (category: 1 | 2 | 3, constraint: string) => {
      const expected = attributeExpectation(rule, constraint)!;
      issues.push({ ruleId: ({1: 'Rule-018', 2: 'Rule-019', 3: 'Rule-020'} as const)[category], configuredRuleId: rule.id, field: rule.field, constraint,
        reasonCode: ['ATTRIBUTE_MISSING', 'ATTRIBUTE_TYPE', 'ATTRIBUTE_VALUE'][category - 1]!, expected,
        reason: `Field ${rule.field}: ${expected}.` });
    };
    if (!Object.hasOwn(source.values, rule.field)) {
      if (rule.required) add(1, 'required');
      continue;
    }
    const value = source.values[rule.field];
    if (value === null) {
      if (!rule.allowNull) add(1, 'allowNull');
      continue;
    }
    if (value === '' && !rule.allowEmpty) { add(1, 'allowEmpty'); continue; }
    if (rule.type && !matchesType(value, rule.type)) { add(2, 'type'); continue; }
    const c = rule.constraints;
    if (!c) continue;
    if (typeof value === 'number') {
      if (c.minimum !== undefined && value < c.minimum) add(3, 'minimum');
      if (c.maximum !== undefined && value > c.maximum) add(3, 'maximum');
      if (c.exclusiveMinimum !== undefined && value <= c.exclusiveMinimum) add(3, 'exclusiveMinimum');
      if (c.exclusiveMaximum !== undefined && value >= c.exclusiveMaximum) add(3, 'exclusiveMaximum');
    }
    if (c.enum && !c.enum.some(item => item === value)) add(3, 'enum');
    if (typeof value === 'string') {
      const length = [...value].length;
      if (c.minLength !== undefined && length < c.minLength) add(3, 'minLength');
      if (c.maxLength !== undefined && length > c.maxLength) add(3, 'maxLength');
      if (c.pattern !== undefined) {
        let regex = patterns.get(rule);
        if (!regex) { regex = new RegExp(c.pattern, 'u'); patterns.set(rule, regex); }
        if (!regex.test(value)) add(3, 'pattern');
      }
    }
  }
  return { status: issues.length || identityIssues.length ? 'invalid' : 'valid', issues, identityIssues };
}
