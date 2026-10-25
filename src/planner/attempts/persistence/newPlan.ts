import { backupDigest } from '../../backup/plannerBackupCompatibility';
import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../../institutional/currentSearch';
import { createInstitutionalSearchAdapter } from '../../institutional/search';
import { loadYi01InstitutionalCatalog } from '../../institutional/yi01';
import { freeze } from '../migration/contracts';
import { sameAttemptData } from '../validation';
import { applyCommand, createWorkspace, type Workspace } from '../workbench/operations';
import { exactKeys, NEW_PERSISTENCE_RULE, NEW_STATE_VERSION, STATE_FORMAT, type AttemptState24, type NewPlanRetained, type NewPlanSource } from './contracts';
import { checkFreshCommandIds, idTail, requiredReservations, sourceUuids, unionReservations } from './identity';

/** No PlannerState defaults, Offering archive, migration table or official quantities. */
const retained = (): NewPlanRetained => ({ importedCourseAchievements: [], importedStudyRecords: [],
  applicability: 'unknown', scopeId: null, graduationEvaluation: 'not_evaluated',
  graduationCheckComplete: false, sourceLinksReverified: false });

// Only the bundled, deeply frozen master is cached. No submitted state or replay
// result is cached; each load/commit still validates and replays every command.
let pinnedSource: Promise<NewPlanSource> | undefined;
export function createNewPlanSource(): Promise<NewPlanSource> {
  return pinnedSource ??= buildNewPlanSource();
}
async function buildNewPlanSource(): Promise<NewPlanSource> {
  const catalog = loadYi01InstitutionalCatalog();
  const result = createInstitutionalSearchAdapter(catalog, CURRENT_CURRICULUM_SEARCH_TARGET).search({ scope: { kind: 'all' } });
  if (result.status !== 'documented_slice_only') throw new Error('new_plan_master_unavailable');
  return freeze({ kind: 'new-plan', evidence: { origin: 'new-plan', initializationVersion: 1,
    ...CURRENT_CURRICULUM_SEARCH_TARGET, masterSha256: await backupDigest(catalog) },
    context: { catalog, officialAchievementIds: [], officialStudyRecordIds: [] } });
}
export const emptyNewPlanWorkspace = (source: NewPlanSource) => createWorkspace({ attempts: [], ownedRecords: [], removals: [] }, source.context);
export function newPlanIssuedIds(workspace: Workspace): string[] {
  return [...new Set([...workspace.receipts.flatMap(c => [c.operationId,
    ...(c.kind === 'add' ? [c.attempt.id] : c.kind === 'add_record' ? [c.record.id] : [])]), ...workspace.usedTodoIds])];
}
export async function encodeNewPlan(source: NewPlanSource, workspace: Workspace): Promise<AttemptState24> {
  const initial = retained();
  return freeze({ format: STATE_FORMAT, schemaVersion: NEW_STATE_VERSION, rule: NEW_PERSISTENCE_RULE,
    source: structuredClone(source.evidence), graph: structuredClone(workspace.graph), retained: initial,
    history: { commands: structuredClone(workspace.receipts), issuedIds: newPlanIssuedIds(workspace), usedTodoIds: [...workspace.usedTodoIds] },
    verification: { graphSha256: await backupDigest(workspace.graph), retainedSha256: await backupDigest(initial) } });
}
/** Source origin and every field are bound to the pinned master; a digest is not issuer authentication. */
export async function replayNewPlan(value: unknown) {
  exactKeys(value, ['format', 'schemaVersion', 'rule', 'source', 'graph', 'retained', 'history', 'verification'], 'new_plan_state');
  if (value.format !== STATE_FORMAT || value.schemaVersion !== NEW_STATE_VERSION || !sameAttemptData(value.rule, NEW_PERSISTENCE_RULE)) throw new Error('unsupported_persistence_version');
  const state = value as unknown as AttemptState24;
  exactKeys(state.source, ['origin', 'initializationVersion', 'curriculumVersionId', 'sourceRevisionId', 'sourceDigest', 'masterSha256'], 'new_plan_source');
  const source = await createNewPlanSource();
  if (!sameAttemptData(state.source, source.evidence)) throw new Error('new_plan_source_mismatch');
  exactKeys(state.history, ['commands', 'issuedIds', 'usedTodoIds'], 'history');
  if (!Array.isArray(state.history.commands)) throw new Error('history_shape');
  let workspace = emptyNewPlanWorkspace(source);
  const occupied = sourceUuids(source);
  for (const command of state.history.commands) {
    const fresh = checkFreshCommandIds(command, occupied);
    const next = applyCommand(workspace, command, source.context);
    if (next === workspace) throw new Error('duplicate_receipt');
    fresh.forEach(id => occupied.add(idTail(id))); workspace = next;
  }
  unionReservations(newPlanIssuedIds(workspace));
  const expected = await encodeNewPlan(source, workspace);
  if (!sameAttemptData(state, expected)) throw new Error('state_replay_mismatch');
  return { state: expected, source, workspace, requiredReservations: requiredReservations(source, expected.history.issuedIds) };
}
