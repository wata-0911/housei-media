import Ajv2020 from 'ajv/dist/2020';
import schema from '../planner_catalog_2026.schema.json';
import type { PlannerCatalog, PlannerState } from '../plannerCatalog';
import { initialState, loadState, STORAGE_KEY } from './storage';
import { validateState } from '../validation';
import { normalizeImportName } from '../gradeImport/gradeImportApply';
import { canonicalBackupJson as canonical, createBackupCatalogSnapshot, checkBackupCatalogCompatibility, type BackupCatalogIdentity, type BackupCatalogSnapshot } from './plannerBackupCompatibility';
import { guidanceForScope, thesisGuidanceViews } from '../graduation/thesisGuidance';

export const PLANNER_BACKUP_FORMAT = 'hosei-planner-backup';
export const PLANNER_BACKUP_VERSION = 2;
export type PlannerBackup = {
  format: typeof PLANNER_BACKUP_FORMAT;
  backupVersion: 1 | 2;
  createdAt: string;
  catalog: BackupCatalogIdentity | BackupCatalogSnapshot;
  state: PlannerState;
};

// Tighten only the backup boundary. Existing import/migration validation is unchanged.
const strictSchema = structuredClone(schema);
const profile = strictSchema.$defs.PlannerState.properties.graduationProfile;
const numberOrNull = { type: ['number', 'null'], minimum: 0 };
const recognitionMode = { enum: ['none', 'recognized', 'exempt', 'unknown'] };
const closed = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const general = closed({ mode: recognitionMode, credits: numberOrNull });
Object.assign(profile, { additionalProperties: false });
Object.assign(profile.properties.recognizedCredits, closed({
  totalCredits: numberOrNull, schoolingEquivalentCredits: numberOrNull, openUniversityCredits: { ...numberOrNull, maximum: 10 },
  general: closed({ humanities: general, social: general, natural: general }),
  foreignLanguage: closed({ mode: recognitionMode, credits: numberOrNull, language: { enum: ['english', 'german', 'french', 'unknown'] }, schoolingEquivalentCredits: numberOrNull }),
  physicalEducation: general,
  professionalCourses: { type: 'array', items: closed({ id: { type: 'string', minLength: 1 }, offeringId: { type: ['string', 'null'] }, courseId: { type: ['string', 'null'] }, mappingId: { type: ['string', 'null'] }, name: { type: 'string' }, credits: { type: 'number', minimum: 0 } }) },
}));
Object.assign(strictSchema.$defs.PlannerState.properties.importedStudyRecords.items.properties.reports, {
  items: closed({ raw: { type: 'string' }, status: { enum: ['none', 'passed', 'resubmit', 'processing', 'unknown'] }, date: { type: ['string', 'null'] } }),
});
const ajv = new Ajv2020({ allErrors: true });
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const strictState = ajv.compile<PlannerState>({ ...strictSchema, $ref: '#/$defs/PlannerState' });

const unique = (ids: string[]) => new Set(ids).size === ids.length;

