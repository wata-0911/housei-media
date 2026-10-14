import { effectiveRecognitionForAdmission } from './graduationProfile';
import { sourceEvidence, type ImportedCourseAchievement, type ImportedStudyRecord } from '../gradeImport/gradeImportApply';
import type { CurriculumCourse, GraduationProfile, Mapping, PlannerCatalog } from '../plannerCatalog';
import { exactImportedCurriculumId } from './officialCourseCredits';
import { REPEATABLE_CREDIT_RULES } from './repeatableRules';
import { LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026 } from './graduationSources';
import { resolveRecognizedProfessionalCurriculumIdentity } from './recognizedProfessionalIdentity';
import { officialCandidateMappings } from './unresolvedOfficialImpact';
import { deriveOfficialRepeatableEvidence, officialRepeatableAggregateDiagnostics, officialRepeatableRule, officialRepeatableSourceSignature, type OfficialRepeatableEvidence } from './officialRepeatableEvidence';

export type OfficialUnknownReason = 'curriculum_identity_unresolved' | 'mapping_not_found' | 'mapping_conflict'
  | 'duplicate_official_rows' | 'metadata_unknown' | 'special_rule_evidence_required' | 'out_of_scope';
/** Calculation-only projection; never persisted or inferred from annual Offerings. */
export type OfficialMethodEvidence = {
  media: 'confirmed' | 'unknown' | 'conflict';
  allEarnedCreditsAreMedia: boolean;
  recordIds: string[];
  rawTerms: string[];
};
export type OfficialGraduationFact = {
  sourceRowIds: string[];
  curriculumCourseId: string | null;
  canonicalName: string | null;
  /** Conflicting rows retain their individual aggregates here; never sum/max snapshots. */
  sourceRows: Array<{ id: string; earnedCreditsTotal: number | null; compositionCredits: number | null; schoolingCreditsTotal: number | null }>;
  earnedCreditsTotal: number | null;
  compositionCredits: number | null;
  schoolingEvidence: { credits: number | null; source: 'official_row' | 'media_earned' | 'unknown'; recordIds: string[] };
  methodEvidence: OfficialMethodEvidence;
  candidateMappingIds: string[];
  allocation: { kind: 'unique' | 'equivalent'; mappingIds: string[] }
    | { kind: 'unknown' | 'out_of_scope'; reason: OfficialUnknownReason };
  diagnostics: string[];
  repeatableEvidence?: OfficialRepeatableEvidence;
};
/** Final, exclusive allocation input. No annual Offering or PlannerItem is synthesized. */
export type OfficialAllocationInput = {
  fact: OfficialGraduationFact;
  mapping: Mapping;
  credits: number;
  completedCredits: number;
  schoolingCredits: number | null;
};
export type DerivedOfficialGraduationFacts = {
  facts: OfficialGraduationFact[];
  allocations: OfficialAllocationInput[];
};

/** Credit semantics come from retained source rows, never a duplicate group's null aggregate.
 * This classifies evidence only; it does not resolve or combine official aggregates.
 */
export function officialFactCreditState(fact: Pick<OfficialGraduationFact, 'sourceRows'> & Partial<Pick<OfficialGraduationFact, 'diagnostics'>>) {
  const conflict = fact.diagnostics?.includes('repeatable_aggregate_conflict') || fact.diagnostics?.includes('repeatable_source_conflict');
  return {
    allZero: !conflict && fact.sourceRows.length > 0 && fact.sourceRows.every(row => row.earnedCreditsTotal === 0),
    hasPositive: fact.sourceRows.some(row => row.earnedCreditsTotal !== null && row.earnedCreditsTotal > 0),
    hasUnknown: Boolean(conflict) || fact.sourceRows.some(row => row.earnedCreditsTotal === null),
  };
}

