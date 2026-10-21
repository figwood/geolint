import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, Zip, ZipDeflate } from 'fflate';
import { runInspection } from '../src/inspection/run.ts';
import { createEngine } from '../src/engine/geos.ts';
import { parseShapefile } from '../src/shapefile/parse.ts';
import { extractShapefile } from '../src/shapefile/archive.ts';
import { shapefile, shapeRecord, square } from './helpers/shapefile.mjs';

// geos-wasm owns a single module context per Node process. Keep the real engine
// alive across these cases; production isolates each run in its own Worker.
let engine;
after(() => engine?.dispose());

async function inspect(bytes, name = 'fixture.shp') {
  const messages = [];
  await runInspection({name, size:bytes.length, arrayBuffer:async () => bytes.slice().buffer}, 'shp', m => messages.push(m), async () => {
    engine ??= await createEngine();
    return {info:engine.info, check:geometry => engine.check(geometry), dispose() {}};
  });
  return messages.at(-1);
}

test('standalone SHP checks original projected coordinates, keeps null records and report indexes', async () => {
  const crossed = [[500000,3000000],[500010,3000010],[500000,3000010],[500010,3000000],[500000,3000000]];
  const message = await inspect(shapefile([shapeRecord([square]), shapeRecord([],0), shapeRecord([crossed])]));
  assert.equal(message.type, 'completed');
  assert.deepEqual(message.result.records.map(r => r.status), ['valid','skipped','invalid']);
  assert.deepEqual(message.result.records.map(r => r.featureIndex), [0,1,2]);
  assert.deepEqual(message.result.records[2].location, {x:500005,y:3000005});
  assert.equal(message.result.run.fileName, 'fixture.shp');
});

test('unordered holes and disjoint exterior rings produce a MultiPolygon without flattening holes', async () => {
  const hole = [[500002,3000002],[500008,3000002],[500008,3000008],[500002,3000008],[500002,3000002]];
  const second = square.map(([x,y]) => [x+20,y]);
  const message = await inspect(shapefile([shapeRecord([hole,second,square])]));
  assert.equal(message.type, 'completed');
  assert.equal(message.result.records[0].geometryType, 'MultiPolygon');
  assert.equal(message.result.records[0].status, 'valid');
});

test('unclosed and malformed polygon records are parse failures without preventing later checks', async () => {
  const bad = shapeRecord([square]); new DataView(bad.buffer).setInt32(44, -1, true);
  const message = await inspect(shapefile([shapeRecord([square.slice(0,-1)]),bad,shapeRecord([square])]));
  assert.equal(message.type, 'completed');
  assert.deepEqual(message.result.records.map(r => r.status), ['parse_failed','parse_failed','valid']);
});

for (const type of [15,25]) test(`Polygon ${type} dimensions are skipped instead of silently stripped`, async () => {
  const message = await inspect(shapefile([shapeRecord([square],type)],type));
  assert.equal(message.type,'completed');
  assert.equal(message.result.records[0].reasonCode,'UNSUPPORTED_DIMENSION');
});
test('two-dimensional point shapes are checked', async () => {
  const message = await inspect(shapefile([shapeRecord([],1)],1));
  assert.equal(message.type,'completed');
  assert.equal(message.result.records[0].status,'valid');
});

test('ZIP accepts a nested uppercase SHP and ignores DBF and PRJ without reprojecting', async () => {
  const bytes = zipSync({'data/LAYER.SHP':shapefile([shapeRecord([square])]),'data/LAYER.PRJ':new TextEncoder().encode('not interpreted'),'data/LAYER.DBF':new Uint8Array([255])});
  const message = await inspect(bytes, 'layer.zip');
  assert.equal(message.type,'completed');
  assert.equal(message.result.summary.valid,1);
  assert.equal(message.result.run.fileName,'layer.zip');
});

for (const [name, bytes, code] of [
  ['truncated SHP',shapefile([shapeRecord([square])]).slice(0,-2),'INVALID_SHAPEFILE'],
  ['bad header',new Uint8Array(100),'INVALID_SHAPEFILE'],
  ['missing layer',zipSync({'readme.txt':new Uint8Array(0)}),'MISSING_SHAPEFILE'],
  ['multiple layers',zipSync({'a.shp':new Uint8Array(0),'b.shp':new Uint8Array(0)}),'MULTIPLE_SHAPEFILES'],
  ['truncated ZIP',zipSync({'a.shp':shapefile([shapeRecord([square])])}).slice(0,-3),'INVALID_ARCHIVE'],
]) test(`${name} fails without a complete report`, async () => {
  const message = await inspect(bytes, name.includes('SHP') || name==='bad header' ? 'bad.shp':'bad.zip');
  assert.equal(message.type,'failed');
  assert.equal(message.code,code);
  assert.equal(message.summary,null);
});

