import type { PlannerCatalog, PlannerState, StructuredRequirement } from './plannerCatalog';

/** A choice is exposed only where the catalog contains both official branches. */
export function supportsThesisSelection(catalog: PlannerCatalog, scopeId: string | null) {
  if (scopeId === null) return false;
  const rules = catalog.requirements.filter((rule): rule is StructuredRequirement => rule.status === 'structured' && rule.scopeId === scopeId);
  return rules.some(rule => rule.conditions?.when?.thesis_selected === true)
    && rules.some(rule => rule.conditions?.when?.thesis_selected === false);
}

/** A thesis decision belongs to the selected program and is never carried across programs. */
export function stateForScopeChange(state: PlannerState, selectedScopeId: string | null): PlannerState {
  return { ...state, selectedScopeId, thesisSelection: 'undecided' };
}
