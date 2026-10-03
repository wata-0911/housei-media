import { useState } from 'react';
import { catalog as defaultCatalog } from '../../planner/catalog';
import { groupImportedAchievements, type ImportedCourseAchievement, type ImportedStudyRecord } from '../../planner/gradeImportApply';
import { importedAchievementManagement } from '../../planner/importedAchievementManagement';
import type { ImportedGraduationNotice } from '../../planner/importedGraduationNotices';
import type { Offering, PlannerCatalog } from '../../planner/plannerCatalog';
import ImportedCourseRepair from './ImportedCourseRepair';
import ImportedStudyRecordEditor from './ImportedStudyRecordEditor';

const matchLabel = (match: ImportedStudyRecord['match']) => match === 'exact_unique' ? '一意一致' : match === 'ambiguous' ? '要確認' : '未一致';

type ManagementProps = {
  records: ImportedStudyRecord[];
  courseRows?: ImportedCourseAchievement[];
  offerings: Offering[];
  catalog?: PlannerCatalog;
  notices?: ImportedGraduationNotice[];
  disabled: boolean;
  onChange: (id: string, patch: Partial<ImportedStudyRecord>) => void;
  onChangeCourse: (id: string, patch: Partial<ImportedCourseAchievement>) => void;
  onDelete: (id: string) => void;
};

// Extracted so the explicit maintenance view retains the same source-owned editors.
export function ImportedManagementRows({ records, courseRows = [], offerings, catalog = defaultCatalog, notices = [], disabled, onChange, onChangeCourse, onDelete }: ManagementProps) {
  return <div className="space-y-4">
    {courseRows.length > 0 && <section className="space-y-2"><h3 className="border-b border-gray-200 pb-1 text-base">成績表の科目行</h3><p className="text-xs text-gray-600">公式の修得単位の正本です。ここで選ぶ照合先は詳細記録より優先します。</p>{courseRows.map(row => <article key={row.id} data-import-management-id={row.id} className="border border-gray-200 p-3 text-sm">
      <p className="font-medium">{row.rawName}</p>
      <p className="mt-1 text-xs">カリキュラム科目: {catalog.curriculum?.courses.find(course => course.id === row.curriculumCourseId)?.canonicalName ?? (row.curriculumMatch === 'ambiguous' ? '要確認' : '未特定')} / 2026開講: {row.offeringMatch === 'exact_unique' && row.selectedOfferingId ? offerings.find(offering => offering.id === row.selectedOfferingId)?.name ?? '未特定' : '未特定'}</p>
      <p className="mt-1">修得 {row.earnedCreditsTotal ?? '不明'}単位 / S {row.schoolingCreditsTotal ?? '不明'}単位 / 構成 {row.compositionCredits ?? '不明'}単位</p>
      {catalog.curriculum && <ImportedCourseRepair row={row} offerings={offerings} curriculum={catalog.curriculum} disabled={disabled} onChangeCourse={onChangeCourse} />}
      <p className="mt-1 text-xs text-gray-600">カリキュラム照合: {matchLabel(row.curriculumMatch ?? row.match)} / 開講照合: {matchLabel(row.offeringMatch ?? 'unmatched')} / {row.selectionSource === 'manual' ? '手動照合' : row.selectionSource === 'auto' ? '自動照合' : '未設定'}{row.categoryRaw ? ` / 成績表区分: ${row.categoryRaw}` : ''}</p>
      {notices.filter(notice => notice.sourceRowIds.includes(row.id)).map((notice, index) => <p key={index} className="mt-1 text-xs text-amber-800">{notice.reason}</p>)}
    </article>)}</section>}
    {groupImportedAchievements(records).map(([year, group]) => <section key={year ?? 'unset'} className="space-y-2"><h3 className="border-b border-gray-200 pb-1 text-base">履修内訳 — {year === null ? '年度未設定' : `${year}年度`}</h3>{group.map(record => <ImportedStudyRecordEditor key={record.id} record={record} offerings={offerings} disabled={disabled} onChange={onChange} onDelete={onDelete} />)}</section>)}
  </div>;
}

export function ImportedManagementPanel(props: ManagementProps & { showAll: boolean; onShowAll: (showAll: boolean) => void }) {
  const { showAll, onShowAll } = props;
  const { records, courseRows = [], catalog = defaultCatalog, notices = [] } = props;
  if (!records.length && !courseRows.length) return null;
  const { issueRows, issueRecords } = importedAchievementManagement(courseRows, records, catalog, notices);
  return <section id="imported-achievements" aria-label="成績取込の管理" className="border border-gray-200 bg-white p-4">
    <details>
      <summary className="cursor-pointer text-lg text-[#002255]">成績取込の管理 — 確認対象の科目行 {issueRows.length}件・履修内訳 {issueRecords.length}件</summary>
      <p className="my-3 text-sm text-gray-600">通常の履修管理は「履修・修得一覧」で行えます。ここでは未照合・重複・算入条件の確認や、内訳の年度・期修正・削除を行えます。</p>
      <a href="#grade-import-panel" className="text-sm underline">成績表を再取り込み</a>
      <button type="button" aria-pressed={showAll} onClick={() => onShowAll(!showAll)} className="ml-4 text-sm underline">{showAll ? '確認対象だけを表示' : '保存済み全件のメンテナンスを表示'}</button>
      {showAll && <p className="my-3 text-xs text-gray-600">保存済み全件を表示しています。照合や内訳の修正・削除に利用してください。</p>}
      {!showAll && issueRows.length + issueRecords.length === 0 && <p className="mt-3 text-sm">確認対象はありません。取り込んだ科目は履修・修得一覧に表示しています。</p>}
      <div className="mt-4"><ImportedManagementRows {...props} records={showAll ? records : issueRecords} courseRows={showAll ? courseRows : issueRows} /></div>
    </details>
  </section>;
}

export default function ImportedAchievements(props: ManagementProps) {
  const [showAll, setShowAll] = useState(false);
  return <ImportedManagementPanel {...props} showAll={showAll} onShowAll={setShowAll} />;
}
