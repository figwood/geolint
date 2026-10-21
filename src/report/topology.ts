import { verifyRuleOutput } from './rule-validation.ts';
import type { CompletedRunV5 } from '../contracts.ts';
import { parseTopologyOptions } from '../topology/config.ts';
import { summarizeTopology, topologyParticipant } from '../topology/run.ts';
import { coreRuleIds, ruleIdsForReason, reasonRules } from '../diagnostics.ts';
import { topologyCheckers } from '../topology/registry.ts';
import { resolveTopologyCheckers } from '../topology/run.ts';

export function verifyTopology(run: CompletedRunV5): void {
  const topology = run.topology;
  if (!topology || !['disabled', 'completed'].includes(topology.status) || !Array.isArray(topology.rules)) throw new Error('Only complete topology results can be exported.');
  const options = parseTopologyOptions(topology.options);
  resolveTopologyCheckers(options, topologyCheckers);
  if (JSON.stringify(options) !== JSON.stringify(topology.options)) throw new Error('Topology configuration is not normalized.');
  if ((topology.status === 'disabled') !== (options.rules.length === 0) || topology.rules.length !== options.rules.length) throw new Error('Topology rule count is inconsistent.');
  const records = new Map(run.records.map(record => [record.recordKey, record]));
  const ids = new Set<string>(), rules = new Set<string>(), allParticipants = new Set<string>();
  let outputPositions = 0;
  const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
  for (const rule of topology.rules) {
    if (rules.has(rule.ruleId) || !options.rules.some(item => item.id === rule.ruleId)) throw new Error('Unknown or duplicate topology rule.');
    rules.add(rule.ruleId);
    const checker = topologyCheckers.find(checker => checker.id === rule.ruleId)!;
    if (checker.outputSchema) {
      const eligible = verifyRuleOutput(rule, checker, records, options);
      for (const key of eligible) allParticipants.add(key);
      if (allParticipants.size > options.limits.features) throw new Error('Shared topology feature budget was exceeded.');
      for (const issue of rule.issues) {
        if (ids.has(issue.issueId)) throw new Error('Duplicate issue ID.');
        ids.add(issue.issueId);
        if (issue.geometry) outputPositions += verifyProblemGeometry(issue.geometry, rule.ruleId, options.limits.positions);
        if (outputPositions > options.limits.positions) throw new Error('Shared output position budget exceeded.');
      }
      continue;
    }
    const pairMode = checker.candidateMode === 'bbox-intersects';
    const scope = pairMode ? 'pair' : checker.candidateMode === 'feature' ? 'record' : 'dataset';
    if (!Array.isArray(rule.issues) || !Array.isArray(rule.exclusions) || !count(rule.participantCount) || !count(rule.candidateCount) || !count(rule.checkCount)
      || (pairMode ? rule.checkCount !== rule.candidateCount : rule.candidateCount !== 0) || (rule.ruleId !== 'Rule-017' && rule.issues.length > rule.checkCount)) throw new Error('Topology counts are inconsistent.');
    const excluded = new Set<string>();
    for (const item of rule.exclusions) {
      if (!records.has(item.recordKey) || excluded.has(item.recordKey) || typeof item.reasonCode !== 'string' || !item.reasonCode || typeof item.affectsCoverage !== 'boolean') throw new Error('Topology exclusion is inconsistent.');
      excluded.add(item.recordKey);
      const source = records.get(item.recordKey)!;
      const diagnostic = reasonRules.find(entry => entry.code === item.reasonCode);
      const applicable = source.geometryType === null || checker.geometryTypes.includes(source.geometryType as never);
      if (checker.acceptsInvalid && source.status === 'invalid' && applicable && item.reasonCode !== 'TOPOLOGY_NOT_APPLICABLE') throw new Error('Multipart inputs cannot be excluded for GEOS invalidity.');
      if (item.reasonCode === 'TOPOLOGY_NOT_APPLICABLE' ? item.affectsCoverage || applicable : !applicable || !diagnostic || !diagnostic.ruleIds.some(id => coreRuleIds.includes(id)) || item.reasonCode !== source.reasonCode || !item.affectsCoverage) throw new Error('Invalid topology exclusion diagnostic.');
    }
    if (rule.participantCount !== records.size - excluded.size || rule.participantCount > options.limits.features
      || (pairMode && rule.checkCount > rule.participantCount * (rule.participantCount - 1) / 2)
      || (checker.candidateMode === 'feature' && rule.checkCount !== rule.participantCount)
      || (!rule.participantCount && (rule.checkCount || rule.issues.length))
      || (['Rule-014', 'Rule-015'].includes(rule.ruleId) && rule.participantCount > 0 && rule.checkCount === 0)
      || (rule.ruleId === 'Rule-017' && rule.checkCount !== Number(rule.participantCount > 0))) throw new Error('Topology participant counts are inconsistent.');
    for (const record of records.values()) if (!excluded.has(record.recordKey)
      && (!checker.geometryTypes.includes(record.geometryType as never) || (record.status !== 'valid' && !(checker.acceptsInvalid && record.status === 'invalid')))) throw new Error('Unchecked geometry cannot participate in topology.');
    for (const record of records.values()) if (!excluded.has(record.recordKey)) allParticipants.add(record.recordKey);
    if (allParticipants.size > options.limits.features) throw new Error('Shared topology feature budget was exceeded.');
    const coverage = !rule.participantCount ? 'none' : rule.exclusions.some(item => item.affectsCoverage) ? 'partial' : 'complete';
    const status = rule.issues.length ? 'violated' : rule.checkCount ? 'passed' : 'skipped';
    if (rule.coverage !== coverage || rule.status !== status) throw new Error('Topology coverage or status is inconsistent.');
    const pairs = new Set<string>();
    for (const issue of rule.issues) {
      const diagnostic = ruleIdsForReason(issue.reasonCode);
      if (Object.hasOwn(issue, 'errorId') || diagnostic.length !== 1 || diagnostic[0] !== rule.ruleId || (issue.scope ?? (pairMode ? 'pair' : undefined)) !== scope) throw new Error('Invalid topology issue mapping.');
      if (typeof issue.issueId !== 'string' || !issue.issueId || ids.has(issue.issueId) || issue.ruleId !== rule.ruleId || typeof issue.reasonCode !== 'string' || !issue.reasonCode || typeof issue.reason !== 'string'
        || !Array.isArray(issue.participants)
        || (pairMode ? issue.participants.length !== 2 : rule.ruleId === 'Rule-017' ? issue.participants.length !== 0 : !issue.participants.length)
        || (rule.ruleId === 'Rule-013' || rule.ruleId === 'Rule-014') && issue.participants.length !== 1
        || rule.ruleId === 'Rule-015' && issue.participants.length > 2) throw new Error('Topology issue is inconsistent.');
      ids.add(issue.issueId);
      const participants = new Set<string>();
      for (const participant of issue.participants) {
        const record = records.get(participant.recordKey);
        if (!record || excluded.has(participant.recordKey) || participants.has(participant.recordKey)) throw new Error('Topology participant is unknown or duplicated.');
        participants.add(participant.recordKey);
        for (const key of ['recordKey', 'featureIndex', 'featureId', 'featureIdType', 'geometryType'] as const) if (participant[key] !== record[key]) throw new Error('Topology participant does not match its source.');
      }
      if (issue.location !== null && (!issue.location || !Number.isFinite(issue.location.x) || !Number.isFinite(issue.location.y))) throw new Error('Invalid topology diagnostic location.');
      const signature = pairMode || rule.ruleId === 'Rule-013' ? [...participants].sort().join('\u0000') : JSON.stringify(issue.location ? [issue.location.x, issue.location.y] : null);
      if (rule.ruleId !== 'Rule-017' && pairs.has(signature)) throw new Error('Duplicate topology issue participants.');
      pairs.add(signature);
      if (['Rule-014', 'Rule-015', 'Rule-017'].includes(rule.ruleId) && issue.location === null) throw new Error('Missing topology location.');
      if (issue.geometry !== undefined || rule.ruleId === 'Rule-017') {
        outputPositions += verifyProblemGeometry(issue.geometry, rule.ruleId, options.limits.positions);
        if (outputPositions > options.limits.positions) throw new Error('Shared topology output position budget was exceeded.');
      }
      if (issue.location !== null && (!issue.location || !Number.isFinite(issue.location.x) || !Number.isFinite(issue.location.y))) throw new Error('Invalid topology diagnostic location.');
    }
  }
  const summary = summarizeTopology(topology.rules);
  for (const key of Object.keys(summary) as (keyof typeof summary)[]) if (summary[key] !== topology.summary?.[key]) throw new Error('Topology summary does not match its rules.');
  if (summary.checks > options.limits.candidates || summary.candidates > options.limits.candidates || summary.issues > options.limits.issues) throw new Error('Topology budget was exceeded.');
}

