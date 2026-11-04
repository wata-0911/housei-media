'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const SRC = path.join(__dirname, '..', 'src');
const FOLDER = 'MOCK_FOLDER_ONLY_0001';
const FILE_A = 'MOCK_FILE_ONLY_A_0001', FILE_B = 'MOCK_FILE_ONLY_B_0002';
const WRITE = 'mock-write-secret-for-tests-only-123456789';
const READ = 'mock-read-secret-for-tests-only-987654321';
const OUTBOX = 'CALENDAR_DRAFT_SYNC_OUTBOX_V1', CURRENT = 'CALENDAR_DRAFT_SYNC_CURRENT_V1';
function crc(bytes) { let c = -1; for (const b of bytes) { c ^= b; for (let i=0;i<8;i++) c=(c>>>1)^((c&1)?0xEDB88320:0); } return (c^-1)>>>0; }
function chunk(name, data) { const t=Buffer.from(name), n=Buffer.alloc(4), c=Buffer.alloc(4); n.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,c]); }
const ihdr=Buffer.alloc(13); ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
const PNG=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND',Buffer.alloc(0))]);
function env(role) {
  const store=new Map(Object.entries({CALENDAR_DRAFT_SYNC_FOLDER_ID:FOLDER,CALENDAR_DRAFT_SYNC_WRITE_SECRET:WRITE,
    CALENDAR_DRAFT_BRIDGE_SECRET:READ,CALENDAR_DRAFT_SYNC_ENDPOINT:'https://script.google.com/macros/s/MOCK_DEPLOYMENT_ONLY/exec'}));
  const files=new Map(); const calls=[]; let uuid=0,held=false,busy=false,failWrite=null,fetcher=null,legacyFail=null,createFail=false,legacyWrites=[],clock=Date.now();
  function addFile(id, options={}) {
    const f={id,created:new Date(options.created||'2026-10-01T01:02:03.000Z'),mime:'image/png',parents:[FOLDER],trashed:false,bytes:Buffer.from(PNG),...options};
    f.getId=()=>f.id;f.isTrashed=()=>f.trashed;f.getMimeType=()=>f.mime;f.getSize=()=>f.size===undefined?f.bytes.length:f.size;
    f.getDateCreated=()=>f.created;f.getUrl=()=>`https://drive.google.com/file/d/${f.id}/view`;
    f.getParents=()=>{let i=0;return {hasNext:()=>i<f.parents.length,next:()=>({getId:()=>f.parents[i++]})};};
    f.getBlob=()=>({getBytes:()=>Array.from(f.bytes)});files.set(id,f);return f;
  }
  const propertyService={getProperty:k=>store.has(k)?store.get(k):null,getProperties:()=>Object.fromEntries(store),setProperty(k,v){
    if (failWrite==='before') {failWrite=null;throw new Error('mock property failure');}
    store.set(k,v);if(failWrite==='after'){failWrite=null;throw new Error('mock uncertain commit');}return this;
  },setProperties(values){legacyWrites.push({held,values});if(legacyFail==='before'){legacyFail=null;throw Error('mock legacy failure');}for(const [k,v] of Object.entries(values))store.set(k,v);if(legacyFail==='after'){legacyFail=null;throw Error('mock legacy uncertain');}return this; }};
  const ctx=vm.createContext({
    Date,JSON,Math,Number,String,Array,Error,RegExp,isNaN,
    PropertiesService:{getScriptProperties:()=>propertyService},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(busy||held)return false;held=true;return true;},releaseLock:()=>{held=false;}})},
    DriveApp:{getFileById:id=>{if(!files.has(id))throw new Error('not found');return files.get(id);},getFolderById:id=>{assert.equal(id,FOLDER);return {createFile:blob=>{if(createFail)throw Error('mock create failure');return addFile('MOCK_CREATED_'+String(files.size).padStart(10,'0'),{created:new Date(clock++),bytes:Buffer.from(blob.bytes)});}};}},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},computeDigest:(_,bytes)=>Array.from(crypto.createHash('sha256').update(Buffer.from(bytes)).digest()),formatDate:()=> '20261020_000000',getUuid:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`,base64Encode:bytes=>Buffer.from(bytes).toString('base64'),base64Decode:s=>Array.from(Buffer.from(s,'base64')),newBlob:(bytes,mime,name)=>({bytes,mime,name})},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:content=>({content,setMimeType(){return this;}})},
    UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});if(!fetcher)throw new Error('mock network unavailable');return fetcher(url,options);}},
  });
  for(const name of ['Shared.gs',...(role==='source'?['Gas1Sender.gs','Gas1Reservation.gs','Gas1Integration.gs']:['Gas2Receiver.gs','Gas2Reservation.gs','Gas2Integration.gs'])]) vm.runInContext(fs.readFileSync(path.join(SRC,name),'utf8'),ctx,{filename:name});
  if(role==='source') vm.runInContext(fs.readFileSync(path.join(__dirname,'..','reference','GAS1.current.redacted.gs'),'utf8').replace('function saveDraftToDrive(', 'function calendarDraftLegacySave_('),ctx,{filename:'supplied-source.gs'});
  return {ctx,store,files,calls,addFile,legacyWrites,setLegacyFail:v=>legacyFail=v,setCreateFail:v=>createFail=v,setBusy:v=>busy=v,setFail:v=>failWrite=v,setFetch:f=>fetcher=f,isHeld:()=>held};
}
function record(e, yearMonth, fileId) { e.store.set('draft_year_month',yearMonth);e.store.set('draft_file_id',fileId);return e.ctx.CalendarDraftSender.recordSavedDraft(yearMonth,fileId); }
function request(overrides={}) {return {action:'sync_current_draft_v1',secret:WRITE,yearMonth:'2026-10',fileId:FILE_A,generatedAt:'2026-10-01T01:02:03.000Z',revision:'100',draftId:'00000000-0000-4000-8000-000000000001',...overrides};}
function receive(e,r) { return JSON.parse(e.ctx.doPost({postData:{contents:JSON.stringify(r)}}).content); }
function http(body,code=200,headers={}) {return {getResponseCode:()=>code,getAllHeaders:()=>headers,getContentText:()=>typeof body==='string'?body:JSON.stringify(body)};}
function connected() {
  const source=env('source'),target=env('target'); source.addFile(FILE_A);target.addFile(FILE_A);
  source.setFetch((url,o)=>http(receive(target,JSON.parse(o.payload)))); return {source,target};
}
function snap(e,key=CURRENT) {const raw=e.store.get(key);if(key===CURRENT&&raw){try{const v=JSON.parse(raw);if(v.schemaVersion===3)return v.current===null?undefined:JSON.stringify(v.current);}catch{}}return raw;}
function setCurrent(e,state){const raw=JSON.parse(e.store.get(CURRENT));if(raw.schemaVersion===3){raw.current=state;e.store.set(CURRENT,JSON.stringify(raw));}else e.store.set(CURRENT,JSON.stringify(state));}
function code(e,r,expected) {const before=snap(e);const result=receive(e,r);assert.equal(result.code,expected);assert.equal(snap(e),before);return result;}


module.exports={env,record,request,receive,http,connected,snap,PNG,FOLDER,FILE_A,FILE_B,WRITE,READ,OUTBOX,CURRENT,code};
