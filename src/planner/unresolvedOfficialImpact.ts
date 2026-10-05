import type { GraduationProfile, Mapping, PlannerCatalog, StructuredRequirement } from './plannerCatalog';
import { officialFactCreditState, specialOfficialCourse, type OfficialGraduationFact } from './officialGraduationFacts';
import { GEOGRAPHY_TRANSFER_RULES_2026 } from './geographyTransferRules';

/** H41 describes possible destinations, never allocation or credit quantities.
 * H31 has a different authority (manual_review Offering.mappingIds); keep it separate.
 */
export type UnresolvedOfficialImpact = {
  globalUnknown: boolean;
  candidates: Array<{ mapping: Mapping; canonicalName: string; affectsHistorySeminar: boolean; destinations: Array<Pick<Mapping, 'category' | 'field' | 'requirementType'>> }>;
  cardIds: Set<string>;
};

const professionalTypes: Record<string, string[]> = {
  '日本文学科': ['必修', '選択必修', '選択'],
  '史学科': ['必修', 'スクーリング選択必修', '選択'],
  '地理学科': ['必修', 'スクーリング必修', '選択必修', '選択'],
  '法律学科': ['選択必修', '選択'], '経済学科': ['選択必修', '選択'], '商業学科': ['選択必修', '選択'],
};
const prefixes: Record<string, string> = {
  '日本文学科': '', '史学科': 'history-', '地理学科': 'geography-',
  '法律学科': 'law-', '経済学科': 'economics-', '商業学科': 'commerce-',
};
const suffixes: Record<string, string> = {
  '必修': 'required', '選択必修': 'required-elective', '選択': 'elective',
  'スクーリング必修': 'schooling-required', 'スクーリング選択必修': 'schooling-required-elective',
};
const validAmountMetadata = (value: number | null) => value === null || (Number.isFinite(value) && value >= 0);

function validMapping(mapping: Mapping, catalog: PlannerCatalog): boolean {
  const program = catalog.programs.find(p => p.scopeId === mapping.scopeId);
  if (!program || typeof mapping.schoolingOnly !== 'boolean' || typeof mapping.mediaOnly !== 'boolean'
    || !validAmountMetadata(mapping.curriculumCredits)
    || (mapping.field !== null && typeof mapping.field !== 'string')) return false;
  if (mapping.category === '専門教育') {
    if (program.isCommon || !professionalTypes[program.department ?? '']?.includes(mapping.requirementType ?? '')) return false;
    // Fields affect the history/geography structured minima. Reject unknown descriptors.
    if (program.department === '史学科' && mapping.field !== null
      && !['日本史の分野', '東洋史の分野', '西洋史の分野', 'その他'].includes(mapping.field)) return false;
    if (program.department === '地理学科' && mapping.field !== null
      && !['人文地理の分野', '自然地理の分野', '地誌・その他の分野'].includes(mapping.field)) return false;
    if (!['史学科', '地理学科'].includes(program.department ?? '') && mapping.field !== null) return false;
    return true;
  }
  if (!program.isCommon || !['必修', '選択必修', '選択', null].includes(mapping.requirementType)) return false;
  return mapping.category === '一般教育' ? [null, '人文', '社会', '自然', 'その他'].includes(mapping.field)
    : mapping.category === '外国語' ? ['英語', '独語', '仏語'].includes(mapping.field ?? '')
      : mapping.category === '保健体育' && mapping.field === null;
}

/** Same ordinary dependency closure as H31, with exact institutional names only.
 * The destination descriptors also cover structured totals/fields and overflow.
 * History's fifth-Course gate includes the existing seminar transfer dependents.
 */
