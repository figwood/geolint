import { createEngine } from '/core/engine/geos.js';
import { normalizeRoot } from '/core/geojson/normalize.js';
import { inspectRecord } from '/core/inspection/inspect.js';
import { summarize } from '/core/inspection/summary.js';
self.onmessage = async ({data:{sizeMiB}}) => {
  let engine;
  try {
    const feature=JSON.stringify({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]]]}});
    const prefix='{"type":"FeatureCollection","features":[', suffix=']}';
    const count=Math.floor((sizeMiB*1024*1024-prefix.length-suffix.length+1)/(feature.length+1));
    const text=prefix+Array(count).fill(feature).join(',')+suffix;
    const bytes=new TextEncoder().encode(text).length;
    const start=performance.now();
    const records=normalizeRoot(JSON.parse(text));
    engine=await createEngine(new URL('/vendor/geos/geos.esm.js',self.location.href).href);
    const results=records.map(record=>inspectRecord(record,engine));
    const result={status:'passed',bytes,features:count,vertices:count*5,elapsedMs:performance.now()-start,engine:engine.info,summary:summarize(results)};
    self.postMessage(result);
  } catch { self.postMessage({status:'failed',reason:'Benchmark worker failed'}); }
  finally { engine?.dispose(); }
};
