import type { AttributeRule } from './contracts.ts';

// Shared by issue creation and export validation; never includes source values.
export function attributeExpectation(rule: AttributeRule, constraint: string): string | undefined {
  if (constraint === 'required') return rule.required ? 'Field must exist' : undefined;
  if (constraint === 'allowNull') return !rule.allowNull ? 'Null is not allowed' : undefined;
  if (constraint === 'allowEmpty') return !rule.allowEmpty ? 'Empty string is not allowed' : undefined;
  if (constraint === 'type') return rule.type ? `Expected ${rule.type}` : undefined;
  const c = rule.constraints;
  if (!c || !Object.hasOwn(c, constraint)) return undefined;
  switch (constraint) {
    case 'minimum': return `Value must be >= ${c.minimum}`;
    case 'maximum': return `Value must be <= ${c.maximum}`;
    case 'exclusiveMinimum': return `Value must be > ${c.exclusiveMinimum}`;
    case 'exclusiveMaximum': return `Value must be < ${c.exclusiveMaximum}`;
    case 'enum': return `Value must be one of ${JSON.stringify(c.enum)}`;
    case 'minLength': return `Length must be >= ${c.minLength}`;
    case 'maxLength': return `Length must be <= ${c.maxLength}`;
    case 'pattern': return `Value must match ${c.pattern}`;
    default: return undefined;
  }
}
