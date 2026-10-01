import type { GraduationProfile, PlannerCatalog, PlannerState, ThesisGuidanceProgress, ThesisGuidanceStep } from './plannerCatalog';
import { publicCourseLimitFor, evaluatePublicCourseLimit } from './publicCourseRules';
import { resolveSafeImportedCourseId } from './importedAchievementIdentity';

export type GuidanceCondition = { label: string; status: 'satisfied' | 'unsatisfied' | 'unknown'; reason?: string };
export type GuidanceStepView = { id: string; label: string; step: ThesisGuidanceStep; conditions: GuidanceCondition[] };
const blank = (): ThesisGuidanceStep => ({ status: 'not_started', passedOn: null });
const passed = (progress: ThesisGuidanceProgress, ...ids: string[]): GuidanceCondition => ({ label: `${ids.join('・')}の指導に合格`, status: ids.every(id => progress.steps[id]?.status === 'passed') ? 'satisfied' : 'unsatisfied' });
export const guidanceForScope = (state: Pick<import('./plannerCatalog').PlannerState, 'thesisGuidanceByScope'>, scopeId: string | null): ThesisGuidanceProgress =>
  scopeId ? state.thesisGuidanceByScope[scopeId] ?? { steps: {}, geographyReportSubmitted: null } : { steps: {}, geographyReportSubmitted: null };
export const setGuidanceStep = (progress: ThesisGuidanceProgress, id: string, patch: Partial<ThesisGuidanceStep>): ThesisGuidanceProgress => ({ ...progress, steps: { ...progress.steps, [id]: { ...blank(), ...progress.steps[id], ...patch } } });
export type GuidanceEligibilityResult = { credits: number | null; status: 'known' | 'unknown'; reason?: string };
type GuidanceState = Pick<PlannerState, 'items' | 'publicCourses' | 'importedCourseAchievements' | 'graduationProfile' | 'selectedScopeId'>;

/** Separate from graduation progress: this only answers the 60/80/100 credit gates. */
export function guidanceEligibilityCreditResult(state: GuidanceState, catalog: PlannerCatalog): GuidanceEligibilityResult {
  const offerings = new Map(catalog.offerings.map(row => [row.id, row]));
  const commonScopes = new Set(catalog.programs.filter(program => program.isCommon).map(program => program.scopeId));
  const relevantMappings = (offeringId: string) => {
    const offering = offerings.get(offeringId);
    if (!offering || offering.resolutionStatus !== 'matched') return null;
    const mappings = offering.mappingIds.map(id => catalog.mappings.find(mapping => mapping.mappingId === id)).filter((mapping): mapping is NonNullable<typeof mapping> => Boolean(mapping)).filter(mapping => mapping.scopeId === state.selectedScopeId || commonScopes.has(mapping.scopeId));
    return mappings.length ? { offering, mappings } : null;
  };
  const excluded = (categories: string[]) => categories.some(category => /教職|教科専門|その他専門/.test(category));
  const creditsByIdentity = new Map<string, { credits: number; ceiling: number }>();
  const add = (identity: string, credits: number, ceiling: number) => {
    const previous = creditsByIdentity.get(identity) ?? { credits: 0, ceiling };
    previous.ceiling = Math.max(previous.ceiling, ceiling);
    previous.credits = Math.min(previous.ceiling, previous.credits + credits);
    creditsByIdentity.set(identity, previous);
  };
  for (const item of state.items) if (item.status === 'earned') {
    const resolved = relevantMappings(item.offeringId);
    if (!resolved || resolved.offering.credits === null) return { credits: null, status: 'unknown', reason: '修得済みの計画科目を資格単位へ安全に分類できません。' };
    if (!excluded(resolved.mappings.map(mapping => mapping.category))) add(resolved.offering.courseId ?? resolved.offering.id, resolved.offering.credits, resolved.offering.credits);
  }
  for (const row of state.importedCourseAchievements) {
    if (row.earnedCreditsTotal === null || row.earnedCreditsTotal <= 0) continue;
    const courseId = resolveSafeImportedCourseId(row, offerings);
    const candidates = courseId ? [...offerings.values()].filter(offering => offering.courseId === courseId && offering.resolutionStatus === 'matched') : [];
    const relevant = candidates.map(candidate => relevantMappings(candidate.id)).filter((value): value is NonNullable<typeof value> => Boolean(value));
    if (!courseId || !relevant.length || relevant.some(value => value.offering.credits === null)) return { credits: null, status: 'unknown', reason: '成績取込の修得実績を資格単位へ安全に分類できません。' };
    if (!excluded(relevant.flatMap(value => value.mappings.map(mapping => mapping.category)))) add(courseId, row.earnedCreditsTotal, Math.max(...relevant.map(value => value.offering.credits!)));
  }
  const limit = state.selectedScopeId ? publicCourseLimitFor(catalog, state.selectedScopeId) : null;
  if (state.publicCourses.some(course => course.status === 'earned') && !limit) return { credits: null, status: 'unknown', reason: '公開科目の算入上限を確認できません。' };
  const publicCredits = limit ? evaluatePublicCourseLimit(state.publicCourses, limit).countedCredits : 0;
  const recognized = state.graduationProfile.recognizedCredits;
  const detailedRecognized = Object.values(recognized.general).reduce((sum, row) => sum + (row.mode === 'recognized' ? row.credits ?? 0 : row.mode === 'exempt' ? 12 : 0), 0) + (recognized.foreignLanguage.mode === 'recognized' ? recognized.foreignLanguage.credits ?? 0 : recognized.foreignLanguage.mode === 'exempt' ? 4 : 0) + (recognized.physicalEducation.mode === 'recognized' ? recognized.physicalEducation.credits ?? 0 : recognized.physicalEducation.mode === 'exempt' ? 2 : 0) + recognized.professionalCourses.reduce((sum, row) => sum + row.credits, 0);
  // Aggregate recognition already includes the detail: it is never another bucket.
  const recognitionCredits = recognized.totalCredits === null ? detailedRecognized : Math.max(recognized.totalCredits, detailedRecognized);
  return { credits: [...creditsByIdentity.values()].reduce((sum, value) => sum + value.credits, 0) + publicCredits + recognitionCredits, status: 'known' };
}

