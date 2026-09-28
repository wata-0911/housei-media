import Ajv2020 from 'ajv/dist/2020';
import schema from './planner_catalog_2026.schema.json';
import type { PlannerCatalog, PlannerState } from './plannerCatalog';
import { isHistorySeminar, validHistorySeminarOrders } from './historySeminar';
import { isMediaSchooling } from './mediaSchooling';

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
  const publicCourseIds = value.publicCourses.map(course => course.id);
  const offeringMap = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const progress = Object.entries(value.mediaSchoolingProgress);
  const evaluations = Object.entries(value.courseEvaluations);
  return (value.selectedScopeId === null || catalog.programs.some(p => p.scopeId === value.selectedScopeId))
    && ids.every(id => offerings.has(id)) && new Set(ids).size === ids.length
    && new Set(todoIds).size === todoIds.length
    && new Set(publicCourseIds).size === publicCourseIds.length
    && value.publicCourses.every(course => course.title === course.title.trim() && course.title.length <= 200 && course.credits === 2)
    && value.todos.every(todo => todo.offeringId === null || offerings.has(todo.offeringId))
    && progress.every(([id, course]) => id === course.offeringId && offerings.has(id) && isMediaSchooling(offeringMap.get(id))
      && new Set(course.lessons.map(lesson => lesson.lesson)).size === course.lessons.length
      && course.lessons.every(lesson => course.totalLessons === null || lesson.lesson <= course.totalLessons))
    && evaluations.every(([id, evaluation]) => id === evaluation.offeringId && offerings.has(id))
    && value.items.every(item => {
      const seminar = isHistorySeminar(offeringMap.get(item.offeringId));
      return seminar ? (item.status === 'earned' || item.earnedOrder === null) : item.earnedOrder === null;
    })
    && validHistorySeminarOrders(value.items, offeringMap);
}
