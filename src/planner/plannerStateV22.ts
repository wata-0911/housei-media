import type { Offering, PlannerCatalog, PlannerItem, PlannerState as V21PlannerState } from './plannerCatalog';

export type CatalogRef = { academicYear: number; revisionId: string };
export type OfferingRef = CatalogRef & { offeringId: string };
export type StableCourse = {
  id: string;
  canonicalName: string;
  identityStatus: 'provisional' | 'verified';
};
export type CourseRegistry = ReadonlyMap<string, Readonly<StableCourse>>;
/** Independent annual source and requirement foundation. No future bundle is
 * registered in PR1 and no source completeness is inferred from another year.
 */
export type AnnualCatalogBundle = CatalogRef & {
  offerings: readonly (Omit<Offering, 'academicYear'> & { academicYear: number })[];
  sourcePaths: readonly string[];
};
export type CurriculumBundle = {
  id: string;
  revisionId: string;
  programs: PlannerCatalog['programs'];
  mappings: PlannerCatalog['mappings'];
  requirements: PlannerCatalog['requirements'];
  graduationCheckComplete: false;
};
export type PlanIntent = {
  id: string;
  courseId: string;
  targetAcademicYear: number;
  plannedYear: number | null;
  preferredTerm: string | null;
  studyYear: 1 | 2 | 3 | 4 | null;
  scopeId: string | null;
  curriculumVersionId: string | null;
  status: 'planned' | 'dropped';
  reference: { catalog: CatalogRef; offeringIds: string[] } | null;
};
export type LinkDecision = {
  source: 'auto' | 'manual';
  scopeId: string;
  curriculumRef: { id: string; revisionId: string };
  bridgeDigest: string;
  acceptedChangeCodes: string[];
};
export type Enrollment = PlannerItem & {
  courseId: string | null;
  courseIdentityResolution: 'catalog_provisional' | 'verified' | 'unresolved';
  planIntentId: string | null;
  offeringRef: OfferingRef;
  linkDecision: LinkDecision | null;
};
export type PlannerState = Omit<V21PlannerState, 'schemaVersion' | 'items'> & {
  schemaVersion: 22;
  items: Enrollment[];
  planIntents: PlanIntent[];
  /** Orphan-only revision pins; never an active binding index. */
  offeringCatalogRefs: Record<string, CatalogRef>;
};

/** Derived only. Course-intent rows have no annual fields/credit achievements.
 * Keeping a tagged row prevents accidentally passing future intent into legacy
 * acquired-credit calculations. PR2 will consume this without persisting it.
 */
export type FoundationPlanRow =
  | { kind: 'course_intent'; intent: PlanIntent }
  | { kind: 'annual'; item: Enrollment; intent: PlanIntent | null }
  | { kind: 'imported'; achievement: V21PlannerState['importedCourseAchievements'][number] }
  | { kind: 'public'; course: V21PlannerState['publicCourses'][number] };