const validCredits = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
const baseName = (name: string) => name.normalize('NFKC').replace(/[（(［[].*$/, '');

export function deriveMethodEvidence(row: ImportedCourseAchievement, records: ImportedStudyRecord[]): OfficialMethodEvidence {
  // importPreview creates correspondence records only with source evidence, except
  // its explicitly fingerprinted course-only compatibility row. Inferred years,
  // editable terms and annual matches do not turn that fallback into evidence.
  const linked = records.filter(r => r.source === 'hosei_import' && r.sourceCourseId === row.id);
  const substantive = linked.filter(r => !(r.method === 'correspondence'
    && r.fingerprint.startsWith('course-only:')
    && !r.rawYear && !r.rawTerm && !r.date && r.credits == null && !r.grade && !r.examGrade
    && !r.reports?.some(report => report.raw.trim() !== '' || report.status !== 'none' || report.date !== null)));
  // 2026 shiori, printed p.133 / PDF p.135: メ＝メディア. No synonyms.
  const isMedia = (r: ImportedStudyRecord) => r.method === 'schooling' && r.rawTerm?.normalize('NFKC').trim() === 'メ';
  const media = substantive.some(isMedia)
    ? substantive.every(isMedia) ? 'confirmed' : 'conflict'
    : 'unknown';
  return {
    media,
    // The official aggregate is the only credit budget. Components are never summed.
    allEarnedCreditsAreMedia: media === 'confirmed' && validCredits(row.earnedCreditsTotal) && row.earnedCreditsTotal > 0,
    recordIds: [...new Set(substantive.map(r => r.id))].sort(),
    rawTerms: [...new Set(substantive.flatMap(r => r.rawTerm == null ? [] : [r.rawTerm]))].sort(),
  };
}

export function specialOfficialCourse(name: string, department: string | null, mapping: Mapping): boolean {
  const base = baseName(name);
  return base === '卒業論文' || base === '基礎特講' || base === '書道実技'
    || /旧課程|旧カリキュラム/.test(name)
    || mapping.requirementType === '公開科目' || /公開科目/.test(name)
    || REPEATABLE_CREDIT_RULES.some(([d, family]) => d === department && (base === family || base.replace(/[0-9]+$/, '') === family))
    || (department === '史学科' && /^(史学演習|歴史資料学|日本史概説|東洋史概説|西洋史概説|考古学|史学概論)/.test(base))
    || (department === '地理学科' && /^(現地研究|地誌学特講|人文地理学演習|自然地理学演習|人文地理学特講|自然地理学特講)/.test(base));
}

/** H60 only: exact identity, duplicate and mapping checks precede this exception. */
function isSafeHistoryIntroductionCompletion(
  course: CurriculumCourse, mapping: Mapping, row: ImportedCourseAchievement,
  department: string | null, catalog: PlannerCatalog, profile?: GraduationProfile,
): boolean {
  return department === '史学科' && course.canonicalName === '史学概論'
    && catalog.curriculum?.source === 'official_curriculum_mappings_2026'
    && profile?.curriculumApplicability === 'current_2026'
    && mapping.department === '史学科' && mapping.category === '専門教育'
    && mapping.requirementType === '必修' && mapping.field === null
    && !mapping.schoolingOnly && !mapping.mediaOnly && mapping.curriculumCredits === 4
    && course.curriculumCredits === 4 && row.compositionCredits === 4
    && row.earnedCreditsTotal === 4 && row.schoolingCreditsTotal === 0
    && (row.recognizedExemption === null || row.recognizedExemption === 0)
    && (row.additionalEnrollment === null || row.additionalEnrollment === 0);
}

/** H57 only: a completed official aggregate proves the existing S>=1 rule. */
function isSafeCalligraphyPracticumCompletion(
  course: CurriculumCourse, mapping: Mapping, row: ImportedCourseAchievement,
  catalog: PlannerCatalog, profile?: GraduationProfile,
): boolean {
  return course.canonicalName === '書道実技'
    && catalog.curriculum?.source === 'official_curriculum_mappings_2026'
    && profile?.curriculumApplicability === 'current_2026'
    && course.curriculumCredits === 2 && mapping.curriculumCredits === 2
    && row.compositionCredits === 2 && row.earnedCreditsTotal === 2
    && (row.schoolingCreditsTotal === 1 || row.schoolingCreditsTotal === 2)
    && !mapping.schoolingOnly && !mapping.mediaOnly
    && (row.recognizedExemption === null || row.recognizedExemption === 0)
    && (row.additionalEnrollment === null || row.additionalEnrollment === 0);
}

/** H12 only. The separate special-course and recognition guards still apply. */
function isSafeLawPartialSchooling(
  course: CurriculumCourse, mapping: Mapping, row: ImportedCourseAchievement,
  department: string | null, catalog: PlannerCatalog, profile?: GraduationProfile,
): boolean {
  return department === '法律学科'
    && catalog.curriculum?.source === 'official_curriculum_mappings_2026'
    && profile?.curriculumApplicability === 'current_2026'
    && ['選択必修', '選択'].includes(mapping.requirementType ?? '')
    && course.curriculumCredits === 4 && mapping.curriculumCredits === 4
    && row.compositionCredits === 4 && row.earnedCreditsTotal === 2 && row.schoolingCreditsTotal === 2
    && !mapping.schoolingOnly && !mapping.mediaOnly
    && (row.recognizedExemption === null || row.recognizedExemption === 0)
    && (row.additionalEnrollment === null || row.additionalEnrollment === 0);
}

/** Course.mappingIds is authoritative. scopeIds is diagnostic only. */
export function deriveOfficialGraduationFacts(
  rows: ImportedCourseAchievement[], records: ImportedStudyRecord[], catalog: PlannerCatalog,
  selectedScopeId: string, profile?: GraduationProfile,
): DerivedOfficialGraduationFacts {
  if (profile) profile = { ...profile, recognizedCredits: effectiveRecognitionForAdmission(profile) };
  const common = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
  const department = catalog.programs.find(p => p.scopeId === selectedScopeId)?.department ?? null;
  const mappings = new Map(catalog.mappings.map(m => [m.mappingId, m]));
  const courses = new Map(catalog.curriculum?.courses.map(c => [c.id, c]) ?? []);
  const recognitionIdentities = (profile?.recognizedCredits.professionalCourses ?? [])
    .map(row => resolveRecognizedProfessionalCurriculumIdentity(row, catalog));
  const groups = new Map<string, ImportedCourseAchievement[]>();
  // F1: detect evidence conflicts on the ORIGINAL set, before selecting any
  // calculation representative. Persisted rows and their order remain untouched.
  const copiesById = new Map<string, ImportedCourseAchievement[]>();
  for (const row of rows) copiesById.set(row.id, [...(copiesById.get(row.id) ?? []), row]);
  const conflictingIds = new Set([...copiesById].filter(([, copies]) =>
    new Set(copies.map(officialRepeatableSourceSignature)).size > 1).map(([id]) => id));
  const representatives = [...copiesById.values()].map(copies => {
    const nativeRepeats = copies.filter(row => {
      const course = courses.get(exactImportedCurriculumId(row, catalog) ?? '');
      return course && sourceEvidence(row) !== null && officialRepeatableRule(department, course);
    });
    // Restrict the new representative policy to this Issue's native repeat path.
    if (!nativeRepeats.length) return copies[copies.length - 1];
    return nativeRepeats.sort((a, b) => officialRepeatableSourceSignature(a).localeCompare(officialRepeatableSourceSignature(b)))[0];
  });
  for (const row of representatives.sort((a, b) => a.id.localeCompare(b.id))) {
    const id = exactImportedCurriculumId(row, catalog);
    const key = id ? `course:${id}` : `row:${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const facts: OfficialGraduationFact[] = [], allocations: OfficialAllocationInput[] = [];
  for (const group of groups.values()) {
    const row = group[0], id = exactImportedCurriculumId(row, catalog), course = id ? courses.get(id) : undefined;
    const sourceRowIds = group.map(r => r.id);
    const originalGroup = sourceRowIds.flatMap(id => copiesById.get(id) ?? []);
    const repeatable = course && originalGroup.some(r => sourceEvidence(r) !== null) && officialRepeatableRule(department, course);
    const identityConflict = repeatable && originalGroup.some(r => exactImportedCurriculumId(r, catalog) !== id);
    // Exact evidence copies collapse. Competing copies retain every authority
    // tuple in the calculation fact; no aggregate is selected by input order.
    const retained = repeatable ? [...new Map(originalGroup.map(r => [`${r.id}:${officialRepeatableSourceSignature(r)}`, r])).values()]
      .sort((a, b) => a.id.localeCompare(b.id) || officialRepeatableSourceSignature(a).localeCompare(officialRepeatableSourceSignature(b))) : group;
    const candidates = course ? [...new Set(course.mappingIds)].flatMap(id => mappings.get(id) ?? [])
      .filter(m => m.scopeId === selectedScopeId || common.has(m.scopeId)).sort((a, b) => a.mappingId.localeCompare(b.mappingId)) : [];
    const fact: OfficialGraduationFact = {
      sourceRowIds, curriculumCourseId: identityConflict ? null : id, canonicalName: identityConflict ? null : course?.canonicalName ?? null,
      sourceRows: retained.map(r => ({ id: r.id, earnedCreditsTotal: r.earnedCreditsTotal, compositionCredits: r.compositionCredits, schoolingCreditsTotal: r.schoolingCreditsTotal })),
      earnedCreditsTotal: retained.length === 1 ? row.earnedCreditsTotal : null,
      compositionCredits: retained.length === 1 ? row.compositionCredits : null,
      schoolingEvidence: { credits: retained.length === 1 ? row.schoolingCreditsTotal : null,
        source: retained.length === 1 && row.schoolingCreditsTotal !== null ? 'official_row' : 'unknown',
        recordIds: [...new Set(records.filter(r => sourceRowIds.includes(r.sourceCourseId ?? '') && r.method === 'schooling').map(r => r.id))].sort() },
      methodEvidence: { media: 'unknown', allEarnedCreditsAreMedia: false, recordIds: [], rawTerms: [] },
      candidateMappingIds: candidates.map(m => m.mappingId),
      allocation: { kind: 'unknown', reason: 'curriculum_identity_unresolved' },
      diagnostics: repeatable && sourceRowIds.some(id => conflictingIds.has(id)) ? ['repeatable_source_conflict'] : [],
    };
    facts.push(fact);
    const hold = (reason: OfficialUnknownReason, detail?: string) => {
      fact.allocation = { kind: reason === 'out_of_scope' ? 'out_of_scope' : 'unknown', reason };
      fact.diagnostics.push(reason, ...(detail ? [detail] : []));
    };
    if (!course) { hold('curriculum_identity_unresolved'); continue; }
    // Opaque legacy fingerprints keep the existing conservative path. Only a
    // retained native snapshot can enter the new evidence-specific projection.
    const repeatableRows = repeatable ? originalGroup : [];
    // R1/R2: metadata/Mapping holds cannot erase known native aggregate conflicts.
    if (repeatable) fact.diagnostics.push(...officialRepeatableAggregateDiagnostics(repeatableRows, course, catalog, records));
    if (identityConflict) { hold('curriculum_identity_unresolved'); continue; }
    if (group.length > 1 && !repeatable) { hold('duplicate_official_rows', 'conflicting_source_rows'); continue; }
    if (course.scopeIds.slice().sort().join() !== [...new Set(course.mappingIds.flatMap(id => mappings.get(id)?.scopeId ?? []))].sort().join()) fact.diagnostics.push('scope_ids_differ_from_mapping_scopes');
    if (!course.mappingIds.length || course.mappingIds.some(id => !mappings.has(id))) { hold('mapping_not_found'); continue; }
    if (!candidates.length) { hold('out_of_scope'); continue; }
    const signature = (m: Mapping) => JSON.stringify([common.has(m.scopeId) ? 'common' : 'selected_program', m.category, m.field, m.requirementType, m.curriculumCredits, m.schoolingOnly, m.mediaOnly]);
    if (new Set(candidates.map(signature)).size !== 1) { hold('mapping_conflict'); continue; }
    // Selecting a descriptor is safe only AFTER proving every edge has the identical allocation signature.
    const mapping = candidates[0];
    if (repeatable) {
      const proof = deriveOfficialRepeatableEvidence(repeatableRows, records, course, mapping, catalog, profile);
      if (proof.kind === 'held') {
        hold('special_rule_evidence_required');
        fact.diagnostics.push(...proof.diagnostics.filter(code => !fact.diagnostics.includes(code)));
        continue;
      }
      fact.repeatableEvidence = proof.evidence;
      fact.allocation = { kind: candidates.length === 1 ? 'unique' : 'equivalent', mappingIds: fact.candidateMappingIds.slice() };
      // Keep every source aggregate (and the multi-row null) intact. The capped
      // calculation budget is separate from the independently verified total.
      allocations.push({ fact, mapping: { ...mapping }, credits: proof.evidence.countedCredits,
        completedCredits: proof.evidence.countedCredits, schoolingCredits: proof.evidence.countedCredits });
      continue;
    }
    const composition = course.curriculumCredits;
    if (!validCredits(row.earnedCreditsTotal) || !validCredits(composition) || composition === 0
      || mapping.curriculumCredits !== composition || (row.compositionCredits !== null && row.compositionCredits !== composition)) {
      hold('metadata_unknown', 'composition_or_earned_credits_unknown'); continue;
    }
    fact.compositionCredits = composition;
    const commonBucket = common.has(mapping.scopeId) && (mapping.category === '一般教育' && ['人文', '社会', '自然', 'その他'].includes(mapping.field ?? '')
      || mapping.category === '外国語' && ['英語', '独語', '仏語'].includes(mapping.field ?? '')
      || mapping.category === '保健体育' && /^(健康・スポーツ科学概論|スポーツ総合演習)/.test(course.canonicalName));
    const professionalBucket = mapping.scopeId === selectedScopeId && mapping.category === '専門教育'
      && ['必修', '選択必修', '選択'].includes(mapping.requirementType ?? '');
    if (!commonBucket && !professionalBucket) { hold('special_rule_evidence_required', 'unsupported_basic_bucket'); continue; }
    const safeHistoryIntroduction = professionalBucket
      && isSafeHistoryIntroductionCompletion(course, mapping, row, department, catalog, profile);
    const safeCalligraphyPracticum = professionalBucket
      && isSafeCalligraphyPracticumCompletion(course, mapping, row, catalog, profile);
    // This passes evidence, not graduation credit: the law allocator still requires 8 completed Courses / 32 credits.
    const safeLawPartial = professionalBucket && isSafeLawPartialSchooling(course, mapping, row, department, catalog, profile);
    if ((specialOfficialCourse(course.canonicalName, department, mapping) && !safeHistoryIntroduction && !safeCalligraphyPracticum) || profile?.curriculumApplicability === 'legacy_or_transition'
      || (row.recognizedExemption ?? 0) > 0 || (row.additionalEnrollment ?? 0) > 0 || row.earnedCreditsTotal > composition
      || (professionalBucket && !safeLawPartial && ['法律学科', '日本文学科', '史学科', '地理学科'].includes(department ?? '') && row.earnedCreditsTotal > 0 && row.earnedCreditsTotal < composition)) {
      hold('special_rule_evidence_required'); continue;
    }
    // H14: release only when ALL recognition identities are exact and disjoint.
    // Validate the official Course/Mapping owners too; ambiguous ownership cannot
    // prove different Courses. No-recognition behavior and later guards are unchanged.
    if (professionalBucket && recognitionIdentities.length > 0
      && (!profile || !officialCandidateMappings(fact, catalog, selectedScopeId, profile)
        || recognitionIdentities.some(result => result.kind !== 'resolved' || result.curriculumCourseId === id))) {
      hold('special_rule_evidence_required', 'recognized_overlap'); continue;
    }
    fact.methodEvidence = deriveMethodEvidence(row, records);
    const mediaEarned = fact.methodEvidence.allEarnedCreditsAreMedia;
    if (row.earnedCreditsTotal > 0 && ((mapping.mediaOnly && !mediaEarned)
      || (mapping.schoolingOnly && row.schoolingCreditsTotal !== row.earnedCreditsTotal && !mediaEarned))) {
      hold('special_rule_evidence_required', fact.methodEvidence.media === 'conflict' ? 'method_evidence_conflict' : 'method_evidence_required'); continue;
    }
    fact.allocation = { kind: candidates.length === 1 ? 'unique' : 'equivalent', mappingIds: fact.candidateMappingIds.slice() };
    let schooling: number | null = row.schoolingCreditsTotal;
    if (schooling === null && mediaEarned) {
      schooling = row.earnedCreditsTotal;
      fact.schoolingEvidence = { credits: schooling, source: 'media_earned', recordIds: fact.methodEvidence.recordIds.slice() };
    }
    // Valid positive official schooling takes precedence over media inference.
    // Only explicit 0 conflicts with positive all-media earned attribution.
    const schoolingConflict = mediaEarned && row.schoolingCreditsTotal === 0;
    if (schoolingConflict) fact.diagnostics.push('media_schooling_credits_conflict');
    if (row.earnedCreditsTotal === 0) schooling = 0;
    // H20: this normal row has passed identity/overlap, exemption, additional
    // enrollment and method guards. In the confirmed current curriculum,
    // profile recognized S owns a separate budget. Preserve the prior hold for
    // an unconfirmed curriculum; H20 does not establish curriculum applicability.
    else if (schoolingConflict || !validCredits(schooling) || schooling > row.earnedCreditsTotal || schooling > composition
      || (department === '法律学科' && LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026.has(course.canonicalName))
      || (profile && profile.curriculumApplicability !== 'current_2026'
        && profile.admissionType !== 'first_year' && profile.admissionType !== 'unknown'
        && profile.recognizedCredits.schoolingEquivalentCredits !== 0)) {
      schooling = null; fact.diagnostics.push('schooling_evidence_requires_confirmation');
    }
    allocations.push({ fact, mapping: { ...mapping }, credits: row.earnedCreditsTotal,
      completedCredits: row.earnedCreditsTotal >= composition ? composition : 0, schoolingCredits: schooling });
  }
  return { facts, allocations };
}
