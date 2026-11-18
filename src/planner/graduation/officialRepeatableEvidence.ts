import { academicYearFromDate, isNativeComponentSnapshot, normalizeImportName, schoolingAcademicYear, sourceEvidence,
  type ImportedCourseAchievement, type ImportedStudyRecord } from '../gradeImport/gradeImportApply';
import { normalizeImportBaseName } from '../gradeImport/importNameNormalization';
import type { CurriculumCourse, GraduationProfile, Mapping, PlannerCatalog } from '../plannerCatalog';
import { REPEATABLE_CREDIT_RULES } from './repeatableRules';
import { exactImportedCurriculumId } from './officialCourseCredits';

/** Exact institutional descriptor, after identity resolution; never a raw-name alias. */
export function officialRepeatableRule(department: string | null, course: CurriculumCourse) {
  const name = course.canonicalName === '歴史資料学1〜6' ? '歴史資料学' : course.canonicalName;
  return REPEATABLE_CREDIT_RULES.find(([d, family]) => d === department && family === name);
}

export type OfficialRepeatableEvidence = {
  label: string;
  attempts: Array<{ sourceRowId: string; recordIds: string[]; academicYear: number; date: string }>;
  /** Sum of independently proven source-row aggregates, NOT a reconstructed aggregate. */
  earnedTotal: number;
  countedCredits: number;
  excessCredits: number;
  limit: number;
  limitCourses: number;
};
export const REPEATABLE_HOLD_MESSAGES: Record<string, string> = {
  repeatable_scope_unconfirmed: '反復科目の2026年度現行課程・制度科目・配分条件を確認できません。',
  repeatable_source_unconfirmed: '反復科目の原行と履修内訳の対応を確認できません。過去スナップショットや旧科目名からは補完しません。',
  repeatable_attempt_unconfirmed: '独立した修得回を確認できません。原行と一致する年度・修得日・合格評価・2単位の内訳が必要です。',
  repeatable_attempt_overlap: '同一年度または同一修得日の内訳が重なっています。別の履修回と断定できないため算入を保留しています。',
  repeatable_aggregate_conflict: '公式の修得合計・S単位と確認できる修得内訳が一致しません。公式合計を補正せず算入を保留しています。',
  repeatable_aggregate_unknown: '公式の修得合計またはS単位が不明です。履修内訳から公式合計を補完せず算入を保留しています。',
  repeatable_source_conflict: '同じ公式行IDの内容が矛盾しています。新しい取得日時だけでは正本を選べません。',
  repeatable_recognition_overlap: '認定済み専門科目と反復実績の重複を確認できないため算入を保留しています。',
};

/** Only source/identity evidence participates; editable planning metadata is not authority. */
export const officialRepeatableSourceSignature = (row: ImportedCourseAchievement) => JSON.stringify([
  row.source, row.fingerprint, row.rawName, row.categoryRaw, row.earnedCreditsTotal,
  row.schoolingCreditsTotal, row.compositionCredits, row.recognizedExemption,
  row.additionalEnrollment, row.curriculumCourseId, row.curriculumMatch, row.candidateCurriculumCourseIds,
]);

/** Row-local complete matching, shared by diagnostics and allocation proof.
 * Unknown years/dates, missing snapshots and mixed/opaque evidence cannot prove
 * an exact detail total. Disjointness between DIFFERENT rows is checked later.
 */
