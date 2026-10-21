import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkOptions, processTreeRss } from '../scripts/benchmark/config.mjs';
import { spawn } from 'node:child_process';
import { killProcessGroups } from '../scripts/benchmark/cleanup.mjs';
test('benchmark accepts only bounded sizes, durations and memory budgets', () => {
  assert.equal(benchmarkOptions(['--size-mb','100']).sizeMiB,100);
  assert.equal(benchmarkOptions(['--size-mb','10']).timeoutSeconds,300);
  for (const args of [['--size-mb','999'],['--timeout-seconds','301'],['--max-rss-mb','0'],['--unknown'],['--size-mb']]) assert.throws(()=>benchmarkOptions(args));
});
test('memory guard measures child descendants rather than unrelated processes', () => {
  assert.equal(processTreeRss('10 1 100\n11 10 200\n12 11 300\n13 1 999',10),600*1024);
  assert.throws(()=>processTreeRss('',10));
});
test('abort cleanup terminates both controller and separately detached browser group', async () => {
  const children = Array.from({length:2}, () => spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {detached:true,stdio:'ignore'}));
  const exited = children.map(child => new Promise(resolve => child.once('exit', resolve)));
  try {
    killProcessGroups(children.map(child => child.pid));
    await Promise.race([Promise.all(exited),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Detached process survived cleanup')),1500).unref())]);
    assert.ok(children.every(child => child.signalCode === 'SIGKILL'));
  } finally { for(const child of children) { try {process.kill(-child.pid,'SIGKILL');} catch {} } }
});
