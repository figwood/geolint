import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine,wrapGeos} from '../src/engine/geos.ts';

const square={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]]]};
test('real cached GEOS module can initialize again after disposal',async()=>{
  for(let i=0;i<2;i++) {const engine=await createEngine();try{assert.equal(engine.check(square).valid,true);}finally{engine.dispose();}}
});
test('real topology sessions distinguish equal, contained and boundary-only relations',async()=>{
  const engine=await createEngine();
  try {
    assert.equal(typeof engine.createTopologySession,'function');
    const session=engine.createTopologySession();
    session.add('a',square);
    session.add('reverse',{type:'Polygon',coordinates:[square.coordinates[0].toReversed()]});
    session.add('inside',{type:'Polygon',coordinates:[[[1,1],[2,1],[2,2],[1,2],[1,1]]]});
    session.add('touch',{type:'Polygon',coordinates:[[[4,0],[5,0],[5,1],[4,1],[4,0]]]});
    assert.equal(session.equals('a','reverse'),true);
    assert.equal(session.equals('a','inside'),false);
    assert.equal(session.relatePattern('a','inside','2********'),true);
    assert.equal(session.relatePattern('a','touch','2********'),false);
    assert.throws(()=>session.add('a',square));
    assert.throws(()=>session.equals('missing','a'));
    assert.throws(()=>session.relatePattern('a','inside','oops'));
    engine.dispose();
    assert.throws(()=>session.equals('a','reverse'));
    session.dispose(); engine.dispose();
  } finally {engine.dispose();}
});

test('session disposes retained geometry before context, including partial registration failure',async()=>{
  const {createGeosTopologySession}=await import('../src/engine/topology.ts');
  let next=1,fail=false,status=1;const events=[];
  const geos={Module:{_malloc:()=>next++,_free:p=>events.push(['free',p]),stringToUTF8:()=>{}},
    GEOSGeoJSONReader_create:()=>7,GEOSGeoJSONReader_destroy:p=>events.push(['reader',p]),
    GEOSGeoJSONReader_readGeometry:()=>fail?0:next++,GEOSGeom_destroy:p=>events.push(['geom',p]),
    GEOSEquals:()=>status,GEOSRelatePattern:()=>status};
  const session=createGeosTopologySession(geos);
  session.add('a',square);session.add('b',square);
  fail=true;assert.throws(()=>session.add('c',square),{code:'ENGINE_FATAL_ERROR'});
  for(const result of [2,3]) {status=result;assert.throws(()=>session.equals('a','b'),{code:'ENGINE_FATAL_ERROR'});}
  session.dispose();session.dispose();
  assert.equal(events.filter(e=>e[0]==='geom').length,2);
  assert.equal(events.filter(e=>e[0]==='reader').length,3);
  assert.equal(events.filter(e=>e[0]==='free').length,3);
  let finishes=0;
  const wrapper=wrapGeos({...geos,GEOSversion:()=> '3.13.0',GEOSisValidDetail:()=>1,finishGEOS:()=>{finishes++;events.push(['finish']);}});
  fail=false;const owned=wrapper.createTopologySession();owned.add('x',square);
  wrapper.dispose();assert.equal(finishes,1);assert.equal(events.at(-1)[0],'finish');
  assert.throws(()=>owned.add('y',square));
});
test('a throwing geometry destructor does not prevent remaining handles or context cleanup',async()=>{
  const {createGeosTopologySession}=await import('../src/engine/topology.ts');let destroyed=0,finished=0,failOnce=true;
  const base={_ctx:99,Module:{_malloc:()=>8,_free(){},stringToUTF8(){}},GEOSGeoJSONReader_create:()=>1,GEOSGeoJSONReader_destroy(){},GEOSGeoJSONReader_readGeometry:()=>++destroyed,
    GEOSGeom_destroy(){destroyed++;if(failOnce){failOnce=false;throw new WebAssembly.RuntimeError('destroy trap');}},GEOSEquals:()=>1,GEOSRelatePattern:()=>1};
  const session=createGeosTopologySession(base);session.add('a',square);session.add('b',square);
  assert.throws(()=>session.dispose(),WebAssembly.RuntimeError);assert.equal(destroyed,4);
  const engine=wrapGeos({...base,GEOSversion:()=> '3.13.0',GEOSisValidDetail:()=>1,GEOS_finish_r(){finished++;}});
  const owned=engine.createTopologySession();owned.add('c',square);
  engine.dispose();assert.equal(finished,1);assert.throws(()=>owned.add('d',square));
});
test('polygon aggregation releases clones on union failure, allocation failure and cancellation',async()=>{
  const {polygonGaps}=await import('../src/engine/areas.ts');
  for(const mode of ['union','allocation','cancel']){
    let next=10,yields=0;const owned=new Set(),destroyed=[];
    const geos={Module:{_malloc:()=>0,_free(){}},GEOSGeom_clone:()=>{const p=next++;owned.add(p);return p;},GEOSUnion:()=>0,
      GEOSGeom_destroy:p=>{assert.ok(owned.delete(p));destroyed.push(p);}};
    const controls={checkpoint(){},reservePositions(){},async yield(){if(mode==='cancel'&&++yields===2)throw new Error('cancelled');}};
    await assert.rejects(polygonGaps(geos,mode==='allocation'?[1]:[1,2],controls));
    assert.equal(owned.size,0);assert.equal(destroyed.length,mode==='allocation'?1:2);
  }
});
