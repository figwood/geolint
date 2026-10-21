export function benchmarkOptions(args) {
  const options = {sizeMiB:10, timeoutSeconds:300, maxRssMiB:512};
  const keys = {'--size-mb':'sizeMiB','--timeout-seconds':'timeoutSeconds','--max-rss-mb':'maxRssMiB'};
  for (let i=0; i<args.length; i+=2) {
    const key=keys[args[i]], value=Number(args[i+1]);
    if (!key || !Number.isSafeInteger(value) || value<=0) throw new Error('Expected --size-mb 10|100|500, --timeout-seconds 1..300, --max-rss-mb positive integer.');
    options[key]=value;
  }
  if (![10,100,500].includes(options.sizeMiB) || options.timeoutSeconds>300) throw new Error('Unsupported size or timeout.');
  return options;
}
export function processTreeRss(output, rootPid) {
  const rows=output.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)).filter(row=>row.length===3 && row.every(Number.isFinite));
  const selected=new Set([rootPid]);
  let changed=true;
  while (changed) { changed=false; for (const [pid,ppid] of rows) if (selected.has(ppid) && !selected.has(pid)) {selected.add(pid);changed=true;} }
  if (!rows.some(([pid])=>pid===rootPid)) throw new Error('Process RSS unavailable');
  return rows.filter(([pid])=>selected.has(pid)).reduce((sum,row)=>sum+row[2]*1024,0);
}
