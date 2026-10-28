import {assignmentIds} from '../codec';
import {buildEdits,EditIds} from './editBridge';
import type {DateCorrection} from '../../workbench/migrationSession';
import {validateControl} from './protocol';
import {EDIT_CONTROL_LIMIT} from './editInput';
import {createAttemptPersistence,type PersistenceHandle,type PersistencePreview} from '../controller';
import type {AuthorityRecord,AtomicAttemptStore} from '../contracts';
import type {prepareMigrationEnvironment} from '../../migration/source';
import type {MigrationSession} from '../../workbench/migrationSession';
import type {Diagnostic} from '../../migration/contracts';
import {backupDigest,backupRawDigest} from '../../../backup/plannerBackupCompatibility';
import {ControllerWorkerError as Fault,type Control,type Result,type Started,type ViewToken,type SessionToken,type PreviewDTO,type DraftToken} from './contracts';
import {preflight,checkRawString,checkRawBytes,INPUT_PROFILES} from './workerInput';
import {Registry,opaqueIdentifier,type Vector} from './registry';
import {SessionQueue} from './queue';
import {snapshot,displayRows,type PageSource} from './display';
import {dataRecord,keys,integer} from './protocol';

type Environment=Awaited<ReturnType<typeof prepareMigrationEnvironment>>;
type Candidate={preview:PersistencePreview;expected:AuthorityRecord};
type Draft={handle:PersistenceHandle;preview?:PersistencePreview;expected:AuthorityRecord;evidence?:'local-witness'|'live-migration'|'new-plan'};
const sameAuthority=(a:AuthorityRecord,b:AuthorityRecord)=>a.raw===b.raw&&a.revision===b.revision&&JSON.stringify(a.committed)===JSON.stringify(b.committed)&&JSON.stringify(a.issuedIds)===JSON.stringify(b.issuedIds);
/** Every actual backend record is preflighted, then returned unchanged to the
 * existing controller. Never preflight A then let controller read B. */
