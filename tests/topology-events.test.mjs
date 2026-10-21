import test from 'node:test';
import assert from 'node:assert/strict';
import { runTopology } from '../src/topology/run.ts';
import { parseTopologyOptions } from '../src/topology/config.ts';

const normalized=[{recordKey:'feature:0',featureIndex:0,featureId:null,featureIdType:'missing',geometryType:'LineString',warnings:[],disposition:'check',geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}}];
const inspected=normalized.map(r=>({...r,status:'valid',reasonCode:'VALID'}));
const checker={id:'events',geometryTypes:['LineString'],candidateMode:'dataset',parseParameters(value){return {threshold:value.threshold??1};},async checkDataset(context){
  for(let part=0;part<2;part++)context.emit({reasonCode:'EVENT',reason:'event',location:{x:0,y:0},occurrence:{sources:[{recordKey:'feature:0',part}]},measurements:{threshold:context.parameters.threshold}},['feature:0'],'record');
}};
test('dataset checks bind normalized parameters and retain distinct events at the same location',async()=>{
  const engine={createTopologySession:()=>({add(){},dispose(){}})};
  const options=parseTopologyOptions({rules:[{id:'events'}]},[checker]);
  assert.deepEqual(options.rules[0].parameters,{threshold:1});
  const result=await runTopology(normalized,inspected,engine,options,[checker]);
  assert.equal(result.rules[0].issues.length,2);
  assert.notEqual(result.rules[0].issues[0].issueId,result.rules[0].issues[1].issueId);
  assert.equal(result.rules[0].issues[0].scope,'record');
});
test('duplicate event signatures are rejected',async()=>{
  const duplicate={...checker,async checkDataset(c){const f={reasonCode:'EVENT',reason:'event',location:null,occurrence:{sources:[{recordKey:'feature:0',part:0}]}};c.emit(f,['feature:0'],'record');c.emit(f,['feature:0'],'record');}};
  await assert.rejects(runTopology(normalized,inspected,{createTopologySession:()=>({add(){},dispose(){}})},parseTopologyOptions({rules:[{id:'events'}]},[duplicate]),[duplicate]),/Duplicate/);
});
