import type { CompletedRun, InspectionRecord } from '../contracts.ts';
import { checkRules, ruleIdsForReason } from '../diagnostics.ts';
import { summarize } from '../inspection/summary.ts';
import { summarizeAttributes } from '../attributes/summary.ts';
import { parseAttributeRuleFile } from '../attributes/config.ts';
import { projectTopology, verifyTopology } from './topology.ts';
import type { TopologyParticipant } from '../topology/contracts.ts';
import { verifyRecords } from './records.ts';

interface ReportIssue {
  recordKey: string | null; featureIndex: number | null; featureId: string | number | null;
  featureIdType: string; geometryType: string | null; status: string; attributeStatus: string;
  ruleIds: string[];
  reasonCode: string; reason: string; location: { x: number; y: number } | null;
  configuredRuleId?: string; field?: string; constraint?: string; expected?: string;
  scope?: string; geometry?: import('../contracts.ts').PolygonalGeometry;
  occurrence?: import('../topology/contracts.ts').Occurrence; measurements?: import('../topology/contracts.ts').Measurements;
  issueId?: string; participants?: TopologyParticipant[];
}
function verify(run: CompletedRun): void {
  if (run.run.status !== 'completed' || run.schemaVersion !== '5.0') throw new Error('Only complete version 5.0 reports can be exported.');
  verifyTopology(run);
  verifyRecords(run);
  const actual = summarize(run.records), attributes = summarizeAttributes(run.records);
  for (const key of Object.keys(actual) as (keyof typeof actual)[]) {
    if (actual[key] !== run.summary[key]) throw new Error('Report summary does not match its records.');
  }
  for (const key of Object.keys(attributes) as (keyof typeof attributes)[]) {
    if (attributes[key] !== run.attributeSummary[key]) throw new Error('Attribute summary does not match its records.');
  }
}
function reference(record: InspectionRecord) {
  // Explicit projection keeps original input properties and geometry out of reports.
  return { recordKey: record.recordKey, featureIndex: record.featureIndex, featureId: record.featureId,
    featureIdType: record.featureIdType, geometryType: record.geometryType, status: record.status,
    attributeStatus: record.attributeResult!.status };
}
export function projectReportIssues(run: CompletedRun): ReportIssue[] {
  verify(run);
  const issues: ReportIssue[] = [];
  for (const record of run.records) {
    const ref = reference(record);
    if (record.status !== 'valid') issues.push({ ...ref, ruleIds: ruleIdsForReason(record.reasonCode),
      reasonCode: record.reasonCode, reason: record.reason, location: record.location });
    const attribute = record.attributeResult!;
    for (const issue of attribute.issues) issues.push({ ...ref, ruleIds: [issue.ruleId],
      configuredRuleId: issue.configuredRuleId, field: issue.field, constraint: issue.constraint, expected: issue.expected,
      reasonCode: issue.reasonCode, reason: issue.reason, location: null });
    for (const issue of attribute.identityIssues) issues.push({ ...ref, ruleIds: [issue.ruleId],
      reasonCode: issue.reasonCode, reason: issue.reason, location: null });
    if (attribute.status === 'failed' || attribute.status === 'skipped') issues.push({ ...ref,
      ruleIds: ruleIdsForReason(attribute.reasonCode ?? ''), reasonCode: attribute.reasonCode ?? 'ATTRIBUTES_UNAVAILABLE',
      reason: attribute.reason ?? 'Attributes were not checked.', location: null });
  }
  for (const rule of projectTopology(run).rules) for (const issue of rule.issues) {
    issues.push({ recordKey: null, featureIndex: null, featureId: null, featureIdType: '', geometryType: null,
      status: 'violated', attributeStatus: '', ruleIds: [issue.ruleId],
      reasonCode: issue.reasonCode, reason: issue.reason, location: issue.location, issueId: issue.issueId, scope: issue.scope, ...(issue.occurrence ? {occurrence:issue.occurrence} : {}), ...(issue.measurements ? {measurements:issue.measurements} : {}), ...(issue.geometry ? { geometry: issue.geometry } : {}), participants: issue.participants });
  }
  return issues;
}
export function buildJsonReport(run: CompletedRun): string {
  const issues = projectReportIssues(run);
  const selected = new Set([...run.ruleSelection.required, ...run.ruleSelection.optional]);
  const attributeRules = parseAttributeRuleFile(run.attributeRules);
  return JSON.stringify({ run: run.run, engine: { parameters: run.engine.parameters }, summary: run.summary,
    ruleSelection: run.ruleSelection, ruleCatalog: checkRules.filter(rule => selected.has(rule.id)),
    attributeSummary: run.attributeSummary, attributeRules: { kind: attributeRules.kind, rules: attributeRules.rules },
    topology: projectTopology(run), issues }, null, 2);
}
const columns = ['issue_id','check_parameters','record_key','feature_index','feature_id','feature_id_type','geometry_type','status','rule_ids','reason_code','reason','error_x','error_y','attribute_status','configured_rule_id','field','constraint','expected'];
function cell(value: string | number | null | undefined): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && (/^[\x00-\x1f\x7f]/.test(text) || /^\s*[=+\-@]/.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function buildCsvReport(run: CompletedRun): string {
  const reportColumns = [...columns, 'participants', 'scope', 'issue_geometry', 'rule_names', 'rule_families', 'occurrence', 'measurements'];
  const rows = projectReportIssues(run).map(record => [
    record.issueId, JSON.stringify({...run.engine.parameters,optionalRules:run.topology.options.rules}), record.recordKey,
    record.featureIndex, record.featureId, record.featureIdType, record.geometryType,
    record.status, JSON.stringify(record.ruleIds), record.reasonCode, record.reason, record.location?.x, record.location?.y,
    record.attributeStatus, record.configuredRuleId, record.field, record.constraint, record.expected,
    record.participants ? JSON.stringify(record.participants) : '', record.scope, record.geometry ? JSON.stringify(record.geometry) : '',
    JSON.stringify(record.ruleIds.map(id => checkRules.find(rule => rule.id === id)!.title)),
    JSON.stringify(record.ruleIds.map(id => checkRules.find(rule => rule.id === id)!.family)),
    record.occurrence ? JSON.stringify(record.occurrence) : '', record.measurements ? JSON.stringify(record.measurements) : '',
  ]);
  return [reportColumns.join(','), ...rows.map(row => row.map(cell).join(','))].join('\r\n') + '\r\n';
}
