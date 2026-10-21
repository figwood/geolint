import { canonicalRuleId } from '../rule-identifiers.ts';
import { InspectionError } from '../errors.ts';
import { topologyCheckers } from './registry.ts';
import { noParameters } from './checkers/parameters.ts';
import type { TopologyChecker, TopologyLimits, TopologyOptions } from './contracts.ts';

// Work counts include per-vertex checks across all selected rules, not just pairs.
// Keep explicit lower budgets available without imposing a fixed default work cap.
export const TOPOLOGY_LIMITS: Readonly<TopologyLimits> = Object.freeze({ features: 20000, positions: 500000, candidates: Number.MAX_SAFE_INTEGER, issues: 10000, durationMs: 30000 });
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Expected a topology configuration object.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Unknown topology configuration field.');
}
export function parseTopologyOptions(value: unknown = {}, checkers: readonly TopologyChecker[] = topologyCheckers): TopologyOptions {
  const input = object(value); keys(input, ['rules', 'limits']);
  const limits = { ...TOPOLOGY_LIMITS };
  if (input.limits !== undefined) {
    const supplied = object(input.limits); keys(supplied, Object.keys(limits));
    for (const name of Object.keys(supplied) as (keyof TopologyLimits)[]) {
      const number = supplied[name];
      if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0 || number > limits[name]) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Topology limits must be positive integers within the product limits.');
      limits[name] = number;
    }
  }
  const rules = input.rules ?? [];
  if (!Array.isArray(rules) || rules.length > 100) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Expected at most 100 topology rules.');
  const ids = new Set<string>();
  return { limits, rules: rules.map(value => {
    const rule = object(value); keys(rule, ['id', 'parameters']);
    if (typeof rule.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(rule.id)) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Topology rule IDs must be unique identifiers.');
    const id = canonicalRuleId(rule.id);
    if (ids.has(id)) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Topology rule IDs must be unique after resolving aliases.');
    ids.add(id);
    const checker = checkers.find(checker => checker.id === id);
    const parameters = (checker?.parseParameters ?? noParameters)(object(rule.parameters ?? {}));
    return { id, parameters: structuredClone(parameters) };
  }) };
}
