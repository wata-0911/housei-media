import type { PlannerCatalog, Mapping, Offering, Requirement, GraduationEvaluation } from './plannerCatalog';

/** Construct once after runtime schema validation. Never silently drop a bad ref. */
export function createMappingResolver(catalog: PlannerCatalog) {
  const byId = new Map<string, Mapping>(catalog.mappings.map(m => [m.mappingId, m]));
  return (offering: Offering): Mapping[] => offering.mappingIds.map(id => {
    const mapping = byId.get(id);
    if (!mapping) throw new Error(`Unknown mappingId: ${id}`);
    return mapping;
  });
}

/** Unknown-scope warnings stay visible for every selection. Common rules also apply. */
export function requirementsForScope(catalog: PlannerCatalog, scopeId: string | null): Requirement[] {
  const common = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
  if (scopeId !== null && !catalog.programs.some(p => p.scopeId === scopeId)) {
    throw new Error(`Unknown scopeId: ${scopeId}`);
  }
  return catalog.requirements.filter(r =>
    r.status === 'unsupported' || r.scopeId === scopeId || common.has(r.scopeId));
}

/** v1 has no graduation engine, even if all individually evaluated rules pass. */
export function graduationEvaluation(): GraduationEvaluation {
  return { result: 'unknown', reason: '卒業判定は未実装です。未対応要件と仮の科目同定を含みます。' };
}
