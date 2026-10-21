export function resultVerdict(summary, attributes, topology) {
  const topologyProblems = topology?.summary.issues ?? 0;
  const failures = summary.engineFailed + (attributes?.failed ?? 0) + (topology?.summary.failed ?? 0);
  const attributeProblems = attributes?.issueCount ?? 0;
  if (summary.invalid || summary.parseFailed || failures || attributes?.invalid || attributeProblems || topologyProblems || topology?.status === 'failed') {
    const counts = [
      [summary.invalid, 'invalid results'], [summary.parseFailed, 'parse failures'],
      [attributeProblems, 'attribute problems'], [topologyProblems, 'optional check problems'], [failures, 'check failures'],
    ].filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`);
    return { tone: 'error', title: 'Problems found', description: `${counts.length ? counts.join(' · ') + '.' : 'Some selected checks failed.'} ` };
  }
  const topologyIncomplete = topology?.status !== 'disabled' && topology?.rules.some(rule => rule.coverage !== 'complete' || rule.status === 'skipped');
  if (!summary.total || !summary.checked || summary.skipped || attributes?.skipped || topologyIncomplete) {
    return {
      tone: 'warning', title: 'Check incomplete',
      description: !summary.total ? 'No records were found. There is no passing result.' : 'No errors were reported, but some data or selected checks were skipped or not fully checked. Review coverage below before treating this file as valid.',
    };
  }
  return { tone: 'success', title: 'No errors found', description: `All ${summary.checked} checked results and applicable selected checks passed. This result applies to the checks enabled for this run.` };
}
