import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoot } from '../src/geojson/normalize.ts';
import { assertFileSize } from '../src/config.ts';

export const polygon = { type: 'Polygon', coordinates: [[[0,0],[4,0],[4,4],[0,4],[0,0]]] };
const feature = (geometry = polygon, id) => ({ type: 'Feature', geometry, properties: {}, ...(id === undefined ? {} : { id }) });
const fc = features => ({ type: 'FeatureCollection', features });
const one = geometry => normalizeRoot(feature(geometry))[0];

test('accepts Polygon, MultiPolygon, Feature and FeatureCollection without changing input', () => {
  const input = structuredClone(polygon);
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } };
  freeze(input);
  assert.equal(normalizeRoot(input)[0].disposition, 'check');
  assert.deepEqual(input, polygon);
  assert.equal(one({ type: 'MultiPolygon', coordinates: [polygon.coordinates] }).disposition, 'check');
  assert.equal(normalizeRoot(feature())[0].recordKey, 'feature:0');
  assert.deepEqual(normalizeRoot(fc([])), []);
});
test('bad feature is isolated, indexes remain stable and ID types do not collide', () => {
  const records = normalizeRoot(fc([feature(polygon,1),false,feature(polygon,'1'),feature(polygon,'café'),feature(polygon,1),feature(polygon,{bad:1}),feature()]));
  assert.deepEqual(records.map(r=>r.disposition), ['check','parse_failed','check','check','check','check','check']);
  assert.deepEqual(records.map(r=>r.recordKey), Array.from({length:7},(_,i)=>`feature:${i}`));
  assert.equal(records[0].featureIdType, 'number');
  assert.equal(records[2].featureIdType, 'string');
  assert.equal(records[3].featureId, 'café');
  assert.equal(records[5].featureIdType, 'invalid');
  assert.equal(records[5].featureId, null);
  assert.equal(records[5].warnings.length,0);
  assert.equal(records[6].featureIdType,'missing');
});
for (const geometry of [null,{type:'Polygon',coordinates:[]},{type:'MultiPolygon',coordinates:[]},{type:'GeometryCollection',geometries:[]},...['Point','MultiPoint','LineString','MultiLineString'].map(type=>({type,coordinates:[]}))]) {
  test(`skips ${JSON.stringify(geometry)} instead of calling it valid`,()=>assert.equal(one(geometry).disposition,'skipped'));
}
test('rejects malformed roots', () => {
  for (const input of [null,[],{},fc(null),{type:'Unknown'}]) {
    assert.throws(()=>normalizeRoot(input),e=>e.code==='INVALID_ROOT');
  }
});
test('accepts legacy CRS metadata at every structural level without changing coordinates or input', () => {
  const crs = { type: 'name', properties: { name: 'EPSG:3857' } };
  const geometry = { type: 'Point', coordinates: [500000, 3000000] };
  const input = { type: 'FeatureCollection', crs, features: [{
    type: 'Feature', id: 'projected', crs,
    properties: { crs: 'attribute value' },
    geometry: { type: 'GeometryCollection', crs, geometries: [{ ...geometry, crs }] },
  }] };
  const original = structuredClone(input);
  const record = normalizeRoot(input)[0];
  assert.equal(record.disposition, 'check');
  assert.deepEqual(record.geometry, { type: 'GeometryCollection', geometries: [geometry] });
  assert.equal(record.attributes.values.crs, 'attribute value');
  assert.deepEqual(input, original);
  assert.deepEqual(normalizeRoot({ ...polygon, crs: null })[0].geometry, polygon);
});
test('checks all structure before rejecting unsupported dimensions', () => {
  const z={type:'Polygon',coordinates:[[[0,0,1],[4,0,1],[4,4,1],[0,0,1]]]};
  assert.equal(one(z).reasonCode,'UNSUPPORTED_DIMENSION');
  assert.equal(one({type:'Polygon',coordinates:[[[0,0,1],[4,0],[4,4,1],[0,0,1]]]}).disposition,'parse_failed');
  assert.equal(one({type:'MultiPolygon',coordinates:[z.coordinates,[[[0,0,1],['bad',0,1],[4,4,1],[0,0,1]]]]}).disposition,'parse_failed');
});
for (const coordinates of [[[]],[[[0,0],[1,1],[0,0]]],[[[0,0],[1,0],[1,1],[0,1]]],[[[0,0],[Infinity,0],[1,1],[0,0]]],[[[0,0],['1',0],[1,1],[0,0]]]]) {
  test(`marks malformed ring ${JSON.stringify(coordinates)} as parse_failed`,()=>assert.equal(one({type:'Polygon',coordinates}).disposition,'parse_failed'));
}
test('empty MultiPolygon member and missing geometry are failures, unknown geometry is not silently skipped',()=>{
  assert.equal(one({type:'MultiPolygon',coordinates:[[]]}).disposition,'parse_failed');
  assert.equal(normalizeRoot({type:'Feature',properties:{}})[0].reasonCode,'INVALID_FEATURE');
  assert.equal(one({type:'Oops'}).disposition,'parse_failed');
});
test('accepts file sizes above the former 10 MiB product limit',()=>{
  assert.doesNotThrow(()=>assertFileSize(10485760));
  assert.doesNotThrow(()=>assertFileSize(10485761));
});
test('ignored deeply nested geometry members never enter the engine input',()=>{
  let ignored=[];for(let i=0;i<12000;i++)ignored=[ignored];
  const record=normalizeRoot({...polygon,ignored,bbox:[0,0,4,4]})[0];
  assert.deepEqual(Object.keys(record.geometry).sort(),['coordinates','type']);
  assert.doesNotThrow(()=>JSON.stringify(record.geometry));
});
test('Feature attributes survive empty or malformed geometry and distinguish unavailable sources',()=>{
  for(const properties of [{x:3},{},null,undefined]) {
    const record=normalizeRoot({type:'Feature',properties,geometry:null})[0];
    assert.equal(record.attributes.status,'available');assert.deepEqual(record.attributes.values,properties??{});
  }
  const record=normalizeRoot({type:'Feature',properties:{PID:'a'},geometry:{type:'Oops'}})[0];
  assert.equal(record.disposition,'parse_failed');assert.equal(record.attributes.values.PID,'a');
  assert.equal(normalizeRoot({type:'Feature',properties:[],geometry:polygon})[0].attributes.status,'failed');
  assert.equal(normalizeRoot(polygon)[0].attributes.status,'skipped');
});
