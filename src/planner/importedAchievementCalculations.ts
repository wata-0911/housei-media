import type { ImportedStudyRecord } from './gradeImportApply';
import { isMediaSchooling } from './mediaSchooling';
import type { Offering, PlannerItem } from './plannerCatalog';

export type ImportedAchievementWarning = { rawName: string; reason: string };
export type ImportedMediaAchievement = { sourceCourseId: string; rawName: string; academicYear: number | null; term: string | null; earnedCreditsTotal: number; schoolingCreditsTotal: number | null; records: ImportedStudyRecord[]; offering: Offering };
export type DerivedImportedAchievements = { items: PlannerItem[]; offerings: Offering[]; warnings: ImportedAchievementWarning[]; media: ImportedMediaAchievement[] };

/**
 * Converts a saved grade-table row into one calculation-only earned item.  A
 * row's aggregate is the only credit source: component credits are display
 * facts and never added together here.  Missing v9 aggregates stay visible
 * but deliberately do not enter calculations.
 */
export function deriveImportedAchievements(records: ImportedStudyRecord[], offerings: Map<string, Offering>, plannedItems: PlannerItem[]): DerivedImportedAchievements {
  const groups = new Map<string, ImportedStudyRecord[]>();
  const warnings: ImportedAchievementWarning[] = [];
  for (const record of records) {
    if (!record.sourceCourseId || record.earnedCreditsTotal === undefined) {
      warnings.push({ rawName: record.rawName, reason: '旧形式の取込実績で、成績表行の修得単位が保存されていません' });
      continue;
    }
    const group = groups.get(record.sourceCourseId) ?? [];
    group.push(record); groups.set(record.sourceCourseId, group);
  }
  const items: PlannerItem[] = [], derivedOfferings: Offering[] = [], media: ImportedMediaAchievement[] = [];
  for (const [sourceCourseId, group] of groups) {
    const first = group[0];
    const earned = first.earnedCreditsTotal;
    if (earned === undefined || earned === null || earned <= 0) continue;
    if (!group.every(record => record.earnedCreditsTotal === earned)) { warnings.push({ rawName: first.rawName, reason: '同じ成績表行の修得単位が一致しないため算入しません' }); continue; }
    const linked = group.flatMap(record => record.offeringId ? [offerings.get(record.offeringId)] : []).filter((offering): offering is Offering => offering !== undefined);
    const courseIds = new Set(linked.filter(offering => offering.resolutionStatus === 'matched' && offering.courseId !== null).map(offering => offering.courseId!));
    if (courseIds.size !== 1) { warnings.push({ rawName: first.rawName, reason: linked.length ? '照合先の科目identityまたはカリキュラム対応を一意に確定できません' : '照合先が未設定です' }); continue; }
    const courseId = [...courseIds][0];
    const sameCourseEarned = plannedItems.some(item => item.status === 'earned' && offerings.get(item.offeringId)?.courseId === courseId);
    if (sameCourseEarned) { warnings.push({ rawName: first.rawName, reason: '履修計画の修得済み科目と同一identityのため、二重計上を避けて算入しません' }); continue; }
    const template = linked.find(offering => offering.courseId === courseId && offering.resolutionStatus === 'matched');
    if (!template || template.credits === null) { warnings.push({ rawName: first.rawName, reason: '照合先の単位数またはカリキュラム対応が不明です' }); continue; }
    const schooling = first.schoolingCreditsTotal ?? null;
    // Only an all-schooling completion can safely claim schooling credit from
    // a single aggregate item. Mixed rows remain ordinary earned credit.
    const method = schooling === earned && template.method === 'schooling' ? 'schooling' : 'correspondence';
    const virtual: Offering = { ...template, id: `imported:${sourceCourseId}`, credits: earned, method };
    items.push({ offeringId: virtual.id, status: 'earned', plannedYear: first.academicYear, plannedTerm: first.term, studyYear: null, earnedOrder: null });
    derivedOfferings.push(virtual);
    const mediaOffering = linked.find(isMediaSchooling);
    if (mediaOffering) media.push({ sourceCourseId, rawName: first.rawName, academicYear: first.academicYear, term: group.find(record => record.method === 'schooling')?.term ?? first.term, earnedCreditsTotal: earned, schoolingCreditsTotal: schooling, records: group, offering: mediaOffering });
  }
  return { items, offerings: derivedOfferings, warnings, media };
}