function inspectRepeatableRowDetails(
  row: ImportedCourseAchievement, records: ImportedStudyRecord[], course: CurriculumCourse, catalog: PlannerCatalog,
): { kind: 'verified'; attempts: OfficialRepeatableEvidence['attempts'] } | { kind: 'held'; reason: string } {
  const hold = (reason: string) => ({ kind: 'held' as const, reason });
  const native = sourceEvidence(row);
  if (row.source !== 'hosei_import' || exactImportedCurriculumId(row, catalog) !== course.id || !native || native[6] !== 0
    || normalizeImportBaseName(row.rawName) !== normalizeImportBaseName(course.canonicalName)
    || row.compositionCredits !== 2 || course.curriculumCredits !== 2
    || (row.recognizedExemption !== null && row.recognizedExemption !== 0)
    || (row.additionalEnrollment !== null && row.additionalEnrollment !== 0)
    || native[4].some(report => report[0] !== '' || report[1] !== 'none' || report[2] !== null)
    || native[5].some(value => value !== '' && value !== false)) return hold('repeatable_source_unconfirmed');
  const linked = records.filter(r => r.sourceCourseId === row.id);
  if (linked.some(r => r.source !== 'hosei_import' || r.method !== 'schooling'
    || normalizeImportName(r.rawName) !== normalizeImportName(row.rawName) || !isNativeComponentSnapshot(r, row))) {
    return hold('repeatable_source_unconfirmed');
  }
  // Competing ownership of a record ID is not a fully verified local snapshot.
  if (linked.some(record => records.some(other => other.id === record.id
    && (other.sourceCourseId !== row.id || other.fingerprint !== record.fingerprint)))) {
    return hold('repeatable_source_conflict');
  }
  const occupied = native[3].map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.some(value => value !== ''));
  if (!occupied.length) return hold('repeatable_attempt_unconfirmed');
  const attempts: OfficialRepeatableEvidence['attempts'] = [];
  const years = new Set<number>(), dates = new Set<string>();
  for (const { slot, index } of occupied) {
    const snapshots = linked.filter(r => r.fingerprint.endsWith(`:${index}`)), record = snapshots[0];
    const year = schoolingAcademicYear(slot[0]);
    if (!record || year === null || !slot[1].trim() || !record.date
      || academicYearFromDate(record.date) !== year || record.credits !== 2 || !/^2(?:\.0+)?$/.test(slot[3].trim())
      || !['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'].includes(record.grade ?? '')) {
      return hold('repeatable_attempt_unconfirmed');
    }
    if (years.has(year) || dates.has(record.date)) return hold('repeatable_attempt_overlap');
    years.add(year); dates.add(record.date);
    attempts.push({ sourceRowId: row.id, recordIds: [...new Set(snapshots.map(r => r.id))].sort(), academicYear: year, date: record.date });
  }
  return { kind: 'verified', attempts };
}

/** Known aggregate contradictions do not require proof of independent attempts.
 * Inspect EVERY retained native row before eligibility can return early. A raw
 * passing S2 proves a known aggregate below2 conflicts, even with no year/date or
 * composition metadata. It never authorizes credit or reconstructs an aggregate.
 * An exact total comparison additionally requires EVERY occupied native slot
 * to pass the same complete row matching as allocation. Never infer a missing
 * history from one partial/opaque S2 snapshot.
 * D, pending/unknown credits and opaque snapshots do not prove a contradiction.
 */
export function officialRepeatableAggregateDiagnostics(
  rows: ImportedCourseAchievement[], course: CurriculumCourse, catalog: PlannerCatalog, records: ImportedStudyRecord[],
): string[] {
  let conflict = false;
  for (const row of rows) {
    const native = sourceEvidence(row);
    if (row.source !== 'hosei_import' || exactImportedCurriculumId(row, catalog) !== course.id || !native) continue;
    const passedS2 = native[3].some(slot => /^2(?:\.0+)?$/.test(slot[3].trim())
      && ['S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'].includes(slot[4].trim()));
    if ((passedS2 && ((row.earnedCreditsTotal !== null && row.earnedCreditsTotal < 2)
      || (row.schoolingCreditsTotal !== null && row.schoolingCreditsTotal < 2)))
      || (row.earnedCreditsTotal !== null && row.schoolingCreditsTotal !== null
        && row.schoolingCreditsTotal > row.earnedCreditsTotal)) conflict = true;
    const details = inspectRepeatableRowDetails(row, records, course, catalog);
    if (details.kind === 'verified' && row.earnedCreditsTotal !== null && row.schoolingCreditsTotal !== null
      && (row.earnedCreditsTotal !== details.attempts.length * 2 || row.schoolingCreditsTotal !== details.attempts.length * 2)) conflict = true;
  }
  return conflict ? ['repeatable_aggregate_conflict'] : [];
}

/** Minimal proof: complete native S2 rows, with disjoint source academic years AND
 * dates. Same-year sessions are deliberately held until a stronger attempt key
 * exists. Capture time, editable years/terms and annual Offering IDs prove nothing.
 * Every source-row aggregate must independently agree with its complete details.
 */
