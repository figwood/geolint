import test from 'node:test';import assert from 'node:assert/strict';
import {createGeosTopologySession} from '../src/engine/topology.ts';
const polygon={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
test('new overlay objects and precision clones are released after output allocation failure',async()=>{
 let next=10,allocate=true;const owned=new Set();const released=[];
 const make=()=>{const p=++next;owned.add(p);return p;};
 const geos={Module:{_malloc:()=>allocate?8:0,_free(){},stringToUTF8(){}},GEOSGeoJSONReader_create:()=>1,GEOSGeoJSONReader_destroy(){},GEOSGeoJSONReader_readGeometry:make,GEOSGeom_destroy(p){assert.ok(owned.delete(p));released.push(p);},GEOSEquals:()=>1,GEOSRelatePattern:()=>1,GEOSIntersection:make};
 const s=createGeosTopologySession(geos);s.add('a',polygon);s.add('b',polygon);s.qgisEquals('a','b',8);assert.equal(owned.size,4);allocate=false;
 await assert.rejects(s.polygonIntersections('a','b',8,{checkpoint(){},reservePositions(){},async yield(){}}),{code:'ENGINE_FATAL_ERROR'});assert.equal(owned.size,4);
 s.dispose();assert.equal(owned.size,0);assert.equal(released.length,5);
});
