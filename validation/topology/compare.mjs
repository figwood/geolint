import {isDeepStrictEqual} from 'node:util';

export function compareTopology(geolint, qgis, expected) {
  const errors=[];
  if(geolint?.status!=='completed'||qgis?.status!=='completed') errors.push('Topology runners did not both complete.');
  const version=v=>typeof v==='string'?v.match(/^\d+\.\d+\.\d+/)?.[0]:undefined;
  if(version(geolint?.version)!==expected.geosVersion||version(qgis?.version)!==expected.geosVersion) errors.push('Topology GEOS versions do not match the expected version.');
  const index=(values,label)=>{
    const map=new Map();
    if(!Array.isArray(values)){errors.push(`${label}: missing cases.`);return map;}
    for(const value of values){if(!value||typeof value.name!=='string'||map.has(value.name)){errors.push(`${label}: invalid or duplicate case.`);continue;}map.set(value.name,value);}
    return map;
  };
  const left=index(geolint?.cases,'geolint'),right=index(qgis?.cases,'QGIS');
  if(left.size!==expected.cases.length||right.size!==expected.cases.length) errors.push('Topology case counts do not match the human expectations.');
  for(const sample of expected.cases){
    const a=left.get(sample.name),b=right.get(sample.name),want=sample.expected;
    if(!a||!b){errors.push(`${sample.name}: missing topology case.`);continue;}
    if(a.participants!==want.participants||b.participants!==want.participants||a.coverage!==want.coverage||b.coverage!==want.coverage
      ||a.comparisons!==want.comparisons||b.fullComparisons!==want.participants*(want.participants-1)/2) errors.push(`${sample.name}: coverage or work counts differ.`);
    for(const rule of ['equal','area']){
      const normalize=value=>{
        if(!Array.isArray(value)||value.some(pair=>!Array.isArray(pair)||pair.length!==2||!pair.every(Number.isSafeInteger)||pair[0]<0||pair[0]>=pair[1])) return null;
        return [...value].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
      };
      if(!isDeepStrictEqual(normalize(a.pairs?.[rule]),normalize(want[rule]))||!isDeepStrictEqual(normalize(b.pairs?.[rule]),normalize(want[rule]))) errors.push(`${sample.name}: ${rule} differs from human expectations.`);
      const state=want[rule].length?'violated':want.comparisons?'passed':'skipped';
      if(a.states?.[rule]!==state) errors.push(`${sample.name}: ${rule} state is incorrect.`);
    }
  }
  return {status:errors.length?'failed':'matched',errors};
}

export function compareDuplicateTopology(geolint,qgis,expected){
  const errors=[];
  const version=value=>typeof value==='string'?value.match(/^\d+\.\d+\.\d+/)?.[0]:undefined;
  if(geolint?.status!=='completed'||qgis?.status!=='completed') errors.push('Duplicate runners did not both complete.');
  if(version(geolint?.version)!==expected.geosVersion||version(qgis?.version)!==expected.geosVersion) errors.push('Duplicate GEOS versions differ.');
  const qgisVersion=typeof qgis?.qgisVersion==='string'?qgis.qgisVersion.match(/^(\d+)\.(\d+)\./):null;
  if(!qgisVersion||Number(qgisVersion[1])!==3||Number(qgisVersion[2])<40||qgis.reference!=='pyqgis-relations') errors.push('Unsupported QGIS version or reference kind.');
  const index=(values,label)=>{
    const map=new Map();
    if(!Array.isArray(values)){errors.push(`${label}: missing duplicate cases.`);return map;}
    for(const value of values){
      if(!value||typeof value.name!=='string'||map.has(value.name)){errors.push(`${label}: invalid or duplicate case.`);continue;}
      map.set(value.name,value);
    }
    if(map.size!==expected.cases.length) errors.push(`${label}: duplicate case count differs.`);
    return map;
  };
  const left=index(geolint?.cases,'geolint'),right=index(qgis?.cases,'QGIS');
  const normalized=(values,kind)=>{
    if(!Array.isArray(values)) return null;
    const seen=new Set();
    for(const item of values){
      if(!Array.isArray(item)||(kind==='pairs'?item.length!==2:item.length<2)
        ||item.some((v,i)=>!Number.isSafeInteger(v)||v<0||(i>0&&v<=item[i-1]))) return null;
      if(kind==='groups') for(const v of item){if(seen.has(v))return null;seen.add(v);}
      else {const key=item.join(':');if(seen.has(key))return null;seen.add(key);}
    }
    return [...values].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  };
  for(const sample of expected.cases){
    const a=left.get(sample.name),b=right.get(sample.name),want=sample.expected;
    if(!a||!b){errors.push(`${sample.name}: missing duplicate case.`);continue;}
    if(a.participants!==want.participants||b.participants!==want.participants||a.coverage!==want.coverage||b.coverage!==want.coverage
      ||a.comparisons!==want.comparisons||b.fullComparisons!==want.participants*(want.participants-1)/2) errors.push(`${sample.name}: eligibility or counts differ.`);
    for(const kind of ['pairs','groups']) for(const [label,actual] of [['geolint',a],['QGIS',b]]){
      if(!isDeepStrictEqual(normalized(actual[kind],kind),normalized(want[kind],kind))) errors.push(`${sample.name}: ${label} duplicate ${kind} differ from human expectations.`);
    }
    if(a.state!==(want.pairs.length?'violated':want.comparisons?'passed':'skipped')) errors.push(`${sample.name}: duplicate status differs.`);
  }
  return {status:errors.length?'failed':'matched',reference:'pyqgis-relations',qgisVersion:qgis?.qgisVersion,errors};
}
