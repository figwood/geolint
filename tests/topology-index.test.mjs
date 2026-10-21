import test from 'node:test';
import assert from 'node:assert/strict';

test('static index matches independent bbox enumeration including touching and dense entries',async()=>{
  const {candidatePairs}=await import('../src/topology/index.ts');
  const entries=Array.from({length:150},(_,i)=>({featureIndex:i,bbox:[i%13-10,i%9,i%13-9,i%9+1]}));
  const expected=[];
  for(let i=0;i<entries.length;i++) for(let j=i+1;j<entries.length;j++) {
    const a=entries[i].bbox,b=entries[j].bbox;
    if(a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3]) expected.push(`${i}:${j}`);
  }
  assert.deepEqual([...candidatePairs(entries)].map(p=>p.join(':')).sort(),expected.sort());
  assert.equal([...candidatePairs(Array.from({length:1000},(_,i)=>({featureIndex:i,bbox:[i*3,0,i*3+1,1]})))].length,0);
  assert.deepEqual([...candidatePairs([{featureIndex:9,bbox:[0,0,1,1]},{featureIndex:2,bbox:[1,1,2,2]}])],[[2,9]]);
});

test('extent counts original repeated vertices and nested collection positions',async()=>{
  const {geometryExtent}=await import('../src/topology/index.ts');
  assert.deepEqual(geometryExtent({type:'GeometryCollection',geometries:[{type:'Point',coordinates:[-5,8]},{type:'LineString',coordinates:[[0,0],[0,0],[2,3]]}]}),{bbox:[-5,0,2,8],positions:4});
});
