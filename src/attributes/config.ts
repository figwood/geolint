import type { AttributeConstraints, AttributeRule, AttributeRuleFile, AttributeType } from './contracts.ts';
import { matchesType } from './values.ts';

export const MAX_RULE_FILE_BYTES = 1024 * 1024;
export class AttributeConfigError extends Error {
  readonly code = 'ATTRIBUTE_CONFIG_ERROR';
  constructor(path: string, detail: string) { super(`${path}: ${detail}`); this.name = 'AttributeConfigError'; }
}
const fail = (path: string, detail: string): never => { throw new AttributeConfigError(path, detail); };
function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Expected an object.');
  return value as Record<string, unknown>;
}
function keys(input: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(input)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'Unknown option.');
}
function bool(input: Record<string, unknown>, key: string, fallback: boolean, path: string): boolean {
  if (!Object.hasOwn(input, key)) return fallback;
  if (typeof input[key] !== 'boolean') fail(`${path}.${key}`, 'Expected a boolean.');
  return input[key] as boolean;
}
export function emptyAttributeRuleFile(): AttributeRuleFile {
  return { kind: 'geolint-attribute-rules', schemaVersion: '1.0', rules: [] };
}
export function parseAttributeRuleFile(input: unknown): AttributeRuleFile {
  const root = object(input, 'config');
  keys(root, ['kind', 'schemaVersion', 'rules'], 'config');
  if (root.kind !== 'geolint-attribute-rules' || root.schemaVersion !== '1.0') fail('config', 'Unsupported rule file kind or version.');
  if (!Array.isArray(root.rules) || root.rules.length > 500) fail('rules', 'Expected an array of at most 500 rules.');
  const ids = new Set<string>(), fields = new Set<string>();
  const rules = (root.rules as unknown[]).map((value, i): AttributeRule => {
    const path = `rules[${i}]`, raw = object(value, path);
    keys(raw, ['id', 'field', 'enabled', 'required', 'allowNull', 'allowEmpty', 'type', 'constraints'], path);
    for (const key of ['id', 'field']) {
      if (typeof raw[key] !== 'string' || !(raw[key] as string).trim() || (raw[key] as string).length > 256) fail(`${path}.${key}`, 'Expected a nonempty string up to 256 characters.');
    }
    const id = raw.id as string, field = raw.field as string;
    if (ids.has(id)) fail(`${path}.id`, 'Duplicate rule ID.');
    if (fields.has(field)) fail(`${path}.field`, 'Duplicate field configuration.');
    ids.add(id); fields.add(field);
    const rule: AttributeRule = { id, field, enabled: bool(raw, 'enabled', true, path), required: bool(raw, 'required', false, path),
      allowNull: bool(raw, 'allowNull', false, path), allowEmpty: bool(raw, 'allowEmpty', true, path) };
    if (Object.hasOwn(raw, 'type')) {
      if (!['string', 'int', 'double', 'boolean', 'date'].includes(raw.type as string)) fail(`${path}.type`, 'Unsupported field type.');
      rule.type = raw.type as AttributeType;
    }
    if (Object.hasOwn(raw, 'constraints')) {
      const cp = `${path}.constraints`, c = object(raw.constraints, cp);
      keys(c, ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'enum', 'minLength', 'maxLength', 'pattern'], cp);
      const constraints: AttributeConstraints = {};
      for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const) {
        if (!Object.hasOwn(c, key)) continue;
        if (!['int', 'double'].includes(rule.type ?? '') || typeof c[key] !== 'number' || !Number.isFinite(c[key])) fail(`${cp}.${key}`, 'Expected a finite bound on an int or double field.');
        constraints[key] = c[key] as number;
      }
      const lower = Math.max(constraints.minimum ?? -Infinity, constraints.exclusiveMinimum ?? -Infinity);
      const upper = Math.min(constraints.maximum ?? Infinity, constraints.exclusiveMaximum ?? Infinity);
      if (lower > upper || (lower === upper && (constraints.exclusiveMinimum === lower || constraints.exclusiveMaximum === upper))) fail(cp, 'Numeric bounds have no possible value.');
      if (rule.type === 'int') {
        const first = Math.max(-Number.MAX_SAFE_INTEGER, Math.ceil(lower) + (Number.isInteger(lower) && constraints.exclusiveMinimum === lower ? 1 : 0));
        const last = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(upper) - (Number.isInteger(upper) && constraints.exclusiveMaximum === upper ? 1 : 0));
        if (first > last) fail(cp, 'Numeric bounds contain no safe integer.');
      }
      for (const key of ['minLength', 'maxLength'] as const) {
        if (!Object.hasOwn(c, key)) continue;
        if (rule.type !== 'string' || typeof c[key] !== 'number' || !Number.isSafeInteger(c[key]) || (c[key] as number) < 0) fail(`${cp}.${key}`, 'Expected a nonnegative integer length on a string field.');
        constraints[key] = c[key] as number;
      }
      if ((constraints.minLength ?? 0) > (constraints.maxLength ?? Infinity)) fail(cp, 'Minimum length exceeds maximum length.');
      if (Object.hasOwn(c, 'pattern')) {
        if (rule.type !== 'string' || typeof c.pattern !== 'string' || c.pattern.length > 512) fail(`${cp}.pattern`, 'Expected a string pattern up to 512 characters on a string field.');
        try { new RegExp(c.pattern as string, 'u'); } catch { fail(`${cp}.pattern`, 'Invalid regular expression.'); }
        constraints.pattern = c.pattern as string;
      }
      if (Object.hasOwn(c, 'enum')) {
        if (!Array.isArray(c.enum) || c.enum.length === 0 || !c.enum.every(v => ['string', 'number', 'boolean'].includes(typeof v) && (typeof v !== 'number' || Number.isFinite(v)) && (!rule.type || matchesType(v, rule.type)))) fail(`${cp}.enum`, 'Expected a nonempty array of scalar values matching the field type.');
        constraints.enum = [...c.enum as (string | number | boolean)[]];
      }
      rule.constraints = constraints;
    }
    return rule;
  });
  const result: AttributeRuleFile = { kind: 'geolint-attribute-rules', schemaVersion: '1.0', rules };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_RULE_FILE_BYTES) fail('config', 'Rule file exceeds 1 MiB.');
  return result;
}
export function readAttributeRuleFile(text: string): AttributeRuleFile {
  if (new TextEncoder().encode(text).length > MAX_RULE_FILE_BYTES) fail('config', 'Rule file exceeds 1 MiB.');
  let input: unknown;
  try { input = JSON.parse(text); } catch { fail('config', 'Invalid JSON.'); }
  return parseAttributeRuleFile(input);
}
export function serializeAttributeRuleFile(config: AttributeRuleFile): string {
  const parsed = parseAttributeRuleFile(config);
  const text = JSON.stringify(parsed, null, 2) + '\n';
  // Every accepted normalized configuration fits in compact form; indentation is optional.
  return new TextEncoder().encode(text).length <= MAX_RULE_FILE_BYTES ? text : JSON.stringify(parsed);
}
