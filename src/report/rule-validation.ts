import type { InspectionRecord } from '../contracts.ts';
import type { TopologyRuleResult,TopologyChecker,TopologyOptions } from '../topology/contracts.ts';
import { ruleIdsForReason } from '../diagnostics.ts';
import { occurrenceSignature } from '../topology/occurrence.ts';
export function verifyRuleOutput(rule:TopologyRuleResult,checker:TopologyChecker,records:ReadonlyMap<string,InspectionRecord>,options:TopologyOptions):Set<string>{
  const fail=():never=>{throw new Error('Invalid optional rule output.');};
  const schema=checker.outputSchema!,parameters=options.rules.find(item=>item.id===rule.ruleId)!.parameters;
  const eligible=new Set<string>(),excluded=new Set<string>();
  const count=(n:number)=>Number.isSafeInteger(n)&&n>=0;
  if(!Array.isArray(rule.issues)||!Array.isArray(rule.exclusions)||![rule.checkCount,rule.candidateCount,rule.participantCount].every(count)||rule.candidateCount!==0)fail();
  const qualifies=(record:InspectionRecord)=>record.status==='valid'||((checker.inputPolicy==='normalized'||checker.inputPolicy==='preflight')&&record.status==='invalid')||(checker.inputPolicy==='preflight'&&record.status==='parse_failed'&&record.reasonCode==='INVALID_RING'&&record.preflightEvidence?.kind==='polygon-rings');
  for(const item of rule.exclusions){
    const record=records.get(item.recordKey);if(!record||excluded.has(item.recordKey))fail();excluded.add(item.recordKey);
    const applicable=record!.geometryType===null||checker.geometryTypes.includes(record!.geometryType as never);
    if(item.reasonCode==='TOPOLOGY_NOT_APPLICABLE'?applicable||item.affectsCoverage:!applicable||qualifies(record!)||item.reasonCode!==record!.reasonCode||!item.affectsCoverage)fail();
  }
  for(const record of records.values())if(!excluded.has(record.recordKey)){
    if(!checker.geometryTypes.includes(record.geometryType as never)||!qualifies(record))fail();eligible.add(record.recordKey);
  }
  const coverage=!eligible.size?'none':rule.exclusions.some(item=>item.affectsCoverage)?'partial':'complete';
  if(rule.participantCount!==eligible.size||rule.coverage!==coverage||(!eligible.size&&(rule.checkCount||rule.issues.length))||(eligible.size>0&&rule.checkCount===0)||(rule.issues.length&&!rule.checkCount)||rule.status!==(rule.issues.length?'violated':rule.checkCount?'passed':'skipped'))fail();
  const signatures=new Set<string>();
  for(const issue of rule.issues){
    if(Object.hasOwn(issue,'errorId')||issue.ruleId!==rule.ruleId||ruleIdsForReason(issue.reasonCode).join()!==rule.ruleId||typeof issue.reason!=='string'||!issue.reason||!issue.scope||!schema.scopes.includes(issue.scope)||typeof issue.issueId!=='string')fail();
    if(!Array.isArray(issue.participants)||issue.participants.length<schema.participants.min||(schema.participants.max!==null&&issue.participants.length>schema.participants.max))fail();
    const keys=new Set<string>();
    for(const participant of issue.participants){
      const record=records.get(participant.recordKey);if(!record||!eligible.has(participant.recordKey)||keys.has(participant.recordKey))fail();keys.add(participant.recordKey);
      for(const key of ['recordKey','featureIndex','featureId','featureIdType','geometryType'] as const)if(participant[key]!==record![key])fail();
    }
    if(issue.location!==null){if(!issue.location||Object.keys(issue.location).some(key=>key!=='x'&&key!=='y')||!Number.isFinite(issue.location.x)||!Number.isFinite(issue.location.y))fail();}else if(schema.location==='required')fail();
    if(schema.geometry==='forbidden'&&issue.geometry!==undefined||schema.geometry==='required'&&!issue.geometry)fail();
    const occurrence=issue.occurrence;
    if(!occurrence||!Array.isArray(occurrence.sources)||Object.keys(occurrence).some(key=>!['sources','region'].includes(key))||(occurrence.region!==undefined&&!count(occurrence.region)))fail();
    const sourceKeys=new Set<string>();
    for(const source of occurrence!.sources){
      if(!source||typeof source!=='object'||!keys.has(source.recordKey)||Object.keys(source).some(key=>!['recordKey','part','ring','vertex','segment'].includes(key)))fail();sourceKeys.add(source.recordKey);
      const record=records.get(source.recordKey)!;
      for(const key of ['part','ring','vertex','segment'] as const)if(source[key]!==undefined&&!count(source[key]!))fail();
      if(source.part!==undefined){
        const shape=record.geometryShape?.parts[source.part];
        const evidence=record.preflightEvidence?.rings.filter(r=>r.part===source.part);
        if(!shape&&!evidence?.length)fail();
        const n=shape?.rings[source.ring??0]??evidence?.find(r=>r.ring===(source.ring??0))?.nodeCount;
        if(n===undefined||source.vertex!==undefined&&source.vertex>=n||source.segment!==undefined&&source.segment>=n-1)fail();
      }else if(source.ring!==undefined||source.vertex!==undefined||source.segment!==undefined)fail();
    }
    if([...keys].join()!==[...sourceKeys].join())fail();
    const signature=occurrenceSignature(rule.ruleId,occurrence!);
    if(signatures.has(signature)||issue.issueId!==signature)fail();signatures.add(signature);
    const values=issue.measurements??{};
    if(Object.keys(values).length!==schema.measurementKeys.length||Object.keys(values).some(key=>!schema.measurementKeys.includes(key)))fail();
    for(const [key,value] of Object.entries(values))if(typeof value!=='number'||!Number.isFinite(value)||value<0||typeof parameters[key]==='number'&&parameters[key]!==value)fail();
    if(rule.ruleId==='Rule-027'){
      const source=occurrence!.sources[0]!,evidence=records.get(source.recordKey)!.preflightEvidence?.rings.find(r=>r.part===source.part&&r.ring===source.ring);
      if(!evidence||values.nodeCount!==evidence.nodeCount||values.nodeCount!>=3)fail();
    }
    schema.validate?.(issue,records,parameters);
  }
  return eligible;
}
