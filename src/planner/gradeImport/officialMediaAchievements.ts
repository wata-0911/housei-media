import { normalizeImportName, schoolingAcademicYear, sourceEvidence, type ImportedCourseAchievement, type ImportedStudyRecord } from './gradeImportApply';
import { deriveMethodEvidence } from '../graduation/officialGraduationFacts';
import { exactImportedCurriculumId } from '../graduation/officialCourseCredits';
import { validImportedInstitutionalIdentity } from '../catalog/curriculumIdentityValidation';
import type { PlannerCatalog } from '../plannerCatalog';

export type OfficialMediaAchievement = {
  sourceCourseId: string;
  rawName: string;
  earnedCreditsTotal: number | null;
  identity: 'curriculum_only' | 'ambiguous' | 'unmatched' | 'unverified' | 'conflict';
  records: ImportedStudyRecord[];
};

/** Original slots win over editable display context. These are transient views,
 * never new details/IDs, Attempt associations, Offerings or calculation inputs. */
function originalSchoolings(row: ImportedCourseAchievement, records: ImportedStudyRecord[]): ImportedStudyRecord[] {
  const source = sourceEvidence(row);
  if (source) return source[3].flatMap((slot, index) => slot.some(value => value !== '') ? [{
    id: `${row.id}:source-slot:${index}`, fingerprint: 'presentation-only', source: 'hosei_import' as const,
    sourceCourseId: row.id, rawName: row.rawName, offeringId: null, match: 'unmatched' as const,
    method: 'schooling' as const, academicYear: schoolingAcademicYear(slot[0]), yearSource: 'source' as const,
    rawYear: slot[0], term: slot[1] || null, rawTerm: slot[1], date: null,
    // No re-parsing/aggregation of component quantities or completion claims.
    credits: null, grade: slot[4] || null,
  }] : []);
  return records.filter(record => record.source === 'hosei_import' && record.sourceCourseId === row.id
    && normalizeImportName(record.rawName) === normalizeImportName(row.rawName) && record.method === 'schooling');
}

/** Read-only source presentation. No annual Offering argument or name matcher.
 * Reuse the official adapter's exact メ rule; full labels were already supported
 * by the legacy Media UI and are accepted only as whole raw term values here. */
export function officialMediaAchievements(rows: ImportedCourseAchievement[], records: ImportedStudyRecord[], catalog: PlannerCatalog): OfficialMediaAchievement[] {
  return rows.flatMap(row => {
    const media = originalSchoolings(row, records).filter(record =>
      deriveMethodEvidence(row, [record]).media === 'confirmed'
      || ['メディア', '前期メディア', '後期メディア'].includes(record.rawTerm?.normalize('NFKC').trim() ?? ''));
    if (!media.length) return [];
    const identity: OfficialMediaAchievement['identity'] = !validImportedInstitutionalIdentity(row, catalog) ? 'conflict'
      // Legacy CurriculumCourse exactness is not an audited InstitutionalCourse
      // association or proof of the learner's department/applicability.
      : exactImportedCurriculumId(row, catalog) ? 'curriculum_only'
      : row.curriculumMatch === 'ambiguous' ? 'ambiguous'
      : row.curriculumMatch === 'unmatched' ? 'unmatched' : 'unverified';
    return [{ sourceCourseId: row.id, rawName: row.rawName, earnedCreditsTotal: row.earnedCreditsTotal, identity, records: media }];
  });
}
