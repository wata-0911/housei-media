import { CURRENT_CURRICULUM_SEARCH_TARGET } from '../../institutional/currentSearch';
import type { AcSnapshot, SavedInventory } from '../production/acController';

export const ATTEMPT_EXPORT_COLUMNS = [
  '区分', '記録 ID', '履修回 ID', '科目名', '予定年度', '計画状態／本人記録の種類',
  '履修回の所属', '履修方式', '科目対応', '本人適用', '記録内容（JSON）',
] as const;

type ExportRow = readonly [
  section: string, id: string, attemptId: string, title: string, plannedYear: string,
  planStatus: string, membership: string, method: string, identity: string, applicability: string, details: string,
];

export type AttemptExportPresentation = Readonly<{
  rows: readonly ExportRow[];
}>;

export function exportPin(state: AcSnapshot, inputsBlocked: boolean): SavedInventory | null {
  if (inputsBlocked || !state.ready || !state.graph || state.dirty || state.busy || state.proposal ||
      state.saved.status !== 'pinned' || !state.saved.past) return null;
  const pin = state.saved.past;
  if (pin.ownerInventory.coverage !== 'complete' || pin.ownerInventory.sourcePin !== pin.snapshot ||
      pin.snapshot.sourceRevisionId !== CURRENT_CURRICULUM_SEARCH_TARGET.sourceRevisionId ||
      pin.snapshot.sourceDigest !== CURRENT_CURRICULUM_SEARCH_TARGET.sourceDigest) return null;
  return pin;
}

type DetailRecord = SavedInventory['ownerInventory']['records'][number];

function recordRow(record: DetailRecord): ExportRow {
  const owner = record.owner;
  const section = owner?.kind === 'attempt' ? '本人記録' :
    owner ? '本人記録・所有者未照合' : '本人記録・所有者なし';
  return [section, record.id, owner?.kind === 'attempt' ? owner.attemptId : '',
    '', '', record.kind, '', '', '', '',
    JSON.stringify({ payload: record.payload, owner, provenance: record.provenance })];
}

export function attemptExportPresentation(pin: SavedInventory): AttemptExportPresentation {
  const rows: ExportRow[] = [];
  for (const { learnerOriginal: attempt } of pin.projection.owners) {
    rows.push(['履修回', attempt.id, attempt.id, attempt.originalTitle,
      attempt.plan ? String(attempt.plan.plannedYear ?? '未設定') : '計画なし',
      attempt.plan?.status ?? '未設定',
      attempt.membership.kind === 'active' ? '計画内' : '削除・分離（記録保持）',
      attempt.method.value, attempt.identity.status, attempt.applicability.status,
      JSON.stringify(attempt)]);
  }
  for (const record of pin.ownerInventory.records) rows.push(recordRow(record));
  for (const row of pin.retained.importedCourseAchievements) {
    rows.push(['旧公式原行・対応未照合', row.id, '', row.rawName, '', '', '', '', '', '', JSON.stringify(row)]);
  }
  for (const row of pin.retained.importedStudyRecords) {
    rows.push(['旧公式明細・対応未照合', row.id, '', row.rawName, '', '', '', '', '', '', JSON.stringify(row)]);
  }
  const { schemaVersion, sourceRevisionId, sourceDigest, graphSha256 } = pin.snapshot;
  return { rows: [
    ['保存済み照合', '', '', '照合時点の保存正本。旧公式原行は履修回に未照合。卒業算入は確定しません。',
      '', '', '', '', '', '', JSON.stringify({
        schemaVersion, sourceRevisionId, sourceDigest, graphSha256,
        attempts: pin.projection.owners.length, learnerRecords: pin.ownerInventory.records.length,
        officialRows: pin.retained.importedCourseAchievements.length, officialDetails: pin.retained.importedStudyRecords.length,
        totalRows: rows.length,
      })],
    ...rows,
  ] };
}

function csvCell(value: string) {
  // Always quote cells. Neutralize formula starters and leading controls before spreadsheet interpretation.
  const protectedValue = /^[\t\r\n]|^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(value) ? "'" + value : value;
  return '"' + protectedValue.replaceAll('"', '""') + '"';
}

export function attemptExportCsv({ rows }: AttemptExportPresentation): string {
  return '\uFEFF' + [ATTEMPT_EXPORT_COLUMNS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
