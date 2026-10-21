import { test } from 'node:test';
import assert from 'node:assert/strict';
async function check(values,rules,sourceStatus='available') {
  const {inspectAttributes}=await import('../src/attributes/inspect.ts');
  const {parseAttributeRuleFile}=await import('../src/attributes/config.ts');
  return inspectAttributes(sourceStatus==='available'?{status:'available',values}:{status:sourceStatus,reasonCode:'NO_SOURCE',reason:'No attributes'},parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules}).rules);
}
test('collects missing, type and content problems on the same feature without leaking values',async()=>{
  const result=await check({geo_type:'PRIVATE_VALUE',geo_area:0},[{id:'pid',field:'PID',required:true},{id:'type',field:'geo_type',type:'int'},{id:'area',field:'geo_area',type:'double',constraints:{exclusiveMinimum:0}}]);
  assert.equal(result.status,'invalid');
  assert.deepEqual(result.issues.map(i=>[i.ruleId,i.configuredRuleId,i.field]),[['Rule-018','pid','PID'],['Rule-019','type','geo_type'],['Rule-020','area','geo_area']]);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_VALUE'));
});
test('missing, null and empty are distinct and optional missing fields skip later checks',async()=>{
  for(const [values,rule,want] of [[{}, {type:'int'},'valid'],[{}, {required:true},'invalid'],[{x:null},{allowNull:true,type:'int'},'valid'],[{x:null},{},'invalid'],[{x:''},{allowEmpty:false},'invalid'],[{x:''},{type:'string'},'valid'],[{x:''},{type:'int'},'invalid'],[{x:' '},{allowEmpty:false,type:'string'},'valid']]) assert.equal((await check(values,[{id:'a',field:'x',...rule}])).status,want);
});
test('strict types, numeric boundaries, Unicode lengths and calendar dates',async()=>{
  for(const [value,type,want] of [[1,'double','valid'],[1.5,'int','invalid'],[Number.MAX_SAFE_INTEGER+1,'int','invalid'],['1','double','invalid'],[true,'boolean','valid'],['true','boolean','invalid'],['2024-02-29','date','valid'],['2023-02-29','date','invalid'],['2024-04-31','date','invalid'],['0000-01-01','date','invalid']]) assert.equal((await check({x:value},[{id:'a',field:'x',type}])).status,want);
  assert.equal((await check({x:'😀'},[{id:'a',field:'x',type:'string',constraints:{minLength:1,maxLength:1}}])).status,'valid');
  assert.equal((await check({x:2},[{id:'a',field:'x',type:'int',constraints:{minimum:2,maximum:2,enum:[2]}}])).status,'valid');
});
test('all content constraints run but a type error does not cascade',async()=>{
  const rule={id:'a',field:'x',type:'string',constraints:{minLength:4,pattern:'^A',enum:['ABCD']}};
  assert.equal((await check({x:'b'},[rule])).issues.length,3);
  const result=await check({x:1},[rule]); assert.equal(result.issues.length,1); assert.equal(result.issues[0].ruleId,'Rule-019');
});
test('top-level own keys are checked literally and input is not mutated',async()=>{
  const values=JSON.parse('{"__proto__":3,"constructor":4,"a.b":5}');
  assert.equal((await check(values,[{id:'a',field:'__proto__',type:'int'},{id:'b',field:'constructor',type:'int'},{id:'c',field:'a.b',type:'int'}])).status,'valid');
  assert.equal((await check({},[{id:'a',field:'constructor',required:true}])).status,'invalid');
  assert.equal(values['a.b'],5);
});
test('unavailable attributes are never valid and disabled rules do not demand a source',async()=>{
  assert.equal((await check({},[{id:'a',field:'x',required:true}],'skipped')).status,'skipped');
  assert.equal((await check({},[{id:'a',field:'x'}],'failed')).status,'failed');
  assert.equal((await check({},[{id:'a',field:'x',enabled:false}],'failed')).status,'disabled');
});
