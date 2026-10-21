import {readFile} from 'node:fs/promises';
import {createEngine} from '../../src/engine/geos.ts';
import {normalizeRoot} from '../../src/geojson/normalize.ts';
import {inspectDataset} from '../../src/inspection/dataset.ts';
import {emptyAttributeRuleFile} from '../../src/attributes/config.ts';

export const duplicateFixture=new URL('../../tests/fixtures/topology/duplicates.json',import.meta.url);
export function duplicateGroups(pairs){
  const components=[];
  for(const [left,right] of pairs){
    const matches=components.filter(group=>group.has(left)||group.has(right));
    const merged=new Set([left,right,...matches.flatMap(group=>[...group])]);
    for(const group of matches) components.splice(components.indexOf(group),1);
    components.push(merged);
  }
  return components.map(group=>[...group].sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]);
}
export async function checkDuplicateRegression(){
  const expected=JSON.parse(await readFile(duplicateFixture,'utf8'));
  const engine=await createEngine();
  const report={status:'completed',version:engine.info.version,ruleId:'Rule-012',cases:[]};
  try{
    for(const sample of expected.cases){
      const records=normalizeRoot({type:'FeatureCollection',features:sample.geometries.map(geometry=>({type:'Feature',id:'duplicate-id',geometry,properties:{}}))});
      const result=await inspectDataset(records,engine,emptyAttributeRuleFile(),{topology:{rules:[{id:report.ruleId}]}});
      const rule=result.topology.rules[0];
      const pairs=rule.issues.map(issue=>issue.participants.map(p=>p.featureIndex)).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      report.cases.push({name:sample.name,participants:rule.participantCount,coverage:rule.coverage,comparisons:rule.checkCount,pairs,groups:duplicateGroups(pairs),state:rule.status});
    }
  }finally{engine.dispose();}
  // Compare with independent, literal human expectations before invoking QGIS.
  for(const sample of expected.cases){
    const actual=report.cases.find(c=>c.name===sample.name),want=sample.expected;
    if(actual.participants!==want.participants||actual.coverage!==want.coverage||actual.comparisons!==want.comparisons
      ||JSON.stringify(actual.pairs)!==JSON.stringify(want.pairs)||JSON.stringify(actual.groups)!==JSON.stringify(want.groups)
      ||actual.state!==(want.pairs.length?'violated':want.comparisons?'passed':'skipped')) throw new Error(`${sample.name}: duplicate geometry regression differs from human expectations.`);
  }
  return {report,expected,cases:report.cases.length,problems:report.cases.reduce((n,c)=>n+c.pairs.length,0)};
}
