import Ajv2020 from 'ajv/dist/2020';
import schema from './planner_catalog_2026.schema.json';
import type { PlannerCatalog, PlannerState } from './plannerCatalog';

const ajv = new Ajv2020({ allErrors: true });
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const validateCatalog = ajv.compile<PlannerCatalog>(schema);
const validateStateSchema = ajv.compile<PlannerState>({
  ...schema, $ref: '#/$defs/PlannerState',
});

export function validateState(value: unknown, catalog: PlannerCatalog): value is PlannerState {
  if (!validateStateSchema(value)) return false;
  const offerings = new Set(catalog.offerings.map(o => o.id));
  const ids = value.items.map(item => item.offeringId);
  const todoIds = value.todos.map(todo => todo.id);
  return (value.selectedScopeId === null || catalog.programs.some(p => p.scopeId === value.selectedScopeId))
    && ids.every(id => offerings.has(id)) && new Set(ids).size === ids.length
    && new Set(todoIds).size === todoIds.length
    && value.todos.every(todo => todo.offeringId === null || offerings.has(todo.offeringId));
}
