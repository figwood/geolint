import {createEngine} from '../../src/engine/geos.ts';
import {normalizeRoot} from '../../src/geojson/normalize.ts';
import {inspectDataset} from '../../src/inspection/dataset.ts';
import {emptyAttributeRuleFile} from '../../src/attributes/config.ts';
export const line=(coordinates)=>({type:'LineString',coordinates});
export const polygon=(rings)=>({type:'Polygon',coordinates:rings});
export async function inspect(geometries,ids,controls={}) {
  const engine=await createEngine();
  try {
    const normalized=normalizeRoot({type:'FeatureCollection',features:geometries.map(geometry=>({type:'Feature',id:'same',geometry,properties:{secret:'private'}}))});
    const result=await inspectDataset(normalized,engine,emptyAttributeRuleFile(),{...controls,topology:{rules:ids.map(id=>({id})),...controls.topology}});
    return {schemaVersion:'5.0',run:{fileName:'test.geojson',fileBytes:100,completedAt:'2026-10-12T00:00:00Z',status:'completed'},engine:engine.info,attributeRules:emptyAttributeRuleFile(),...result};
  } finally {engine.dispose();}
}
