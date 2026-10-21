import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startInspection } from '../src/worker/client.ts';

// Only transport is replaced: production client owns sequencing, cancellation and cleanup.
test('cancel and restart isolate stale messages and terminate old Worker',()=>{
  const original=globalThis.Worker;const workers=[];
  globalThis.Worker=class{onmessage=null;onerror=null;onmessageerror=null;terminated=false;constructor(){workers.push(this)}postMessage(value){this.request=value}terminate(){this.terminated=true}};
  const file=new File(['{}'],'test.geojson');const messages=[];
  try{
    const first=startInspection(file,m=>messages.push(m));
    const oldCallback=workers[0].onmessage;
    workers[0].onmessage({data:{type:'progress',runId:first.runId,processed:4,total:20,phase:'checking'}});
    first.cancel();first.cancel();
    assert.equal(workers[0].terminated,true);assert.equal(messages.at(-1).type,'cancelled');assert.equal(messages.at(-1).processed,4);
    assert.equal(messages.at(-1).code,'TOPOLOGY_CANCELLED');assert.equal(Object.hasOwn(messages.at(-1),'errorId'),false);
    const second=startInspection(file,m=>messages.push(m));
    oldCallback({data:{type:'completed',runId:first.runId,result:{}}});
    workers[1].onmessage({data:{type:'completed',runId:first.runId,result:{}}});
    assert.equal(messages.filter(m=>m.type==='completed').length,0);
    workers[1].onmessage({data:{type:'completed',runId:second.runId,result:{}}});
    assert.equal(messages.at(-1).runId,second.runId);assert.equal(workers[1].terminated,true);
    second.cancel();assert.equal(messages.at(-1).type,'completed');
  }finally{globalThis.Worker=original}
});
test('starting new task cancels active task; crashes produce sanitized terminal failure',()=>{
  const original=globalThis.Worker;const workers=[];
  globalThis.Worker=class{constructor(){workers.push(this)}postMessage(value){this.request=value}terminate(){this.terminated=true}};
  const messages=[];const file=new File(['{}'],'test.geojson');
  try{
    startInspection(file,m=>messages.push(m));const next=startInspection(file,m=>messages.push(m));
    assert.equal(messages[0].type,'cancelled');assert.equal(workers[0].terminated,true);
    workers[1].onerror({preventDefault(){},message:'SECRET raw geometry'});
    assert.equal(messages.at(-1).code,'WORKER_ERROR');assert.equal(messages.at(-1).summary,null);assert.equal(messages.at(-1).message.includes('SECRET'),false);
    next.cancel();
  }finally{globalThis.Worker=original}
});
