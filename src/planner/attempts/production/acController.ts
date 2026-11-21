import { createBrowserPlannerAttemptSession } from './session';
import type { AttemptGraph, AttemptId } from '../types';
import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../../institutional/currentSearch';
import type { AuthorityAdmission } from './authorityAdmission';
export { admissionProblem } from './admission';

type Session = ReturnType<typeof createBrowserPlannerAttemptSession>;
type Proposal = Awaited<ReturnType<Session['prepareSave']>>;
export type SavedInventory = Awaited<ReturnType<Session['readSavedInventory']>>;
export type ProgressKind = 'media' | 'correspondence' | 'evaluation';
export type SavedDisplay = Readonly<{
  status: 'unconnected' | 'reading' | 'pinned' | 'hold';
  past: SavedInventory | null;
  reason: string;
}>;
export type AcSnapshot = Readonly<{
  graph: AttemptGraph | null; ready: boolean; busy: boolean; dirty: boolean;
  saved: SavedDisplay;
  proposal: Proposal | null; error: string; notice: string;
  admission: AuthorityAdmission | null;
  calculation: Readonly<{ scopeId: string; result: Awaited<ReturnType<Session['calculate']>> }> | null;
}>;
/** No Command or identity allocation here. No automatic retry after a write. */
export function createAcController(session: Session = createBrowserPlannerAttemptSession()) {
  let readGeneration = 0;
  let state: AcSnapshot = { saved: { status: 'unconnected', past: null, reason: '' }, graph: null, ready: false, busy: false, dirty: false, proposal: null, error: '', notice: '読込前', calculation: null, admission: null };
  const listeners = new Set<() => void>();
  function publish(patch: Partial<AcSnapshot>) { state = Object.freeze({ ...state, ...patch }); listeners.forEach(fn => fn()); }
  function holdSaved(reason: string, patch: Partial<AcSnapshot> = {}) {
    readGeneration++;
    publish({ ...patch, saved: { status: 'hold', past: state.saved.past, reason } });
  }
  async function readSaved() {
    if (!state.graph || !state.admission?.canEdit || typeof session.readSavedInventory !== 'function') return false;
    const generation = ++readGeneration;
    publish({ saved: { status: 'reading', past: state.saved.past, reason: '' } });
    try {
      const result = await session.readSavedInventory();
      if (generation !== readGeneration) return false;
      const { sourceRevisionId, sourceDigest } = result.snapshot;
      if (sourceRevisionId !== CURRENT_CURRICULUM_SEARCH_TARGET.sourceRevisionId ||
          sourceDigest !== CURRENT_CURRICULUM_SEARCH_TARGET.sourceDigest) {
        const target = CURRENT_CURRICULUM_SEARCH_TARGET;
        throw new Error('検索と保存済みの資料版が一致しません。保存済み: ' + sourceRevisionId + ' / ' + sourceDigest +
          '。検索: ' + target.sourceRevisionId + ' / ' + target.sourceDigest);
      }
      publish({ saved: { status: 'pinned', past: result, reason: '' } });
      return generation === readGeneration;
    } catch (error) {
      if (generation === readGeneration) holdSaved(String(error), { ready: false, admission: session.admission() });
      return false;
    }
  }
  function failed(error: unknown) {
    const admission = session.admission?.() ?? null;
    if (admission && !admission.canEdit && state.graph) holdSaved(admission.message);
    publish({ error: String(error), calculation: null, admission,
      ...(admission && !admission.canEdit && !admission.canCreate && !admission.canMigrate ? {
        ready: false, proposal: null, notice: state.notice.startsWith('保存失敗') ? state.notice : admission.message,
      } : {}) });
  }
  async function run(action: () => Promise<void | boolean>) {
    if (state.busy) return false;
    publish({ busy: true, error: '' });
    try { return (await action()) !== false; }
    catch (error) { failed(error); return false; }
    finally { publish({ busy: false }); }
  }
  function editable() { if (!state.ready || state.busy || state.proposal) throw Error('編集できません。保存確認を閉じるか再読込してください。'); }
  function changed(graph: AttemptGraph) { holdSaved('未保存の下書きがあります'); publish({ graph, error: '', dirty: true, calculation: null, proposal: null, notice: '未保存の下書きがあります' }); }
  function mutate(action: () => AttemptGraph) {
    try { editable(); changed(action()); return true; }
    catch (error) { failed(error); return false; }
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    load: () => run(async () => {
      holdSaved('保存内容を再照合中です');
      const generation = readGeneration;
      publish({ ready: false, proposal: null, calculation: null, notice: '保存内容を照合中…' });
      // Keep the last display snapshot on a failed read, but revoke edit authority.
      const graph = await session.load();
      if (generation !== readGeneration) return;
      const admission = session.admission?.() ?? null;
      publish({ graph, admission, ready: admission ? admission.canEdit || admission.canCreate || admission.canMigrate : true,
        dirty: false, notice: admission?.message ?? (graph ? '保存内容を再読込・照合しました' : '新規計画を開始できます') });
      if (graph && admission?.canEdit) await readSaved();
      else if (graph) holdSaved(admission?.message ?? '保存済み表示の読取を確認できません');
      else if (!state.saved.past) publish({ saved: { status: 'unconnected', past: null, reason: '' } });
    }),
    verifySaved: () => run(async () => {
      if (!state.ready || state.dirty || state.proposal) throw Error('保存済み表示の再照合は保留です。');
      return readSaved();
    }),
    invalidateSaved() {
      session.invalidatePreviews();
      holdSaved('別画面で変更された可能性があります。再読込してください',
        { ready: false, proposal: null, calculation: null });
    },
    prepare: () => run(async () => {
      if (!state.ready || state.proposal) throw Error('再読込または保存確認が必要です。');
      publish({ proposal: await session.prepareSave(), notice: '保存内容を確認してください（まだ保存されていません）' });
    }),
    prepareMigration: (raw: string) => run(async () => {
      if (!state.ready || state.graph || state.proposal) throw Error('空の計画でのみ明示移行できます。');
      publish({ proposal: await session.prepareMigration(raw), notice: '移行前の原文と保存内容を確認してください（まだ保存されていません）' });
    }),
    prepareRestore: (raw: string) => run(async () => {
      if (!state.ready || state.dirty || state.proposal) throw Error('下書きを解決してから復元を準備してください。');
      publish({ proposal: await session.prepareRestore(raw), notice: '復元内容を確認してください（まだ保存されていません）' });
    }),
    invalidateSelection() {
      session.invalidatePreviews(); publish({ proposal: null, calculation: null });
    },
    cancel() { if (!state.busy) {
      session.invalidatePreviews();
      publish({ proposal: null, notice: state.dirty ? '未保存の下書きがあります' : '保存確認を取り消しました' });
    } },
    save: (proposal: Proposal, confirmed: boolean, adoption?: string) => run(async () => {
      if (!state.ready || state.proposal !== proposal || !confirmed ||
          (proposal.adoptionSha256 !== null && proposal.adoptionSha256 !== adoption)) throw Error('有効な保存確認が必要です。');
      const generation = readGeneration;
      publish({ proposal: null, ready: false, calculation: null, notice: '保存中…' });
      let graph: AttemptGraph | null;
      try {
        graph = await session.save(proposal, true, adoption);
      } catch (error) {
        publish({ notice: error instanceof Error && error.message === 'stale_save_revoked'
          ? '保存失敗。書込み前に保存資格が失効したため、下書きを保持しました。'
          : '保存失敗・競合または応答不明です。原文を保護し、再読込して保存結果を照合してください。' });
        throw error;
      }
      // F01 confirmed the durable commit. A later display hold must not
      // report the write as failed or make the old pin current again.
      const pendingRead = '保存済み（保存後の再照合が必要です）';
      if (generation !== readGeneration) {
        publish({ dirty: false, notice: pendingRead });
        return;
      }
      publish({ graph, admission: session.admission(), ready: true, dirty: false, notice: '保存済み（正式保存が完了しました）' });
      if (!await readSaved()) publish({ notice: pendingRead });
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
    progress: (id: AttemptId, payload: string, kind: ProgressKind = 'correspondence') => mutate(() => {
      const records = state.graph?.ownedRecords.filter(r => r.kind === kind && r.owner?.kind === 'attempt' && r.owner.attemptId === id) ?? [];
      if (records.length > 1) throw Error('同種進捗が複数あります。編集対象の明示契約が必要です。');
      const attempt = state.graph?.attempts.find(a => a.id === id && a.membership.kind === 'active');
      if (!attempt || (kind !== 'evaluation' && attempt.method.value !== kind)) {
        throw Error('対象履修回と履修方法を確認してください。');
      }
      return session.progress(id, kind, payload);
    }),
    remove: (id: AttemptId) => mutate(() => session.remove(id)),
    undo: (id: AttemptId) => mutate(() => session.undo(id)),
    createBackup: () => {
      if (!state.ready || state.busy || state.dirty || state.proposal) return Promise.reject(Error('保存済みの計画を照合してください。'));
      return session.createBackup().catch(error => { failed(error); throw error; });
    },
    protectCurrent: session.protectCurrent,
  };
}
