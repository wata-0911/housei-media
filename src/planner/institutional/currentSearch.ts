import { createInstitutionalSearchAdapter } from './search';
import type { InstitutionalSearchAdapter, InstitutionalSearchTarget } from './search';
import { loadYi01InstitutionalCatalog } from './yi01';

/** Audited 2026 booklet slice. This is not a learner applicability decision. */
export const CURRENT_CURRICULUM_SEARCH_TARGET: Readonly<InstitutionalSearchTarget> = Object.freeze({
  curriculumVersionId: 'hosei:cv:8a3e5ca4-ff0b-4b09-906c-6fddcec29887',
  sourceRevisionId: 'yi-01:source:shiori-quartz',
  sourceDigest: '1ab6bad5b372f2dd12f6a4ecc4b56d3b3c5338b201765b4de775b820d49e3bf0',
});

/** Opt-in entry; no production search or Attempt command imports this module. */
export function loadCurrentCurriculumSearchAdapter(): InstitutionalSearchAdapter {
  return createInstitutionalSearchAdapter(loadYi01InstitutionalCatalog(), CURRENT_CURRICULUM_SEARCH_TARGET);
}
