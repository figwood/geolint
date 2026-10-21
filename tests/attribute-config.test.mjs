import { test } from 'node:test';
import assert from 'node:assert/strict';
const module = () => import('../src/attributes/config.ts');
const config = rules => ({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules});
test('configuration round trip preserves rules and fills defaults', async () => {
  const {parseAttributeRuleFile,readAttributeRuleFile,serializeAttributeRuleFile}=await module();
  const input=config([{id:'pid',field:'PID',required:true},{id:'area',field:'geo_area',type:'double',enabled:false,constraints:{exclusiveMinimum:0}}]);
  const parsed=parseAttributeRuleFile(input);
  assert.equal(parsed.rules[0].allowNull,false); assert.equal(parsed.rules[0].allowEmpty,true);
  assert.deepEqual(readAttributeRuleFile(serializeAttributeRuleFile(parsed)),parsed);
  assert.equal(parsed.rules[1].enabled,false); assert.equal(input.rules[0].enabled,undefined);
});
test('bad configuration is rejected with a rule path instead of silently accepting constraints',async()=>{
  const {parseAttributeRuleFile}=await module();
  for(const rule of [
    {id:'a',field:'x',typo:true},{id:'a',field:'x',type:'integer'},
    {id:'a',field:'x',type:'double',constraints:{minimum:3,maximum:2}},
    {id:'a',field:'x',type:'double',constraints:{minimum:0,maximum:0,exclusiveMinimum:0}},
    {id:'a',field:'x',type:'int',constraints:{minimum:0.1,maximum:0.9}},
    {id:'a',field:'x',type:'double',constraints:{pattern:'x'}},
    {id:'a',field:'x',type:'string',constraints:{pattern:'['}},
    {id:'a',field:'x',type:'int',constraints:{enum:['1']}},
    {id:'a',field:'x',type:'string',constraints:{minLength:2,maxLength:1}},
    {id:'a',field:'x',type:'string',constraints:{pattern:'a'.repeat(513)}},
    {id:'a',field:'x'.repeat(257)}
  ]) assert.throws(()=>parseAttributeRuleFile(config([rule])), /rules\[0\]/);
  for(const bad of [config([{id:'a',field:'x'},{id:'a',field:'y'}]),config([{id:'a',field:'x'},{id:'b',field:'x'}]),{...config([]),schemaVersion:'9'},config(Array.from({length:501},(_,i)=>({id:String(i),field:String(i)})))]) assert.throws(()=>parseAttributeRuleFile(bad));
});
test('file input enforces byte size and rejects invalid JSON',async()=>{
  const {readAttributeRuleFile,parseAttributeRuleFile}=await module();
  assert.throws(()=>readAttributeRuleFile('{'),/JSON/);
  assert.throws(()=>readAttributeRuleFile(' '.repeat(1024*1024+1)),/1 MiB/);
  assert.equal(parseAttributeRuleFile(config(Array.from({length:500},(_,i)=>({id:String(i),field:String(i)})))).rules.length,500);
});
test('accepted compact configurations remain exportable when indentation would exceed the size limit',async()=>{
  const {readAttributeRuleFile,serializeAttributeRuleFile}=await module();
  const input=config([{id:'a',field:'x',type:'boolean',constraints:{enum:Array(80000).fill(true)}}]);
  const parsed=readAttributeRuleFile(JSON.stringify(input));
  const exported=serializeAttributeRuleFile(parsed);
  assert.ok(Buffer.byteLength(exported)<=1024*1024);
  assert.equal(readAttributeRuleFile(exported).rules[0].constraints.enum.length,80000);
});
