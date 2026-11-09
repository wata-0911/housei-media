import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const p=await import(process.env.F01_REAL_PLAYWRIGHT);
const dir=process.env.F01_OUTPUT;let sequence=0;
const launch=p.chromium.launch.bind(p.chromium);
p.chromium.launch=async(...args)=>{
 const b=await launch(...args);console.log(JSON.stringify({kind:'browser-version',version:b.version()}));
 const capture=async ctx=>{for(const page of ctx.pages()){if(sequence>=40)break;const n=++sequence;try{await mkdir(dir,{recursive:true});await page.screenshot({path:join(dir,'page-'+n+'.png'),timeout:5000});await writeFile(join(dir,'page-'+n+'.html'),(await page.content()).slice(0,262144));}catch(e){console.log('snapshot unavailable: '+String(e));}}};
 const nc=b.newContext.bind(b);b.newContext=async(...a)=>{const c=await nc(...a),close=c.close.bind(c);c.close=async(...x)=>{await capture(c);return close(...x);};return c;};
 return b;
};
export const chromium=p.chromium;
