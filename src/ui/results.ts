import type { InspectionRecord, RecordStatus, Summary } from '../contracts.ts';
import type { AttributeSummary } from '../attributes/contracts.ts';
import type { TopologyIssue, TopologyResult } from '../topology/contracts.ts';
import { summarize } from '../inspection/summary.ts';

export function topologyNotice(result: TopologyResult): string {
  if (result.status === 'disabled') return 'Optional geometry and spatial relationship checks were not run. No optional checks are enabled.';
  if (result.status === 'failed') return 'Optional geometry and spatial relationship checks did not complete. No complete report is available.';
  const partial = result.rules.some(rule => rule.coverage !== 'complete');
  const skipped = result.rules.filter(rule => rule.status === 'skipped').length;
  return `${result.summary.issues} optional check problem(s). ${skipped} rule(s) skipped without checks.${partial ? ' Coverage is partial or unavailable; review unchecked records.' : ' All applicable records were included.'}`;
}

export type RecordFilter = RecordStatus | 'all' | 'checked' | 'issues' | 'attribute-issues' | 'attribute-invalid' | 'attribute-skipped' | 'attribute-failed' | 'attribute-checked' | 'attribute-valid' | 'attribute-disabled';
export const PAGE_SIZE = 100;
export function recordPage<T extends Pick<InspectionRecord, 'status' | 'attributeResult'>>(records: T[], filter: RecordFilter, requestedPage: number) {
  const selected = filter === 'all' ? records : records.filter(record => {
    if (filter === 'checked') return record.status === 'valid' || record.status === 'invalid';
    if (filter === 'attribute-checked') return record.attributeResult?.status === 'valid' || record.attributeResult?.status === 'invalid';
    if (filter === 'attribute-issues') return !!(record.attributeResult?.issues.length || record.attributeResult?.identityIssues.length);
    if (filter.startsWith('attribute-')) return record.attributeResult?.status === filter.slice(10);
    if (filter === 'issues') return record.status !== 'valid' || ['invalid', 'skipped', 'failed'].includes(record.attributeResult?.status ?? '');
    return record.status === filter;
  });
  const pages = Math.max(1, Math.ceil(selected.length / PAGE_SIZE));
  const page = Math.min(pages - 1, Math.max(0, Math.trunc(requestedPage) || 0));
  return { records: selected.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), total: selected.length, page, pages };
}
export function completionNotice(summary: Summary, attributes?: AttributeSummary): string {
  if (summary.total === 0) return 'No records found in this collection.';
  if (summary.checked === 0) return 'No geometries were checked. Review skipped and failed records.';
  if (attributes && (attributes.invalid || attributes.skipped || attributes.failed)) return 'Review attribute problems and unchecked attributes. Spatial and attribute results are independent.';
  if (summary.invalid || summary.skipped || summary.parseFailed || summary.engineFailed) return '';
  return `All ${summary.checked} checked geometries are valid under planar 2D GEOS rules.${attributes?.checked ? ` All ${attributes.checked} checked attribute records pass the configured rules.` : ''}`;
}

interface RecordTopologyResult {
  issues: TopologyIssue[];
  exclusions: { ruleId: string; reasonCode: string }[];
  uncheckedRuleIds: string[];
}
export function topologyRecordResults(records: readonly Pick<InspectionRecord, 'recordKey'>[], topology: TopologyResult): Map<string, RecordTopologyResult> {
  const results = new Map<string, RecordTopologyResult>(records.map(record => [record.recordKey, { issues: [], exclusions: [], uncheckedRuleIds: [] }]));
  for (const rule of topology.rules) {
    for (const issue of rule.issues) {
      for (const participant of issue.participants) results.get(participant.recordKey)?.issues.push(issue);
    }
    const excluded = new Set(rule.exclusions.map(exclusion => exclusion.recordKey));
    for (const exclusion of rule.exclusions) {
      if (exclusion.affectsCoverage === false || exclusion.reasonCode === 'TOPOLOGY_NOT_APPLICABLE') continue;
      results.get(exclusion.recordKey)?.exclusions.push({ ruleId: rule.ruleId, reasonCode: exclusion.reasonCode });
    }
    if (rule.status === 'skipped') {
      for (const [recordKey, result] of results) if (!excluded.has(recordKey)) result.uncheckedRuleIds.push(rule.ruleId);
    }
  }
  return results;
}

export interface UnifiedResult extends InspectionRecord, RecordTopologyResult {
  sourceRecord: InspectionRecord | null;
}

export function unifiedResults(run: { records: InspectionRecord[]; topology: TopologyResult }): { records: UnifiedResult[]; summary: Summary; datasetIssues: number } {
  const topology = topologyRecordResults(run.records, run.topology);
  const records: UnifiedResult[] = run.records.map(record => {
    const related = topology.get(record.recordKey)!;
    return {
      ...record, ...related, sourceRecord: record,
      status: related.issues.length ? 'invalid' : record.status,
      location: record.location ?? related.issues.find(issue => issue.location)?.location ?? null,
    };
  });
  for (const rule of run.topology.rules) {
    for (const issue of rule.issues) {
      if (issue.participants.length) continue;
      records.push({
        recordKey: issue.issueId, featureIndex: -1, featureId: null, featureIdType: 'missing',
        geometryType: issue.geometry?.type ?? null, warnings: [], status: 'invalid',
        reasonCode: issue.reasonCode, reason: issue.reason, location: issue.location,
        issues: [issue], exclusions: [], uncheckedRuleIds: [], sourceRecord: null,
      });
    }
  }
  return { records, summary: summarize(records), datasetIssues: records.length - run.records.length };
}

export function sourceRecordPage(records: readonly Pick<InspectionRecord, 'recordKey'>[], recordKey: string): number | null {
  const index = records.findIndex(record => record.recordKey === recordKey);
  return index < 0 ? null : Math.floor(index / PAGE_SIZE);
}
