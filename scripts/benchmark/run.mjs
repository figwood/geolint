import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { benchmarkOptions, processTreeRss } from './config.mjs';
import { killProcessGroups } from './cleanup.mjs';
const options=benchmarkOptions(process.argv.slice(2));
const freeMemory=os.freemem();
const budget=Math.min(options.maxRssMiB*1024*1024,Math.floor(freeMemory/4));
const started=Date.now();
const metadata={recordedAt:new Date().toISOString(),...options,budgetBytes:budget,freeMemoryBytes:freeMemory,os:os.platform()+' '+os.release(),architecture:os.arch(),cpu:os.cpus()[0]?.model,node:process.version,memoryMetric:'sampled sum of RSS for isolated child and descendants (not an exact browser peak)',memorySampleIntervalMs:250};
let output='',peak=0,stopReason,memoryAvailable=true,browserPid,forceCleanup;
const child=spawn(process.execPath,[fileURLToPath(new URL('./child.mjs',import.meta.url)),String(options.sizeMiB)],{detached:true,stdio:['ignore','pipe','ignore','ipc']});
child.on('message', message => { if (Number.isSafeInteger(message?.browserPid) && message.browserPid > 1) browserPid=message.browserPid; });
function stop(reason) {
  if (stopReason) return;
  stopReason=reason;
  // First close through Playwright, including a launch still in progress.
  child.kill('SIGTERM');
  // The launch timeout is 10s; allow cleanup to finish, then kill both groups.
  forceCleanup=setTimeout(()=>killProcessGroups([browserPid,child.pid]),15000);
}
child.stdout.on('data',chunk=>{output+=chunk;});
const sample=()=>{
  try {
    const rss=processTreeRss(execFileSync('ps',['-axo','pid=,ppid=,rss='],{encoding:'utf8',timeout:1000}),child.pid);
    peak=Math.max(peak,rss);
    if (rss>budget) stop('Memory budget exceeded');
  } catch {memoryAvailable=false;stop('Memory guard unavailable; large-file run stopped');}
};
const interval=setInterval(sample,250);
const timeout=setTimeout(()=>stop('Five-minute or configured timeout exceeded'),options.timeoutSeconds*1000);
const exitCode=await new Promise(resolve=>{child.on('error',()=>resolve(-1));child.on('close',code=>resolve(code));});
clearInterval(interval);clearTimeout(timeout);
clearTimeout(forceCleanup);
// Never leave a detached browser behind, even on unexpected controller exit.
if (browserPid) killProcessGroups([browserPid]);
let result;
try {result=JSON.parse(output.trim());} catch {result={status:'failed',reason:'Benchmark process did not return a result',exitCode};}
if(stopReason) result={status:'aborted',reason:stopReason};
const record={...metadata,...result,wallTimeMs:Date.now()-started,sampledPeakRssBytes:memoryAvailable&&peak?peak:'unavailable'};
await mkdir('.cache/benchmarks',{recursive:true});
const path=`.cache/benchmarks/${options.sizeMiB}MiB.json`;
await writeFile(path,JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({path,...record},null,2));
if(record.status!=='passed') process.exitCode=1;
