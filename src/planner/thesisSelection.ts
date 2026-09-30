import type { PlannerCatalog, PlannerState, ThesisProgress } from './plannerCatalog';

export type ThesisPolicy = 'required' | 'optional' | 'unknown';

/**
 * Derive the policy only from structured, scope-local catalog evidence. A thesis
 * course with a stated credit requirement is mandatory; an optional policy needs
 * both official numeric branches. Everything else deliberately stays unknown.
 */
export function thesisPolicyForScope(catalog: PlannerCatalog, scopeId: string | null): ThesisPolicy {
  if (scopeId === null) return 'unknown';
  const department = catalog.programs.find(program => program.scopeId === scopeId)?.department;
  if (['日本文学科', '史学科', '地理学科'].includes(department ?? '')) return 'required';
  if (['法律学科', '経済学科', '商業学科'].includes(department ?? '')) return 'optional';
  return 'unknown';
}

/** A choice is exposed only where the catalog contains both official branches. */
export function supportsThesisSelection(catalog: PlannerCatalog, scopeId: string | null) {
  return thesisPolicyForScope(catalog, scopeId) === 'optional';
}

/** A thesis decision belongs to the selected program and is never carried across programs. */
export function stateForScopeChange(state: PlannerState, selectedScopeId: string | null): PlannerState {
  const progress = selectedScopeId === null ? { selection: 'undecided' as const, status: 'not_started' as const }
    : state.thesisProgressByScope[selectedScopeId] ?? { selection: 'undecided' as const, status: 'not_started' as const };
  return { ...state, selectedScopeId, thesisSelection: progress.selection };
}

export function thesisProgressForScope(state: Pick<PlannerState, 'thesisSelection' | 'thesisProgressByScope'>, scopeId: string | null): ThesisProgress {
  const saved = scopeId === null ? undefined : state.thesisProgressByScope[scopeId];
  return saved ?? { selection: state.thesisSelection, status: 'not_started' };
}

export function setThesisProgressForScope(state: PlannerState, scopeId: string | null, patch: Partial<ThesisProgress>): PlannerState {
  if (scopeId === null) return state;
  const current = thesisProgressForScope(state, scopeId);
  const next = { ...current, ...patch };
  if (next.selection !== 'selected') next.status = 'not_started';
  return { ...state, thesisSelection: next.selection, thesisProgressByScope: { ...state.thesisProgressByScope, [scopeId]: next } };
}
