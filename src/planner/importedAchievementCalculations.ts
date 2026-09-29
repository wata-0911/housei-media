import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import { isMediaSchooling } from './mediaSchooling';
import { categoryFromImportRaw, type CreditCategory } from './annualPlan';
import type { ImportedCourseUserMeta, Offering, PlannerItem } from './plannerCatalog';
import type { PlannerCatalog } from './plannerCatalog';
import { matchedNameOfferings, normalizeImportBaseName } from './importedAchievementRepair';

export type ImportedAchievementWarning = { rawName: string; reason: string };
export type ImportedMediaAchievement = { sourceCourseId: string; rawName: string; academicYear: number | null; term: string | null; earnedCreditsTotal: number; schoolingCreditsTotal: number | null; records: ImportedStudyRecord[]; offering: Offering };
export type ImportedMediaPending = { sourceCourseId: string; rawName: string; candidates: Offering[] };
/** An unresolved grade-table row that has a safe Media offering and learner lifecycle context. */
export type ImportedManagedMedia = { sourceCourseId: string; rawName: string; meta: ImportedCourseUserMeta; offering: Offering };
export type DerivedImportedAchievements = { items: PlannerItem[]; offerings: Offering[]; categoryItems: PlannerItem[]; categoryOfferings: Offering[]; warnings: ImportedAchievementWarning[]; media: ImportedMediaAchievement[]; mediaPending: ImportedMediaPending[]; unclassified: ImportedCourseAchievement[]; classifiedCredits: number; categoryOverrides: Map<string, CreditCategory> };

