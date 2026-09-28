import type { Offering, PlannerCatalog } from './plannerCatalog';
import { createMappingResolver } from './plannerHelpers';

export type AcademicYearLevel = 1 | 2 | 3 | 4;
export type YearEligibility = 'eligible' | 'ineligible' | 'unknown';

type EligibilityResolution = { years: AcademicYearLevel[] | null };

const YEAR_LEVELS: AcademicYearLevel[] = [1, 2, 3, 4];

function isAcademicYearLevel(value: number): value is AcademicYearLevel {
  return YEAR_LEVELS.includes(value as AcademicYearLevel);
}

function normalizedYears(years: number[] | null): AcademicYearLevel[] | null {
  if (years === null || years.length === 0 || !years.every(isAcademicYearLevel)) return null;
  return [...new Set(years as AcademicYearLevel[])].sort((a, b) => a - b);
}

function sameYears(left: AcademicYearLevel[], right: AcademicYearLevel[]) {
  return left.length === right.length && left.every((year, index) => year === right[index]);
}

function commonScopeIds(catalog: PlannerCatalog) {
  return new Set(catalog.programs.filter(program => program.isCommon).map(program => program.scopeId));
}

/**
 * Resolve the single official year range that is safe to expose for this search.
 * Offering data is a catalog-wide opening record; mapping data is scoped curriculum
 * data. They agree in many records but not all, so this deliberately never unions,
 * intersects, or assigns one source priority when both are present and disagree.
 */
function resolveEligibilityYears(offering: Offering, selectedScopeId: string | null, catalog: PlannerCatalog): EligibilityResolution {
  // A mapping override can make an item matched, but unresolved and out-of-scope
  // records have no approved curriculum relationship for this purpose.
  if (offering.resolutionStatus !== 'matched') return { years: null };

  const offeringYears = normalizedYears(offering.eligibleYears);
  if (selectedScopeId === null) return { years: offeringYears };

  const resolveMappings = createMappingResolver(catalog);
  const mappings = resolveMappings(offering);
  const direct = mappings.filter(mapping => mapping.scopeId === selectedScopeId);
  const applicable = direct.length > 0
    ? direct
    : mappings.filter(mapping => commonScopeIds(catalog).has(mapping.scopeId));

  // No relevant curriculum edge does not prove that another department's course is
  // unavailable. Its availability depends on a relationship absent from the catalog.
  if (applicable.length === 0) return { years: null };

  const mappingYears = applicable.map(mapping => normalizedYears(mapping.eligibleYears));
  if (mappingYears.some((years): years is null => years === null)) return { years: null };
  const first = mappingYears[0]!;
  // Several edges for one scope are only usable when they make the same statement.
  if (!mappingYears.every(years => sameYears(first, years!))) return { years: null };
  // A catalog-wide offering statement and a scope statement that conflict are not
  // reconciled here: neither intersection nor precedence is documented.
  if (offeringYears !== null && !sameYears(offeringYears, first)) return { years: null };
  return { years: first };
}

export function yearEligibility(offering: Offering, selectedScopeId: string | null, targetYear: AcademicYearLevel, catalog: PlannerCatalog): YearEligibility {
  const years = resolveEligibilityYears(offering, selectedScopeId, catalog).years;
  if (years === null) return 'unknown';
  return years.includes(targetYear) ? 'eligible' : 'ineligible';
}

/** Uses the same resolution as yearEligibility so the chip cannot contradict filtering. */
export function eligibilityYearsLabel(offering: Offering, selectedScopeId: string | null, catalog: PlannerCatalog) {
  const years = resolveEligibilityYears(offering, selectedScopeId, catalog).years;
  if (years === null) return '履修可能学年: 判定保留';
  const compact = years.length > 1 && years.every((year, index) => index === 0 || year === years[index - 1]! + 1)
    ? `${years[0]}〜${years[years.length - 1]}年`
    : `${years.join('・')}年`;
  return `履修可能学年: ${compact}`;
}

export function filterOfferingsByYear(offerings: Offering[], selectedScopeId: string | null, targetYear: AcademicYearLevel | null, includeUnknown: boolean, catalog: PlannerCatalog) {
  if (targetYear === null) return offerings;
  return offerings.filter(offering => {
    const eligibility = yearEligibility(offering, selectedScopeId, targetYear, catalog);
    return eligibility === 'eligible' || (includeUnknown && eligibility === 'unknown');
  });
}

/** Synthetic public courses have no catalog evidence and are unknown whenever filtered. */
export function showSyntheticPublicCourse(targetYear: AcademicYearLevel | null, includeUnknown: boolean) {
  return targetYear === null || includeUnknown;
}