export function createReadonlyStore(read:()=>Promise<AuthorityRecord>,observed:(r:AuthorityRecord)=>void=()=>{}):AtomicAttemptStore {
 return {async read(){const record=await read();const r=dataRecord(record);keys(r,['raw','revision','committed','issuedIds']);if(!(r.raw===null||typeof r.raw==='string')||!integer(r.revision)||!Array.isArray(r.committed)||!Array.isArray(r.issuedIds))throw new Fault('internal');
  if(record.raw!==null)preflight(record.raw,'state');observed(record);return record;
 },async commit(){throw new Fault('readonly_mode');}};
}
/** Session dependencies are chosen by the entry, never supplied over IPC. */
export function createPreviewSession(read:()=>Promise<AuthorityRecord>,loadEnvironment:()=>Promise<Environment>,boot:number) {
 const migrationSnapshots=new WeakMap<MigrationSession,AuthorityRecord>();
 const queue=new SessionQueue();let vector:Vector={boot,sourceEpoch:0,contextRevision:1,draftRevision:0,authorityRevision:0};
 const registry=new Registry(vector);let session:SessionToken,view:ViewToken,started=false,closed=false;
 let transportRaw:string|undefined,allowAuthorityRefresh=false,authorityRevoked=false;
 // Keep the current view/Workspace for display; candidate authority never revives.
 const viewingOperations:readonly Control['op'][]=['readPage','release'];
 function requireCandidateAuthority(op:Control['op']){if(authorityRevoked&&!viewingOperations.includes(op))throw new Fault('stale_authority');}
 function invalidateAuthority():never{authorityRevoked=true;registry.revokeKinds(['draft','preview','migration','correction']);throw new Fault('stale_authority');}
 let observed:AuthorityRecord|undefined,authority:AuthorityRecord|undefined,selected:{kind:string;raw:string}|undefined;
 let pages:PageSource={diagnostics:[]};let activeDraft:Draft|undefined,activePreview:Candidate|undefined;
 const store=createReadonlyStore(read,r=>{
  if(authority&&!allowAuthorityRefresh&&!sameAuthority(authority,r))invalidateAuthority();
  observed=structuredClone(r);
 });
 let environmentTask:Promise<Environment>|undefined;const environment=()=>environmentTask??=loadEnvironment();
 const editIds=new EditIds();
 const controller=createAttemptPersistence(store,undefined,environment,undefined,{issued:id=>editIds.restrict([id]),reserved:()=>editIds.reservations()});
 const current=(id:number)=>{queue.check(id);if(closed)throw new Fault('closed');};
 function guard(c:Control){requireCandidateAuthority(c.op);if(c.session!==session||c.expectedView!==view)throw new Fault('stale_view');registry.get(c.expectedView,'view',c.op);}
 const editSubmissions=new Set<string>();
 let activeMigration:MigrationSession|undefined,corrected=false,correctionCount=0;
 const operations=['openCommitted','inspectLegacyRaw','inspectBackupRaw','prepareMigration','prepareSave','readPage','release','prepareNewPlan','prepareEdits','proposeDate','confirmDate'];
 function publish(delta:Partial<Vector>={}){vector={...vector,...delta};for(const n of Object.values(vector))if(!Number.isSafeInteger(n))throw new Fault('resource_limit');registry.advance(vector);view=registry.mint('view',{},operations);return view;}
 function select(kind:string,raw:string){if(selected&&(selected.kind!==kind||selected.raw!==raw))throw new Fault('stale_view');selected??={kind,raw};}
 function previewDTO(candidate:Candidate,draft?:DraftToken):PreviewDTO{
  const p=candidate.preview;controller.assertPreview(p);const preview=registry.mint('preview',candidate,['prepareSave']);
  const common={view,preview,summary:snapshot(p.handle),candidateBytes:p.bytes,previousPresent:p.previousRaw!==null,previousBytes:p.previousRaw===null?0:new TextEncoder().encode(p.previousRaw).byteLength,portableAdoptionRequired:p.recovery?.portable??false,canCommit:false as const};
  if(p.action==='restore')return {...common,action:'restore'};
  if(!draft)throw new Fault('internal');return {...common,action:p.action==='migration'?'migration':p.action==='new-plan'?'new-plan':'edit',draft};
 }
 function inspection(m:MigrationSession,expected:AuthorityRecord){
  const diagnostics:readonly Diagnostic[]=m.decoded.status!=='decoded'?m.decoded.diagnostics:m.preview?.diagnostics??[];
  const status=m.preview?.status??(m.decoded.status==='decoded'?'rejected':m.decoded.status);
  publish({sourceEpoch:vector.sourceEpoch+1,draftRevision:vector.draftRevision+1,authorityRevision:expected.revision});authority=expected;activeMigration=m;activeDraft=undefined;activePreview=undefined;pages={diagnostics,migration:m};
  return {view,status,diagnosticCount:diagnostics.length,...(status==='ready'?{migration:registry.mint('migration',{session:m,expected},['prepareMigration'])}:{}),...(diagnostics.length?{diagnosticsCursor:registry.mint('cursor',{kind:'diagnostics',offset:0},['readPage'])}:{})};
 }
 async function execute(c:Control,raw?:string):Promise<Result>{
  current(c.requestId);
  if(c.op==='startSession'){
   if(started)throw new Fault('protocol');started=true;
   await environment();current(c.requestId);authority=await store.read();current(c.requestId);
   vector={...vector,authorityRevision:authority.revision};publish();session=registry.mint('session',{},[]);
   return {session,view,mode:'preview-only'} satisfies Started;
  }
  if(!started)throw new Fault('protocol');guard(c);
  if(c.op==='openCommitted'){
   if(selected)throw new Fault('stale_view');
   let h:PersistenceHandle|null;allowAuthorityRefresh=true;
   try{h=await controller.load();}finally{allowAuthorityRefresh=false;}
   current(c.requestId);guard(c);
   // Null has no replacement ViewToken. An unchanged empty DB preserves the
   // draft; an externally erased authority requires a fresh session instead.
   if(!h){if(authority&&!sameAuthority(authority,observed!))invalidateAuthority();return null;}
   authority=observed!;publish({authorityRevision:authority.revision});activeDraft=undefined;activePreview=undefined;pages={diagnostics:[],...(h?{handle:h}:{})};
   activeDraft={handle:h,expected:authority};
   return {view,handle:registry.mint('handle',h,['display']),draft:registry.mint('draft',activeDraft,['prepareSave','prepareEdits']),summary:snapshot(h),evidence:'local-witness'};
  }
  if(c.op==='prepareNewPlan'){
   if(selected)throw new Fault('stale_view');
   const p=await controller.prepareNewPlan();current(c.requestId);guard(c);await store.read();current(c.requestId);guard(c);controller.assertPreview(p);preflight(JSON.stringify(p.handle.state),'state');
   const expected=observed!,candidate={preview:p,expected};select('new-plan','');publish({sourceEpoch:vector.sourceEpoch+1,draftRevision:vector.draftRevision+1});activePreview=candidate;activeDraft={handle:p.handle,preview:p,expected,evidence:'new-plan'};pages={handle:p.handle,diagnostics:[]};
   return previewDTO(candidate,registry.mint('draft',activeDraft,['prepareSave','prepareEdits']));
  }
  if(c.op==='prepareEdits'){
   const d=registry.get<Draft>(c.draft!,'draft',c.op);
   const submission=JSON.stringify([c.expectedView,c.draft,c.intents],(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);if(editSubmissions.has(submission))throw new Fault('protocol');editSubmissions.add(submission);
   await store.read();current(c.requestId);guard(c);
   const commands=buildEdits(d.handle,d.expected,c.intents!,registry,editIds);
   const p=await controller.prepareEdits(d.handle,commands);current(c.requestId);guard(c);await store.read();current(c.requestId);guard(c);controller.assertPreview(p);preflight(JSON.stringify(p.handle.state),'state');
   const candidate={preview:p,expected:d.expected},next={handle:p.handle,preview:p,expected:d.expected,evidence:d.evidence??'local-witness' as const};
   if(!selected)select('committed',d.expected.raw??'');
   publish({draftRevision:vector.draftRevision+1});activeDraft=next;activePreview=candidate;pages={handle:p.handle,diagnostics:[]};
   return {view,handle:registry.mint('handle',p.handle,['display']),draft:registry.mint('draft',next,['prepareSave','prepareEdits']),summary:snapshot(p.handle),evidence:next.evidence};
  }
  if(c.op==='proposeDate'){
   const target=registry.get<{session:MigrationSession;date:{offeringId:string;assessmentId:string}}>(c.date!,'row',c.op);
   if(target.session!==activeMigration||correctionCount>=128)throw new Fault('stale_view');
   await store.read();current(c.requestId);guard(c);
   const proposal=await controller.proposeDate(target.session,target.date.offeringId,target.date.assessmentId,c.newDate!);current(c.requestId);guard(c);
   if(proposal.oldDate.length>64)throw new Fault('resource_limit');
   return {view,correction:registry.mint('correction',{session:target.session,proposal,expected:migrationSnapshots.get(target.session)!},['confirmDate']),oldDate:proposal.oldDate,newDate:proposal.newDate};
  }
  if(c.op==='confirmDate'){
   const target=registry.get<{session:MigrationSession;proposal:DateCorrection;expected:AuthorityRecord}>(c.correction!,'correction',c.op);
   if(c.confirmed!==true||target.session!==activeMigration)throw new Fault('invalid_input');
   // Detect authority before ID issuance and once more after every awaited work.
   await store.read();current(c.requestId);guard(c);
   const m=await controller.confirmDate(target.session,target.proposal,true);if(m.table)editIds.restrict([...assignmentIds(m.table),...m.reservedIds]);current(c.requestId);guard(c);
   await store.read();current(c.requestId);guard(c);
   migrationSnapshots.set(m,target.expected);corrected=true;correctionCount++;
   return inspection(m,target.expected);
  }
  if(c.op==='inspectLegacyRaw'||c.op==='inspectBackupRaw'){
   if(activeDraft?.preview?.action==='edit')throw new Fault('stale_view');
   if(typeof raw!=='string')throw new Fault('protocol');select(c.op,raw);preflight(raw,c.op==='inspectLegacyRaw'?'legacy':'backup');
   if(c.op==='inspectLegacyRaw'){
    const m=corrected&&activeMigration?(await store.read(),activeMigration):await controller.inspectLegacy(raw);
    if(m.table)editIds.restrict([...assignmentIds(m.table),...m.reservedIds]);
    // A controller cache hit retains its ORIGINAL authority, including fields
    // that may change without a revision increment. Never rebind its metadata.
    const actual=observed!,expected=migrationSnapshots.get(m)??actual;migrationSnapshots.set(m,expected);
    current(c.requestId);guard(c);if(!sameAuthority(expected,actual))invalidateAuthority();
    return inspection(m,expected);
   }
   const p=await controller.inspectBackup(raw);current(c.requestId);guard(c);controller.assertPreview(p);const expected=observed!;
   publish({sourceEpoch:1,authorityRevision:expected.revision});authority=expected;activeDraft=undefined;activePreview={preview:p,expected};pages={handle:p.handle,diagnostics:[]};
   const version=(preflight(raw,'backup').value as {backupVersion:1|2|3}).backupVersion;
   return {view,status:'ready',restorePreview:registry.mint('preview',activePreview,['prepareSave']),diagnosticCount:0,backupVersion:version,evidence:p.recovery?.portable?'portable-unadopted':'local-witness'};
  }
  if(c.op==='prepareMigration'){
   const m=registry.get<{session:MigrationSession;expected:AuthorityRecord}>(c.migration!,'migration',c.op);
   // Controller independently checks WeakMap membership and live assignment.
   await store.read();current(c.requestId);guard(c);
   const p=await controller.prepareMigration(m.session);current(c.requestId);guard(c);await store.read();current(c.requestId);guard(c);controller.assertPreview(p);preflight(JSON.stringify(p.handle.state),'state');
   const candidate={preview:p,expected:m.expected};publish({draftRevision:vector.draftRevision+1});activePreview=candidate;activeDraft={handle:p.handle,preview:p,expected:m.expected,evidence:'live-migration'};pages={handle:p.handle,diagnostics:[]};
   return previewDTO(candidate,registry.mint('draft',activeDraft,['prepareSave','prepareEdits']));
  }
  if(c.op==='prepareSave'){
   let candidate:Candidate;
   if(c.draft){const d=registry.get<Draft>(c.draft,'draft',c.op);
    // Also authenticates the actual handle via controller's private WeakMap.
    const p=await controller.prepareEdits(d.handle,[]);current(c.requestId);guard(c);candidate={preview:d.preview??p,expected:d.expected};
   }else {candidate=registry.get<Candidate>(c.restorePreview!,'preview',c.op);if(candidate.preview.action!=='restore')throw new Fault('stale_view');}
   controller.assertPreview(candidate.preview);
   const actual=await store.read();current(c.requestId);guard(c);
   if(!sameAuthority(candidate.expected,actual))invalidateAuthority();
   preflight(JSON.stringify(candidate.preview.handle.state),'state');
   const hint={kind:'untrusted-recovery-hint' as const,version:1 as const,submissionKey:opaqueIdentifier(),
    baseAuthoritySha256:await backupDigest(actual),candidateStateSha256:await backupDigest(candidate.preview.handle.state),candidateRawSha256:await backupRawDigest(JSON.stringify(candidate.preview.handle.state))};
   current(c.requestId);guard(c);registry.revokeKinds(['preview']);activePreview=candidate;
   return {preview:previewDTO(candidate,c.draft as DraftToken|undefined),recoveryHint:hint};
  }
  if(c.op==='readPage'){
   let offset=0;if(c.cursor){const cursor=registry.get<{kind:string;offset:number}>(c.cursor,'cursor',c.op);if(cursor.kind!==c.kind)throw new Fault('protocol');offset=cursor.offset;}
   const result=displayRows(pages,c.kind!,offset,registry,!!c.cursor);
   // Consume cursor before issuing the next one; repeated request joins ledger.
   if(c.cursor)registry.release(c.cursor);
   return {view,rows:result.rows,total:result.total,...(result.next!==null?{cursor:registry.mint('cursor',{kind:c.kind,offset:result.next},['readPage'])}:{})};
  }
  registry.release(c.token!);return null;
 }
 return {
  request(c:Control,raw?:string){
   // Freeze the admitted primitive request before queueing; direct unit callers
   // cannot mutate a pending intent after its ledger fingerprint was recorded.
   try{if(raw!==undefined){checkRawString(raw);checkRawBytes(raw,INPUT_PROFILES[c.op==='inspectLegacyRaw'?'legacy':'backup']);}validateControl(c);if(c.boot!==boot)throw new Fault('protocol');const encoded=JSON.stringify(c);if(encoded.length>EDIT_CONTROL_LIMIT)throw new Fault('resource_limit');c=JSON.parse(encoded) as Control;}catch(e){return Promise.reject(e);}
   if(closed)return Promise.reject(new Fault('closed'));
   // Also gate settled-ledger replay: an old successful DTO cannot renew eligibility.
   try{requireCandidateAuthority(c.op);if(raw!==undefined){
    if(!queue.has(c.requestId)){guard(c);if(transportRaw!==undefined&&transportRaw!==raw)throw new Fault('stale_view');transportRaw??=raw;raw=transportRaw;}
   }}catch(e){return Promise.reject(e);}
   // Exact collision-free key: bounded header plus ONE canonical selected raw
   // reference. Busy/duplicate traffic performs no eager TextEncoder/hash allocation.
   const fingerprint=raw===undefined?[JSON.stringify(c)]:[JSON.stringify(c),raw];
   return queue.run(c.requestId,fingerprint,raw!==undefined,()=>execute(c,raw),new TextEncoder().encode(JSON.stringify(c.op==='prepareEdits'?c.intents:c)).byteLength);
  },cancel(id:number){queue.cancel(id);},close(){closed=true;queue.close();registry.clear();editSubmissions.clear();activeMigration=undefined;selected=undefined;transportRaw=undefined;activeDraft=undefined;activePreview=undefined;pages={diagnostics:[]};authority=undefined;observed=undefined;},
 };
}