function candidateImpact(mapping: Mapping, canonicalName: string, department: string) {
  const destinations = [{ category: mapping.category, field: mapping.field, requirementType: mapping.requirementType }];
  const cardIds = new Set<string>();
  let affectsHistorySeminar = false;
  if (mapping.category !== '専門教育') {
    if (specialOfficialCourse(canonicalName, department, mapping)) return null;
    cardIds.add(({ '一般教育': 'group-general', '外国語': 'group-foreign', '保健体育': 'group-physical' } as Record<string, string>)[mapping.category]);
    return { destinations, cardIds, affectsHistorySeminar };
  }
  const prefix = prefixes[department];
  if (prefix === undefined || !professionalTypes[department].includes(mapping.requirementType ?? '')) return null;
  const geographyRule = department === '地理学科' ? Object.values(GEOGRAPHY_TRANSFER_RULES_2026).find(rule => {
    const names: readonly string[] = 'canonicalName' in rule ? [rule.canonicalName] : rule.canonicalNames;
    return names.includes(canonicalName);
  }) : undefined;
  const historyOverview = department === '史学科' && ['日本史概説', '東洋史概説', '西洋史概説'].includes(canonicalName);
  // Never normalize a special family into an ordinary single Course. Only these
  // existing exact routing tables supply a complete potential destination set.
  if (specialOfficialCourse(canonicalName, department, mapping) && !geographyRule && !historyOverview) return null;
  const add = (requirementType: string, field = mapping.field) => destinations.push({ category: '専門教育', field, requirementType });
  if (geographyRule) for (const [bucket] of geographyRule.stages) {
    const [type, field] = bucket.split(':');
    add(type, field ?? mapping.field);
  }
  if (historyOverview) {
    add('必修'); add('スクーリング選択必修'); add('選択');
  }
  if (destinations.some(d => d.requirementType === '選択必修') && ['法律学科', '日本文学科', '地理学科'].includes(department)) add('選択');
  if (department === '史学科' && destinations.some(d => d.requirementType === 'スクーリング選択必修')) {
    // The same five-Course gate can move existing seminar2 in another field.
    affectsHistorySeminar = true;
    for (const field of ['日本史の分野', '東洋史の分野', '西洋史の分野']) add('選択', field);
    cardIds.add('history-seminar-required-elective'); cardIds.add('history-seminar-elective');
  }
  for (const destination of destinations) cardIds.add(`professional-${prefix}${suffixes[destination.requirementType!]}`);
  if (department !== '史学科') cardIds.add(`professional-${department === '日本文学科' ? 'japanese-' : prefix}total`);
  return { destinations, cardIds, affectsHistorySeminar };
}

export function unresolvedOfficialImpact(
  facts: OfficialGraduationFact[], hasOrphanRecords: boolean, catalog: PlannerCatalog,
  scopeId: string, profile: GraduationProfile,
): UnresolvedOfficialImpact {
  const impact: UnresolvedOfficialImpact = { globalUnknown: hasOrphanRecords, candidates: [], cardIds: new Set() };
  const department = catalog.programs.find(p => p.scopeId === scopeId)?.department ?? '';
  const relevant = (m: Mapping) => m.scopeId === scopeId || catalog.programs.some(p => p.scopeId === m.scopeId && p.isCommon);
  for (const fact of facts) {
    if (fact.allocation.kind !== 'unknown' || officialFactCreditState(fact).allZero) continue;
    const owners = catalog.curriculum?.courses.filter(c => c.id === fact.curriculumCourseId) ?? [];
    const course = owners.length === 1 ? owners[0] : undefined;
    if (catalog.curriculum?.source !== 'official_curriculum_mappings_2026' || catalog.curriculum.schemaVersion !== 1
      || profile.curriculumApplicability !== 'current_2026' || fact.diagnostics.includes('recognized_overlap')
      || !course || !course.canonicalName
      || course.canonicalName !== fact.canonicalName || !validAmountMetadata(course.curriculumCredits)
      || !course.mappingIds.length || !fact.candidateMappingIds.length) {
      impact.globalUnknown = true; continue;
    }
    // deriveOfficialGraduationFacts filters missing/outside Mapping ids before
    // retaining candidates. Validate the authoritative edges too, so a missing
    // or malformed edge cannot silently disappear from the potential union.
    const edges = course.mappingIds.map(id => catalog.mappings.filter(m => m.mappingId === id));
    if (edges.some(matches => matches.length !== 1 || !validMapping(matches[0], catalog)
      || matches[0].curriculumCredits !== course.curriculumCredits
      || catalog.curriculum!.courses.filter(c => c.mappingIds.includes(matches[0].mappingId)).length !== 1)) {
      impact.globalUnknown = true; continue;
    }
    const mappings = edges.map(matches => matches[0]).filter(relevant);
    const expected = new Set(mappings.map(m => m.mappingId));
    if (expected.size !== fact.candidateMappingIds.length || fact.candidateMappingIds.some(id => !expected.has(id))) {
      impact.globalUnknown = true; continue;
    }
    for (const mapping of mappings) {
      const closure = candidateImpact(mapping, course.canonicalName, department);
      if (!closure) { impact.globalUnknown = true; continue; }
      impact.candidates.push({ mapping, canonicalName: course.canonicalName, affectsHistorySeminar: closure.affectsHistorySeminar, destinations: closure.destinations });
      for (const id of closure.cardIds) impact.cardIds.add(id);
    }
  }
  return impact;
}

