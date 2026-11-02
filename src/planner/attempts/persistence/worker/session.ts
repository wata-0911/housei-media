import {readAuthoritySnapshot,isVersioned,replayReadonlyState,content,type ReadHandle} from './versionedRead';
import {sameAuthoritySnapshot} from '../authoritySnapshot';
import {sameAttemptData} from '../../validation';
import {decodeStateJson,decodeBackupJson} from '../contractDecoders';
import {legacyReservationAnalysis,previewLegacyRule2Migration} from '../legacyPreview';
import type {ReservationCoverage} from '../versionedContracts';
import type {ContentDTO} from './contracts';
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


type Environment=Awaited<ReturnType<typeof prepareMigrationEnvironment>>;
type Candidate={preview:PersistencePreview;expected:AuthorityRecord};
type Draft={handle:PersistenceHandle;preview?:PersistencePreview;expected:AuthorityRecord;evidence?:'local-witness'|'live-migration'|'new-plan'};
const sameAuthority=sameAuthoritySnapshot;
/** Strict validation belongs to the exact read being returned. No shared
 * observed record, normalization, reservation import or token registration. */
export function createReadonlyStore(read:()=>Promise<AuthorityRecord>,observed:(r:AuthorityRecord)=>void=()=>{}):AtomicAttemptStore {
 return {async read(){const record=await readAuthoritySnapshot(await read());observed(record);return record;},async commit(){throw new Fault('readonly_mode');}};
}
type ReadCandidate={kind:'readonly';handle:ReadHandle;raw:string;expected:AuthorityRecord;content:ContentDTO;action:'restore'|'migration';portable:boolean};
type RuleMigration={kind:'rule2';raw:string;expected:AuthorityRecord};
/** Session dependencies are chosen by the entry, never supplied over IPC. */
export function createPreviewSession(read:()=>Promise<AuthorityRecord>,loadEnvironment:()=>Promise<Environment>,boot:number) {
 const migrationSnapshots=new WeakMap<MigrationSession,AuthorityRecord>();
 const queue=new SessionQueue();let vector:Vector={boot,sourceEpoch:0,contextRevision:1,draftRevision:0,authorityRevision:0};
 const registry=new Registry(vector);let session:SessionToken,view:ViewToken,started=false,closed=false;
 let transportRaw:string|undefined,authorityRevoked=false;
 // Keep the current view/Workspace for display; candidate authority never revives.
 const viewingOperations:readonly Control['op'][]=['readPage','release'];
 function requireCandidateAuthority(op:Control['op']){if(authorityRevoked&&!viewingOperations.includes(op))throw new Fault('stale_authority');}
 function invalidateAuthority():never{authorityRevoked=true;registry.revokeKinds(['draft','preview','migration','correction']);throw new Fault('stale_authority');}
 let operation:{snapshot?:AuthorityRecord}|undefined;let authority:AuthorityRecord|undefined,selected:{kind:string;raw:string}|undefined;
 let pages:PageSource={diagnostics:[]};let activeDraft:Draft|undefined,activePreview:Candidate|undefined;
 const validatedStore=createReadonlyStore(read);
 const store:AtomicAttemptStore={...validatedStore,async read(){
  // Capture this operation BEFORE the backend/decoder awaits. The queue never
  // overlaps executions; completion additionally checks the captured context.
  const observation=operation;
  try{const record=await validatedStore.read();
   if(!observation||closed)throw new Fault('closed');
   if(authority&&!sameAuthority(authority,record))invalidateAuthority();
   editIds.restrict(record.issuedIds);observation.snapshot=record;return record;
  }catch(error){authorityRevoked=true;registry.revokeKinds(['draft','preview','migration','correction']);if(authority&&!(error instanceof Fault&&error.code==='closed'))throw new Fault('stale_authority');throw error;}
 }};
 let initialEnvironment:Environment|undefined;
 async function environment(){
  try{const latest=await loadEnvironment();if(initialEnvironment&&!sameAttemptData(initialEnvironment,latest))throw new Fault('environment_changed');return latest;}
  catch{authorityRevoked=true;registry.revokeKinds(['draft','preview','migration','correction']);throw new Fault('environment_changed');}
 }
 async function verifyEnvironment(){await environment();}
 let readCandidate:ReadCandidate|undefined;
 async function checkReplayEnvironment(handle:ReadHandle){if('environment' in handle&&!sameAttemptData(handle.environment,await environment())){authorityRevoked=true;registry.revokeKinds(['draft','preview','migration','correction']);throw new Fault('environment_changed');}}
 async function finish(c:Control){await store.read();await verifyEnvironment();current(c.requestId);guard(c);}
 function readonlyPreview(candidate:ReadCandidate,draft?:DraftToken):PreviewDTO {
  const common={view,preview:registry.mint('preview',candidate,['prepareSave']),summary:snapshot(candidate.handle),candidateBytes:new TextEncoder().encode(candidate.raw).byteLength,previousPresent:candidate.expected.raw!==null,previousBytes:candidate.expected.raw===null?0:new TextEncoder().encode(candidate.expected.raw).byteLength,portableAdoptionRequired:candidate.portable,canCommit:false as const,content:candidate.content};
  if(candidate.action==='restore')return {...common,action:'restore'};
  if(!draft)throw new Fault('internal');return {...common,action:'migration',draft};
 }
 const editIds=new EditIds();
 const controller=createAttemptPersistence(store,undefined,environment,undefined,{issued:id=>editIds.restrict([id]),reserved:()=>editIds.reservations(),beforeCommand:(workspace,command)=>editIds.checkCommand(workspace,command)});
 const current=(id:number)=>{queue.check(id);if(closed)throw new Fault('closed');};
 function guard(c:Control){requireCandidateAuthority(c.op);if(c.session!==session||c.expectedView!==view)throw new Fault('stale_view');registry.get(c.expectedView,'view',c.op);}
 const editSubmissions=new Set<string>();
 let activeMigration:MigrationSession|undefined,corrected=false,correctionCount=0;
 const operations=['openCommitted','inspectLegacyRaw','inspectBackupRaw','inspectAttemptRaw','prepareMigration','prepareSave','readPage','release','prepareNewPlan','prepareEdits','proposeDate','confirmDate'];
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
  const observation:{snapshot?:AuthorityRecord}={};operation=observation;
  current(c.requestId);
  if(c.op==='startSession'){
   if(started)throw new Fault('protocol');started=true;
   initialEnvironment=structuredClone(await environment());current(c.requestId);authority=await store.read();current(c.requestId);
   vector={...vector,authorityRevision:authority.revision};publish();session=registry.mint('session',{},[]);
   return {session,view,mode:'preview-only'} satisfies Started;
  }
  if(!started)throw new Fault('protocol');guard(c);
  if(!viewingOperations.includes(c.op)){await verifyEnvironment();current(c.requestId);guard(c);}
  if(readCandidate&&['prepareEdits','prepareNewPlan','proposeDate','confirmDate'].includes(c.op))throw new Fault('readonly_mode');
  if(c.op==='openCommitted'){
   if(selected)throw new Fault('stale_view');
   const initial=await store.read();
   current(c.requestId);guard(c);
   if(isVersioned(initial)&&initial.raw!==null){
    const checked=await decodeStateJson(initial.raw),handle=await replayReadonlyState(checked.value);await checkReplayEnvironment(handle);
    // Recheck exactly this operation's record after replay; never use a later
    // shared observation as provenance for an earlier handle.
    if(!sameAuthority(initial,await store.read()))invalidateAuthority();await verifyEnvironment();current(c.requestId);guard(c);
    authority=initial;publish({authorityRevision:initial.revision});activeDraft=undefined;activePreview=undefined;pages={handle,diagnostics:[],readonly:true};
    const meta=content(handle.state,'host-content',(initial as AuthorityRecord&{reservationCoverage:ReservationCoverage}).reservationCoverage);
    readCandidate={kind:'readonly',handle,raw:initial.raw,expected:initial,content:meta,action:'restore',portable:false};
    return {view,handle:registry.mint('handle',handle,['display']),summary:snapshot(handle),content:meta,evidence:'local-witness'};
   }
   if(isVersioned(initial)){if(!sameAuthority(authority,initial))invalidateAuthority();await verifyEnvironment();current(c.requestId);guard(c);return null;}
   let h:PersistenceHandle|null;
   try{h=await controller.load();}finally{current(c.requestId);}
   current(c.requestId);guard(c);if(!sameAuthority(initial,observation.snapshot))invalidateAuthority();await verifyEnvironment();current(c.requestId);guard(c);
   readCandidate=undefined;
   // Null has no replacement ViewToken. An unchanged empty DB preserves the
   // draft; an externally erased authority requires a fresh session instead.
   if(!h){if(authority&&!sameAuthority(authority,observation.snapshot!))invalidateAuthority();return null;}
   authority=observation.snapshot!;publish({authorityRevision:authority.revision});activeDraft=undefined;activePreview=undefined;pages={diagnostics:[],...(h?{handle:h}:{})};
   activeDraft={handle:h,expected:authority};
   return {view,handle:registry.mint('handle',h,['display']),draft:registry.mint('draft',activeDraft,['prepareSave','prepareEdits']),summary:snapshot(h),evidence:'local-witness'};
  }
  if(c.op==='prepareNewPlan'){
   if(isVersioned(await store.read()))throw new Fault('readonly_mode');current(c.requestId);guard(c);
   if(selected)throw new Fault('stale_view');
   const p=await controller.prepareNewPlan();current(c.requestId);guard(c);await store.read();current(c.requestId);guard(c);controller.assertPreview(p);preflight(JSON.stringify(p.handle.state),'state');
   await finish(c);const expected=observation.snapshot!,candidate={preview:p,expected};select('new-plan','');publish({sourceEpoch:vector.sourceEpoch+1,draftRevision:vector.draftRevision+1});activePreview=candidate;activeDraft={handle:p.handle,preview:p,expected,evidence:'new-plan'};pages={handle:p.handle,diagnostics:[]};
   return previewDTO(candidate,registry.mint('draft',activeDraft,['prepareSave','prepareEdits']));
  }
  if(c.op==='prepareEdits'){
   const d=registry.get<Draft>(c.draft!,'draft',c.op);
   const submission=JSON.stringify([c.expectedView,c.draft,c.intents],(_,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);if(editSubmissions.has(submission))throw new Fault('protocol');editSubmissions.add(submission);
   await store.read();current(c.requestId);guard(c);
   const commands=buildEdits(d.handle,d.expected,c.intents!,registry,editIds);
   const p=await controller.prepareEdits(d.handle,commands);current(c.requestId);guard(c);await store.read();current(c.requestId);guard(c);controller.assertPreview(p);preflight(JSON.stringify(p.handle.state),'state');
   await finish(c);const candidate={preview:p,expected:d.expected},next={handle:p.handle,preview:p,expected:d.expected,evidence:d.evidence??'local-witness' as const};
   if(!selected)select('committed',d.expected.raw??'');
   publish({draftRevision:vector.draftRevision+1});activeDraft=next;activePreview=candidate;pages={handle:p.handle,diagnostics:[]};
   return {view,handle:registry.mint('handle',p.handle,['display']),draft:registry.mint('draft',next,['prepareSave','prepareEdits']),summary:snapshot(p.handle),evidence:next.evidence};
  }
  if(c.op==='proposeDate'){
   const target=registry.get<{session:MigrationSession;date:{offeringId:string;assessmentId:string}}>(c.date!,'row',c.op);
   if(target.session!==activeMigration||correctionCount>=128)throw new Fault('stale_view');
   await store.read();current(c.requestId);guard(c);
   const proposal=await controller.proposeDate(target.session,target.date.offeringId,target.date.assessmentId,c.newDate!);current(c.requestId);guard(c);
   await finish(c);if(proposal.oldDate.length>64)throw new Fault('resource_limit');
   return {view,correction:registry.mint('correction',{session:target.session,proposal,expected:migrationSnapshots.get(target.session)!},['confirmDate']),oldDate:proposal.oldDate,newDate:proposal.newDate};
  }
  if(c.op==='confirmDate'){
   const target=registry.get<{session:MigrationSession;proposal:DateCorrection;expected:AuthorityRecord}>(c.correction!,'correction',c.op);
   if(c.confirmed!==true||target.session!==activeMigration)throw new Fault('invalid_input');
   // Detect authority before ID issuance and once more after every awaited work.
   await store.read();current(c.requestId);guard(c);
   const m=await controller.confirmDate(target.session,target.proposal,true);if(m.table)editIds.restrict([...assignmentIds(m.table),...m.reservedIds]);current(c.requestId);guard(c);
   await store.read();current(c.requestId);guard(c);
   await finish(c);migrationSnapshots.set(m,target.expected);corrected=true;correctionCount++;
   return inspection(m,target.expected);
  }
  if(c.op==='inspectAttemptRaw'||c.op==='inspectBackupRaw'){
   if(typeof raw!=='string')throw new Fault('protocol');
   const admitted=preflight(raw,c.op==='inspectAttemptRaw'?'state':'backup');
   const expected=await store.read();current(c.requestId);guard(c);
   if(c.op==='inspectAttemptRaw'||isVersioned(expected)||![1,2,3].includes((admitted.value as {backupVersion:number}).backupVersion)){
    if(activeDraft?.preview?.action==='edit')throw new Fault('stale_view');select(c.op,raw);
    const decoded=c.op==='inspectAttemptRaw'?await decodeStateJson(raw):await decodeBackupJson(raw);
    const state='backupVersion' in decoded.value?decoded.value.state:decoded.value;
    const handle=await replayReadonlyState(state);await checkReplayEnvironment(handle);
    const analysis=c.op==='inspectAttemptRaw'&&state.rule.version===1?await legacyReservationAnalysis(raw):undefined;
    if('backupVersion' in decoded.value&&decoded.value.backupVersion===1&&!expected.committed.includes(await backupDigest(state)))throw new Error('backup_unknown_checkpoint');
    await finish(c);
    const coverage='reservationCoverage' in decoded.value?decoded.value.reservationCoverage:undefined;
    const meta=content(state,c.op==='inspectAttemptRaw'?'submitted-state':'unadopted-backup',coverage,analysis?(analysis.status==='held'?'held':'candidate'):'none');
    publish({sourceEpoch:vector.sourceEpoch+1,draftRevision:vector.draftRevision+1,authorityRevision:expected.revision});authority=expected;activeDraft=undefined;activePreview=undefined;activeMigration=undefined;pages={handle,diagnostics:[],readonly:true};
    const candidate:ReadCandidate={kind:'readonly',handle,raw:JSON.stringify(state),expected,content:meta,action:'restore',portable:c.op==='inspectBackupRaw'&&(decoded.value as {backupVersion?:number}).backupVersion!==1};readCandidate=candidate;
    return {view,status:analysis?.status==='held'?'held':'ready',diagnosticCount:analysis?.blockers.length??0,summary:snapshot(handle),content:meta,...(analysis?.status==='migration-candidate'?{migration:registry.mint('migration',{kind:'rule2',raw,expected} satisfies RuleMigration,['prepareMigration'])}:{}),...(c.op==='inspectBackupRaw'?{backupVersion:(decoded.value as {backupVersion:1|2|3|4}).backupVersion,evidence:((decoded.value as {backupVersion:number}).backupVersion===1?'local-witness':'portable-unadopted') as 'local-witness'|'portable-unadopted',restorePreview:registry.mint('preview',candidate,['prepareSave'])}:{})};
   }
  }
  if(c.op==='inspectLegacyRaw'||c.op==='inspectBackupRaw'){
   if(activeDraft?.preview?.action==='edit')throw new Fault('stale_view');
   if(typeof raw!=='string')throw new Fault('protocol');select(c.op,raw);preflight(raw,c.op==='inspectLegacyRaw'?'legacy':'backup');
   if(c.op==='inspectLegacyRaw'){
    // v22's existing live migration controller remains rule1-host only. Do not
    // strip a v2 authority down to four fields to mint migration credentials.
    if(isVersioned(await store.read()))throw new Fault('readonly_mode');current(c.requestId);guard(c);
    const m=corrected&&activeMigration?(await store.read(),activeMigration):await controller.inspectLegacy(raw);
    if(m.table)editIds.restrict([...assignmentIds(m.table),...m.reservedIds]);
    // A controller cache hit retains its ORIGINAL authority, including fields
    // that may change without a revision increment. Never rebind its metadata.
    const actual=observation.snapshot!,expected=migrationSnapshots.get(m)??actual;migrationSnapshots.set(m,expected);
    current(c.requestId);guard(c);if(!sameAuthority(expected,actual))invalidateAuthority();
    await finish(c);return inspection(m,expected);
   }
   const p=await controller.inspectBackup(raw);current(c.requestId);guard(c);controller.assertPreview(p);await finish(c);readCandidate=undefined;const expected=observation.snapshot!;
   publish({sourceEpoch:1,authorityRevision:expected.revision});authority=expected;activeDraft=undefined;activePreview={preview:p,expected};pages={handle:p.handle,diagnostics:[]};
   const version=(preflight(raw,'backup').value as {backupVersion:1|2|3}).backupVersion;
   return {view,status:'ready',restorePreview:registry.mint('preview',activePreview,['prepareSave']),diagnosticCount:0,backupVersion:version,evidence:p.recovery?.portable?'portable-unadopted':'local-witness'};
  }
  if(c.op==='prepareMigration'){
   const target=registry.get<RuleMigration|{session:MigrationSession;expected:AuthorityRecord}>(c.migration!,'migration',c.op);
   if('kind' in target){
    const actual=await store.read();if(!sameAuthority(target.expected,actual))invalidateAuthority();
    const preview=await previewLegacyRule2Migration(target.raw);if(preview.status!=='preview')throw new Fault('invalid_input');
    const handle=await replayReadonlyState(preview.candidate);await checkReplayEnvironment(handle);preflight(JSON.stringify(preview.candidate),'state');await finish(c);
    const candidate:ReadCandidate={kind:'readonly',handle,raw:JSON.stringify(preview.candidate),expected:target.expected,content:content(preview.candidate,'submitted-state',preview.reservationCoverage,'preview'),action:'migration',portable:false};
    publish({draftRevision:vector.draftRevision+1});readCandidate=candidate;pages={handle,diagnostics:[],readonly:true};
    return readonlyPreview(candidate,registry.mint('draft',candidate,['prepareSave']));
   }
   const m=registry.get<{session:MigrationSession;expected:AuthorityRecord}>(c.migration!,'migration',c.op);
   // Controller independently checks WeakMap membership and live assignment.
   await store.read();current(c.requestId);guard(c);
   const p=await controller.prepareMigration(m.session);current(c.requestId);guard(c);await store.read();current(c.requestId);guard(c);controller.assertPreview(p);preflight(JSON.stringify(p.handle.state),'state');
   await finish(c);const candidate={preview:p,expected:m.expected};publish({draftRevision:vector.draftRevision+1});activePreview=candidate;activeDraft={handle:p.handle,preview:p,expected:m.expected,evidence:'live-migration'};pages={handle:p.handle,diagnostics:[]};
   return previewDTO(candidate,registry.mint('draft',activeDraft,['prepareSave','prepareEdits']));
  }
  if(c.op==='prepareSave'){
   if(readCandidate){
    const candidate=registry.get<ReadCandidate>(c.draft??c.restorePreview!,c.draft?'draft':'preview',c.op);
    if(candidate.kind!=='readonly'||candidate!==readCandidate||(c.restorePreview&&candidate.action!=='restore'))throw new Fault('stale_view');
    const actual=await store.read();if(!sameAuthority(candidate.expected,actual))invalidateAuthority();
    const checked=await decodeStateJson(candidate.raw),handle=await replayReadonlyState(checked.value);await checkReplayEnvironment(handle);
    const hint={kind:'untrusted-recovery-hint' as const,version:1 as const,submissionKey:opaqueIdentifier(),baseAuthoritySha256:await backupDigest(actual),candidateStateSha256:await backupDigest(handle.state),candidateRawSha256:await backupRawDigest(candidate.raw)};
    await finish(c);registry.revokeKinds(['preview']);return {preview:readonlyPreview(candidate,c.draft as DraftToken|undefined),recoveryHint:hint};
   }
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
   await finish(c);registry.revokeKinds(['preview']);activePreview=candidate;
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
   try{if(raw!==undefined){checkRawString(raw);checkRawBytes(raw,INPUT_PROFILES[c.op==='inspectLegacyRaw'?'legacy':c.op==='inspectAttemptRaw'?'state':'backup']);}validateControl(c);if(c.boot!==boot)throw new Fault('protocol');const encoded=JSON.stringify(c);if(encoded.length>EDIT_CONTROL_LIMIT)throw new Fault('resource_limit');c=JSON.parse(encoded) as Control;}catch(e){return Promise.reject(e);}
   if(closed)return Promise.reject(new Fault('closed'));
   // Also gate settled-ledger replay: an old successful DTO cannot renew eligibility.
   try{requireCandidateAuthority(c.op);if(raw!==undefined){
    if(!queue.has(c.requestId)){guard(c);if(transportRaw!==undefined&&transportRaw!==raw)throw new Fault('stale_view');transportRaw??=raw;raw=transportRaw;}
   }}catch(e){return Promise.reject(e);}
   // Exact collision-free key: bounded header plus ONE canonical selected raw
   // reference. Busy/duplicate traffic performs no eager TextEncoder/hash allocation.
   const fingerprint=raw===undefined?[JSON.stringify(c)]:[JSON.stringify(c),raw];
   return queue.run(c.requestId,fingerprint,raw!==undefined,async()=>{try{return await execute(c,raw);}finally{operation=undefined;}},new TextEncoder().encode(JSON.stringify(c.op==='prepareEdits'?c.intents:c)).byteLength);
  },cancel(id:number){queue.cancel(id);},close(){closed=true;queue.close();registry.clear();editSubmissions.clear();activeMigration=undefined;selected=undefined;transportRaw=undefined;activeDraft=undefined;activePreview=undefined;pages={diagnostics:[]};authority=undefined;operation=undefined;readCandidate=undefined;initialEnvironment=undefined;},
 };
}
