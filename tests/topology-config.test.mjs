import test from 'node:test';
import assert from 'node:assert/strict';

test('topology options snapshot defaults and reject unsafe limits and unsupported parameters', async () => {
  const {parseTopologyOptions} = await import('../src/topology/config.ts');
  const defaults = parseTopologyOptions();
  assert.deepEqual(defaults.rules, []);
  assert.deepEqual(defaults.limits, {features:20000,positions:500000,candidates:Number.MAX_SAFE_INTEGER,issues:10000,durationMs:30000});
  for (const key of Object.keys(defaults.limits)) {
    assert.equal(parseTopologyOptions({limits:{[key]:1}}).limits[key],1);
    for (const value of [0,-1,1.5,NaN,Infinity,defaults.limits[key]+1]) assert.throws(()=>parseTopologyOptions({limits:{[key]:value}}));
  }
  for(const value of [{other:true},{rules:[{id:'x',parameters:{tolerance:1}}]},{rules:[{id:'x'},{id:'x'}]},{limits:{bytes:1}},{rules:[{id:'x',enabled:true}]}]) assert.throws(()=>parseTopologyOptions(value));
  const input={rules:[{id:'x'}],limits:{issues:2}};
  const config=parseTopologyOptions(input); input.rules[0].id='changed';
  assert.equal(config.rules[0].id,'x');
});

test('default work budget accepts cumulative checks above the former 200000 ceiling', async () => {
  const {TopologyBudget} = await import('../src/topology/budget.ts');
  const {parseTopologyOptions} = await import('../src/topology/config.ts');
  const budget = new TopologyBudget(parseTopologyOptions().limits);
  budget.reserve('candidates', 200000);
  assert.doesNotThrow(() => budget.reserve('candidates', 200001));
  assert.equal(parseTopologyOptions({limits:{candidates:400001}}).limits.candidates, 400001);
});

test('budget enforces cumulative work boundaries, time and abort independently', async () => {
  const {TopologyBudget}=await import('../src/topology/budget.ts');
  const {parseTopologyOptions}=await import('../src/topology/config.ts');
  let now=0; const signal=new AbortController();
  const budget=new TopologyBudget(parseTopologyOptions({limits:{candidates:2,durationMs:10}}).limits,signal.signal,()=>now);
  budget.reserve('candidates',2);
  assert.throws(()=>budget.reserve('candidates',1),{code:'TOPOLOGY_LIMIT_EXCEEDED'});
  now=10; assert.throws(()=>budget.checkpoint(),{code:'TOPOLOGY_TIMEOUT'});
  now=0; signal.abort(); assert.throws(()=>budget.checkpoint(),{code:'TOPOLOGY_CANCELLED'});
});
