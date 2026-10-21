import type { CompletedRun } from '../contracts.ts';
import { coreRuleIds, ruleIdsForReason, reasonRules, selectedRuleIds } from '../diagnostics.ts';
import { parseAttributeRuleFile } from '../attributes/config.ts';
import { attributeExpectation } from '../attributes/expectation.ts';

export function verifyRecords(run: CompletedRun): void {
  const config = parseAttributeRuleFile(run.attributeRules);
  if (JSON.stringify(config) !== JSON.stringify(run.attributeRules)) throw new Error('Attribute configuration is not normalized.');
  const enabled = config.rules.some(rule => rule.enabled);
  const selection = selectedRuleIds(enabled, run.topology.options.rules.map(rule => rule.id));
  if (!run.ruleSelection || JSON.stringify(selection) !== JSON.stringify(run.ruleSelection)) throw new Error('Rule selection does not match execution.');
  if (run.summary.engineFailed !== 0) throw new Error('Engine failures cannot be exported as a completed report.');
  if (new Set(run.records.map(record => record.recordKey)).size !== run.records.length) throw new Error('Report record keys must be unique.');
  for (const record of run.records) {
    const identityMatches = record.featureIdType === 'string' ? typeof record.featureId === 'string'
      : record.featureIdType === 'number' ? typeof record.featureId === 'number' && Number.isFinite(record.featureId)
      : ['missing', 'invalid'].includes(record.featureIdType) && record.featureId === null;
    if (!identityMatches || !Number.isSafeInteger(record.featureIndex) || record.featureIndex < 0 || record.recordKey !== `feature:${record.featureIndex}`) throw new Error('Invalid record identity metadata.');
    const diagnostic = reasonRules.find(entry => entry.code === record.reasonCode);
    if (record.status === 'valid' ? record.reasonCode !== 'VALID' : !diagnostic || !diagnostic.ruleIds.some(id => coreRuleIds.includes(id)) || diagnostic.status !== record.status) throw new Error('Record status and diagnostic are inconsistent.');
    if (!Array.isArray(record.warnings) || record.warnings.length) throw new Error('Unknown or obsolete record warnings.');
    const result = record.attributeResult;
    if (!result || !Array.isArray(result.issues) || !Array.isArray(result.identityIssues)) throw new Error('Missing attribute result arrays.');
    if (enabled === (result.status === 'disabled')) throw new Error('Attribute execution does not match selection.');
    const needsIdentity = enabled && record.featureIdType === 'invalid';
    if (result.identityIssues.length !== Number(needsIdentity)) throw new Error('Feature identity issues do not match source metadata.');
    for (const issue of result.identityIssues) {
      if (issue.ruleId !== 'Rule-023' || issue.reasonCode !== 'INVALID_FEATURE_ID' || typeof issue.reason !== 'string' || !issue.reason
        || Object.keys(issue).some(key => !['ruleId', 'reasonCode', 'reason'].includes(key))) throw new Error('Invalid feature identity issue.');
    }
    const sourceUnavailable = result.status === 'failed' || result.status === 'skipped';
    if (sourceUnavailable) {
      const source = reasonRules.find(entry => entry.code === result.reasonCode);
      if (!source || !source.ruleIds.includes('Rule-021') || source.status !== result.status || typeof result.reason !== 'string' || result.issues.length) throw new Error('Invalid attribute source diagnostic.');
    } else {
      if (result.reasonCode !== undefined || result.reason !== undefined) throw new Error('Unexpected attribute diagnostic.');
      if ((result.status === 'invalid') !== (result.issues.length + result.identityIssues.length > 0)) throw new Error('Attribute status does not match its issues.');
    }
    for (const issue of result.issues) {
      const configured = config.rules.find(rule => rule.id === issue.configuredRuleId);
      const ids = ruleIdsForReason(issue.reasonCode);
      if (!configured?.enabled || configured.field !== issue.field || !['Rule-018', 'Rule-019', 'Rule-020'].includes(issue.ruleId)
        || Object.hasOwn(issue, 'errorId') || ids.length !== 1 || ids[0] !== issue.ruleId
        || typeof issue.constraint !== 'string' || typeof issue.expected !== 'string' || typeof issue.reason !== 'string') throw new Error('Attribute issue does not match its configured rule.');
      const selectedConstraint = issue.ruleId === 'Rule-018'
        ? (issue.constraint === 'required' && configured.required) || (issue.constraint === 'allowNull' && !configured.allowNull) || (issue.constraint === 'allowEmpty' && !configured.allowEmpty)
        : issue.ruleId === 'Rule-019' ? issue.constraint === 'type' && configured.type !== undefined
        : configured.constraints !== undefined && Object.hasOwn(configured.constraints, issue.constraint);
      if (!selectedConstraint) throw new Error('Attribute issue claims an unconfigured constraint.');
      if (attributeExpectation(configured, issue.constraint) !== issue.expected) throw new Error('Attribute expectation does not match its configured constraint.');
    }
  }
}
