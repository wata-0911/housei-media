import type {PersistenceHandle} from '../controller';
import type {Diagnostic} from '../../migration/contracts';
import type {DisplayRow,PageKind,SnapshotDTO} from './contracts';
import {ControllerWorkerError as Fault} from './contracts';
import {Registry} from './registry';
export function snapshot(handle:PersistenceHandle):SnapshotDTO {
 const {state,workspace,source}=handle, records=workspace.graph.ownedRecords;
 return Object.freeze({schemaVersion:state.schemaVersion,sourceKind:source.kind,active:workspace.graph.attempts.filter(a=>a.membership.kind==='active').length,
 detached:workspace.graph.attempts.filter(a=>a.membership.kind==='detached').length,ownedRecords:records.length,receipts:workspace.receipts.length,
 reservationCount:state.history.issuedIds.length,officialAchievementCount:state.retained.importedCourseAchievements.length,
 applicability:'unknown',graduationCheckComplete:false,sourceLinksReverified:false});
}
export type PageSource={handle?:PersistenceHandle;diagnostics:readonly Diagnostic[]};
// Closed display projection: no generic object serialization, original/path/raw fields.
export function displayRows(source:PageSource,kind:PageKind,offset:number,registry:Registry,replacingCursor=false):{rows:DisplayRow[];total:number;next:number|null}{
 const h=source.handle;let data:readonly unknown[];
 if(kind==='diagnostics')data=source.diagnostics;
 else{if(!h)throw new Fault('stale_view');data=kind==='attempts'?h.workspace.graph.attempts:kind==='records'?h.workspace.graph.ownedRecords:kind==='removals'?h.workspace.graph.removals:h.state.retained.importedCourseAchievements;}
 const count=Math.min(50,data.length-offset),hasNext=offset+count<data.length;registry.reserve(count+(hasNext?1:0),hasNext&&!replacingCursor?1:0);
 const rows=data.slice(offset,offset+50).map(value=>{
  const v=value as Record<string,unknown>;let text='',rowKind:string=kind,quantity:number|null=null;
  if(kind==='attempts')text=String(v.originalTitle??'');
  if(kind==='records'){rowKind=['media','correspondence','evaluation','todo'].includes(v.kind as string)?v.kind as string:'record';const payload=v.payload as Record<string,unknown>;text=rowKind==='todo'&&typeof payload?.text==='string'?payload.text:rowKind;}
  if(kind==='removals')text='removed';
  if(kind==='official'){text=typeof v.rawName==='string'?v.rawName:'';quantity=typeof v.earnedCreditsTotal==='number'?v.earnedCreditsTotal:null;}
  if(kind==='diagnostics'){// Codes only; unknown code names cannot disclose arbitrary input.
   const safe=['unsupported_state_version','invalid_json','invalid_date','invalid_state','unsupported_backup','protection_not_migratable'];text=safe.includes(v.code as string)?v.code as string:'input_diagnostic';
  }
  return Object.freeze({row:registry.mint('row',value,['display']),kind:rowKind,excerpt:text.slice(0,64),fullLength:text.length,quantity});
 });
 const next=offset+rows.length;return {rows,total:data.length,next:next<data.length?next:null};
}