export function guidanceEligibilityCredits(state: GuidanceState, catalog: PlannerCatalog): number | null {
  return guidanceEligibilityCreditResult(state, catalog).credits;
}

function year(profile: GraduationProfile, minimum: number): GuidanceCondition { return profile.currentStudyYear === null ? { label: `${minimum}年次以上`, status: 'unknown', reason: '在学年次を入力してください。' } : { label: `${minimum}年次以上`, status: profile.currentStudyYear >= minimum ? 'satisfied' : 'unsatisfied' }; }
function valid(step: ThesisGuidanceStep, years: number, referenceDate: Date): GuidanceCondition {
  if (step.status !== 'passed') return { label: '前段指導に合格', status: 'unsatisfied' };
  if (!step.passedOn) return { label: `${years}年間の有効期間`, status: 'unknown', reason: '合格日が未入力です。' };
  const until = new Date(step.passedOn); until.setFullYear(until.getFullYear() + years);
  return { label: `${years}年間の有効期間`, status: until >= referenceDate ? 'satisfied' : 'unsatisfied' };
}
/** Procedures only; credit inputs remain intentionally external and never declare graduation. */
export function thesisGuidanceViews(catalog: PlannerCatalog, scopeId: string | null, profile: GraduationProfile, progress: ThesisGuidanceProgress, eligibilityCredits: number | null, referenceDate: Date): GuidanceStepView[] {
  const department = catalog.programs.find(p => p.scopeId === scopeId)?.department;
  const credit = (target: number): GuidanceCondition => eligibilityCredits === null ? { label: `${target}単位以上`, status: 'unknown', reason: '対象外科目を安全に除外できない実績があります。' } : { label: `${target}単位以上`, status: eligibilityCredits >= target ? 'satisfied' : 'unsatisfied' };
  const step = (id: string, label: string, conditions: GuidanceCondition[] = []): GuidanceStepView => ({ id, label, step: { ...blank(), ...progress.steps[id] }, conditions });
  if (department === '法律学科') return [step('general', '卒業論文一般指導', [year(profile, 3)]), step('submission', '卒論提出申請（参考）', [year(profile, 4), credit(100), passed(progress, 'general')])];
  if (['日本文学科', '史学科', '地理学科'].includes(department ?? '')) {
    const first = step('first', '第1次指導', [year(profile, 3), credit(60), ...(department === '地理学科' ? [{ label: '地理調査法リポート提出', status: progress.geographyReportSubmitted === null ? 'unknown' as const : progress.geographyReportSubmitted ? 'satisfied' as const : 'unsatisfied' as const }] : [])]);
    const rows = [step('general', '卒業論文一般指導（任意）', [year(profile, 2)]), first, step('second', '第2次指導', [valid(first.step, 3, referenceDate)])];
    if (department !== '日本文学科') rows.push(step('third', '第3次指導', [{ label: '第1・第2次指導に合格', status: first.step.status === 'passed' && progress.steps.second?.status === 'passed' ? 'satisfied' : 'unsatisfied' }]));
    rows.push(step('submission', '卒論提出申請（参考）', [year(profile, 4), credit(100), passed(progress, 'first', 'second', ...(department === '日本文学科' ? [] : ['third']))])); return rows;
  }
  if (['経済学科', '商業学科'].includes(department ?? '')) { const plan = step('plan', '卒業論文計画書指導', [year(profile, 4), credit(80)]); return [step('general', '卒業論文一般指導（任意）', [year(profile, 2)]), plan, step('interim', '卒業論文中間報告書指導', [valid(plan.step, 2, referenceDate)]), step('submission', '卒論提出申請（参考）', [year(profile, 4), credit(100), passed(progress, 'plan', 'interim')])]; }
  return [];
}
