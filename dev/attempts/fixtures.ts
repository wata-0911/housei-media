import { isMediaSchooling } from '../../src/planner/progress/mediaSchooling';
import { initialState } from '../../src/planner/backup/storage';
import { catalog } from '../../src/planner/catalog/catalog';
import { plannerItemFromCourseSearch } from '../../src/planner/planning/plannerItemState';
import { prepareMigrationEnvironment } from '../../src/planner/attempts/migration/source';
import { createMigrationWorkbench } from '../../src/planner/attempts/workbench/migrationSession';

// Vite raw imports retain the exact six-file bytes checked by the YI-04 decoder.
const rawModules = import.meta.glob('../../src/data/planner_*2026.json', { query: '?raw', import: 'default', eager: true });
const inputModules = import.meta.glob('../../scripts/inputs/curriculum-*-2026.json', { query: '?raw', import: 'default', eager: true });
export async function loadMigrationEnvironment() {
  const rawFiles = Object.fromEntries(Object.entries({ ...rawModules, ...inputModules }).map(([path, raw]) => [path.slice(6), raw as string]));
  return prepareMigrationEnvironment(rawFiles);
}
export type FixtureName = 'ready' | 'held-day' | 'held-month' | 'rejected';
export function fixtureRaw(name: FixtureName) {
  if (name === 'rejected') return '{"schemaVersion":999}';
  const state = initialState();
  const offering = catalog.offerings.find(isMediaSchooling)!;
  state.items = [plannerItemFromCourseSearch(offering.id)];
  state.mediaSchoolingProgress[offering.id] = { offeringId: offering.id, totalLessons: null,
    lessons: [{ lesson: 1, videoCompleted: false, testCompleted: true }],
    assessments: [{ id: 'fixture-assessment/raw~id', type: 'other', label: '隔離fixture試験',
      scheduledDate: name === 'held-day' ? '2027-02-30' : name === 'held-month' ? '2027-99-99' : '2027-02-28', completed: false }] };
  state.todos = [{ id: '10000000-0000-4000-8000-000000000001', offeringId: null, text: '隔離fixture TODO', done: false }];
  return JSON.stringify(state, null, 2);
}

export async function loadMigrationWorkbench() { return createMigrationWorkbench(await loadMigrationEnvironment(), catalog); }
