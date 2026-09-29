import { isHoseiGradeImportV1, type HoseiGradeImportV1 } from './gradeImportContract';
import { importPreview, type ImportedStudyRecord, type ImportPreviewUnit } from './gradeImportApply';
import type { Offering } from './plannerCatalog';

export const GRADE_HANDOFF_FRAGMENT_KEY = 'hosei-import';
export const GRADE_HANDOFF_REQUEST = 'hosei-grade-handoff-request';
export const GRADE_HANDOFF_RESPONSE = 'hosei-grade-handoff-response';
const tokenOk = (token: unknown): token is string => typeof token === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[4-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);

export function gradeHandoffToken(hash: string): string | null {
  const value = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get(GRADE_HANDOFF_FRAGMENT_KEY);
  return tokenOk(value) ? value : null;
}

export function isGradeHandoffResponse(value: unknown, token: string): value is { type: typeof GRADE_HANDOFF_RESPONSE; ok: boolean; token: string; importData?: unknown; reason?: string } {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return message.type === GRADE_HANDOFF_RESPONSE && message.token === token && typeof message.ok === 'boolean' && (message.reason === undefined || typeof message.reason === 'string');
}

/** The page validates again even though the extension only gives data to this origin. */
export function previewDirectGradeHandoff(value: unknown, offerings: Offering[], existing: ImportedStudyRecord[]): { data: HoseiGradeImportV1; units: ImportPreviewUnit[] } | null {
  if (!isHoseiGradeImportV1(value)) return null;
  return { data: value, units: importPreview(value, offerings, existing) };
}
