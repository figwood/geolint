const parseParameters=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length) throw new Error('Probe parameters must be empty.');
  return {};
};
const participantTypes=['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'];
export const topologyProbes=[
  {id:'probe-equals',geometryTypes:participantTypes,candidateMode:'bbox-intersects',parseParameters,
    check:(session,a,b)=>session.equals(a.recordKey,b.recordKey)?{reasonCode:'PROBE_EQUAL',reason:'Topologically equal geometries.',location:null}:null},
  {id:'probe-area',geometryTypes:['Polygon','MultiPolygon'],candidateMode:'bbox-intersects',parseParameters,
    check:(session,a,b)=>session.relatePattern(a.recordKey,b.recordKey,'2********')?{reasonCode:'PROBE_AREA_INTERSECTION',reason:'Polygon interiors share an area.',location:null}:null},
];
