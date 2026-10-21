import { normalizeRoot } from '../../src/geojson/normalize.ts';
import { inspectDataset } from '../../src/inspection/dataset.ts';
import { emptyAttributeRuleFile } from '../../src/attributes/config.ts';
import { createEngine } from '../../src/engine/geos.ts';
export const line = coordinates => ({type:'LineString',coordinates});
export const polygon = coordinates => ({type:'Polygon',coordinates});
export const square = (x=0,y=0,size=4) => polygon([[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]]);
export async function inspect(geometries, id, parameters={}, controls={}) {
  const normalized=normalizeRoot({type:'FeatureCollection',features:geometries.map(geometry=>({type:'Feature',id:'same',properties:{},geometry}))});
  const engine=await createEngine();
  try {
    const result=await inspectDataset(normalized,engine,emptyAttributeRuleFile(),{...controls,topology:{rules:[{id,parameters}],...controls.topology}});
    return {...result, schemaVersion:'5.0', attributeRules:emptyAttributeRuleFile(), engine:engine.info,run:{fileName:'test.geojson',fileBytes:100,completedAt:new Date().toISOString(),status:'completed'}};
  } finally {engine.dispose();}
}
