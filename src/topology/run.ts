import { occurrenceSignature } from './occurrence.ts';
import type { GeometryEngine, InspectionRecord, NormalizedRecord } from '../contracts.ts';
import { InspectionError } from '../errors.ts';
import type { TopologyChecker, TopologyControls, TopologyOptions, TopologyParticipant, TopologyResult, TopologyRuleResult, TopologySummary } from './contracts.ts';
import { parseTopologyOptions } from './config.ts';
import { TopologyBudget } from './budget.ts';
import { candidatePairs, geometryExtent } from './index.ts';

export function topologyParticipant(record: TopologyParticipant): TopologyParticipant {
  return { recordKey: record.recordKey, featureIndex: record.featureIndex, featureId: record.featureId, featureIdType: record.featureIdType, geometryType: record.geometryType };
}
export function summarizeTopology(rules: readonly TopologyRuleResult[]): TopologySummary {
  const summary: TopologySummary = { total: rules.length, passed: 0, violated: 0, skipped: 0, failed: 0, candidates: 0, checks: 0, issues: 0 };
  for (const rule of rules) {
    summary[rule.status]++; summary.candidates += rule.candidateCount; summary.checks += rule.checkCount; summary.issues += rule.issues.length;
  }
  return summary;
}
export function resolveTopologyCheckers(options: TopologyOptions, checkers: readonly TopologyChecker[]): TopologyChecker[] {
  if (new Set(checkers.map(checker => checker.id)).size !== checkers.length) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Duplicate topology checker registration.');
  return options.rules.map(rule => {
    const checker = checkers.find(checker => checker.id === rule.id);
    if (!checker || !['bbox-intersects', 'feature', 'dataset'].includes(checker.candidateMode)) throw new InspectionError('TOPOLOGY_CONFIG_ERROR', 'Topology rule is not registered.');
    checker.parseParameters(rule.parameters);
    return checker;
  });
}
export async function runTopology(normalized: readonly NormalizedRecord[], inspected: readonly InspectionRecord[], engine: GeometryEngine, input: TopologyOptions, checkers: readonly TopologyChecker[], controls: TopologyControls = {}): Promise<TopologyResult> {
  const options = parseTopologyOptions(input, checkers);
  const selected = resolveTopologyCheckers(options, checkers);
  if (!selected.length) return { status: 'disabled', options, rules: [], summary: summarizeTopology([]) };
  if (!engine.createTopologySession) throw new InspectionError('TOPOLOGY_ENGINE_UNAVAILABLE', 'The engine cannot run topology checks.');
  const now = controls.now ?? (() => performance.now());
  const budget = new TopologyBudget(options.limits, controls.signal, now);
  const results = new Map(inspected.map(record => [record.recordKey, record]));
  if (results.size !== inspected.length || normalized.length !== inspected.length || new Set(normalized.map(r => r.featureIndex)).size !== normalized.length || new Set(normalized.map(r => r.recordKey)).size !== normalized.length) throw new InspectionError('TOPOLOGY_INPUT_ERROR', 'Dataset records are inconsistent.');
  let candidates = 0, checks = 0, lastYield = now();
  const pulse = async (phase: 'topology-preparing' | 'topology-checking', force = false) => {
    budget.checkpoint();
    if (force || now() - lastYield >= 50) {
      controls.onProgress?.({ phase, candidates, checks });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      budget.checkpoint(); lastYield = now();
    }
  };
  await pulse('topology-preparing', true);
  const plans = selected.map(checker => {
    const participants: (NormalizedRecord & { disposition: 'check' })[] = [];
    const preflightRecords: NormalizedRecord[] = [];
    const rule: TopologyRuleResult = { ruleId: checker.id, status: 'skipped', coverage: 'none', participantCount: 0, exclusions: [], candidateCount: 0, checkCount: 0, issues: [] };
    for (const record of normalized) {
      budget.checkpoint();
      const inspectedRecord = results.get(record.recordKey);
      if (!inspectedRecord || inspectedRecord.featureIndex !== record.featureIndex) throw new InspectionError('TOPOLOGY_INPUT_ERROR', 'Dataset records are inconsistent.');
      const applicable = record.geometryType === null || checker.geometryTypes.includes(record.geometryType as never);
      if (!applicable) rule.exclusions.push({ recordKey: record.recordKey, reasonCode: 'TOPOLOGY_NOT_APPLICABLE', affectsCoverage: false });
      else if (checker.inputPolicy === 'preflight' && record.disposition === 'parse_failed' && record.reasonCode === 'INVALID_RING' && record.preflightEvidence) preflightRecords.push(record);
      else if (record.disposition !== 'check' || (inspectedRecord.status !== 'valid' && !((checker.acceptsInvalid || checker.inputPolicy === 'normalized' || checker.inputPolicy === 'preflight') && inspectedRecord.status === 'invalid'))) rule.exclusions.push({ recordKey: record.recordKey, reasonCode: record.disposition !== 'check' ? record.reasonCode : inspectedRecord.reasonCode, affectsCoverage: true });
      else participants.push(record as NormalizedRecord & { disposition: 'check' });
    }
    rule.participantCount = participants.length + preflightRecords.length;
    rule.coverage = !rule.participantCount ? 'none' : rule.exclusions.some(item => item.affectsCoverage) ? 'partial' : 'complete';
    return { checker, participants, preflightRecords, rule };
  });
  const unique = new Map(plans.flatMap(plan => plan.participants.map(record => [record.recordKey, record] as const)));
  budget.reserve('features', new Set(plans.flatMap(plan => [...plan.participants,...plan.preflightRecords].map(record=>record.recordKey))).size);
  for (const record of new Map(plans.flatMap(plan => plan.preflightRecords.map(record=>[record.recordKey,record] as const))).values()) budget.reserve('positions', (record.preflightEvidence?.rings ?? []).reduce((sum,ring)=>sum+ring.nodeCount+1,0));
  const extents = new Map<string, ReturnType<typeof geometryExtent>>();
  for (const record of unique.values()) {
    const extent = geometryExtent(record.geometry);
    budget.reserve('positions', extent.positions); extents.set(record.recordKey, extent);
    await pulse('topology-preparing');
  }
  const session = engine.createTopologySession();
  try {
    for (const record of unique.values()) { budget.checkpoint(); session.add(record.recordKey, record.geometry); await pulse('topology-preparing'); }
    await pulse('topology-checking', true);
    for (const { checker, participants, preflightRecords, rule } of plans) {
      const byKey = new Map([...participants, ...preflightRecords].map(record => [record.recordKey, record]));
      const checked = () => { budget.reserve('candidates', 1); checks++; rule.checkCount++; };
      const signatures = new Set<string>();
      const emit = (finding: import('./contracts.ts').TopologyFinding, keys: readonly string[], scope?: import('./contracts.ts').TopologyScope, legacyId?: string) => {
        budget.reserve('issues', 1);
        if (new Set(keys).size !== keys.length || keys.some(key => !byKey.has(key))) throw new InspectionError('TOPOLOGY_INPUT_ERROR', 'Unknown topology issue source.');
        const signature = finding.occurrence ? JSON.stringify(finding.occurrence) : null;
        if (signature && signatures.has(signature)) throw new InspectionError('TOPOLOGY_INPUT_ERROR', 'Duplicate topology event.');
        if (signature) signatures.add(signature);
        rule.issues.push({ ...finding, ruleId: rule.ruleId, issueId: legacyId ?? (signature ? occurrenceSignature(rule.ruleId, finding.occurrence!) : `${rule.ruleId}:${rule.issues.length}`),
          scope: scope ?? (checker.candidateMode === 'feature' ? 'record' : checker.candidateMode === 'bbox-intersects' ? 'pair' : 'dataset'),
          participants: keys.map(key => topologyParticipant(byKey.get(key)!)) });
      };
      if (checker.candidateMode === 'feature') {
        for (const record of participants) {
          budget.checkpoint();
          checked(); const finding = checker.checkFeature(record);
          if (finding) emit(finding, [record.recordKey]);
          await pulse('topology-checking');
        }
      } else if (checker.candidateMode === 'dataset') {
        if (rule.participantCount) await checker.checkDataset({ records: participants, preflightRecords, parameters: options.rules.find(option => option.id === rule.ruleId)!.parameters, session, checked, emit,
          controls: { checkpoint: () => budget.checkpoint(), yield: () => pulse('topology-checking'), reservePositions: count => budget.reserve('positions', count) } });
      } else {
        const byIndex = new Map(participants.map(record => [record.featureIndex, record]));
        const entries = participants.map(record => ({ featureIndex: record.featureIndex, bbox: extents.get(record.recordKey)!.bbox }));
        for (const [leftIndex, rightIndex] of candidatePairs(entries, () => budget.checkpoint())) {
          candidates++; rule.candidateCount++;
          const left = topologyParticipant(byIndex.get(leftIndex)!), right = topologyParticipant(byIndex.get(rightIndex)!);
          checked(); const finding = checker.check(session, left, right);
          if (finding) emit(finding, [left.recordKey, right.recordKey], undefined, `${rule.ruleId}:${leftIndex}:${rightIndex}`);
          await pulse('topology-checking');
        }
      }
      rule.status = rule.issues.length ? 'violated' : rule.checkCount ? 'passed' : 'skipped';
      await pulse('topology-checking', true);
    }
    budget.checkpoint();
    const rules = plans.map(plan => plan.rule);
    return { status: 'completed', options, rules, summary: summarizeTopology(rules) };
  } finally { session.dispose(); }
}
