import { diagnoseHoseiGradeImportV1, type HoseiGradeImportValidationIssue } from '../src/planner/gradeImportContract';

export class GradeImportSerializationError extends Error {
  constructor(readonly code: 'GI_SERIALIZE_INPUT' | 'GI_SERIALIZE_ENCODE' | 'GI_SERIALIZE_PARSE' | 'GI_SERIALIZE_FINAL', readonly issue: HoseiGradeImportValidationIssue | null = null) {
    super(code); // Never attach a cause or page-derived exception message.
  }
}

/**
 * Page-world libraries may install Array/Object.prototype.toJSON that returns
 * JSON text. Isolate only our own snapshot from those inherited hooks without
 * changing the host page's prototypes or relaxing the contract validator.
 */
function snapshot(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object' || Object.prototype.hasOwnProperty.call(value, 'toJSON')) throw new GradeImportSerializationError('GI_SERIALIZE_ENCODE');
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    Object.defineProperty(copy, 'toJSON', { value: undefined });
    for (let index = 0; index < value.length; index++) copy.push(snapshot(value[index]));
    return copy;
  }
  const copy = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value)) copy[key] = snapshot((value as Record<string, unknown>)[key]);
  return copy;
}

/** Only extractor-created contract objects reach this transport boundary. */
export function serializeGradeImport(payload: unknown): string {
  let inputIssue;
  try { inputIssue = diagnoseHoseiGradeImportV1(payload); }
  catch { throw new GradeImportSerializationError('GI_SERIALIZE_INPUT'); }
  if (inputIssue) throw new GradeImportSerializationError('GI_SERIALIZE_INPUT', inputIssue);
  let text: string;
  try { text = JSON.stringify(snapshot(payload)); }
  catch { throw new GradeImportSerializationError('GI_SERIALIZE_ENCODE'); }
  let finalPayload: unknown;
  try { finalPayload = JSON.parse(text); }
  catch { throw new GradeImportSerializationError('GI_SERIALIZE_PARSE'); }
  let finalIssue;
  try { finalIssue = diagnoseHoseiGradeImportV1(finalPayload); }
  catch { throw new GradeImportSerializationError('GI_SERIALIZE_FINAL'); }
  if (text[0] !== '{' || finalIssue || typeof finalPayload !== 'object' || finalPayload === null
    || !('schemaVersion' in finalPayload) || finalPayload.schemaVersion !== 1
    || !('courses' in finalPayload) || !Array.isArray(finalPayload.courses)) {
    throw new GradeImportSerializationError('GI_SERIALIZE_FINAL', finalIssue);
  }
  return text;
}
