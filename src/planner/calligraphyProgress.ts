import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { CorrespondenceCourseProgress, CurriculumCourse, GraduationProfile, Offering, PlannerCatalog, PlannerItem } from './plannerCatalog';
import { exactImportedCurriculumId } from './officialCourseCredits';
import { deriveOfficialGraduationFacts } from './officialGraduationFacts';
import { plannerItemCreditContribution } from './plannerItemCredits';

// Exact institutional identity from the 2026 catalog, never a name-only Offering match.
export const CALLIGRAPHY_CURRICULUM_ID = 'curriculum:5e8b0825-7ba9-4a53-847c-7e56283718e5';
export function isCalligraphyCorrespondence(offering: Offering | undefined): boolean {
  return offering?.curriculumCourseId === CALLIGRAPHY_CURRICULUM_ID && offering.academicYear === 2026
    && offering.resolutionStatus === 'matched' && offering.method === 'correspondence' && offering.credits === 2;
}
export function isCalligraphyCourse(course: CurriculumCourse): boolean {
  return course.id === CALLIGRAPHY_CURRICULUM_ID;
}
export type CalligraphyProgress = {
  earnedCredits: number; projectedCredits: number; completedCredits: number;
  completion: 'complete' | 'incomplete' | 'unknown'; projectedCompletion: 'complete' | 'incomplete' | 'unknown';
  evidence: 'official' | 'learner' | 'none'; officialPreferred: boolean; warnings: string[];
};
/** p.48g: batch acceptance is a completion prerequisite, never a standalone credit. */
function structureCredits(schooling: number, batchPassed: boolean): number {
  return schooling >= 2 || (schooling >= 1 && batchPassed) ? 2 : Math.min(1, schooling);
}
export function deriveCalligraphyProgress(
  course: CurriculumCourse, items: PlannerItem[], catalog: PlannerCatalog, scopeId: string | null,
  saved: Record<string, CorrespondenceCourseProgress> = {}, rows: ImportedCourseAchievement[] = [],
  records: ImportedStudyRecord[] = [], profile?: GraduationProfile,
): CalligraphyProgress {
  const offerings = new Map(catalog.offerings.map(o => [o.id, o]));
  const attempts = items.filter(item => offerings.get(item.offeringId)?.curriculumCourseId === course.id);
  const exactRows = [...new Map(rows.filter(row => exactImportedCurriculumId(row, catalog) === course.id).map(row => [row.id, row])).values()];
  const possibleOfficialOverlap = rows.some(row => exactImportedCurriculumId(row, catalog) === null && row.candidateCurriculumCourseIds?.includes(course.id));
  const linkedUnresolved = attempts.some(item => rows.some(row => row.id === item.importedSourceCourseId && exactImportedCurriculumId(row, catalog) !== course.id));
  const current = isCalligraphyCourse(course) && course.canonicalName === '書道実技' && course.curriculumCredits === 2
    && catalog.curriculum?.source === 'official_curriculum_mappings_2026'
    && course.mappingIds.length > 0 && course.mappingIds.every(id => catalog.mappings.some(m => m.mappingId === id
      && m.department === '日本文学科' && m.category === '専門教育' && m.curriculumCredits === 2))
    && profile?.curriculumApplicability === 'current_2026'
    && catalog.programs.some(p => p.scopeId === scopeId && p.department === '日本文学科')
    && course.mappingIds.some(id => catalog.mappings.some(m => m.mappingId === id && m.scopeId === scopeId));
  if (exactRows.length || linkedUnresolved || possibleOfficialOverlap) {
    const earned = exactRows.length === 1 ? exactRows[0].earnedCreditsTotal ?? 0 : 0;
    const completed = current && exactRows.length === 1 && scopeId !== null
      && deriveOfficialGraduationFacts(exactRows, records, catalog, scopeId, profile).allocations.some(a => a.fact.curriculumCourseId === course.id && a.completedCredits === 2);
    const completion = completed ? 'complete' : exactRows.length === 1 && earned === 0 && exactRows[0].earnedCreditsTotal === 0 ? 'incomplete' : 'unknown';
    return { earnedCredits: earned, projectedCredits: earned, completedCredits: completed ? 2 : 0, completion, projectedCompletion: completion,
      evidence: completed ? 'official' : 'none', officialPreferred: true,
      warnings: ['書道実技の修得単位は公式集計を優先します。添削進捗や手動履修で公式値を補完・重複加算しません。',
        ...(completed ? [] : ['公式成績の構成2単位・修得2単位・スクーリング1または2単位等の完成根拠を確認してください。'])] };
  }
  const active = attempts.filter(item => item.status !== 'dropped' && item.status !== 'failed' && item.importedSourceCourseId === undefined);
  const schoolCredits = (projected: boolean) => active.reduce((total, item) => {
    const o = offerings.get(item.offeringId)!;
    return total + (o.resolutionStatus === 'matched' && o.method === 'schooling' && o.academicYear === 2026 && o.credits === 1
      && (item.status === 'earned' || (projected && ['planned', 'in_progress', 'waiting'].includes(item.status)))
      ? plannerItemCreditContribution(item, o) ?? 0 : 0);
  }, 0);
  const correspondence = active.filter(item => isCalligraphyCorrespondence(offerings.get(item.offeringId)));
  const passed = correspondence.some(item => saved[item.offeringId]?.calligraphyBatchStatus === 'passed');
  const earned = structureCredits(schoolCredits(false), passed);
  const projected = structureCredits(schoolCredits(true), passed);
  const completion = current ? earned === 2 ? 'complete' : 'incomplete' : 'unknown';
  const projectedCompletion = current ? projected === 2 ? 'complete' : 'incomplete' : 'unknown';
  return { earnedCredits: current ? earned : Math.min(2, schoolCredits(false)), projectedCredits: current ? projected : Math.min(2, schoolCredits(true)),
    completedCredits: completion === 'complete' ? 2 : 0, completion, projectedCompletion, evidence: completion === 'complete' ? 'learner' : 'none', officialPreferred: false,
    warnings: ['添削10課題は一括した本人の学習進捗です。添削だけで正式な1単位または完成2単位を修得したことにはなりません。',
      ...(correspondence.some(item => saved[item.offeringId]?.calligraphyBatchStatus === undefined) ? ['保存済み通信2単位の履修状態・評価・リポートは保持しています。添削一括の状態を確認して入力してください。自動変換はしていません。'] : []),
      ...(completion === 'complete' ? ['本人記録による完成条件達成（構成2単位）。正式な修得証拠は公式成績表で確認してください。'] : []),
      ...(!current ? ['この判定は日本文学科の2026年度現行課程専用です。所属と適用課程を確認してください。'] : [])] };
}
