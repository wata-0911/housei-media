import curriculum from '../../../docs/planner-yi-01/curriculum-crosswalk.json';
import mapping from '../../../docs/planner-yi-01/mapping-crosswalk.json';
import official from '../../../docs/planner-yi-01/official-rows.json';
import notes from '../../../docs/planner-yi-01/official-notes.json';
import codes from '../../../docs/planner-yi-01/official-codes.json';
import summary from '../../../docs/planner-yi-01/summary.json';
import registry from '../../data/institutional_registry.json';
import { loadInstitutionalCatalog } from './loader';
import type { InstitutionalInput } from './types';

/** Opt-in, standalone entry point. Never imported by the existing Planner runtime.
 * The repository audit check measures the six raw files. This entry reads the pinned
 * evidence without loading those annual files or requiring any Offering/archive. */
export const yi01InstitutionalInput: InstitutionalInput = {
  auditVersion: curriculum.auditVersion, sourceDigest: summary.sourceDigest, legacyDigests: summary.legacyDigests,
  curriculumRows: curriculum.rows, mappingRows: mapping.rows, officialRows: official.rows,
  notes: notes.rows, codes: codes.rows,
};
export const yi02InstitutionalRegistry = registry;
export function loadYi01InstitutionalCatalog() {
  return loadInstitutionalCatalog(yi01InstitutionalInput, yi02InstitutionalRegistry);
}