export function validateBackupState(value: unknown, catalog: PlannerCatalog): asserts value is PlannerState {
  if (!strictState(value) || !validateState(value, catalog)) throw new Error('保存データの形式・スキーマ22・認定情報が不正です。正常なバックアップとして扱えません。元データを退避してください。');
  const offeringMap = new Map(catalog.offerings.map(row => [row.id, row]));
  const courses = new Set(catalog.courses.map(row => row.id));
  const mappings = new Set(catalog.mappings.map(row => row.mappingId));
  const scopes = new Set(catalog.programs.map(row => row.scopeId));
  const rows = new Map(value.importedCourseAchievements.map(row => [row.id, row]));
  const offeringRef = (id: string | null) => id === null || offeringMap.has(id);
  const courseRef = (id: string | null) => id === null || courses.has(id);
  const valid = unique(value.importedCourseAchievements.map(row => row.id))
    && unique(value.importedCourseAchievements.map(row => row.fingerprint))
    && unique(value.importedStudyRecords.map(row => row.id))
    && unique(value.importedStudyRecords.map(row => row.fingerprint))
    && Object.keys(value.thesisProgressByScope).every(id => scopes.has(id))
    && Object.keys(value.thesisGuidanceByScope).every(id => scopes.has(id))
    && value.importedCourseAchievements.every(row => offeringRef(row.selectedOfferingId) && courseRef(row.courseId)
      && unique(row.candidateOfferingIds) && row.candidateOfferingIds.every(id => offeringMap.has(id)))
    && value.importedStudyRecords.every(row => offeringRef(row.offeringId)
      && (row.offeringId === null || offeringMap.get(row.offeringId)?.method === row.method)
      && (row.sourceCourseId === undefined || (rows.has(row.sourceCourseId)
        && normalizeImportName(rows.get(row.sourceCourseId)!.rawName) === normalizeImportName(row.rawName))))
    && value.graduationProfile.recognizedCredits.professionalCourses.every(row => offeringRef(row.offeringId) && courseRef(row.courseId) && (row.mappingId === null || mappings.has(row.mappingId)))
    && unique(value.graduationProfile.recognizedCredits.professionalCourses.map(row => row.id))
    && Object.values(value.mediaSchoolingProgress).every(row => unique(row.assessments.map(assessment => assessment.id)))
    && Object.entries(value.thesisGuidanceByScope).every(([scopeId, progress]) => {
      const allowed = new Set(thesisGuidanceViews(catalog, scopeId, value.graduationProfile, guidanceForScope(value, scopeId), null, new Date('2026-01-01')).map(step => step.id));
      return Object.keys(progress.steps).every(id => allowed.has(id));
    });
  if (!valid) throw new Error('IDの重複または科目・所属・成績行の参照が不整合です。元データは変更していません。');
  // Refuse any state that loadState would silently migrate/normalize/repair.
  const raw = JSON.stringify(value);
  const loaded = loadState({ getItem: key => key === STORAGE_KEY ? raw : null, setItem: () => { throw new Error('Unexpected write'); } }, catalog);
  if (loaded.error || loaded.recoveredRecognitionRaw || canonical(value) !== canonical(loaded.state)) throw new Error('再読み込み時に修復が必要なデータです。元データを退避し、内容を確認してから保存してください。');
}

/** Reads raw persisted state, never the recognition-recovery display projection. */
export async function createPlannerBackup(raw: string | null, catalog: PlannerCatalog, now = new Date()): Promise<PlannerBackup> {
  let state: unknown;
  try { state = raw === null ? initialState() : JSON.parse(raw); }
  catch { throw new Error('保存原文が不正なJSONです。元データを退避してください。'); }
  validateBackupState(state, catalog);
  return { format: PLANNER_BACKUP_FORMAT, backupVersion: 2, createdAt: now.toISOString(), catalog: await createBackupCatalogSnapshot(catalog), state };
}

export async function parsePlannerBackup(text: string, catalog: PlannerCatalog): Promise<PlannerBackup> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('JSONの構文が不正です。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('プランナー用バックアップではありません。');
  const backup = value as Record<string, unknown>;
  if (backup.format === 'hosei-planner-protection') throw new Error('これは未検証原文の保護ファイルです。通常の全件復元には使用できません。原文を保持して対応する復旧手順を確認してください。');
  if (Object.keys(backup).sort().join(',') !== 'backupVersion,catalog,createdAt,format,state' || backup.format !== PLANNER_BACKUP_FORMAT || (backup.backupVersion !== 1 && backup.backupVersion !== 2)) throw new Error('バックアップ形式・版が未対応です（対応: hosei-planner-backup v1/v2）。成績取り込みJSONは復元できません。');
  if (typeof backup.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(backup.createdAt) || !Number.isFinite(Date.parse(backup.createdAt)) || new Date(backup.createdAt).toISOString() !== backup.createdAt) throw new Error('作成日時が不正です。');
  const sourceCatalog = await checkBackupCatalogCompatibility(backup.catalog, backup.backupVersion as 1 | 2, catalog);
  if (sourceCatalog) validateBackupState(backup.state, sourceCatalog);
  validateBackupState(backup.state, catalog);
  return backup as PlannerBackup;
}

export function backupSummary(backup: PlannerBackup) {
  return { plans: backup.state.items.length, publicCourses: backup.state.publicCourses.length, officialRows: backup.state.importedCourseAchievements.length,
    components: backup.state.importedStudyRecords.length, todos: backup.state.todos.length };
}