function mediaOfferingFor(group: ImportedStudyRecord[], manuallyLinked: Offering | undefined, courseId: string, offerings: Map<string, Offering>): Offering | undefined {
  // An explicit choice always wins.  In particular, a learner's explicit
  // non-Media choice must not be silently replaced with a derived Media one.
  if (manuallyLinked) return isMediaSchooling(manuallyLinked) ? manuallyLinked : undefined;

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

function oneCourseId(candidates: Offering[]): string | null {
  const ids = [...new Set(candidates.map(candidate => candidate.courseId).filter((id): id is string => id !== null))];
  return ids.length === 1 ? ids[0] : null;
}

/**
 * A display-time counterpart to the v14 repair.  It deliberately returns an
 * identity instead of modifying the imported source row: current imports must
 * benefit from safe NFKC/delivery-suffix repair without turning a derived
 * conclusion into a source fact.
 */
function repairedCourseId(rawName: string, offerings: Map<string, Offering>): string | null {
  const baseName = normalizeImportBaseName(rawName);
  const candidates = [...offerings.values()].filter(offering => offering.resolutionStatus === 'matched' && normalizeImportBaseName(offering.name) === baseName);
  return oneCourseId(candidates);
}

function mediaCandidatesForCourse(courseId: string | null, offerings: Map<string, Offering>): Offering[] {
  return courseId === null ? [] : [...offerings.values()].filter(offering => offering.courseId === courseId && isMediaSchooling(offering));
}

function candidateMedia(row: ImportedCourseAchievement, offerings: Map<string, Offering>): Offering[] {
  return [...new Map(row.candidateOfferingIds.flatMap(id => offerings.get(id)).filter((offering): offering is Offering => Boolean(offering && offering.resolutionStatus === 'matched' && isMediaSchooling(offering))).map(offering => [offering.id, offering])).values()];
}

function derivedMediaOffering(row: ImportedCourseAchievement, group: ImportedStudyRecord[], offerings: Map<string, Offering>): Offering | undefined {
  const selectionSource = row.selectionSource ?? (row.selectedOfferingId ? 'manual' : 'none');
  const manual = selectionSource === 'manual' && row.selectedOfferingId ? offerings.get(row.selectedOfferingId) : undefined;
  // A manual choice is authoritative, including an explicit normal-schooling
  // selection that intentionally keeps this row out of Media progress.
  if (manual) return isMediaSchooling(manual) ? manual : undefined;

  // Rule 2: an exact course identity plus explicit Media term evidence is safe.
  const directCourseId = row.courseId && row.match === 'exact_unique' ? row.courseId : null;
  const direct = directCourseId ? mediaOfferingFor(group, undefined, directCourseId, offerings) : undefined;
  if (direct) return direct;

  // Rule 3: reuse the constrained v14 base-name repair as a derived identity.
  // mediaOfferingFor still rejects normal-schooling competition when no Media
  // term is present, so names such as English S cannot activate Media alone.
  const repairedCourse = repairedCourseId(row.rawName, offerings);
  const repaired = repairedCourse ? mediaOfferingFor(group, undefined, repairedCourse, offerings) : undefined;
  if (repaired) return repaired;

  // Rule 4: import candidates can establish a single Media offering only when
  // neither their set nor their resolved course identity has a normal-schooling
  // competitor.
  const candidates = candidateMedia(row, offerings);
  const candidateIds = new Set(row.candidateOfferingIds);
  const candidateCourseIds = new Set(candidates.map(candidate => candidate.courseId).filter((id): id is string => id !== null));
  const normalCandidate = [...candidateIds].map(id => offerings.get(id)).some(offering => offering?.resolutionStatus === 'matched' && offering.method === 'schooling' && !isMediaSchooling(offering))
    || [...offerings.values()].some(offering => offering.resolutionStatus === 'matched' && offering.courseId !== null && candidateCourseIds.has(offering.courseId) && offering.method === 'schooling' && !isMediaSchooling(offering));
  return candidates.length === 1 && !normalCandidate ? candidates[0] : undefined;
}

/**
 * Finds a Media offering only from an existing safe course identity or a
 * manual selection. Names alone never activate progress tracking.
 */
export function managedImportedMedia(rows: ImportedCourseAchievement[], records: ImportedStudyRecord[], userMeta: Record<string, ImportedCourseUserMeta>, offerings: Map<string, Offering>): { media: ImportedManagedMedia[]; pending: ImportedMediaPending[] } {
  const grouped = new Map<string, ImportedStudyRecord[]>();
  for (const record of records) if (record.sourceCourseId) grouped.set(record.sourceCourseId, [...(grouped.get(record.sourceCourseId) ?? []), record]);
  const media: ImportedManagedMedia[] = [];
  const pending: ImportedMediaPending[] = [];
  const usedOfferings = new Set<string>();
  for (const row of rows) {
    const meta = userMeta[row.id];
    // Only an explicitly in-progress, not-yet-earned row may create a Media
    // progress surface.  Waiting and pending rows remain source facts only.
    if (meta?.lifecycleStatus !== 'in_progress' || (row.earnedCreditsTotal !== null && row.earnedCreditsTotal > 0)) continue;
    const group = grouped.get(row.id) ?? [];
    const selectionSource = row.selectionSource ?? (row.selectedOfferingId ? 'manual' : 'none');
    const offering = derivedMediaOffering(row, group, offerings);
    if (offering && !usedOfferings.has(offering.id)) {
      media.push({ sourceCourseId: row.id, rawName: row.rawName, meta, offering });
      usedOfferings.add(offering.id);
      continue;
    }
    const directCourseId = row.courseId && row.match === 'exact_unique' ? row.courseId : null;
    const repairedCourse = repairedCourseId(row.rawName, offerings);
    const candidates = [...new Map([...mediaCandidatesForCourse(directCourseId, offerings), ...mediaCandidatesForCourse(repairedCourse, offerings), ...candidateMedia(row, offerings)].map(candidate => [candidate.id, candidate])).values()];
    // A safe course identity alone is not proof that a schooling component
    // was Media.  Keep every unresolved automatic case visible for an
    // intentional learner confirmation, including a single Media candidate
    // that conflicts with a normal-schooling candidate.
    if (candidates.length > 0 && selectionSource !== 'manual') pending.push({ sourceCourseId: row.id, rawName: row.rawName, candidates });
  }
  return { media, pending };
}

/**
 * Converts a saved grade-table row into one calculation-only earned item.  A
 * row's aggregate is the only credit source: component credits are display
 * facts and never added together here.  Missing v9 aggregates stay visible
 * but deliberately do not enter calculations.
 */
export function deriveImportedAchievements(records: ImportedStudyRecord[], offerings: Map<string, Offering>, plannedItems: PlannerItem[], sourceRows: ImportedCourseAchievement[] = [], catalog?: PlannerCatalog, selectedScopeId: string | null = null): DerivedImportedAchievements {
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
    const first = group[0]; return { id, fingerprint: `legacy:${id}`, source: 'hosei_import' as const, rawName: first.rawName, categoryRaw: null, capturedAt: first.capturedAt ?? '', earnedCreditsTotal: first.earnedCreditsTotal ?? null, schoolingCreditsTotal: first.schoolingCreditsTotal ?? null, compositionCredits: first.compositionCredits ?? null, recognizedExemption: first.recognizedExemption ?? null, additionalEnrollment: first.additionalEnrollment ?? null, academicYear: first.academicYear, yearSource: first.yearSource, courseId: null, selectedOfferingId: null, selectionSource: 'none' as const, match: first.match, candidateOfferingIds: [] };
  });
  const items: PlannerItem[] = [], derivedOfferings: Offering[] = [], categoryItems: PlannerItem[] = [], categoryOfferings: Offering[] = [], media: ImportedMediaAchievement[] = [], mediaPending: ImportedMediaPending[] = [], unclassified: ImportedCourseAchievement[] = [], categoryOverrides = new Map<string, CreditCategory>();
  for (const row of rows) {
    const selectionSource = row.selectionSource ?? (row.selectedOfferingId ? 'manual' : 'none');
    const group = groups.get(row.id) ?? [];
    const earned = row.earnedCreditsTotal;
    if (earned === null || earned <= 0) continue;
    // A row-level choice is an explicit correction and therefore overrides its
    // detail records, which can legitimately point at separate components.
    const category = categoryFromImportRaw(row.categoryRaw);
    const linked = (selectionSource === 'manual' && row.selectedOfferingId ? [row.selectedOfferingId] : row.selectedOfferingId ? [row.selectedOfferingId, ...group.map(record => record.offeringId)] : group.map(record => record.offeringId)).flatMap(id => id ? [offerings.get(id)] : []).filter((offering): offering is Offering => offering !== undefined);
    // A v13 repair may establish a course identity without guessing a single
    // offering.  It is just as safe as a linked matched offering for category
    // and graduation mapping.
    const rowCandidates = row.courseId ? [...offerings.values()].filter(offering => offering.courseId === row.courseId && offering.resolutionStatus === 'matched') : [];
    const mappingCandidates = [...linked, ...rowCandidates];
    const courseIds = new Set(mappingCandidates.filter(offering => offering.resolutionStatus === 'matched' && offering.courseId !== null).map(offering => offering.courseId!));
    const baseCandidates = catalog && selectedScopeId ? matchedNameOfferings(row.rawName, catalog) : [];
    const commonScopes = new Set(catalog?.programs.filter(program => program.isCommon).map(program => program.scopeId) ?? []);
    const mappings = new Map((catalog?.mappings ?? []).map(mapping => [mapping.mappingId, mapping]));
    const candidateCategories = new Set(baseCandidates.flatMap(offering => offering.mappingIds.map(id => mappings.get(id)).filter((mapping): mapping is NonNullable<typeof mapping> => mapping !== undefined).filter(mapping => mapping.scopeId === selectedScopeId || commonScopes.has(mapping.scopeId)).map(mapping => mapping.category === '一般教育' && mapping.field ? `一般教育：${mapping.field}` : mapping.category)).filter((value): value is CreditCategory => ['一般教育：人文', '一般教育：社会', '一般教育：自然', '一般教育：その他', '外国語', '保健体育', '専門教育'].includes(value)));
    const fallbackCategory = !category && baseCandidates.length > 0 && candidateCategories.size === 1 ? [...candidateCategories][0] : null;
    if (courseIds.size !== 1) {
      const categoryToUse = category ?? fallbackCategory;
      if (categoryToUse) {
        const id = `imported-category:${row.id}`;
        const virtual: Offering = { id, courseId: null, academicYear: 2026, name: row.rawName, method: 'correspondence', subjectCode: null, classCode: null, credits: earned, deliveryCategory: null, period: null, faculty: null, department: null, eligibleYears: null, resolutionStatus: 'manual_review', mappingIds: [], source: { url: null, page: null } };
        categoryItems.push({ offeringId: id, status: 'earned', plannedYear: row.academicYear, plannedTerm: null, studyYear: null, earnedOrder: null }); categoryOfferings.push(virtual); categoryOverrides.set(id, categoryToUse);
      } else { warnings.push({ rawName: row.rawName, reason: baseCandidates.length ? '候補の所属区分が一致しないため手動確認が必要です' : linked.length ? '照合先の科目identityまたはカリキュラム対応を一意に確定できません' : '名称候補がありません' }); unclassified.push(row); }
      const schoolingEvidence = group.some(record => record.method === 'schooling') || (row.schoolingCreditsTotal !== null && row.schoolingCreditsTotal > 0);
      if (schoolingEvidence && selectionSource !== 'manual') { const candidates = baseCandidates.filter(isMediaSchooling); if (candidates.length) mediaPending.push({ sourceCourseId: row.id, rawName: row.rawName, candidates }); }
      continue;
    }
    const courseId = [...courseIds][0];
    const sameCourseEarned = plannedItems.some(item => item.status === 'earned' && offerings.get(item.offeringId)?.courseId === courseId);
    if (sameCourseEarned) { warnings.push({ rawName: row.rawName, reason: '履修計画の修得済み科目と同一identityのため、二重計上を避けて算入しません' }); continue; }
    const template = mappingCandidates.find(offering => offering.courseId === courseId && offering.resolutionStatus === 'matched');
    if (!template || template.credits === null) { warnings.push({ rawName: row.rawName, reason: '照合先の単位数またはカリキュラム対応が不明です' }); if (!category) unclassified.push(row); continue; }
    const schooling = row.schoolingCreditsTotal ?? null;
    // Only an all-schooling completion can safely claim schooling credit from
    // a single aggregate item. Mixed rows remain ordinary earned credit.
    const method = schooling === earned && template.method === 'schooling' ? 'schooling' : 'correspondence';
    const virtual: Offering = { ...template, id: `imported:${row.id}`, credits: earned, method };
    if (category) {
      const id = `imported-category:${row.id}`;
      const categoryVirtual: Offering = { id, courseId: null, academicYear: 2026, name: row.rawName, method: 'correspondence', subjectCode: null, classCode: null, credits: earned, deliveryCategory: null, period: null, faculty: null, department: null, eligibleYears: null, resolutionStatus: 'manual_review', mappingIds: [], source: { url: null, page: null } };
      categoryItems.push({ offeringId: id, status: 'earned', plannedYear: row.academicYear, plannedTerm: null, studyYear: null, earnedOrder: null }); categoryOfferings.push(categoryVirtual); categoryOverrides.set(id, category);
    }
    items.push({ offeringId: virtual.id, status: 'earned', plannedYear: row.academicYear, plannedTerm: group.find(record => record.method === 'schooling')?.term ?? null, studyYear: null, earnedOrder: null });
    derivedOfferings.push(virtual);
    if (!category) categoryItems.push(items.at(-1)!);
    if (!category) categoryOfferings.push(virtual);
    const manuallyLinked = selectionSource === 'manual' && row.selectedOfferingId ? offerings.get(row.selectedOfferingId) : undefined;
    const legacyExplicitMedia = sourceRows.length === 0 && group.length === 1 ? linked.find(isMediaSchooling) : undefined;
    const mediaOffering = mediaOfferingFor(group, manuallyLinked ?? legacyExplicitMedia, courseId, offerings);
    if (mediaOffering) media.push({ sourceCourseId: row.id, rawName: row.rawName, academicYear: row.academicYear, term: group.find(record => record.method === 'schooling')?.term ?? null, earnedCreditsTotal: earned, schoolingCreditsTotal: schooling, records: group, offering: mediaOffering });
    else if ((group.some(record => record.method === 'schooling') || (schooling !== null && schooling > 0 && group.length === 0)) && selectionSource !== 'manual') {
      const candidates = [...offerings.values()].filter(offering => offering.courseId === courseId && isMediaSchooling(offering));
      if (candidates.length) mediaPending.push({ sourceCourseId: row.id, rawName: row.rawName, candidates });
    }
  }
  return { items, offerings: derivedOfferings, categoryItems, categoryOfferings, warnings, media, mediaPending, unclassified, classifiedCredits: items.reduce((sum, item) => sum + (derivedOfferings.find(offering => offering.id === item.offeringId)?.credits ?? 0), 0), categoryOverrides };
}
