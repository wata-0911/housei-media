import type {AttemptPlan,AttemptMethod,AttemptOwnedRecord} from '../../types';
import type {MediaLessonProgress,MediaAssessment,ReportProgress} from '../../../plannerCatalog';
import type {Token} from './contracts';
export type RowToken=Token<'row'>;
export type CorrectionToken=Token<'correction'>;
export type PlanInput=Pick<AttemptPlan,'status'|'plannedYear'|'plannedTerm'|'studyYear'|'earnedOrder'|'contribution'>;
export type MethodInput=AttemptMethod['value'];
type Payload<K extends AttemptOwnedRecord['kind']>=Extract<AttemptOwnedRecord,{kind:K}>['payload'];
export type RecordFieldsInput=
 | {kind:'media';totalLessons:number|null}
 | ({kind:'correspondence'}&Omit<Payload<'correspondence'>,'reports'>)
 | ({kind:'evaluation'}&Payload<'evaluation'>)
 | ({kind:'todo'}&Pick<Payload<'todo'>,'text'|'done'>);
export type PayloadPatchInput=
 | {kind:'media';totalLessons?:number|null;lesson?:MediaLessonProgress;assessment?:{row:RowToken;changes:Partial<Omit<MediaAssessment,'id'>>};addAssessment?:Omit<MediaAssessment,'id'>}
 | ({kind:'correspondence';report?:ReportProgress}&Partial<Omit<Payload<'correspondence'>,'reports'>>)
 | ({kind:'evaluation'}&Partial<Payload<'evaluation'>>)
 | ({kind:'todo'}&Partial<Pick<Payload<'todo'>,'text'|'done'>>);
export type EditableFieldsInput={title?:string;plan?:Partial<PlanInput>;method?:{value:MethodInput;note:string};selection?:RowToken|null};
export type EditIntent=
 | {kind:'add';selection:RowToken|null;title:string;plan:PlanInput;method:MethodInput;note:string}
 | {kind:'edit';attempt:RowToken;changes:EditableFieldsInput}
 | {kind:'remove';attempt:RowToken}
 | {kind:'undo';removal:RowToken}
 | {kind:'add_record';owner:RowToken|null;fields:RecordFieldsInput}
 | {kind:'edit_payload';record:RowToken;changes:PayloadPatchInput}
 | {kind:'assign_todo';todo:RowToken;owner:RowToken|null;expectedOwner:RowToken|null}
 | {kind:'delete_todo';todo:RowToken};
export type CorrectionDTO=Readonly<{view:Token<'view'>;correction:CorrectionToken;oldDate:string;newDate:string|null}>;
