// Synthetic requests; real Vite resolution on the host filesystem. Run with Node22.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {writeFile,mkdir,readFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=process.cwd(),port=45431,rows=[],evidence=process.env.G03_GATE_EVIDENCE;
const probe=resolve(root,'.case-probe-'+process.pid);await writeFile(probe,'case');
let insensitive=false;try{insensitive=await readFile(probe.toUpperCase(),'utf8')==='case';}catch{}finally{await unlink(probe);}
function get(path){return new Promise((ok,no)=>{const q=request({hostname:'127.0.0.1',port,path,headers:{accept:'*/*'}},r=>{let body='';r.setEncoding('utf8');r.on('data',x=>body+=x);r.on('end',()=>ok({status:r.statusCode,type:r.headers['content-type']||'',body}));});q.setTimeout(120000,()=>q.destroy(Error('request timeout '+path)));q.on('error',no);q.end();});}
const configs=process.env.G03_GATE_RED==='1'?[['red','production','production',[0,0,0]]]:[['off','development','development',[0,0,0]],['yi05','development','development',[1,0,0]],['yi06','development','development',[0,1,0]],['institutional','development','development',[0,0,1]],['all','development','development',[1,1,1]],['mode-production','production','development',[1,1,1]],['env-production','development','production',[1,1,1]]];
const targets=[['attempts','dev/attempts/main.tsx',0],['attempts','dev/attempts/Workbench.tsx',0],['attempts','dev/attempts/Fields.tsx',0],['attempts','dev/attempts/style.css',0],['persistence','dev/persistence/main.tsx',1],['institutional','dev/institutional/main.tsx',2],['institutional','dev/institutional/InstitutionalSearch.tsx',2],['institutional','dev/institutional/searchView.ts',2],['attempts','src/planner/attempts/workbench/operations.ts',0],['persistence','src/planner/attempts/persistence/sessionIds.ts',1]];
let failures=[];
for(const [name,mode,nodeEnv,flags] of configs){
 const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort','--mode',mode],{env:{...process.env,NODE_ENV:nodeEnv,YI05_WORKBENCH:String(flags[0]),YI06_PERSISTENCE:String(flags[1]),YI_INSTITUTIONAL_READONLY:String(flags[2])}});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 try{const end=Date.now()+120000;while(!output.includes('Local:')){if(child.exitCode!==null||Date.now()>end)throw Error(output);await new Promise(r=>setTimeout(r,100));}
 for(const [group,file,index] of targets){
  const isOn=mode==='development'&&nodeEnv!=='production'&&(flags[index]||(index===0&&flags[1]&&file!=='dev/attempts/main.tsx'));
  const raw='/'+file,fs='/@fs'+resolve(root,file),encode=s=>s.replaceAll('dev','%64%65%76').replaceAll('src','%73%72%63');
  const enc1=encode(raw),enc2=enc1.replaceAll('%','%25'),enc3=enc2.replaceAll('%','%25');
  const paths=[raw,raw.replace('/dev/','/DEV/').replace('/src/','/SRC/'),raw.toUpperCase(),raw.replace('/'+group+'/','/'+group.toUpperCase()+'/'),enc1,enc2,enc3,'//'+file,'/x/../'+file,raw.replaceAll('/','\\'),fs,fs.toUpperCase(),'/@fs'+resolve(root,file).replaceAll('/dev/','/DEV/'),'/'+file.replaceAll('/','%2f')];
  for(const path of new Set(paths))for(const query of ['', '?raw','?url','?import']){
   const response=await get(path+query);const html=/text\/html/i.test(response.type)&&/^\s*(?:<!doctype|<html)/i.test(response.body);
   const module=!html&&(/(?:javascript|typescript|text\/css)/i.test(response.type)||response.body.includes('createRoot')||response.body.includes('randomUUID')||response.body.includes('InstitutionalSearch'));
   rows.push({name,path:path+query,status:response.status,type:response.type,html,module,body:response.body});
   if(isOn && path===raw && query==='')assert.equal(module,true,'enabled canonical module '+raw);
   if(!isOn&&module)failures.push({name,path:path+query,type:response.type,status:response.status});
  }
 }
 for(const [group,,index] of [['attempts','',0],['persistence','',1],['institutional','',2]]){
  const on=mode==='development'&&nodeEnv!=='production'&&flags[index],entry='/__dev/'+group;
  const e1=entry.replace('__dev','%5f%5fdev'),e2=e1.replaceAll('%','%25'),e3=e2.replaceAll('%','%25');
  for(const path of [entry,entry.toUpperCase(),e1,e2,e3,'/x/..'+entry,'/'+entry,entry.replaceAll('/','\\')])for(const query of ['', '?raw','?url','?import']){
   const res=await get(path+query);rows.push({name,path:path+query,...res,entry:true});
   if(path===entry&&query===''){assert.equal(res.status,on?200:404);if(on)assert.match(res.body,/<script/);}
   if(!on && /(?:<title>YI-0[56]|<title>制度科目|src=["']\/dev\/(?:attempts|persistence|institutional)\/main)/.test(res.body))failures.push({name,path:path+query,entry:true,status:res.status,type:res.type});
  }
 }
 }finally{child.kill();await new Promise(r=>child.once('exit',r));}
}
if(evidence){await mkdir(evidence,{recursive:true});await writeFile(resolve(evidence,'http.json'),JSON.stringify({platform:process.platform,caseInsensitive:insensitive,rows,failures},null,2));}
console.log(JSON.stringify({platform:process.platform,caseInsensitive:insensitive,responses:rows.length,failures},null,2));assert.deepEqual(failures,[]);
