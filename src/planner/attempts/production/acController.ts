import { createBrowserPlannerAttemptSession } from './session';
import type { AttemptGraph, AttemptId } from '../types';
import type { AuthorityAdmission } from './authorityAdmission';
export { admissionProblem } from './admission';

type Session = ReturnType<typeof createBrowserPlannerAttemptSession>;
type Proposal = Awaited<ReturnType<Session['prepareSave']>>;
export type AcSnapshot = Readonly<{
  graph: AttemptGraph | null; ready: boolean; busy: boolean; dirty: boolean;
  proposal: Proposal | null; error: string; notice: string;
  admission: AuthorityAdmission | null;
  calculation: Readonly<{ scopeId: string; result: Awaited<ReturnType<Session['calculate']>> }> | null;
}>;
/** No Command or identity allocation here. No automatic retry after a write. */
export function createAcController(session: Session = createBrowserPlannerAttemptSession()) {
  let state: AcSnapshot = { graph: null, ready: false, busy: false, dirty: false, proposal: null, error: '', notice: '読込前', calculation: null, admission: null };
  const listeners = new Set<() => void>();
  function publish(patch: Partial<AcSnapshot>) { state = Object.freeze({ ...state, ...patch }); listeners.forEach(fn => fn()); }
  function failed(error: unknown) {
    const admission = session.admission?.() ?? null;
    publish({ error: String(error), calculation: null, admission,
      ...(admission && !admission.canEdit && !admission.canCreate && !admission.canMigrate ? {
        ready: false, proposal: null, notice: state.notice.startsWith('保存失敗') ? state.notice : admission.message,
      } : {}) });
  }
  async function run(action: () => Promise<void>) {
    if (state.busy) return false;
    publish({ busy: true, error: '' });
    try { await action(); return true; }
    catch (error) { failed(error); return false; }
    finally { publish({ busy: false }); }
  }
  function editable() { if (!state.ready || state.busy || state.proposal) throw Error('編集できません。保存確認を閉じるか再読込してください。'); }
  function changed(graph: AttemptGraph) { publish({ graph, error: '', dirty: true, calculation: null, proposal: null, notice: '未保存の下書きがあります' }); }
  function mutate(action: () => AttemptGraph) {
    try { editable(); changed(action()); return true; }
    catch (error) { failed(error); return false; }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    load: () => run(async () => {
      publish({ ready: false, proposal: null, calculation: null, notice: '保存内容を照合中…' });
      // Keep the last display snapshot on a failed read, but revoke edit authority.
      const graph = await session.load();
      const admission = session.admission?.() ?? null;
      publish({ graph, admission, ready: admission ? admission.canEdit || admission.canCreate || admission.canMigrate : true,
        dirty: false, notice: admission?.message ?? (graph ? '保存内容を再読込・照合しました' : '新規計画を開始できます') });
    }),
    prepare: () => run(async () => {
      if (!state.ready || state.proposal) throw Error('再読込または保存確認が必要です。');
      publish({ proposal: await session.prepareSave(), notice: '保存内容を確認してください（まだ保存されていません）' });
    }),
    prepareMigration: (raw: string) => run(async () => {
      if (!state.ready || state.graph || state.proposal) throw Error('空の計画でのみ明示移行できます。');
      publish({ proposal: await session.prepareMigration(raw), notice: '移行前の原文と保存内容を確認してください（まだ保存されていません）' });
    }),
    invalidateSelection() {
      session.invalidatePreviews(); publish({ proposal: null, calculation: null });
    },
    cancel() { if (!state.busy) {
      session.invalidatePreviews();
      publish({ proposal: null, notice: state.dirty ? '未保存の下書きがあります' : '保存確認を取り消しました' });
    } },
    save: (proposal: Proposal, confirmed: boolean) => run(async () => {
      if (!state.ready || state.proposal !== proposal || !confirmed) throw Error('有効な保存確認が必要です。');
      publish({ proposal: null, ready: false, calculation: null, notice: '保存中…' });
      try {
        const graph = await session.save(proposal, true);
        publish({ graph, admission: session.admission(), ready: true, dirty: false, notice: '保存済み（正式保存が完了しました）' });
      } catch (error) {
        publish({ notice: '保存失敗・競合または応答不明です。原文を保護し、再読込して保存結果を照合してください。' });
        throw error;
      }
    }),
    add: (placementId: string, input: string) => mutate(() => session.add(placementId, input)),
    update: (id: AttemptId, input: string) => mutate(() => session.update(id, input)),
    calculate: (scopeId: string) => run(async () => {
      publish({ calculation: null });
      if (!state.ready || state.dirty || state.proposal || !state.graph) throw Error('保存・再読込済みの計画で計算してください。');
      const result = await session.calculate(scopeId);
      publish({ calculation: Object.freeze({ scopeId, result }) });
    }),
    recordContribution: (id: AttemptId, input: string) => mutate(() => session.recordContribution(id, input)),
    progress: (id: AttemptId, payload: string) => mutate(() => {
      const records = state.graph?.ownedRecords.filter(r => r.kind === 'correspondence' && r.owner?.kind === 'attempt' && r.owner.attemptId === id) ?? [];
      if (records.length > 1) throw Error('同種進捗が複数あります。編集対象の明示契約が必要です。');
      return session.progress(id, 'correspondence', payload);
    }),
    remove: (id: AttemptId) => mutate(() => session.remove(id)),
    undo: (id: AttemptId) => mutate(() => session.undo(id)),
    protectCurrent: session.protectCurrent,
  };
}
