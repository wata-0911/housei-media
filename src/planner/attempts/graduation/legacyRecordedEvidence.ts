import type { Attempt } from '../types';
import type { PersistenceSource } from '../persistence/contracts';
import type { CurriculumPlacement } from '../../institutional/types';
import { sameAttemptData } from '../validation';
import { isMediaSchooling } from '../../progress/mediaSchooling';
import { recordedOpeningSessionKey } from '../../graduation/recordedOpeningEvidence';

/** Read-only interpretation of a decoded, frozen schema22 source. A reference
 * alone is insufficient: the original earned item, method and placement must
 * agree. Never supply a default to a new plan, explicit null/0, or an edited
 * method. Repeated claims of the same old opening share one evidence key. */
export function legacyRecordedEvidence(a: Attempt, source: PersistenceSource, p: CurriculumPlacement) {
  if (source.kind === 'new-plan' || a.plan?.status !== 'earned' || a.method.source !== 'legacy_reference'
    || a.method.evidence?.kind !== 'legacy') return null;
  const refs = a.legacyRefs.filter(r => r.status === 'known' && r.entityKind === 'Offering');
  if (refs.length !== 1 || !sameAttemptData(refs[0], a.method.evidence.ref)) return null;
  const ref = refs[0], offering = source.sourceCatalog.offerings.find(o => o.id === ref.oldId);
  const items = source.state.items.filter(i => i.offeringId === ref.oldId);
  if (!offering || items.length !== 1 || items[0].status !== 'earned'
    || offering.curriculumCourseId !== p.auditRecord.oldCurriculumCourseId
    || !offering.mappingIds.includes(p.auditRecord.oldMappingId)
    || a.method.value !== (isMediaSchooling(offering) ? 'media' : offering.method)
    || a.plan.importedSourceCourseId !== items[0].importedSourceCourseId) return null;
  const original = items[0];
  return { offeringId: offering.id,
    // One original source row can supply quantity/method evidence only once.
    sourceRowKey: JSON.stringify([source.rawSha256, source.sourceCatalogSha256, offering.id]),
    omittedCredits: !Object.hasOwn(a.plan, 'contribution') && !Object.hasOwn(original, 'courseCreditContribution') ? offering.credits : null,
    mediaAsSchooling: isMediaSchooling(offering),
    // Fixed original year/term/period, not planned year, Attempt ID or title.
    repeatKey: recordedOpeningSessionKey(offering, source.sourceCatalog.academicYear) };
}
