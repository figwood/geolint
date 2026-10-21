import { createEngine } from '../../src/engine/geos.ts';
import { runInspection } from '../../src/inspection/run.ts';

// Exercise the production per-vertex rule and terminal run state with real WASM.
export async function checkTopologyWorkBudgetRegression() {
  const count = 200001;
  const geometry = { type: 'LineString', coordinates: Array.from({ length: count }, (_, i) => [i, i]) };
  const file = new File([JSON.stringify(geometry)], 'topology-work-budget.geojson');
  const run = async limits => {
    let terminal;
    await runInspection(file, 'work-budget', message => {
      if (message.type !== 'progress') terminal = message;
    }, createEngine, undefined, { rules: [{ id: 'Rule-025' }], ...(limits ? { limits } : {}) });
    return terminal;
  };
  const completed = await run();
  const rule = completed?.result?.topology.rules[0];
  if (completed?.type !== 'completed' || rule?.checkCount !== count || rule.coverage !== 'complete' || rule.status !== 'passed') {
    throw new Error(`Topology work regression did not complete all ${count} checks: ${completed?.code ?? completed?.type}.`);
  }
  const limited = await run({ candidates: 200000 });
  if (limited?.type !== 'failed' || limited.code !== 'TOPOLOGY_LIMIT_EXCEEDED' || limited.summary !== null) {
    throw new Error('Explicit topology work limits must still reject incomplete runs.');
  }
  return { checks: count, explicitLimit: 'enforced' };
}
