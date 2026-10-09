import type { PlannerCatalog, PlannerState, ThesisProgress } from './plannerCatalog';

export type ThesisPolicy = 'required' | 'optional' | 'unknown';

/**
 * Department policies follow the audited 2026 thesis rules. Optional does not
 * imply a numeric credit branch: only Law has official with/without targets.
 * Unrecognized departments deliberately stay unknown.
 */
export function thesisPolicyForScope(catalog: PlannerCatalog, scopeId: string | null): ThesisPolicy {
  if (scopeId === null) return 'unknown';
  const department = catalog.programs.find(program => program.scopeId === scopeId)?.department;
  if (['日本文学科', '史学科', '地理学科'].includes(department ?? '')) return 'required';
  if (['法律学科', '経済学科', '商業学科'].includes(department ?? '')) return 'optional';
  return 'unknown';
}

/** Expose a choice only for departments audited as optional. */
export function supportsThesisSelection(catalog: PlannerCatalog, scopeId: string | null) {
  return thesisPolicyForScope(catalog, scopeId) === 'optional';
}

/** A thesis decision belongs to the selected program and is never carried across programs. */
function defaultProgress(policy: ThesisPolicy): ThesisProgress {
  return { selection: policy === 'required' ? 'selected' : 'undecided', status: 'not_started' };
}

/**
 * Required theses are selected by definition.  Keep this normalization at the
 * state boundary as well as in the UI so legacy v18 records cannot make a
 * required thesis look optional or reset its independently tracked status.
 */
function normalizedProgress(policy: ThesisPolicy, progress: ThesisProgress): ThesisProgress {
  if (policy === 'required') return { selection: 'selected', status: progress.status };
  if (progress.selection !== 'selected') return { ...progress, status: 'not_started' };
  return progress;
}

export function thesisProgressForScope(state: Pick<PlannerState, 'thesisSelection' | 'thesisProgressByScope'>, catalog: PlannerCatalog, scopeId: string | null): ThesisProgress {
  const policy = thesisPolicyForScope(catalog, scopeId);
  const saved = scopeId === null ? undefined : state.thesisProgressByScope[scopeId];
  return normalizedProgress(policy, saved ?? (scopeId === null ? { selection: state.thesisSelection, status: 'not_started' } : defaultProgress(policy)));
}

/** Visibility only: hiding procedures must never clear independently saved guidance. */
export function shouldShowThesisGuidance(state: Pick<PlannerState, 'thesisSelection' | 'thesisProgressByScope'>, catalog: PlannerCatalog, scopeId: string | null): boolean {
  return thesisPolicyForScope(catalog, scopeId) !== 'unknown'
    && thesisProgressForScope(state, catalog, scopeId).selection === 'selected';
}

/** A thesis decision belongs to the selected program and is never carried across programs. */
export function stateForScopeChange(state: PlannerState, catalog: PlannerCatalog, selectedScopeId: string | null): PlannerState {
  if (selectedScopeId === null) return { ...state, selectedScopeId, thesisSelection: 'undecided' };
  const progress = thesisProgressForScope(state, catalog, selectedScopeId);
  return {
    ...state,
    selectedScopeId,
    thesisSelection: progress.selection,
    thesisProgressByScope: { ...state.thesisProgressByScope, [selectedScopeId]: progress },
  };
}

export function setThesisProgressForScope(state: PlannerState, catalog: PlannerCatalog, scopeId: string | null, patch: Partial<ThesisProgress>): PlannerState {
  if (scopeId === null) return state;
  const current = thesisProgressForScope(state, catalog, scopeId);
  const next = normalizedProgress(thesisPolicyForScope(catalog, scopeId), { ...current, ...patch });
  return { ...state, thesisSelection: next.selection, thesisProgressByScope: { ...state.thesisProgressByScope, [scopeId]: next } };
}

/** Normalize persisted v18 data before validation; status is preserved for required scopes. */
export function normalizeThesisProgressState(state: PlannerState, catalog: PlannerCatalog): PlannerState {
  const progressByScope = Object.fromEntries(Object.entries(state.thesisProgressByScope).map(([scopeId, progress]) => [scopeId, normalizedProgress(thesisPolicyForScope(catalog, scopeId), progress)]));
  const selected = state.selectedScopeId;
  if (selected !== null && thesisPolicyForScope(catalog, selected) === 'required' && !progressByScope[selected]) {
    progressByScope[selected] = defaultProgress('required');
  }
  const selection = selected === null ? state.thesisSelection : (progressByScope[selected]?.selection ?? state.thesisSelection);
  return { ...state, thesisSelection: selection, thesisProgressByScope: progressByScope };
}
