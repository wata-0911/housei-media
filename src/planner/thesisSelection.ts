import type { PlannerCatalog, PlannerState, StructuredRequirement } from './plannerCatalog';

export type ThesisPolicy = 'required' | 'optional' | 'unknown';

/**
 * Derive the policy only from structured, scope-local catalog evidence. A thesis
 * course with a stated credit requirement is mandatory; an optional policy needs
 * both official numeric branches. Everything else deliberately stays unknown.
 */
export function thesisPolicyForScope(catalog: PlannerCatalog, scopeId: string | null): ThesisPolicy {
  if (scopeId === null) return 'unknown';
  const rules = catalog.requirements.filter((rule): rule is StructuredRequirement => rule.status === 'structured' && rule.scopeId === scopeId);
  const hasNumericBranch = (selected: boolean) => rules.some(rule => rule.conditions?.when?.thesis_selected === selected
    && rule.value !== null
    && rule.unit === 'credits');
  const hasBothBranches = hasNumericBranch(true) && hasNumericBranch(false);
  if (hasBothBranches) return 'optional';
  const hasRequiredThesis = rules.some(rule => rule.ruleType === 'required_course'
    && rule.target.course_name === '卒業論文'
    && rule.value !== null
    && rule.conditions?.when?.thesis_selected === undefined);
  return hasRequiredThesis ? 'required' : 'unknown';
}

/** A choice is exposed only where the catalog contains both official branches. */
export function supportsThesisSelection(catalog: PlannerCatalog, scopeId: string | null) {
  return thesisPolicyForScope(catalog, scopeId) === 'optional';
}

/** A thesis decision belongs to the selected program and is never carried across programs. */
export function stateForScopeChange(state: PlannerState, selectedScopeId: string | null): PlannerState {
  return { ...state, selectedScopeId, thesisSelection: 'undecided' };
}
