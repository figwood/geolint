import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAttributeRuleFile} from '../src/attributes/config.ts';
test('invalid numeric-control text stays invalid instead of deleting a bound',async()=>{
  const {numberConstraint}=await import('../src/ui/attribute-input.ts');
  assert.equal(numberConstraint('',false),undefined);
  assert.equal(numberConstraint('10',false),10);
  const invalid=numberConstraint('',true);
  assert.ok(Number.isNaN(invalid));
  assert.throws(()=>parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'a',field:'x',type:'int',constraints:{minimum:invalid}}]}),/minimum/);
});
