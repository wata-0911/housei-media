import type { GraduationProfile, PlannerCatalog, PlannerItem, ThesisGuidanceProgress, ThesisGuidanceStep } from './plannerCatalog';

export type GuidanceCondition = { label: string; status: 'satisfied' | 'unsatisfied' | 'unknown'; reason?: string };
export type GuidanceStepView = { id: string; label: string; step: ThesisGuidanceStep; conditions: GuidanceCondition[] };
const blank = (): ThesisGuidanceStep => ({ status: 'not_started', passedOn: null });
export const guidanceForScope = (state: Pick<import('./plannerCatalog').PlannerState, 'thesisGuidanceByScope'>, scopeId: string | null): ThesisGuidanceProgress =>
  scopeId ? state.thesisGuidanceByScope[scopeId] ?? { steps: {}, geographyReportSubmitted: null } : { steps: {}, geographyReportSubmitted: null };
export const setGuidanceStep = (progress: ThesisGuidanceProgress, id: string, patch: Partial<ThesisGuidanceStep>): ThesisGuidanceProgress => ({ ...progress, steps: { ...progress.steps, [id]: { ...blank(), ...progress.steps[id], ...patch } } });
export function guidanceEligibilityCredits(items: PlannerItem[], catalog: PlannerCatalog, profile: GraduationProfile): number | null {
  const seen = new Set<string>(); let total = 0;
  for (const item of items) { if (item.status === 'earned') { const offering = catalog.offerings.find(o => o.id === item.offeringId); if (!offering || offering.credits === null || offering.resolutionStatus !== 'matched') return null; const maps = offering.mappingIds.map(id => catalog.mappings.find(m => m.mappingId === id)).filter(Boolean); if (maps.some(m => /教職|教科専門|その他専門/.test(m!.category))) continue; const key = offering.courseId ?? offering.id; if (!seen.has(key)) { seen.add(key); total += offering.credits; } } }
  return total + (profile.recognizedCredits.totalCredits ?? 0);
}

function year(profile: GraduationProfile, minimum: number): GuidanceCondition { return profile.currentStudyYear === null ? { label: `${minimum}年次以上`, status: 'unknown', reason: '在学年次を入力してください。' } : { label: `${minimum}年次以上`, status: profile.currentStudyYear >= minimum ? 'satisfied' : 'unsatisfied' }; }
function valid(step: ThesisGuidanceStep, years: number): GuidanceCondition {
  if (step.status !== 'passed') return { label: '前段指導に合格', status: 'unsatisfied' };
  if (!step.passedOn) return { label: `${years}年間の有効期間`, status: 'unknown', reason: '合格日が未入力です。' };
  const until = new Date(step.passedOn); until.setFullYear(until.getFullYear() + years);
  return { label: `${years}年間の有効期間`, status: until >= new Date() ? 'satisfied' : 'unsatisfied' };
}
/** Procedures only; credit inputs remain intentionally external and never declare graduation. */
export function thesisGuidanceViews(catalog: PlannerCatalog, scopeId: string | null, profile: GraduationProfile, progress: ThesisGuidanceProgress, eligibilityCredits: number | null): GuidanceStepView[] {
  const department = catalog.programs.find(p => p.scopeId === scopeId)?.department;
  const credit = (target: number): GuidanceCondition => eligibilityCredits === null ? { label: `${target}単位以上`, status: 'unknown', reason: '対象外科目を安全に除外できない実績があります。' } : { label: `${target}単位以上`, status: eligibilityCredits >= target ? 'satisfied' : 'unsatisfied' };
  const step = (id: string, label: string, conditions: GuidanceCondition[] = []): GuidanceStepView => ({ id, label, step: { ...blank(), ...progress.steps[id] }, conditions });
  if (department === '法律学科') return [step('general', '卒業論文一般指導', [year(profile, 3)]), step('submission', '卒論提出申請（参考）', [year(profile, 4), credit(100), { label: '一般指導を受講', status: progress.steps.general?.status === 'passed' ? 'satisfied' : 'unsatisfied' }])];
  if (['日本文学科', '史学科', '地理学科'].includes(department ?? '')) {
    const first = step('first', '第1次指導', [year(profile, 3), credit(60), ...(department === '地理学科' ? [{ label: '地理調査法リポート提出', status: progress.geographyReportSubmitted === null ? 'unknown' as const : progress.geographyReportSubmitted ? 'satisfied' as const : 'unsatisfied' as const }] : [])]);
    const rows = [step('general', '卒業論文一般指導（任意）', [year(profile, 2)]), first, step('second', '第2次指導', [valid(first.step, 3)])];
    if (department !== '日本文学科') rows.push(step('third', '第3次指導', [{ label: '第1・第2次指導に合格', status: first.step.status === 'passed' && progress.steps.second?.status === 'passed' ? 'satisfied' : 'unsatisfied' }]));
    rows.push(step('submission', '卒論提出申請（参考）', [year(profile, 4), credit(100)])); return rows;
  }
  if (['経済学科', '商業学科'].includes(department ?? '')) { const plan = step('plan', '卒業論文計画書指導', [year(profile, 4), credit(80)]); return [step('general', '卒業論文一般指導（任意）', [year(profile, 2)]), plan, step('interim', '卒業論文中間報告書指導', [valid(plan.step, 2)]), step('submission', '卒論提出申請（参考）', [year(profile, 4), credit(100)])]; }
  return [];
}