test('stored ZIP and streamed ZIP with data descriptors retain identical original SHP bytes', () => {
  const shp = shapefile([shapeRecord([square])]);
  assert.deepEqual(extractShapefile(zipSync({'a.shp':shp},{level:0})),shp);
  const chunks = [];
  const zip = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
  const entry = new ZipDeflate('nested/a.shp'); zip.add(entry);
  entry.push(shp.subarray(0,120)); entry.push(shp.subarray(120),true); zip.end();
  assert.deepEqual(extractShapefile(Buffer.concat(chunks)),shp);
});

test('ZIP checksum corruption, encrypted layers and dishonest expansion sizes cannot complete', () => {
  const shp = shapefile([shapeRecord([square])]);
  const archive = zipSync({'a.shp':shp});
  const central = archive.findIndex((_,i) => archive[i]===0x50 && archive[i+1]===0x4b && archive[i+2]===1 && archive[i+3]===2);
  for (const mutate of [
    view => view.setUint32(central+16,0,true),
    view => { view.setUint16(6,1,true); view.setUint16(central+8,1,true); },
    view => { view.setUint32(22,100,true); view.setUint32(central+24,100,true); },
    view => view.setUint32(central+20,0xffffffff,true),
  ]) {
    const bad = archive.slice(); mutate(new DataView(bad.buffer));
    assert.throws(() => extractShapefile(bad), error => error.code==='INVALID_ARCHIVE');
  }
});

test('ZIP entry count limit applies before any SHP extraction', () => {
  const contents = Object.fromEntries(Array.from({length:1025},(_,i) => [`${i}.txt`,new Uint8Array(0)]));
  contents['a.shp'] = shapefile([shapeRecord([square])]);
  assert.throws(() => extractShapefile(zipSync(contents)), error => error.code==='ARCHIVE_TOO_LARGE');
});

test('ZIP expanded content may exceed the former 10 MiB limit', () => {
  const shp = shapefile([shapeRecord([square])]);
  const sidecar = new Uint8Array(10 * 1024 * 1024);
  assert.deepEqual(extractShapefile(zipSync({'a.shp': shp, 'a.dbf': sidecar})), shp);
});

test('empty files, empty shapes and mismatched record types retain explicit outcomes', () => {
  assert.deepEqual(parseShapefile(shapefile([])),[]);
  assert.equal(parseShapefile(shapefile([shapeRecord([])]))[0].reasonCode,'EMPTY_GEOMETRY');
  assert.equal(parseShapefile(shapefile([shapeRecord([],1)]))[0].disposition,'parse_failed');
});

test('overlapping clockwise shells remain invalid rather than merged or repaired', async () => {
  const message = await inspect(shapefile([shapeRecord([square,square.map(([x,y]) => [x+5,y])])]));
  assert.equal(message.type,'completed');
  assert.equal(message.result.records[0].status,'invalid');
});

test('duplicate case-insensitive SHP names are rejected instead of choosing a layer', () => {
  assert.throws(() => extractShapefile(zipSync({'a.shp':new Uint8Array(0),'A.SHP':new Uint8Array(0)})), error => error.code==='INVALID_ARCHIVE');
});

test('damaged ignored sidecars and local CRC inconsistencies reject the whole ZIP', () => {
  const contents = {'a.shp':shapefile([shapeRecord([square])]),'a.dbf':new TextEncoder().encode('ignored attributes')};
  const archive = zipSync(contents,{level:0});
  const corruptSidecar = archive.slice();
  const local = 30 + 'a.shp'.length + contents['a.shp'].length;
  corruptSidecar[local + 30 + 'a.dbf'.length] ^= 1;
  assert.throws(() => extractShapefile(corruptSidecar), error => error.code==='INVALID_ARCHIVE');
  const wrongLocalCrc = archive.slice(); new DataView(wrongLocalCrc.buffer).setUint32(14,0,true);
  assert.throws(() => extractShapefile(wrongLocalCrc), error => error.code==='INVALID_ARCHIVE');
});

for (const type of [1,3,8,11,13,15,18,21,23,25,28,31]) test(`type-only malformed shape ${type} is parse_failed, not skipped`, () => {
  const record = new Uint8Array(4); new DataView(record.buffer).setInt32(0,type,true);
  assert.equal(parseShapefile(shapefile([record],type))[0].disposition,'parse_failed');
});

test('invalid part counts in dimensioned polygons are parse failures', () => {
  const record = shapeRecord([square],15); new DataView(record.buffer).setInt32(36,0x7fffffff,true);
  assert.equal(parseShapefile(shapefile([record],15))[0].disposition,'parse_failed');
});
