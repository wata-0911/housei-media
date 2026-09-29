import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import { isMediaSchooling } from './mediaSchooling';
import type { Offering, PlannerItem } from './plannerCatalog';

export type ImportedAchievementWarning = { rawName: string; reason: string };
export type ImportedMediaAchievement = { sourceCourseId: string; rawName: string; academicYear: number | null; term: string | null; earnedCreditsTotal: number; schoolingCreditsTotal: number | null; records: ImportedStudyRecord[]; offering: Offering };
export type DerivedImportedAchievements = { items: PlannerItem[]; offerings: Offering[]; warnings: ImportedAchievementWarning[]; media: ImportedMediaAchievement[]; unclassified: ImportedCourseAchievement[]; classifiedCredits: number };

function mediaOfferingFor(group: ImportedStudyRecord[], linked: Offering[], courseId: string, offerings: Map<string, Offering>): Offering | undefined {
  const explicitlyLinked = linked.find(isMediaSchooling);
  if (explicitlyLinked) return explicitlyLinked;

  const mediaCandidates = [...offerings.values()].filter(offering => offering.courseId === courseId && isMediaSchooling(offering));
  const terms = group.filter(record => record.method === 'schooling').flatMap(record => [record.term, record.rawTerm]).filter((term): term is string => typeof term === 'string').map(term => term.normalize('NFKC').replace(/\s/g, ''));
  const candidatesFor = (category: string) => mediaCandidates.filter(offering => offering.deliveryCategory === category);
  for (const category of ['前期メディア', '後期メディア']) {
    if (terms.some(term => term.includes(category))) {
      const candidates = candidatesFor(category);
      return candidates.length === 1 ? candidates[0] : undefined;
    }
  }
  if (terms.some(term => term.includes('メディア'))) return mediaCandidates.length === 1 ? mediaCandidates[0] : undefined;
  const normalCandidates = [...offerings.values()].filter(offering => offering.courseId === courseId && offering.method === 'schooling' && !isMediaSchooling(offering));
  if (mediaCandidates.length === 1 && normalCandidates.length === 0) return mediaCandidates[0];
  return undefined;
}

/**
 * Converts a saved grade-table row into one calculation-only earned item.  A
 * row's aggregate is the only credit source: component credits are display
 * facts and never added together here.  Missing v9 aggregates stay visible
 * but deliberately do not enter calculations.
 */
export function deriveImportedAchievements(records: ImportedStudyRecord[], offerings: Map<string, Offering>, plannedItems: PlannerItem[], sourceRows: ImportedCourseAchievement[] = []): DerivedImportedAchievements {
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
  const rows = sourceRows.length ? sourceRows : [...groups.entries()].map(([id, group]) => {
    const first = group[0]; return { id, fingerprint: `legacy:${id}`, source: 'hosei_import' as const, rawName: first.rawName, categoryRaw: null, capturedAt: first.capturedAt ?? '', earnedCreditsTotal: first.earnedCreditsTotal ?? null, schoolingCreditsTotal: first.schoolingCreditsTotal ?? null, compositionCredits: first.compositionCredits ?? null, recognizedExemption: first.recognizedExemption ?? null, additionalEnrollment: first.additionalEnrollment ?? null, academicYear: first.academicYear, yearSource: first.yearSource, courseId: null, selectedOfferingId: null, match: first.match, candidateOfferingIds: [] };
  });
  const items: PlannerItem[] = [], derivedOfferings: Offering[] = [], media: ImportedMediaAchievement[] = [], unclassified: ImportedCourseAchievement[] = [];
  for (const row of rows) {
    const group = groups.get(row.id) ?? [];
    const earned = row.earnedCreditsTotal;
    if (earned === null || earned <= 0) continue;
    const linked = [row.selectedOfferingId, ...group.map(record => record.offeringId)].flatMap(id => id ? [offerings.get(id)] : []).filter((offering): offering is Offering => offering !== undefined);
    const courseIds = new Set(linked.filter(offering => offering.resolutionStatus === 'matched' && offering.courseId !== null).map(offering => offering.courseId!));
    if (courseIds.size !== 1) { warnings.push({ rawName: row.rawName, reason: linked.length ? '照合先の科目identityまたはカリキュラム対応を一意に確定できません' : '照合先が未設定です' }); unclassified.push(row); continue; }
    const courseId = [...courseIds][0];
    const sameCourseEarned = plannedItems.some(item => item.status === 'earned' && offerings.get(item.offeringId)?.courseId === courseId);
    if (sameCourseEarned) { warnings.push({ rawName: row.rawName, reason: '履修計画の修得済み科目と同一identityのため、二重計上を避けて算入しません' }); continue; }
    const template = linked.find(offering => offering.courseId === courseId && offering.resolutionStatus === 'matched');
    if (!template || template.credits === null) { warnings.push({ rawName: row.rawName, reason: '照合先の単位数またはカリキュラム対応が不明です' }); unclassified.push(row); continue; }
    const schooling = row.schoolingCreditsTotal ?? null;
    // Only an all-schooling completion can safely claim schooling credit from
    // a single aggregate item. Mixed rows remain ordinary earned credit.
    const method = schooling === earned && template.method === 'schooling' ? 'schooling' : 'correspondence';
    const virtual: Offering = { ...template, id: `imported:${row.id}`, credits: earned, method };
    items.push({ offeringId: virtual.id, status: 'earned', plannedYear: row.academicYear, plannedTerm: group.find(record => record.method === 'schooling')?.term ?? null, studyYear: null, earnedOrder: null });
    derivedOfferings.push(virtual);
    const mediaOffering = mediaOfferingFor(group, linked, courseId, offerings);
    if (mediaOffering) media.push({ sourceCourseId: row.id, rawName: row.rawName, academicYear: row.academicYear, term: group.find(record => record.method === 'schooling')?.term ?? null, earnedCreditsTotal: earned, schoolingCreditsTotal: schooling, records: group, offering: mediaOffering });
  }
  return { items, offerings: derivedOfferings, warnings, media, unclassified, classifiedCredits: items.reduce((sum, item) => sum + (derivedOfferings.find(offering => offering.id === item.offeringId)?.credits ?? 0), 0) };
}
