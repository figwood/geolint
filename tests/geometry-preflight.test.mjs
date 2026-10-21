import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect,polygon,square } from './helpers/qgis.mjs';
import { normalizeRoot } from '../src/geojson/normalize.ts';
test('short polygon rings retain parsing failure and produce independently located node-count issues',async()=>{
  const run=await inspect([polygon([[[0,0],[1,0],[0,0]]])],'Rule-027');
  assert.equal(run.records[0].status,'parse_failed');
  assert.equal(run.records[0].reasonCode,'INVALID_RING');
  assert.equal(run.topology.rules[0].issues.length,1);
  assert.equal(run.topology.rules[0].issues[0].measurements.nodeCount,2);
  const clean=await inspect([square(),polygon([[[0,0],[1,0],[2,0],[0,0]]])],'Rule-027');
  assert.equal(clean.topology.summary.issues,0);
});
test('preflight refuses unsafe coordinates, dimensions and nesting',()=>{
  for(const coordinates of [[[[0,0],[1,0,1],[0,0]]],[[[0,0],[Infinity,1],[0,0]]],['bad']]){
    const [record]=normalizeRoot(polygon(coordinates));assert.equal(record.preflightEvidence,undefined);
  }
});
test('a finite single-node ring is safe evidence and never reaches GEOS',async()=>{
 const run=await inspect([polygon([[[0,0]]])],'Rule-027');assert.equal(run.records[0].status,'parse_failed');assert.equal(run.topology.summary.issues,1);assert.equal(run.topology.rules[0].issues[0].measurements.nodeCount,1);
});
