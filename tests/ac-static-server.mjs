import {createServer} from 'node:http';
import {readFile,mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,extname,join} from 'node:path';
// Serves only a built snapshot, on loopback. No Vite source server or proxy.
export async function serveAc(root,entry='dev/ac/index.html'){
 const base=await mkdtemp(join(tmpdir(),'issue188-ac-static-'));await cp(resolve(root),base,{recursive:true});
 const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local');const name=decodeURIComponent(url.pathname);
  let file=resolve(base,'.'+name);
  if(!file.startsWith(base+'/'))file=resolve(base,entry);
  if(!extname(name))file=resolve(base,entry);
  try{const bytes=await readFile(file);res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(bytes);}catch{res.statusCode=404;res.end('Not found');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));return{origin:`http://127.0.0.1:${server.address().port}`,close:async()=>{await new Promise(r=>{server.closeAllConnections();server.close(r);});await rm(base,{recursive:true,force:true});}};
}
