import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createEngine} from '../../src/engine/geos.ts';
import {normalizeRoot} from '../../src/geojson/normalize.ts';
import {inspectDataset} from '../../src/inspection/dataset.ts';
import {emptyAttributeRuleFile} from '../../src/attributes/config.ts';
import {topologyProbes} from '../../tests/helpers/topology-probes.mjs';
import {compareTopology} from './compare.mjs';

export const topologyFixture=new URL('../../tests/fixtures/topology/cases.json',import.meta.url);
export async function checkTopologyRegression(){
  const expected=JSON.parse(await readFile(topologyFixture,'utf8'));
  const engine=await createEngine();
  const report={status:'completed',version:engine.info.version,cases:[]};
  try{
    for(const sample of expected.cases){
      const normalized=normalizeRoot({type:'FeatureCollection',features:sample.geometries.map(geometry=>({type:'Feature',id:'duplicate',geometry,properties:{}}))});
      const {topology}=await inspectDataset(normalized,engine,emptyAttributeRuleFile(),{topology:{rules:topologyProbes.map(probe=>({id:probe.id}))},checkers:topologyProbes});
      const [equal,area]=topology.rules;
      if(equal.participantCount!==area.participantCount||equal.coverage!==area.coverage||equal.checkCount!==area.checkCount) throw new Error('Fixed topology samples have inconsistent eligibility.');
      const pairs=rule=>rule.issues.map(issue=>issue.participants.map(p=>p.featureIndex));
      report.cases.push({name:sample.name,participants:equal.participantCount,coverage:equal.coverage,comparisons:equal.checkCount,pairs:{equal:pairs(equal),area:pairs(area)},states:{equal:equal.status,area:area.status}});
    }
  }finally{engine.dispose();}
  for(const sample of expected.cases){
    const actual=report.cases.find(item=>item.name===sample.name),want=sample.expected;
    if(actual.participants!==want.participants||actual.coverage!==want.coverage||actual.comparisons!==want.comparisons) throw new Error(`${sample.name}: topology eligibility mismatch.`);
    for(const rule of ['equal','area']){
      const pairs=actual.pairs[rule].map(pair=>pair.join(':')).sort();
      if(JSON.stringify(pairs)!==JSON.stringify(want[rule].map(pair=>pair.join(':')).sort())||actual.states[rule]!== (want[rule].length?'violated':want.comparisons?'passed':'skipped')) throw new Error(`${sample.name}: topology ${rule} mismatch.`);
    }
  }
  return {cases:report.cases.length,problems:report.cases.reduce((n,item)=>n+item.pairs.equal.length+item.pairs.area.length,0),report,expected};
}
export {compareTopology};
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{const result=await checkTopologyRegression();if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result.report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(`Topology regression: matched ${result.cases} cases and ${result.problems} expected problems.`);}
  catch(error){console.error(error.message);process.exitCode=2;}
}
