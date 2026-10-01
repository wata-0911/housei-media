import type { PlannerCatalog, PlannerItem, PlannerState as V21PlannerState } from './plannerCatalog';
import type { CatalogRef, CourseRegistry, Enrollment, FoundationPlanRow, PlanIntent, PlannerState, OfferingRef } from './plannerStateV22';
import { bridgeEvidence2026, CURRICULUM_2026_REF, createCourseRegistry, is2026CatalogRef, offeringRef2026, resolve2026Offering } from './catalogFoundation';
import { validatePlanIntentShape } from './stateSchemaValidation';

export function enrollmentFromLegacy(item: PlannerItem, catalog: PlannerCatalog): Enrollment {
  const offering = catalog.offerings.find(offering => offering.id === item.offeringId);
  if (!offering || offering.academicYear !== 2026) throw new Error('Unknown annual Offering');
  const registry = createCourseRegistry(catalog.courses);
  const courseId = offering.resolutionStatus === 'matched' && offering.courseId !== null && registry.has(offering.courseId)
    ? offering.courseId : null;
  return { ...item, courseId, courseIdentityResolution: courseId === null ? 'unresolved' : 'catalog_provisional',
    planIntentId: null, offeringRef: offeringRef2026(item.offeringId), linkDecision: null };
}

/** Preserve unknown import references too; only resolvable orphan IDs get pins. */
export function referencedOfferingIds(state: Pick<PlannerState, 'todos' | 'mediaSchoolingProgress' | 'correspondenceProgress' | 'courseEvaluations' | 'importedStudyRecords' | 'importedCourseAchievements' | 'graduationProfile'>): Set<string> {
  return new Set([
    ...Object.keys(state.mediaSchoolingProgress), ...Object.keys(state.correspondenceProgress), ...Object.keys(state.courseEvaluations),
    ...state.todos.flatMap(row => row.offeringId === null ? [] : [row.offeringId]),
    ...state.importedStudyRecords.flatMap(row => row.offeringId === null ? [] : [row.offeringId]),
    ...state.importedCourseAchievements.flatMap(row => [...row.candidateOfferingIds, ...(row.selectedOfferingId === null ? [] : [row.selectedOfferingId])]),
    ...state.graduationProfile.recognizedCredits.professionalCourses.flatMap(row => row.offeringId === null ? [] : [row.offeringId]),
  ]);
}

export function migrateV21ToV22(state: V21PlannerState, catalog: PlannerCatalog): PlannerState {
  const items = state.items.map(item => enrollmentFromLegacy(item, catalog));
  const active = new Set(items.map(item => item.offeringId));
  const known = new Set(catalog.offerings.map(offering => offering.id));
  const offeringCatalogRefs: Record<string, CatalogRef> = {};
  for (const id of referencedOfferingIds(state)) {
    if (!active.has(id) && known.has(id)) {
      const { academicYear, revisionId } = offeringRef2026(id);
      offeringCatalogRefs[id] = { academicYear, revisionId };
    }
  }
  return { ...state, schemaVersion: 22, items, planIntents: [], offeringCatalogRefs };
}

export const isValidPlanYear = (year: number): boolean => Number.isInteger(year) && year >= 1000 && year <= 9999;

/** A future intent never claims that an Offering exists. Null/unregistered Course
 * identity is rejected, while provisional identity is intentionally allowed.
 */
export function createPlanIntent(intent: PlanIntent, registry: CourseRegistry): PlanIntent {
  if (!validatePlanIntentShape(intent)) throw new Error('Invalid PlanIntent shape');
  if (!registry.has(intent.courseId)) throw new Error('Course identity is not registered');
  if (!isValidPlanYear(intent.targetAcademicYear) || (intent.plannedYear !== null && !isValidPlanYear(intent.plannedYear))) throw new Error('Invalid plan year');
  return structuredClone(intent);
}

export function enrollmentForIntent(state: Pick<PlannerState, 'items'>, intentId: string): Enrollment | undefined {
  return state.items.find(item => item.planIntentId === intentId);
}

/** No candidate discovery/coalescing or auto-link. Binding is read exclusively
 * from Enrollment, and neither linked flags nor derived rows are persisted.
 */
export function foundationPlanRows(state: PlannerState): FoundationPlanRow[] {
  const intents = new Map(state.planIntents.map(intent => [intent.id, intent]));
  const bound = new Set(state.items.flatMap(item => item.planIntentId === null ? [] : [item.planIntentId]));
  return [
    ...state.items.map((item): FoundationPlanRow => ({ kind: 'annual', item, intent: item.planIntentId === null ? null : intents.get(item.planIntentId) ?? null })),
    ...state.planIntents.filter(intent => !bound.has(intent.id)).map((intent): FoundationPlanRow => ({ kind: 'course_intent', intent })),
    ...state.importedCourseAchievements.map((achievement): FoundationPlanRow => ({ kind: 'imported', achievement })),
    ...state.publicCourses.map((course): FoundationPlanRow => ({ kind: 'public', course })),
  ];
}

/** Active Enrollment is canonical; orphan pins are consulted only without one. */
export function offeringReference(state: Pick<PlannerState, 'items' | 'offeringCatalogRefs'>, offeringId: string): OfferingRef | undefined {
  const active = state.items.find(item => item.offeringId === offeringId);
  if (active) return active.offeringRef;
  const orphan = state.offeringCatalogRefs[offeringId];
  return orphan ? { ...orphan, offeringId } : undefined;
}

