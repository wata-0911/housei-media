import { useState } from 'react';
import { curriculumMatchForOfferingSelection } from '../../planner/curriculumImportMatch';
import { normalizeImportName, type ImportedCourseAchievement } from '../../planner/gradeImportApply';
import type { CurriculumCatalog, Offering } from '../../planner/plannerCatalog';

type RepairProps = {
  row: ImportedCourseAchievement;
  offerings: Offering[];
  curriculum: CurriculumCatalog;
  disabled: boolean;
  onChangeCourse: (id: string, patch: Partial<ImportedCourseAchievement>) => void;
};

export function ImportedCourseRepairControls({ row, offerings, curriculum, disabled, onChangeCourse, query, onSearch }: RepairProps & { query: string; onSearch: (value: string) => void }) {
  const normalized = normalizeImportName(query);
  const candidates = offerings.filter(offering => offering.id === row.selectedOfferingId || row.candidateOfferingIds.includes(offering.id)
    || (normalized !== '' && normalizeImportName(offering.name).includes(normalized)));
  // Keep the saved selection visible even if a large candidate set is truncated.
  const displayed = [...new Map([...(offerings.filter(offering => offering.id === row.selectedOfferingId)), ...candidates.slice(0, 80)].map(offering => [offering.id, offering])).values()];
  return <div className="mt-2 space-y-2 text-sm" data-import-repair-id={row.id}>
    <label className="block">カタログを検索 <input aria-label={`${row.rawName}の開講検索`} disabled={disabled} value={query} onChange={event => onSearch(event.target.value)} placeholder="科目名で検索" className="ml-2 border p-1" /></label>
    <label className="block">行の照合先 <select aria-label={`${row.rawName}の照合先`} disabled={disabled} value={row.selectedOfferingId ?? ''} onChange={event => {
      const selectedOfferingId = event.target.value || null;
      const offering = offerings.find(value => value.id === selectedOfferingId);
      onChangeCourse(row.id, {
        ...curriculumMatchForOfferingSelection(row, offering, curriculum),
        selectedOfferingId, selectionSource: selectedOfferingId ? 'manual' : 'none', courseId: offering?.courseId ?? null,
        match: offering?.courseId && offering.resolutionStatus === 'matched' ? 'exact_unique' : selectedOfferingId ? 'ambiguous' : 'unmatched',
        candidateOfferingIds: [...new Set([...row.candidateOfferingIds, ...displayed.map(candidate => candidate.id)])],
      });
    }} className="ml-2 max-w-full border p-1"><option value="">選ばない（区分・要件は未確定）</option>{displayed.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}（{candidate.period ?? '期未設定'}）</option>)}</select></label>
    <p className="text-xs text-gray-600">開講を選んで制度科目との対応を確認できます。科目名の検索だけでは照合を確定しません。</p>
  </div>;
}

export default function ImportedCourseRepair(props: RepairProps) {
  const [query, setQuery] = useState('');
  return <ImportedCourseRepairControls {...props} query={query} onSearch={setQuery} />;
}