export function deriveOfficialRepeatableEvidence(
  rows: ImportedCourseAchievement[], records: ImportedStudyRecord[], course: CurriculumCourse,
  mapping: Mapping, catalog: PlannerCatalog, profile: GraduationProfile | undefined,
): { kind: 'verified'; evidence: OfficialRepeatableEvidence } | { kind: 'held'; reason: string; diagnostics: string[] } {
  const aggregateDiagnostics = officialRepeatableAggregateDiagnostics(rows, course, catalog, records);
  const rowDiagnostics = rows.flatMap(row => {
    const details = inspectRepeatableRowDetails(row, records, course, catalog);
    return [...(details.kind === 'held' ? [details.reason] : []),
      ...(row.earnedCreditsTotal === null || row.schoolingCreditsTotal === null ? ['repeatable_aggregate_unknown'] : [])];
  });
  const diagnostics = [...new Set([...aggregateDiagnostics, ...rowDiagnostics])].sort();
  const hold = (reason: string) => ({ kind: 'held' as const, reason, diagnostics: [...new Set([reason, ...diagnostics])].sort() });
  const rule = officialRepeatableRule(mapping.department, course);
  if (!rule || catalog.curriculum?.source !== 'official_curriculum_mappings_2026'
    || profile?.curriculumApplicability !== 'current_2026'
    || course.curriculumCredits !== 2 || mapping.curriculumCredits !== 2
    || mapping.category !== '専門教育' || mapping.requirementType !== '選択' || mapping.field !== null
    || !mapping.schoolingOnly || mapping.mediaOnly
    || catalog.curriculum.courses.filter(c => officialRepeatableRule(mapping.department, c)?.[1] === rule[1]).length !== 1
    || new Set(course.mappingIds).size !== course.mappingIds.length
    || course.mappingIds.some(id => catalog.curriculum!.courses.filter(c => c.mappingIds.includes(id)).length !== 1)) {
    return hold('repeatable_scope_unconfirmed');
  }
  if ((profile.recognizedCredits.professionalCourses?.length ?? 0) > 0) return hold('repeatable_recognition_overlap');
  // Preserve reimport idempotence without choosing the last conflicting ID.
  const uniqueRows = new Map<string, ImportedCourseAchievement>();
  for (const row of rows) {
    const previous = uniqueRows.get(row.id);
    if (previous && officialRepeatableSourceSignature(previous) !== officialRepeatableSourceSignature(row)) return hold('repeatable_source_conflict');
    uniqueRows.set(row.id, row);
  }
  if (diagnostics.length) return hold(diagnostics[0]);
  const attempts: OfficialRepeatableEvidence['attempts'] = [];
  const years = new Set<number>(), dates = new Set<string>();
  const recordOwners = new Map<string, string>();
  let earnedTotal = 0;
  for (const row of [...uniqueRows.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const details = inspectRepeatableRowDetails(row, records, course, catalog);
    if (details.kind === 'held') return hold(details.reason);
    if (row.earnedCreditsTotal === null || row.schoolingCreditsTotal === null) return hold('repeatable_aggregate_unknown');
    const linked = records.filter(r => r.sourceCourseId === row.id);
    for (const record of linked) {
      const owner = JSON.stringify([row.id, record.fingerprint]);
      if (recordOwners.has(record.id) && recordOwners.get(record.id) !== owner) return hold('repeatable_source_conflict');
      recordOwners.set(record.id, owner);
    }
    for (const attempt of details.attempts) {
      // Different row/slot positions never prove independence by themselves.
      if (years.has(attempt.academicYear) || dates.has(attempt.date)) return hold('repeatable_attempt_overlap');
      years.add(attempt.academicYear); dates.add(attempt.date); attempts.push(attempt);
    }
    if (row.earnedCreditsTotal !== details.attempts.length * 2 || row.schoolingCreditsTotal !== row.earnedCreditsTotal) {
      return hold('repeatable_aggregate_conflict');
    }
    earnedTotal += row.earnedCreditsTotal;
  }
  if (aggregateDiagnostics.length) return hold('repeatable_aggregate_conflict');
  const [, label, limit, limitCourses] = rule;
  const countedCredits = Math.min(earnedTotal, limit, Math.min(attempts.length, limitCourses) * 2);
  return { kind: 'verified', evidence: { label, attempts: attempts.sort((a, b) => a.date.localeCompare(b.date)),
    earnedTotal, countedCredits, excessCredits: earnedTotal - countedCredits, limit, limitCourses } };
}
