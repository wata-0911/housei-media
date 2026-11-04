import { useState } from 'react';
import { InstitutionalSearchView } from '../../src/components/planner/institutional/InstitutionalSearchView';
import { loadCurrentCurriculumSearchAdapter } from '../../src/planner/institutional/currentSearch';
import type { InstitutionalSearchAdapter } from '../../src/planner/institutional/search';

/** Dev entry only. The shared view receives a read-only adapter, never save commands. */
export function InstitutionalSearch({ adapter }: { adapter?: InstitutionalSearchAdapter }) {
  const [source] = useState(() => adapter ?? loadCurrentCurriculumSearchAdapter());
  return <main>
    <h1 className="institutional-dev-heading">制度科目検索・開発用read-only画面</h1>
    <InstitutionalSearchView adapter={source} />
  </main>;
}
