// Run after other checks, with PLANNER_PLAYWRIGHT_MODULE/BROWSER_EXECUTABLE.
// Fixtures: evidence/stage2/inventory.mjs; no real learner data.
import { replayBrowser } from '../tests/helpers/replay-browser.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const output=new URL('../evidence/stage2/browser-performance.json',import.meta.url),runtime=await replayBrowser();
const result={condition:'fresh module Worker per job, one pair per version/scale/rate; full replay in both paths; no timing instrumentation inside replay',browser:runtime.browser.version(),samples:[],limits:'Page CDP CPU rate 1/4; worker-target Emulation rate rejected by Chromium (see throttle-probe.json), no independent Worker 4x guarantee; not a smartphone/Safari proxy; samples are not p95'};
try{
 for(const rate of [1,4])for(const version of [23,24])for(const scale of ['normal','large','heavy']){
  const raw=await readFile(new URL(`../evidence/stage2/fixture-${version}-${scale}.json`,import.meta.url),'utf8');
  const p=await runtime.browser.newPage();await p.goto(runtime.origin);const cdp=await p.context().newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate});await cdp.send('Performance.enable');
  await p.evaluate(raw=>{window.raw=raw;window.tasks=[];new PerformanceObserver(list=>tasks.push(...list.getEntries().map(x=>({start:x.startTime,duration:x.duration})))).observe({type:'longtask'});},raw);
  for(const mode of ['sync','worker']){
   const browserSession=await runtime.browser.newBrowserCDPSession();let peakRssKiB=0,rssSamples=0,sampling=false;
   const sampleRss=async()=>{if(sampling)return;sampling=true;try{const info=await browserSession.send('SystemInfo.getProcessInfo');const pids=info.processInfo.map(p=>String(p.id));const rows=execFileSync('/bin/ps',['-o','rss=','-p',pids.join(',')],{encoding:'utf8'});const rss=rows.trim().split(/\s+/).reduce((n,x)=>n+Number(x),0);peakRssKiB=Math.max(peakRssKiB,rss);rssSamples++;}catch{ /* sampled process can exit while ps is running */ }finally{sampling=false;}};
   await sampleRss();const memoryTimer=setInterval(()=>{void sampleRss();},200);
   await p.waitForTimeout(100);const metricsBefore=await cdp.send('Performance.getMetrics');
   const sample=await p.evaluate(async mode=>{
    const timerGaps=[],rafGaps=[];let last=performance.now(),lastRaf=last,rafId;
    const interval=setInterval(()=>{const now=performance.now();timerGaps.push(now-last);last=now;},10);
    const frame=now=>{rafGaps.push(now-lastRaf);lastRaf=now;rafId=requestAnimationFrame(frame);};rafId=requestAnimationFrame(frame);
    await new Promise(r=>setTimeout(r,30));const begin=performance.now();let data,processMs=0,transferMs=null,summaryUnits=null,summaryTransferMs=null;
    if(mode==='sync'){
     const replay=await oldReplay.replayState(oldReplay.parseMigrationJson(raw));
     window.expectedSummary={kind:'read-only-replay',schemaVersion:replay.state.schemaVersion,commands:replay.workspace.receipts.length,attempts:replay.workspace.graph.attempts.length,ownedRecords:replay.workspace.graph.ownedRecords.length,removals:replay.workspace.graph.removals.length,reservations:replay.requiredReservations.length,graphSha256:replay.state.verification.graphSha256,retainedSha256:replay.state.verification.retainedSha256};
     data={summary:expectedSummary};
    }else{
     // Only event/client overhead is instrumented, replay computation unchanged.
     const api=replayClient.createReplayClient(()=>{
      const w=new Worker('/timed-worker.js',{type:'module'});let handler;
      return {postMessage:m=>w.postMessage(m),terminate:()=>w.terminate(),set onmessage(h){handler=h;w.onmessage=h?e=>{const received=performance.timeOrigin+performance.now(),t=performance.now(),newline=e.data.indexOf('\n'),sentAt=Number(e.data.slice(0,newline)),data=e.data.slice(newline+1);handler?.({data});const elapsed=performance.now()-t;if(data.includes('"type":"success"')){processMs=elapsed;summaryUnits=data.length;summaryTransferMs=received-sentAt;}}:null;},set onerror(h){w.onerror=h;},set onmessageerror(h){w.onmessageerror=h;}};
     });
     data=await api.replay(raw);transferMs=data.timing.wallMs-data.timing.readyMs-data.timing.replayMs;
     if(JSON.stringify(data.summary)!==JSON.stringify(expectedSummary))throw Error('full-replay summary mismatch');
    }
    const end=performance.now();await new Promise(r=>setTimeout(r,80));clearInterval(interval);cancelAnimationFrame(rafId);
    return {mode,wallMs:end-begin,...data.timing,processMs,transferMs,summaryUnits,summaryTransferMs,timerMaxGapMs:Math.max(...timerGaps),rafMaxGapMs:Math.max(...rafGaps),longestTaskMs:Math.max(0,...tasks.filter(t=>t.start>=begin-1&&t.start<end).map(t=>t.duration)),summary:data.summary,mainHeap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize,limit:performance.memory.jsHeapSizeLimit}:null};
   },mode);
   clearInterval(memoryTimer);while(sampling)await new Promise(r=>setTimeout(r,5));await sampleRss();await browserSession.detach();
   const metricsAfter=await cdp.send('Performance.getMetrics');assert.equal(sample.summary.commands,100);result.samples.push({rate,version,scale,bytes:Buffer.byteLength(raw),browserProcessRssPeakKiB:peakRssKiB,rssSamples,...sample,metricsBefore:metricsBefore.metrics,metricsAfter:metricsAfter.metrics});
   await writeFile(output,JSON.stringify(result,null,2));console.log(rate,version,scale,mode,Math.round(sample.wallMs),Math.round(sample.longestTaskMs),Math.round(sample.timerMaxGapMs));
  }
  await p.close();
 }
 result.completed=true;await writeFile(output,JSON.stringify(result,null,2));
}finally{await runtime.close();}
