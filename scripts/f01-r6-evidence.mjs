import {spawnSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const output=process.env.F01_R6_EVIDENCE,red=process.env.F01_R6_RED;
assert.ok(output&&red,'explicit CI evidence and isolated baseline directories required');
const results=[];
for(const [name,cwd,file,expected] of [
 ['red-unit',red,'tests/authority-r6.test.mjs',{tests:13,pass:7,fail:6}],
 ['red-browser',red,'tests/authority-r6.browser.mjs',{tests:6,pass:0,fail:6}],
 ['green-unit',process.cwd(),'tests/authority-r6.test.mjs',{tests:13,pass:13,fail:0}],
 ['green-browser',process.cwd(),'tests/authority-r6.browser.mjs',{tests:6,pass:6,fail:0}],
]){
 const start=Date.now(),loadBefore=os.loadavg(),r=spawnSync(process.execPath,['--import','tsx','--test',file],{cwd,encoding:'utf8',maxBuffer:32*1024*1024,env:process.env}),log=(r.stdout||'')+(r.stderr||'');
 writeFileSync(join(output,name+'.log'),log);const metrics=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(key=>[key,Number(log.match(new RegExp('^# '+key+' (\\d+)\\s*$','m'))?.[1])]));
 const row={name,source:name.startsWith('red')?'a761132e700763edef5c644af2eb0ea5616ef812':'CI checkout recorded in checkout.txt',command:[process.execPath,'--import','tsx','--test',file],status:r.status,signal:r.signal,error:r.error?.message,metrics,elapsedMs:Date.now()-start,loadBefore,loadAfter:os.loadavg(),testSha256:createHash('sha256').update(readFileSync(join(cwd,file))).digest('hex'),logSha256:createHash('sha256').update(log).digest('hex')};results.push(row);writeFileSync(join(output,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(row));
 assert.equal(r.status,expected.fail?1:0,name);for(const[key,value]of Object.entries({...expected,cancelled:0,skipped:0,todo:0}))assert.equal(metrics[key],value,name+' '+key);
}