/** Pin newly created orphan records in the existing 2026 UI's atomic save.
 * Existing pins are never re-resolved against a latest/default revision.
 */
export function pinOfferingRecords(state: PlannerState, catalog: PlannerCatalog): PlannerState {
  const active = new Set(state.items.map(item => item.offeringId));
  const known = new Set(catalog.offerings.map(offering => offering.id));
  const offeringCatalogRefs: Record<string, CatalogRef> = { ...state.offeringCatalogRefs };
  for (const id of active) delete offeringCatalogRefs[id];
  for (const id of referencedOfferingIds(state)) {
    if (!active.has(id) && known.has(id)) {
      const { academicYear, revisionId } = offeringRef2026(id);
      offeringCatalogRefs[id] = state.offeringCatalogRefs[id] ?? { academicYear, revisionId };
    }
  }
  return { ...state, offeringCatalogRefs };
}

/** One atomic state update moves, rather than duplicates, the revision pin. */
export function removeEnrollment(state: PlannerState, offeringId: string): PlannerState {
  const item = state.items.find(item => item.offeringId === offeringId);
  if (!item) return state;
  const offeringCatalogRefs = { ...state.offeringCatalogRefs };
  if (referencedOfferingIds(state).has(offeringId)) {
    const { academicYear, revisionId } = item.offeringRef;
    offeringCatalogRefs[offeringId] = { academicYear, revisionId };
  }
  return { ...state, items: state.items.filter(item => item.offeringId !== offeringId), offeringCatalogRefs };
}

export function addEnrollment(state: PlannerState, item: Enrollment, catalog: PlannerCatalog, index = state.items.length): PlannerState {
  if (state.items.some(existing => existing.offeringId === item.offeringId)) throw new Error('Duplicate Enrollment');
  const pin = state.offeringCatalogRefs[item.offeringId];
  if (pin && (pin.academicYear !== item.offeringRef.academicYear || pin.revisionId !== item.offeringRef.revisionId)) throw new Error('Orphan revision mismatch');
  if (!resolve2026Offering(catalog, item.offeringRef)) throw new Error('Unknown Offering revision');
  const offeringCatalogRefs = { ...state.offeringCatalogRefs };
  delete offeringCatalogRefs[item.offeringId];
  const position = Math.min(Math.max(index, 0), state.items.length);
  return { ...state, items: [...state.items.slice(0, position), item, ...state.items.slice(position)], offeringCatalogRefs };
}

export function validFoundation(state: PlannerState, catalog: PlannerCatalog): boolean {
  const registry = createCourseRegistry(catalog.courses);
  const intents = new Map(state.planIntents.map(intent => [intent.id, intent]));
  const bound = state.items.flatMap(item => item.planIntentId === null ? [] : [item.planIntentId]);
  const active = new Set(state.items.map(item => item.offeringId));
  const referenced = referencedOfferingIds(state);
  if (intents.size !== state.planIntents.length || new Set(bound).size !== bound.length) return false;
  if (!state.planIntents.every(intent => registry.has(intent.courseId))) return false;
  if (!state.planIntents.every(intent => intent.reference === null || is2026CatalogRef(intent.reference.catalog)
    && intent.reference.offeringIds.every(id => catalog.offerings.some(offering => offering.id === id && offering.courseId === intent.courseId)))) return false;
  if (!Object.entries(state.offeringCatalogRefs).every(([id, ref]) => !active.has(id) && is2026CatalogRef(ref) && resolve2026Offering(catalog, { ...ref, offeringId: id }))) return false;
  // All resolvable orphan references must be pinned, including records added
  // after migration. Unknown import references retain their original semantics.
  if (![...referenced].every(id => active.has(id) || !catalog.offerings.some(offering => offering.id === id) || state.offeringCatalogRefs[id])) return false;
  return state.items.every(item => {
    const offering = resolve2026Offering(catalog, item.offeringRef);
    if (!offering || item.offeringRef.offeringId !== item.offeringId) return false;
    if (item.courseId === null ? item.courseIdentityResolution !== 'unresolved'
      : !registry.has(item.courseId) || offering.courseId !== item.courseId || offering.resolutionStatus !== 'matched'
        || item.courseIdentityResolution !== 'catalog_provisional') return false;
    if (item.planIntentId === null) return item.linkDecision === null;
    const intent = intents.get(item.planIntentId);
    if (!intent || intent.status !== 'planned' || item.courseId === null || item.courseId !== intent.courseId
      || intent.targetAcademicYear !== offering.academicYear || !item.linkDecision) return false;
    // The current scope/profile is NOT a storage invariant. Link evidence pins
    // the context that was reviewed; changing global context is future review.
    const decision = item.linkDecision;
    return decision.curriculumRef.id === CURRICULUM_2026_REF.id && decision.curriculumRef.revisionId === CURRICULUM_2026_REF.revisionId
      && decision.bridgeDigest === bridgeEvidence2026(catalog, offering, decision.scopeId)
      && (decision.source !== 'auto' || registry.get(item.courseId)?.identityStatus === 'verified');
  });
}
