import type { ImportedCourseAchievement, ImportedStudyRecord } from './gradeImportApply';
import type { GraduationProfile, Mapping, PlannerCatalog } from './plannerCatalog';
import { exactImportedCurriculumId } from './officialCourseCredits';
import { REPEATABLE_CREDIT_RULES } from './repeatableRules';
import { LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026 } from './graduationSources';

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
export function officialFactCreditState(fact: Pick<OfficialGraduationFact, 'sourceRows'>) {
  return {
    allZero: fact.sourceRows.length > 0 && fact.sourceRows.every(row => row.earnedCreditsTotal === 0),
    hasPositive: fact.sourceRows.some(row => row.earnedCreditsTotal !== null && row.earnedCreditsTotal > 0),
    hasUnknown: fact.sourceRows.some(row => row.earnedCreditsTotal === null),
  };
}

const validCredits = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
const baseName = (name: string) => name.normalize('NFKC').replace(/[（(［[].*$/, '');

function deriveMethodEvidence(row: ImportedCourseAchievement, records: ImportedStudyRecord[]): OfficialMethodEvidence {
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

function specialCourse(name: string, department: string | null, mapping: Mapping): boolean {
  const base = baseName(name);
  return base === '卒業論文' || base === '基礎特講' || base === '書道実技'
    || /旧課程|旧カリキュラム/.test(name)
    || mapping.requirementType === '公開科目' || /公開科目/.test(name)
    || REPEATABLE_CREDIT_RULES.some(([d, family]) => d === department && (base === family || base.replace(/[0-9]+$/, '') === family))
    || (department === '史学科' && /^(史学演習|歴史資料学|日本史概説|東洋史概説|西洋史概説|考古学|史学概論)/.test(base))
    || (department === '地理学科' && /^(現地研究|地誌学特講|人文地理学演習|自然地理学演習|人文地理学特講|自然地理学特講)/.test(base));
}

/** Course.mappingIds is authoritative. scopeIds is diagnostic only. */
export function deriveOfficialGraduationFacts(
  rows: ImportedCourseAchievement[], records: ImportedStudyRecord[], catalog: PlannerCatalog,
  selectedScopeId: string, profile?: GraduationProfile,
): DerivedOfficialGraduationFacts {
  const common = new Set(catalog.programs.filter(p => p.isCommon).map(p => p.scopeId));
  const department = catalog.programs.find(p => p.scopeId === selectedScopeId)?.department ?? null;
  const mappings = new Map(catalog.mappings.map(m => [m.mappingId, m]));
  const courses = new Map(catalog.curriculum?.courses.map(c => [c.id, c]) ?? []);
  const groups = new Map<string, ImportedCourseAchievement[]>();
  // Repeated input of the very same source row is idempotent. Different ids are never deduped by fingerprint.
  for (const row of [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const id = exactImportedCurriculumId(row, catalog);
    const key = id ? `course:${id}` : `row:${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const facts: OfficialGraduationFact[] = [], allocations: OfficialAllocationInput[] = [];
  for (const group of groups.values()) {
    const row = group[0], id = exactImportedCurriculumId(row, catalog), course = id ? courses.get(id) : undefined;
    const sourceRowIds = group.map(r => r.id);
    const candidates = course ? [...new Set(course.mappingIds)].flatMap(id => mappings.get(id) ?? [])
      .filter(m => m.scopeId === selectedScopeId || common.has(m.scopeId)).sort((a, b) => a.mappingId.localeCompare(b.mappingId)) : [];
    const fact: OfficialGraduationFact = {
      sourceRowIds, curriculumCourseId: id, canonicalName: course?.canonicalName ?? null,
      sourceRows: group.map(r => ({ id: r.id, earnedCreditsTotal: r.earnedCreditsTotal, compositionCredits: r.compositionCredits, schoolingCreditsTotal: r.schoolingCreditsTotal })),
      earnedCreditsTotal: group.length === 1 ? row.earnedCreditsTotal : null,
      compositionCredits: group.length === 1 ? row.compositionCredits : null,
      schoolingEvidence: { credits: group.length === 1 ? row.schoolingCreditsTotal : null,
        source: group.length === 1 && row.schoolingCreditsTotal !== null ? 'official_row' : 'unknown',
        recordIds: [...new Set(records.filter(r => sourceRowIds.includes(r.sourceCourseId ?? '') && r.method === 'schooling').map(r => r.id))].sort() },
      methodEvidence: { media: 'unknown', allEarnedCreditsAreMedia: false, recordIds: [], rawTerms: [] },
      candidateMappingIds: candidates.map(m => m.mappingId),
      allocation: { kind: 'unknown', reason: 'curriculum_identity_unresolved' }, diagnostics: [],
    };
    facts.push(fact);
    const hold = (reason: OfficialUnknownReason, detail?: string) => {
      fact.allocation = { kind: reason === 'out_of_scope' ? 'out_of_scope' : 'unknown', reason };
      fact.diagnostics.push(reason, ...(detail ? [detail] : []));
    };
    if (!course) { hold('curriculum_identity_unresolved'); continue; }
    if (group.length > 1) { hold('duplicate_official_rows', 'conflicting_source_rows'); continue; }
    if (course.scopeIds.slice().sort().join() !== [...new Set(course.mappingIds.flatMap(id => mappings.get(id)?.scopeId ?? []))].sort().join()) fact.diagnostics.push('scope_ids_differ_from_mapping_scopes');
    if (!course.mappingIds.length || course.mappingIds.some(id => !mappings.has(id))) { hold('mapping_not_found'); continue; }
    if (!candidates.length) { hold('out_of_scope'); continue; }
    const signature = (m: Mapping) => JSON.stringify([common.has(m.scopeId) ? 'common' : 'selected_program', m.category, m.field, m.requirementType, m.curriculumCredits, m.schoolingOnly, m.mediaOnly]);
    if (new Set(candidates.map(signature)).size !== 1) { hold('mapping_conflict'); continue; }
    // Selecting a descriptor is safe only AFTER proving every edge has the identical allocation signature.
    const mapping = candidates[0];
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
    if (specialCourse(course.canonicalName, department, mapping) || profile?.curriculumApplicability === 'legacy_or_transition'
      || (row.recognizedExemption ?? 0) > 0 || (row.additionalEnrollment ?? 0) > 0 || row.earnedCreditsTotal > composition
      || (professionalBucket && ['法律学科', '日本文学科', '史学科', '地理学科'].includes(department ?? '') && row.earnedCreditsTotal > 0 && row.earnedCreditsTotal < composition)) {
      hold('special_rule_evidence_required'); continue;
    }
    // Keep recognition architecture intact; uncertain overlap is not a new dedup/merge policy.
    if (professionalBucket && (profile?.recognizedCredits.professionalCourses?.length ?? 0) > 0) {
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
    else if (schoolingConflict || !validCredits(schooling) || schooling > row.earnedCreditsTotal || schooling > composition
      || (department === '法律学科' && LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026.has(course.canonicalName))
      || (profile && profile.admissionType !== 'first_year' && profile.admissionType !== 'unknown'
        && profile.recognizedCredits.schoolingEquivalentCredits !== 0)) {
      schooling = null; fact.diagnostics.push('schooling_evidence_requires_confirmation');
    }
    allocations.push({ fact, mapping: { ...mapping }, credits: row.earnedCreditsTotal,
      completedCredits: row.earnedCreditsTotal >= composition ? composition : 0, schoolingCredits: schooling });
  }
  return { facts, allocations };
}