export function projectTopology(run: CompletedRunV5) {
  verifyTopology(run);
  return {
    status: run.topology.status, options: parseTopologyOptions(run.topology.options), summary: { ...run.topology.summary },
    rules: run.topology.rules.map(rule => ({
      ruleId: rule.ruleId, status: rule.status, coverage: rule.coverage, participantCount: rule.participantCount,
      candidateCount: rule.candidateCount, checkCount: rule.checkCount,
      exclusions: rule.exclusions.map(item => ({ recordKey: item.recordKey, reasonCode: item.reasonCode, affectsCoverage: item.affectsCoverage })),
      issues: rule.issues.map(issue => ({ issueId: issue.issueId, ruleId: issue.ruleId, reasonCode: issue.reasonCode, reason: issue.reason,
        scope: issue.scope ?? 'pair', ...(issue.occurrence ? {occurrence:structuredClone(issue.occurrence)} : {}), ...(issue.measurements ? {measurements:structuredClone(issue.measurements)} : {}), ...(issue.geometry ? { geometry: structuredClone(issue.geometry) } : {}),
        location: issue.location ? { x: issue.location.x, y: issue.location.y } : null, participants: issue.participants.map(topologyParticipant) })),
    })),
  };
}

function verifyProblemGeometry(geometry: unknown, ruleId: string, limit: number): number {
  if (!['Rule-017','Rule-037','Rule-038'].includes(ruleId) || !geometry || typeof geometry !== 'object') throw new Error('Unexpected problem geometry.');
  const value = geometry as { type?: unknown; coordinates?: unknown };
  if (Object.keys(value).some(key => !['type', 'coordinates'].includes(key)) || value.type !== 'Polygon' || !Array.isArray(value.coordinates) || value.coordinates.length === 0) throw new Error('Invalid gap geometry.');
  let positions = 0;
  for (const ring of value.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4 || ring.length > limit || !ring.every(point => Array.isArray(point) && point.length === 2 && point.every(n => typeof n === 'number' && Number.isFinite(n)))
      || ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('Invalid gap ring.');
    positions += ring.length;
    if (positions > limit) throw new Error('Gap positions exceed the budget.');
  }
  return positions;
}
