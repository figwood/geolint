import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseInput} from '../../src/input/adapters.ts';
import {readAttributeRuleFile,parseAttributeRuleFile} from '../../src/attributes/config.ts';
import {inspectAttributes} from '../../src/attributes/inspect.ts';

export async function checkAttributeRegression() {
  const base = new URL('../../tests/fixtures/attributes/', import.meta.url);
  const [bytes, text, expectation] = await Promise.all([
    readFile(new URL('data.geojson',base)),readFile(new URL('rules.json',base),'utf8'),readFile(new URL('expected.json',base),'utf8'),
  ]);
  const config=readAttributeRuleFile(text), records=parseInput('data.geojson',bytes);
  const actual=records.map(record=>{
    const result=inspectAttributes(record.attributes,config.rules,record.featureIdType);
    return {featureIndex:record.featureIndex,status:result.status,issues:result.issues.map(({ruleId,configuredRuleId,field,constraint})=>({ruleId,configuredRuleId,field,constraint}))};
  });
  if(!isDeepStrictEqual(actual,JSON.parse(expectation))) throw new Error('Attribute results differ from hand-authored regression expectations.');
  const identityRules=parseAttributeRuleFile({kind:'geolint-attribute-rules',schemaVersion:'1.0',rules:[{id:'identity-probe',field:'unused'}]}).rules;
  const identityCases=[
    [{status:'available',values:{}},identityRules,'invalid',1],
    [{status:'failed',reasonCode:'INVALID_PROPERTIES',reason:'Malformed source'},identityRules,'failed',1],
    [{status:'skipped',reasonCode:'ATTRIBUTES_UNAVAILABLE',reason:'Unavailable source'},identityRules,'skipped',1],
    [{status:'failed',reasonCode:'INVALID_PROPERTIES',reason:'Malformed source'},[],'disabled',0],
  ];
  for(const [source,rules,status,count] of identityCases){
    const result=inspectAttributes(source,rules,'invalid');
    if(result.status!==status || result.identityIssues.length!==count || result.identityIssues.some(issue=>issue.ruleId!=='Rule-023'||Object.hasOwn(issue,'errorId')||issue.reasonCode!=='INVALID_FEATURE_ID'||Object.hasOwn(issue,'configuredRuleId'))) throw new Error('Feature identity results differ from hand-authored regression expectations.');
  }
  return {records:actual.length,problems:actual.reduce((n,r)=>n+r.issues.length,0),identityCases:4,identityProblems:3};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{const result=await checkAttributeRegression();console.log(`Attribute regression passed: ${result.records} records, ${result.problems} expected problems; identity cases=${result.identityCases}, problems=${result.identityProblems}.`);}
  catch(error){console.error(error.message);process.exitCode=1;}
}
