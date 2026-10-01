import type { Course, Offering, PlannerCatalog } from './plannerCatalog';
import type { CatalogRef, CourseRegistry, OfferingRef, StableCourse } from './plannerStateV22';

/** Versioned application adapter identifier, NOT an official revision or a digest.
 * Bump it (and retain the old adapter) if snapshot/override semantics change.
 * Raw source facts and the effective override view remain separate.
 */
export const CATALOG_2026_MANIFEST = Object.freeze({
  academicYear: 2026,
  revisionId: 'housei-media:2026:effective-adapter:v1',
  snapshotPath: 'src/data/planner_catalog_2026.json',
  overrideModule: 'src/planner/manualMappingOverrides.ts',
  provenance: 'versioned_application_identifier',
} as const);

export const CURRICULUM_2026_REF = Object.freeze({ id: 'current_2026', revisionId: 'housei-media:2026:requirement-adapter:v1' });

/** Canonical evidence serialization, not a fabricated official/cryptographic
 * digest. Pins the effective mapping and credit facts reviewed for this scope.
 */
export function bridgeEvidence2026(catalog: PlannerCatalog, offering: Offering, scopeId: string): string | null {
  if (!catalog.programs.some(program => program.scopeId === scopeId) || offering.resolutionStatus !== 'matched') return null;
  const common = new Set(catalog.programs.filter(program => program.isCommon).map(program => program.scopeId));
  const mappings = catalog.mappings.filter(mapping => offering.mappingIds.includes(mapping.mappingId)
    && (mapping.scopeId === scopeId || common.has(mapping.scopeId)));
  if (mappings.length === 0) return null;
  return JSON.stringify({ offeringId: offering.id, courseId: offering.courseId, credits: offering.credits,
    scopeId, mappings: [...mappings].sort((a, b) => a.mappingId.localeCompare(b.mappingId)) });
}

export function createCourseRegistry(courses: readonly (Course | StableCourse)[]): CourseRegistry {
  const entries = courses.map(course => [course.id, Object.freeze({ ...course })] as const);
  if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error('Duplicate Course identity');
  // Copy, never synthesize an identity from names/codes/mapping. Existing Courses
  // enter as provisional; only a separately audited registry can be verified.
  const registry = new Map(entries);
  return Object.freeze({
    get size() { return registry.size; },
    get: (id: string) => registry.get(id), has: (id: string) => registry.has(id),
    entries: () => registry.entries(), keys: () => registry.keys(), values: () => registry.values(),
    [Symbol.iterator]: () => registry[Symbol.iterator](),
    forEach(callback: (value: Readonly<StableCourse>, key: string, map: CourseRegistry) => void, thisArg?: unknown) {
      registry.forEach((value, key) => callback.call(thisArg, value, key, this));
    },
  });
}

export function courseAllowsAutoLink(registry: CourseRegistry, courseId: string): boolean {
  return registry.get(courseId)?.identityStatus === 'verified';
}

export function offeringRef2026(offeringId: string): OfferingRef {
  return { academicYear: 2026, revisionId: CATALOG_2026_MANIFEST.revisionId, offeringId };
}

export function is2026CatalogRef(ref: CatalogRef): boolean {
  return ref.academicYear === 2026 && ref.revisionId === CATALOG_2026_MANIFEST.revisionId;
}

/** PR1 adapter only. The caller supplies the existing effective catalog; it must
 * not be confused with the unchanged raw snapshot or an unknown future bundle.
 */
export function resolve2026Offering(catalog: PlannerCatalog, ref: OfferingRef): Offering | undefined {
  if (!is2026CatalogRef(ref) || catalog.academicYear !== 2026) return undefined;
  return catalog.offerings.find(offering => offering.id === ref.offeringId && offering.academicYear === 2026);
}

function freezeSource<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(child => freezeSource(child));
    Object.freeze(value);
  }
  return value;
}

export function create2026CatalogAdapter(rawSnapshot: PlannerCatalog, effectiveCatalog: PlannerCatalog) {
  if (rawSnapshot.academicYear !== 2026 || effectiveCatalog.academicYear !== 2026) throw new Error('Wrong source year');
  const rawSnapshotView = freezeSource(structuredClone(rawSnapshot));
  const effectiveView = freezeSource(structuredClone(effectiveCatalog));
  return Object.freeze({ manifest: CATALOG_2026_MANIFEST, rawSnapshot: rawSnapshotView, effectiveView,
    courses: createCourseRegistry(effectiveView.courses),
    resolve: (ref: OfferingRef) => resolve2026Offering(effectiveView, ref),
  });
}
