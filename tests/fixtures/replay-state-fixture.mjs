import { createNewPlanSource, emptyNewPlanWorkspace, encodeNewPlan } from '../../src/planner/attempts/persistence/newPlan.ts';
import { encodeState } from '../../src/planner/attempts/persistence/codec.ts';
import { createWorkspace, applyCommand, newOperationId } from '../../src/planner/attempts/workbench/operations.ts';
import { makeAttempt } from '../../src/planner/attempts/workbench/catalogView.ts';
import { emptyProgress } from '../../dev/attempts/progressDefaults.ts';

const input = title => ({ title, courseId:null, placementId:null, plan:{status:'planned', plannedYear:null, plannedTerm:null, studyYear:null, earnedOrder:null}, method:'media', note:'' });

export async function replayFixture(version = 24, scale = 'normal', count = 100) {
  let source, table, base, workspace;
  if (version === 23) {
    const f = await import('./migration-fixture.mjs');
    const input = scale === 'large' ? f.initialState() : f.mixed();
    if (scale === 'large') input.items = f.catalog.offerings.slice(0, 500).map(f.item);
    ({ source, table, result: base } = await f.preview(input));
    if (base.status !== 'ready') throw Error('fixture migration not ready');
    base = base.target;
    workspace = createWorkspace(base.graph, source.context);
  } else {
    source = await createNewPlanSource(); workspace = emptyNewPlanWorkspace(source);
  }
  const submit = command => { workspace = applyCommand(workspace, command, source.context); };
  if (!workspace.graph.attempts.length || scale === 'heavy') {
    const attempt = makeAttempt(source.context.catalog, input('synthetic replay'));
    submit({ kind: 'add', operationId: attempt.creationOperationId, attempt });
  }
  const attemptId = (scale === 'heavy' ? workspace.graph.attempts.at(-1) : workspace.graph.attempts[0]).id;
  if (scale === 'heavy') {
    for (const kind of ['media', 'correspondence', 'evaluation']) {
      const record = emptyProgress(kind, attemptId);
      if (kind === 'media') record.payload = { totalLessons: 1000, lessons: Array.from({length:1000}, (_, i) => ({ lesson:i+1, videoCompleted:true, testCompleted:false })), assessments:Array.from({length:100}, (_, i) => ({ id:'synthetic-assessment-'+i, type:'other', label:'synthetic', scheduledDate:null, completed:false })) };
      if (kind === 'correspondence') record.payload = { requiredReports:1000, reports:Array.from({length:1000}, (_, i) => ({ reportNumber:i+1, status:'passed', grade:'A' })), examGrade:null };
      submit({ kind:'add_record', operationId:newOperationId(), record });
    }
  }
  while (workspace.receipts.length < count) {
    if (version === 24 && scale === 'large') {
      const attempt = makeAttempt(source.context.catalog, input('synthetic bulk'));
      submit({kind:'add', operationId:attempt.creationOperationId, attempt});
    } else submit({kind:'edit', operationId:newOperationId(), attemptId, changes:{originalTitle:'synthetic edit '+workspace.receipts.length}});
  }
  const state = version === 24 ? await encodeNewPlan(source, workspace) : await encodeState(source, table, base, workspace, base.catalog ?? (await import('./migration-fixture.mjs')).env.target);
  return { state, workspace, raw:JSON.stringify(state) };
}
