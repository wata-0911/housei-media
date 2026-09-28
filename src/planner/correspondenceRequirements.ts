import type { Offering } from './plannerCatalog';

export type CorrespondenceRequirement = { requiredReports: number; sourcePage: number; sourceLabel: string };

/*
 * Exact-name mappings transcribed from 2026年度通信学習設題総覧.  Names with
 * multiple plausible catalog matches remain unknown rather than being guessed.
 */
const requirementsByName: Record<string, CorrespondenceRequirement> = {
  '健康・スポーツ科学概論': { requiredReports: 1, sourcePage: 19, sourceLabel: '教養-19' },
  '経営学総論Ⅰ': { requiredReports: 1, sourcePage: 161, sourceLabel: '商業-1' },
  '債権総論': { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' },
  '民法総則': { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' },
  '日本史': { requiredReports: 2, sourcePage: 19, sourceLabel: '教養-19' },
  '西洋史': { requiredReports: 2, sourcePage: 19, sourceLabel: '教養-19' },
  '哲学': { requiredReports: 2, sourcePage: 19, sourceLabel: '教養-19' },
  '行政法': { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' },
  '会社法': { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' },
  '刑事訴訟法': { requiredReports: 2, sourcePage: 39, sourceLabel: '法律-1' },
  '経済学': { requiredReports: 2, sourcePage: 133, sourceLabel: '経済-1' },
  '財政学Ⅰ': { requiredReports: 2, sourcePage: 133, sourceLabel: '経済-1' },
};

export function correspondenceRequirementFor(offering: Offering | undefined): CorrespondenceRequirement | null {
  if (offering?.method !== 'correspondence') return null;
  return requirementsByName[offering.name] ?? null;
}

export const structuredRequirementCount = Object.keys(requirementsByName).length;
