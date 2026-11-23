import { parseHoseiGradeImportV1 } from '../../gradeImport/gradeImportContract';
import type { DeepReadonly, GradeSourceArchive } from '../gradeImport/sourceArchive';
import { digest, freeze, parse, rawDigest } from './codec';

export const GRADE_SOURCE_REFERENCE_MAX_BYTES = 1024 * 1024;
const MAX_COURSES = 2000;
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const EMPTY_SHA256 = '0'.repeat(64);

// The pinned G01A envelope determines the serialized byte budget and hash inputs.
const ARCHIVE_DESCRIPTOR = {
  format: 'hosei-g01a-source-prototype',
  contractVersion: '0.1.0-prototype',
  policy: {
    id: 'g01a-source-utf8-v1-prototype',
    dtoContract: 'hosei_web_learning_grade_table/v1',
    normalization: 'pinned-v1-allowlist',
    digest: 'sha256/utf8-raw+canonical-sorted-keys-preserve-array-order',
    numericPolicy: 'decimal-roundtrip-no-underflow-or-rounding',
  },
  inputContract: { source: 'hosei_web_learning_grade_table', schemaVersion: 1 },
} as const satisfies Pick<GradeSourceArchive, 'format' | 'contractVersion' | 'policy' | 'inputContract'>;

export type GradeSourceReference = DeepReadonly<{
  rawSha256: string;
  rows: { rawName: string; earnedCredits: number | null; compositionCredits: number | null }[];
}>;

export async function decodeGradeSourceReference(raw: unknown): Promise<GradeSourceReference> {
  if (typeof raw !== 'string' || raw.length > GRADE_SOURCE_REFERENCE_MAX_BYTES || /[\uD800-\uDFFF]/u.test(raw)) {
    throw new Error('grade_source_reference_input');
  }
  const encoder = new TextEncoder();
  const rawUtf8Bytes = encoder.encode(raw).byteLength;
  if (rawUtf8Bytes > GRADE_SOURCE_REFERENCE_MAX_BYTES) {
    throw new Error('grade_source_reference_capacity');
  }

  const dto = parseHoseiGradeImportV1(parse(raw));
  if (!dto) throw new Error('grade_source_reference_contract');
  if (dto.courses.length > MAX_COURSES) throw new Error('grade_source_reference_capacity');

  const archive = { ...ARCHIVE_DESCRIPTOR, raw, rawUtf8Bytes, rawSha256: EMPTY_SHA256, dto, dtoSha256: EMPTY_SHA256 };
  if (encoder.encode(JSON.stringify({ ...archive, archiveSha256: EMPTY_SHA256 })).byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('grade_source_reference_capacity');
  }
  archive.rawSha256 = await rawDigest(raw);
  archive.dtoSha256 = await digest(dto);
  // Match G01A's fail-closed check even though the reference exposes only the original digest.
  await digest(archive);
  return freeze({
    rawSha256: archive.rawSha256,
    rows: dto.courses.map(({ rawName, earnedCredits, compositionCredits }) => ({
      rawName, earnedCredits: earnedCredits.value, compositionCredits: compositionCredits.value,
    })),
  });
}