export function officialImpactsCard(impact: UnresolvedOfficialImpact, id: string): boolean {
  return impact.globalUnknown || impact.cardIds.has(id);
}

export function officialImpactsRequirement(impact: UnresolvedOfficialImpact, requirement: StructuredRequirement): boolean {
  if (impact.globalUnknown) return true;
  // H42 keeps its broad schooling hold separately. Unknown official method may
  // intersect either ordinary method condition; annual Offerings cannot settle it.
  if (requirement.ruleType === 'min_schooling_credits') return false;
  const target = requirement.target;
  const names = target.course_names ?? (target.course_name ? [target.course_name] : null);
  return impact.candidates.some(candidate => (names === null || names.includes(candidate.canonicalName) || (candidate.affectsHistorySeminar && names.some(name => name === '史学演習' || name.startsWith('史学演習（'))))
    && candidate.destinations.some(destination =>
      (target.curriculum_category === undefined || destination.category === target.curriculum_category)
      && (target.curriculum_field === undefined || destination.field === target.curriculum_field)
      && (target.requirement_type === undefined || destination.requirementType === target.requirement_type)));
}

/** Destination uncertainty is distinct from evaluation uncertainty. This only
 * discharges H41's local hold: prior H31/recognition/quantity holds stay unknown,
 * global fallback stays conservative, and H42/overall are applied separately.
 */
export function officialEvaluationCanChange(
  impact: UnresolvedOfficialImpact,
  row: { status: string; ruleType: string; earned: number | null; target: number | null },
  requirement?: StructuredRequirement,
): boolean {
  if (impact.globalUnknown || row.status !== 'satisfied' || row.earned === null || row.target === null) return true;
  // These cards evaluate lower bounds (including field/course-count minima),
  // with optional caps. Their existing satisfied status proves ALL conditions,
  // not just earned >= target. Overflow destinations are checked independently.
  if (row.ruleType === 'group' || row.ruleType === 'professional_group') return false;
  if (!requirement || !['min_credits', 'min_courses', 'required_course'].includes(requirement.ruleType)) return true;
  // A history fifth-Course transfer can remove an existing seminar from a named
  // or field-specific source requirement. Do not assume additive semantics there.
  const target = requirement.target;
  const seminarSourceSubset = target.requirement_type === 'スクーリング選択必修'
    && (target.course_name !== undefined || target.course_names !== undefined || target.curriculum_field !== undefined);
  if (seminarSourceSubset && impact.candidates.some(candidate => candidate.affectsHistorySeminar
    && officialImpactsRequirement({ ...impact, candidates: [candidate] }, requirement))) return true;
  // Only the evaluator's supported lower-bound/completion conditions are known
  // monotone. Upper bounds, choose_one and future conditions remain held.
  return Object.keys(requirement.conditions ?? {}).some(key => !['full_course_credits_required', 'min_courses', 'when'].includes(key));
}
