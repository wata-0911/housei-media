import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
const cases=[
 {branch:'main',vercelEnv:'production',allowed:false},
 {branch:'dev',vercelEnv:'production',allowed:true},
 {branch:'main',vercelEnv:'preview',allowed:false},
 {branch:'dev',vercelEnv:'preview',allowed:false},
 {branch:'dev',vercelEnv:undefined,allowed:false},
 {branch:'dev',vercelEnv:'',allowed:false},
 {branch:'dev',vercelEnv:'development',allowed:false},
 {branch:'dev',vercelEnv:'unknown',allowed:false},
];
for(const {branch,vercelEnv,allowed} of cases)test(`browser build branch=${branch} VERCEL_ENV=${String(vercelEnv)} ${allowed?'includes':'excludes'} approval under identical enabled dev-project config`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'calendar-gate-'));try{
 const env={...process.env,VERCEL:'1',VERCEL_GIT_COMMIT_REF:branch,VERCEL_GIT_REPO_OWNER:'wata-0911',VERCEL_GIT_REPO_SLUG:'housei-media',VERCEL_PROJECT_ID:'mock-dev-project-only',CALENDAR_APPROVAL_DEV_PROJECT_ID:'mock-dev-project-only',CALENDAR_APPROVAL_ENABLED:'true',CALENDAR_LOCAL_TEST_MODE:'true'};
 if(vercelEnv===undefined)delete env.VERCEL_ENV;else env.VERCEL_ENV=vercelEnv;
 await run(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',root,'--emptyOutDir'],{env,maxBuffer:5*1024*1024});
 const files=(await readdir(join(root,'assets'))).filter(f=>f.endsWith('.js'));const source=(await Promise.all(files.map(f=>readFile(join(root,'assets',f),'utf8')))).join('\n');
 assert.equal(source.includes('この画像を承認'),allowed);assert.equal(source.includes('/api/calendar-approve'),allowed);assert.equal(source.includes('calendar-preview-receipt-key'),false,'backend receipt key logic cannot enter browser');
 }finally{await rm(root,{recursive:true,force:true});}
});
