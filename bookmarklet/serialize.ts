import { isHoseiGradeImportV1 } from '../src/planner/gradeImportContract';

/** Only extractor-created contract objects reach this transport boundary. */
export function serializeGradeImport(payload: unknown): string {
  if (!isHoseiGradeImportV1(payload) || !Array.isArray(payload.courses)) {
    throw new Error('成績データの形式を検証できませんでした。コピーしていません。');
  }
  const text = JSON.stringify(payload);
  const finalPayload: unknown = JSON.parse(text);
  if (text[0] !== '{' || !isHoseiGradeImportV1(finalPayload) || finalPayload.schemaVersion !== 1 || !Array.isArray(finalPayload.courses)) {
    throw new Error('コピー用JSONの形式を検証できませんでした。コピーしていません。');
  }
  return text;
}
