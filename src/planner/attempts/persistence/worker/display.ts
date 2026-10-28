import type {PersistenceHandle} from '../controller';
import type {Diagnostic} from '../../migration/contracts';
import type {MigrationSession} from '../../workbench/migrationSession';
import {heldDates} from '../../workbench/migrationSession';
import {createInstitutionalSearchAdapter} from '../../../institutional/search';
import {CURRENT_CURRICULUM_SEARCH_TARGET} from '../../../institutional/currentSearch';
import type {DisplayRow,PageKind,SnapshotDTO} from './contracts';
import {ControllerWorkerError as Fault} from './contracts';
import type {EditRow} from './editBridge';
import {Registry} from './registry';
export function snapshot(handle:PersistenceHandle):SnapshotDTO {
 const {state,workspace,source}=handle, records=workspace.graph.ownedRecords;
 return Object.freeze({schemaVersion:state.schemaVersion,sourceKind:source.kind,active:workspace.graph.attempts.filter(a=>a.membership.kind==='active').length,
 detached:workspace.graph.attempts.filter(a=>a.membership.kind==='detached').length,ownedRecords:records.length,receipts:workspace.receipts.length,
 reservationCount:state.history.issuedIds.length,officialAchievementCount:state.retained.importedCourseAchievements.length,
 applicability:'unknown',graduationCheckComplete:false,sourceLinksReverified:false});
}
export type PageSource={handle?:PersistenceHandle;diagnostics:readonly Diagnostic[];migration?:MigrationSession};
// Purpose-bound references are private; no raw/source/IDs are serialized.
export function displayRows(source:PageSource,kind:PageKind,offset:number,registry:Registry,replacingCursor=false):{rows:DisplayRow[];total:number;next:number|null}{
 const h=source.handle;let data:readonly unknown[];
 if(kind==='diagnostics')data=source.diagnostics;
 else if(kind==='dates')data=source.migration?heldDates(source.migration):[];
 else{if(!h)throw new Fault('stale_view');data=kind==='attempts'?h.workspace.graph.attempts:kind==='records'?h.workspace.graph.ownedRecords:kind==='removals'?h.workspace.graph.removals:kind==='owners'?h.workspace.graph.ownedRecords.map(r=>r.owner).filter(o=>o!==null):kind==='assessments'?h.workspace.graph.ownedRecords.flatMap(r=>r.kind==='media'?r.payload.assessments.map(a=>({assessment:a,recordId:r.id})):[]):kind==='search'?createInstitutionalSearchAdapter(h.source.context.catalog,CURRENT_CURRICULUM_SEARCH_TARGET).search({scope:{kind:'all'}}).rows:h.state.retained.importedCourseAchievements;}
 const count=Math.min(50,data.length-offset),hasNext=offset+count<data.length;registry.reserve(count+(hasNext?1:0),hasNext&&!replacingCursor?1:0);
 const rows=data.slice(offset,offset+50).map(value=>{
  const v=value as Record<string,unknown>;let text='',rowKind:string=kind,quantity:number|null=null,privateValue:unknown=value,ops=['display'];
  const purpose=kind==='attempts'?'attempt':kind==='records'?'record':kind==='removals'?'removal':kind==='search'?'selection':kind==='assessments'?'assessment':kind==='owners'?'owner':null;
  if(kind==='attempts')text=String(v.originalTitle??'');
  if(kind==='records'){rowKind=['media','correspondence','evaluation','todo'].includes(v.kind as string)?v.kind as string:'record';const payload=v.payload as Record<string,unknown>;text=rowKind==='todo'&&typeof payload?.text==='string'?payload.text:rowKind;}
  if(kind==='owners')text=String(v.kind);
  if(kind==='removals')text='removed';
  if(kind==='search'){const p=v.placement as {officialName:string;kind:string};text=p.officialName;rowKind=p.kind;}
  if(kind==='assessments'){privateValue=v.assessment;text=String((v.assessment as {label:string}).label);}
  if(kind==='dates'){text=String(v.date);privateValue={session:source.migration,date:value};ops=['proposeDate'];}
  if(kind==='official'){text=typeof v.rawName==='string'?v.rawName:'';quantity=typeof v.earnedCreditsTotal==='number'?v.earnedCreditsTotal:null;}
  if(kind==='diagnostics'){
   const safe=['unsupported_state_version','invalid_json','invalid_date','invalid_state','unsupported_backup','protection_not_migratable'];text=safe.includes(v.code as string)?v.code as string:'input_diagnostic';
  }
  if(purpose){privateValue={purpose,value:privateValue,...(kind==='assessments'?{recordId:v.recordId as string}:{})} satisfies EditRow;ops=['prepareEdits'];}
  return Object.freeze({row:registry.mint('row',privateValue,ops),kind:rowKind,excerpt:text.slice(0,64),fullLength:text.length,quantity});
 });
 const next=offset+rows.length;return {rows,total:data.length,next:next<data.length?next:null};
}
