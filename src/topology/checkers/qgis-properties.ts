import { qgisChecker, emitQgis } from './qgis-common.ts';
export const degeneratePolygonChecker = qgisChecker('Rule-027', async context => {
  for (const record of context.preflightRecords) for (const ring of record.preflightEvidence?.rings ?? []) {
    context.checked();
    if (ring.nodeCount < 3) emitQgis(context, 'Rule-027', [{recordKey:record.recordKey, part:ring.part, ring:ring.ring}], ring.first, {nodeCount:ring.nodeCount});
    await context.controls.yield();
  }
  // Safely normalized polygon rings already satisfy this necessary condition.
  for (const record of context.records) { context.checked(); await context.controls.yield(); }
}, 'preflight');

import { firstPosition, geometryParts, polygonCentroid } from '../geometry-parts.ts';
export const propertyCheckers = [degeneratePolygonChecker,
  qgisChecker('Rule-028', async context => {
    for(const record of context.records)for(const part of geometryParts(record.geometry)){
      context.checked();
      if(part.ring>0)emitQgis(context,'Rule-028',[{recordKey:record.recordKey,part:part.part,ring:part.ring}],polygonCentroid([[...part.positions,part.positions[0]!]]));
      await context.controls.yield();
    }
  }),
  qgisChecker('Rule-029',async context=>{
    for(const record of context.records){
      context.checked();const geometry=record.geometry;
      if(geometry.type!=='GeometryCollection' && geometry.coordinates.length===1)emitQgis(context,'Rule-029',[{recordKey:record.recordKey}],context.session.centroid?.(record.recordKey) ?? firstPosition(geometry),{partCount:1});
      await context.controls.yield();
    }
  }),
  qgisChecker('Rule-040',async context=>{
    for(const record of context.records){
      context.checked();
      if(!(context.parameters.allowedTypes as readonly string[]).includes(record.geometry.type))emitQgis(context,'Rule-040',[{recordKey:record.recordKey}],firstPosition(record.geometry));
      await context.controls.yield();
    }
  }),
];
