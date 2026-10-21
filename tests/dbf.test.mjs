import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync} from 'fflate';
import {dbf} from './helpers/dbf.mjs';
import {shapefile,shapeRecord,square} from './helpers/shapefile.mjs';
import {parseInput} from '../src/input/adapters.ts';
const parse=async(...args)=>(await import('../src/shapefile/dbf.ts')).parseDbf(...args);
const fields=[{name:'PID',type:'C',length:12},{name:'geo_type',type:'N',length:4},{name:'geo_area',type:'F',length:10,decimals:2},{name:'active',type:'L',length:1},{name:'day',type:'D',length:8}];
test('DBF supports character numeric logical and date fields and keeps deletion row alignment',async()=>{
  const results=await parse(dbf(fields,[{PID:'A',geo_type:'2',geo_area:'1.5',active:'T',day:'20240229'},{PID:'DELETED'},{PID:'C'}],{deleted:[1]}),3);
  assert.equal(results[0].status,'available');
  assert.deepEqual({...results[0].values},{PID:'A',geo_type:2,geo_area:1.5,active:true,day:'2024-02-29'});
  assert.equal(results[1].status,'skipped');
  assert.deepEqual({...results[2].values},{PID:'C',geo_type:null,geo_area:null,active:null,day:null});
});
test('DBF corrupt framing mismatched records unsupported fields and bad values fail explicitly',async()=>{
  const valid=dbf(fields,[{PID:'a'}]);
  const broken=valid.slice();new DataView(broken.buffer).setUint16(10,1,true);
  for(const [bytes,count] of [[broken,1],[valid.slice(0,-3),1],[valid,2],[dbf([{name:'x',type:'M',length:10}],[{}]),1],[dbf(fields,[{geo_type:'oops'}]),1],[dbf(fields,[{day:'20230229'}]),1]]) {
    const result=await parse(bytes,count);assert.equal(result.length,count);assert.ok(result.every(r=>r.status==='failed'));
  }
});
test('DBF decodes explicit UTF-8 GBK CP1252 and ASCII and refuses ambiguous non-ASCII',async()=>{
  const f=[{name:'name',type:'C',length:16}], enc=new TextEncoder();
  for(const [raw,cpg,want] of [[enc.encode('café'),'UTF-8','café'],[new Uint8Array([0xa8,0xa6]),'936','é'],[new Uint8Array([0xe9]),'1252','é'],[enc.encode('PID'),'ASCII','PID']]) {
    const result=await parse(dbf(f,[{name:raw}]),1,enc.encode(cpg));assert.equal(result[0].values.name,want);
  }
  assert.equal((await parse(dbf(f,[{name:new Uint8Array([0xe9])}],{driver:0x57}),1))[0].values.name,'é');
  for(const cpg of [undefined,enc.encode('bogus'),enc.encode('ASCII'),enc.encode('UTF-8')]) assert.equal((await parse(dbf(f,[{name:new Uint8Array([0xff])}]),1,cpg))[0].status,'failed');
});
test('ZIP attributes use the matching DBF and missing or damaged DBF never changes geometry',()=>{
  const shp=shapefile([shapeRecord([square])]);
  const good=dbf(fields,[{PID:'a'}]);
  const run=entries=>parseInput('data.zip',zipSync(entries));
  assert.equal(run({'dir/DATA.SHP':shp,'dir/data.DBF':good})[0].attributes.values.PID,'a');
  for(const entries of [{'data.shp':shp},{'dir/data.shp':shp,'other/data.dbf':good}]) {
    const r=run(entries)[0];assert.equal(r.disposition,'check');assert.equal(r.attributes.status,'skipped');
  }
  const r=run({'data.shp':shp,'data.dbf':new Uint8Array(3)})[0];assert.equal(r.disposition,'check');assert.equal(r.attributes.status,'failed');
});

test('ZIP DBF language driver 0x4D decodes CP936 attributes without a CPG', () => {
  const shp = shapefile([shapeRecord([square])]);
  const attributes = dbf([{ name: 'name', type: 'C', length: 16 }], [{ name: new Uint8Array([0xa8, 0xa6]) }], { driver: 0x4d });
  const records = parseInput('world.zip', zipSync({ 'country.shp': shp, 'country.dbf': attributes }));
  assert.equal(records[0].attributes.status, 'available');
  assert.equal(records[0].attributes.values.name, 'é');
});
