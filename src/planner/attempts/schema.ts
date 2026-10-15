import Ajv from 'ajv';
import type { AttemptGraph } from './types';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export const attemptIdPattern = new RegExp(`^hosei:attempt:${uuid}$`);
const id = (prefix: string) => ({ type: 'string', pattern: `^${prefix}${uuid}$` });
const text = { type: 'string' };
const nonempty = { type: 'string', minLength: 1 };
const nil = { type: 'null' };
const bool = { type: 'boolean' };
const enumeration = (...values: string[]) => ({ enum: values });
const array = (items: object) => ({ type: 'array', items });
const nullable = (value: object) => ({ anyOf: [value, nil] });
const integer = (minimum: number, maximum = Number.MAX_SAFE_INTEGER) => ({ type: 'integer', minimum, maximum });
const year = nullable(integer(1000, 9999));
const object = (properties: Record<string, object>, optional: string[] = []) => ({
  type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false,
});
const document = object({ sourceRevisionId: nonempty, evidenceIds: { ...array(nonempty), minItems: 1, uniqueItems: true } });
const legacy = object({
  status: enumeration('known', 'unknown'), entityKind: enumeration('Offering', 'legacyCourse', 'CurriculumCourse', 'Mapping'),
  oldId: nonempty, sourceRevisionId: nonempty, sourceDigest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  legacyDigests: { type: 'object', minProperties: 1, additionalProperties: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
  reason: nullable(nonempty),
});
const evidence = { oneOf: [
  object({ kind: { const: 'learner' }, note: nonempty }),
  object({ kind: { const: 'document' }, ref: document }),
  object({ kind: { const: 'legacy' }, ref: legacy }),
  object({ kind: { const: 'official_detail' }, studyRecordId: nonempty }),
] };
const resolution = (ref: object, extra: Record<string, object> = {}) => ({ oneOf: [
  object({ ...extra, status: { const: 'confirmed' }, ref, candidateAuditIds: { ...array(nonempty), uniqueItems: true }, reason: nil }),
  object({ ...extra, status: enumeration('unmatched', 'ambiguous', 'conflict', 'unknown'), ref: nil,
    candidateAuditIds: { ...array(nonempty), uniqueItems: true }, reason: nonempty }),
] });
const attemptOwner = object({ kind: { const: 'attempt' }, attemptId: id('hosei:attempt:') });
const legacyOwner = object({ kind: { const: 'unresolved_legacy' }, ref: legacy, reason: nonempty });
const owner = { oneOf: [attemptOwner, legacyOwner] };
const plan = object({
  status: enumeration('planned', 'in_progress', 'waiting', 'earned', 'failed', 'dropped'),
  plannedYear: year, plannedTerm: nullable(text), studyYear: nullable(integer(1, 4)), earnedOrder: nullable(integer(1)),
  contribution: object({ value: nullable({ type: 'number', minimum: 0 }), source: { const: 'learner' }, note: nullable(text) }),
  importedSourceCourseId: nonempty,
}, ['contribution', 'importedSourceCourseId']);
const attempt = object({
  id: id('hosei:attempt:'), creationOperationId: id('hosei:attempt-op:'), originalTitle: nonempty,
  identity: resolution(object({ ...document.properties, institutionalCourseId: { anyOf: [id('curriculum:'), id('hosei:ic:')] } })),
  placement: resolution(object({ ...document.properties, placementId: id('hosei:cp:'), curriculumVersionId: id('hosei:cv:'), scopeId: id('') }), { candidatePlacementIds: { ...array(id('hosei:cp:')), uniqueItems: true } }),
  applicability: object({ status: enumeration('unknown', 'unverified', 'confirmed'), curriculumVersionId: nullable(id('hosei:cv:')),
    scopeId: nullable(id('')), legacyApplicability: enumeration('current_2026', 'legacy_or_transition', 'unknown'),
    originalValue: nullable(text), evidence: nullable(document) }),
  legacyRefs: array(legacy),
  membership: { oneOf: [object({ kind: { const: 'active' } }),
    object({ kind: { const: 'detached' }, reason: { const: 'plan_deleted' }, deletionOperationId: id('hosei:attempt-op:') }),
    object({ kind: { const: 'detached' }, reason: { const: 'legacy_orphan' }, deletionOperationId: nil }),
  ] },
  plan: nullable(plan),
  method: object({ value: enumeration('correspondence', 'schooling', 'media', 'unknown'),
    source: enumeration('learner', 'legacy_reference', 'official_detail', 'unknown'), evidence: nullable(evidence) }),
  actualYear: object({ value: year, source: enumeration('manual', 'source', 'inferred', 'unknown'), evidence: nullable(evidence), reason: nullable(nonempty) }),
});
const grade = nullable(enumeration('S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'));
const date = nullable({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const payloads = {
  media: object({ totalLessons: nullable(integer(0)), lessons: array(object({ lesson: integer(1), videoCompleted: bool, testCompleted: bool })),
    assessments: array(object({ id: nonempty, type: enumeration('midterm', 'final', 'other'), label: text, scheduledDate: date, completed: bool })) }),
  correspondence: object({ requiredReports: nullable(integer(0)), reports: array(object({ reportNumber: integer(1),
    status: enumeration('not_submitted', 'submitted', 'grading', 'resubmit', 'passed'),
    grade: nullable(enumeration('S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-')) })), examGrade: grade,
    calligraphyBatchStatus: enumeration('not_submitted', 'grading', 'passed') }, ['calligraphyBatchStatus']),
  evaluation: object({ finalGrade: grade, reportGrade: grade, schoolingGrade: grade }),
  todo: object({ id: nonempty, text, done: bool }),
};
const schema = object({ attempts: array(attempt),
  ownedRecords: array({ oneOf: Object.entries(payloads).map(([kind, payload]) => object({
    id: id('hosei:owned:'), kind: { const: kind }, owner: kind === 'todo' ? nullable(owner) : owner, payload,
  })) }),
  removals: array(object({ operationId: id('hosei:attempt-op:'), attemptSnapshot: attempt, previousPosition: integer(0) })),
});
// No defaults/coercion/removal: validation never rewrites caller data.
export const validateAttemptGraphShape = new Ajv({ allErrors: true, strict: true }).compile<AttemptGraph>(schema);
