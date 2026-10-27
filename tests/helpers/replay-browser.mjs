import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
export async function replayBrowser(){
 const compile=async(path,globalName,extra={})=>(await build({entryPoints:[root+path],bundle:true,write:false,format:globalName?'iife':'esm',platform:'browser',...(globalName?{globalName}:{}),...(globalName==='replayClient'?{define:{'import.meta.url':JSON.stringify('http://127.0.0.1/replay-client.js')}}:{}),...extra})).outputFiles[0].text;
 const guard=`const forbidden=()=>{throw new Error('read_only_boundary_violation');}; indexedDB.open=forbidden; indexedDB.deleteDatabase=forbidden; navigator.locks.request=forbidden; crypto.randomUUID=forbidden; globalThis.fetch=forbidden;\n`;
 const [worker,client,sync,observed,fault,timed,pending,nativeClient]=await Promise.all([
  compile('src/planner/attempts/replay/replay.worker.ts',null,{banner:{js:guard}}),
  compile('src/planner/attempts/replay/client.ts','replayClient'),
  compile('tests/helpers/replay-sync-entry.ts','oldReplay'),
  compile('src/planner/attempts/replay/replay.worker.ts',null,{banner:{js:guard},plugins:[{name:'private-worker-equality',setup(b){b.onLoad({filter:/replayStateJson\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('const replay = await replayState(parsed.value);',`const replay = await replayState(parsed.value);
const legacy = await replayState(JSON.parse(raw));
if (JSON.stringify([replay.state,replay.workspace,replay.requiredReservations]) !== JSON.stringify([legacy.state,legacy.workspace,legacy.requiredReservations])) throw new Error('test_all_values_differ');`),loader:'ts'}));}}]}),
  compile('src/planner/attempts/replay/replay.worker.ts',null,{banner:{js:guard},plugins:[{name:'internal-fault',setup(b){b.onLoad({filter:/replayStateJson\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('const replay = await replayState(parsed.value);', `throw new Error('synthetic private raw',{cause:new Error('synthetic secret')}); const replay = await replayState(parsed.value);`),loader:'ts'}));}}]}),
  compile('src/planner/attempts/replay/replay.worker.ts',null,{banner:{js:guard+`const nativeSend=globalThis.postMessage.bind(globalThis); globalThis.postMessage=data=>nativeSend(String(performance.timeOrigin+performance.now())+'\\n'+data);`}}),
  compile('src/planner/attempts/replay/replay.worker.ts',null,{banner:{js:guard},plugins:[{name:'pending-phase',setup(b){b.onLoad({filter:/replayStateJson\.ts$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('const replay = await replayState(parsed.value);', 'await new Promise(resolve=>setTimeout(resolve,100)); const replay = await replayState(parsed.value);'),loader:'ts'}));}}]}),
  compile('src/planner/attempts/replay/client.ts',null),
 ]);
 const assets={'/replay.worker.ts':worker,'/observed.js':observed,'/fault.js':fault,'/timed-worker.js':timed,'/pending.js':pending,'/native-client.js':nativeClient,'/client.js':client,'/sync.js':sync,'/startup-fault.js':`throw new Error('private startup');`};
 const server=createServer((req,res)=>{res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Isolated replay test</title><script src="/client.js"></script><script src="/sync.js"></script>');}else if(assets[req.url]){res.setHeader('Content-Type','text/javascript');res.end(assets[req.url]);}else{res.statusCode=404;res.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const module=process.env.PLANNER_PLAYWRIGHT_MODULE||'playwright';const {chromium}=await import(module);let browser;
 try{browser=await chromium.launch({headless:true,...(process.env.PLANNER_BROWSER_EXECUTABLE?{executablePath:process.env.PLANNER_BROWSER_EXECUTABLE}:{})});}catch(e){server.close();throw e;}
 return {browser,origin:`http://127.0.0.1:${server.address().port}`,async close(){await browser.close();await new Promise(r=>server.close(r));}};
}
