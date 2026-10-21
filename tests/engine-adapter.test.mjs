import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapGeos, createEngine } from '../src/engine/geos.ts';

// Models only the GEOS pointer ABI, never decides geometry validity from input.
function abi({status=0,throws=false,allocationFailure=0,readerFailure=false,readerAllocationFailure=false}={}) {
  const heap=new DataView(new ArrayBuffer(4096));let next=32,allocations=0;
  const live=new Set(),destroyed=[];let finished=0;
  const malloc=size=>{if(++allocations===allocationFailure)return 0;const p=next;next+=size+8;live.add(p);return p;};
  const geos={
    Module:{_malloc:malloc,_free:p=>{assert.equal(live.delete(p),true)},setValue:(p,v,t)=>t==='i32'?heap.setInt32(p,v,true):heap.setFloat64(p,v,true),getValue:(p,t)=>t==='i32'?heap.getUint32(p,true):heap.getFloat64(p,true),stringToUTF8(){},UTF8ToString:()=> 'Self-intersection'},
    GEOSversion:()=> '3.13.0-CAPI-1.19.0', GEOSGeoJSONReader_create:()=>readerAllocationFailure?0:10,
    GEOSGeoJSONReader_destroy:p=>destroyed.push(p),GEOSGeoJSONReader_readGeometry:()=>readerFailure?0:20,
    GEOSisValidDetail(g,flags,reason,location){assert.equal(flags,0);if(throws)throw new WebAssembly.RuntimeError('trap');heap.setInt32(reason,malloc(24),true);heap.setInt32(location,30,true);return status},
    GEOSGeomGetX:(_,p)=>{heap.setFloat64(p,2,true);return 1},GEOSGeomGetY:(_,p)=>{heap.setFloat64(p,2,true);return 1},
    GEOSFree:p=>{assert.equal(live.delete(p),true)},GEOSGeom_destroy:p=>destroyed.push(p),initGEOS(){},finishGEOS:()=>{finished++},
  };
  return {geos,live,destroyed,get finished(){return finished}};
}
const p={type:'Polygon',coordinates:[[[0,0],[4,4],[0,4],[4,0],[0,0]]]};
test('adapter reads reason and location then frees all temporary GEOS/heap resources',()=>{
  const a=abi();const e=wrapGeos(a.geos);const result=e.check(p);
  assert.deepEqual(result,{valid:false,reason:'Self-intersection',location:{x:2,y:2}});
  assert.equal(a.live.size,0);assert.deepEqual(a.destroyed.sort((a,b)=>a-b),[10,20,30]);
  assert.equal(e.info.version,'3.13.0-CAPI-1.19.0');
  e.dispose();e.dispose();assert.equal(a.finished,1);assert.throws(()=>e.check(p));
});
test('adapter frees allocated resources on traps and partial allocation failures',()=>{
  for(const options of [{throws:true},...Array.from({length:5},(_,i)=>({allocationFailure:i+1})),{readerFailure:true},{status:2}]){
    const a=abi(options);const e=wrapGeos(a.geos);
    assert.throws(()=>e.check(p));assert.equal(a.live.size,0);assert.equal(a.destroyed.includes(10),true);e.dispose();
  }
});
test('unclassified GEOS exceptions and null allocations stop the run; WASM traps remain fatal',()=>{
  for(const options of [{status:2},{readerAllocationFailure:true},{readerFailure:true}]){
    const e=wrapGeos(abi(options).geos);assert.throws(()=>e.check(p),error=>error.code==='ENGINE_FATAL_ERROR');e.dispose();
  }
  const fatal=wrapGeos(abi({throws:true}).geos);assert.throws(()=>fatal.check(p),WebAssembly.RuntimeError);fatal.dispose();
});
test('a module resolving after initialization timeout cannot retain an engine context',async context=>{
  const a=abi();let resolveModule;
  globalThis.__geolintDelayedModule=new Promise(resolve=>{resolveModule=resolve});
  context.mock.timers.enable({apis:['setTimeout']});
  try{
    const result=createEngine('data:text/javascript,export default async function(){return await globalThis.__geolintDelayedModule}');
    const rejection=assert.rejects(result,error=>error.code==='ENGINE_INIT_ERROR');
    context.mock.timers.tick(15000);await rejection;
    resolveModule(a.geos);
    for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(a.finished,1);
    const fresh=wrapGeos(a.geos);fresh.dispose();
  }finally{context.mock.timers.reset();delete globalThis.__geolintDelayedModule}
});
