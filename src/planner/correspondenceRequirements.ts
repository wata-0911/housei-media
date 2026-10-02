import type { Offering, PlannerItem } from './plannerCatalog';

export type CorrespondenceRequirement = { requiredReports: number; sourcePage: number; sourceLabel: string };

/*
 * Offering IDs whose single 2026 catalog match was visually checked against the
 * corresponding entry in the 通信学習設題総覧.  Name-only matching is unsafe:
 * 経営学総論Ⅰ and 会社法 have multiple correspondence offerings, so they remain
 * unknown until a source-backed one-to-one mapping is available.
 */
export const requirementsByOfferingId: Record<string, CorrespondenceRequirement> = {
  '01a5787a-56d5-4e81-aa09-c6333c937561': { requiredReports: 1, sourcePage: 19, sourceLabel: '教養-19' }, // 健康・スポーツ科学概論
  '04050f27-c605-44c1-ae02-785c42114cd3': { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' }, // 債権総論
  '155a43ec-b3fc-4e1b-b93c-f9696df9afae': { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' }, // 民法総則
  '14f8fb30-560d-49b1-a4ee-dcb27e82c858': { requiredReports: 2, sourcePage: 19, sourceLabel: '教養-19' }, // 日本史
  'b4f44c10-6db3-495b-9833-bbcada7b79f7': { requiredReports: 2, sourcePage: 19, sourceLabel: '教養-19' }, // 西洋史
  'f39777f6-ff69-4622-a50b-4bf8a0a44f47': { requiredReports: 2, sourcePage: 19, sourceLabel: '教養-19' }, // 哲学
  '4c87c6b1-df41-41e3-9dfa-57d920fb0278': { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' }, // 行政法
  '28833e6a-a16e-4240-85a9-de76bdeee27a': { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' }, // 刑事訴訟法
  '0a1ff05f-617a-468f-8ff0-a2d4ee6589d3': { requiredReports: 2, sourcePage: 133, sourceLabel: '経済-1' }, // 経済学
  '3db57799-c797-440c-a31d-b0806a81fe07': { requiredReports: 2, sourcePage: 133, sourceLabel: '経済-1' }, // 財政学Ⅰ
};

export function correspondenceRequirementFor(offering: Offering | undefined): CorrespondenceRequirement | null {
  if (offering?.method !== 'correspondence') return null;
  return requirementsByOfferingId[offering.id] ?? null;
}

/** Only the verified 2/4-topic patterns in shiori p.31 justify halving. */
export function effectiveRequiredReportsFor(item: PlannerItem, offering: Offering, fullRequirement = correspondenceRequirementFor(offering)): number | null {
  const full = fullRequirement?.requiredReports ?? null;
  if (offering.method !== 'correspondence' || offering.credits !== 4 || item.courseCreditContribution !== 2) return full;
  return full === 2 || full === 4 ? full / 2 : null;
}

export const structuredRequirementCount = Object.keys(requirementsByOfferingId).length;
