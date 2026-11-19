import { catalog } from '../catalog/catalog';
import { BACKUP_KEY, initialState, loadState, STORAGE_KEY, withPlannerWriteLock } from '../backup/storage';
import { assertLegacyWriteAllowed } from '../backup/legacyWriteFence';
import { createPlannerBackup, parsePlannerBackup } from '../backup/plannerBackup';
import { canonicalBackupJson } from '../backup/plannerBackupCompatibility';
import { officialMediaAchievements } from '../gradeImport/officialMediaAchievements';
import { FORMAT, openAtomicMedia } from './atomic-media.mjs';
import type { BootPreflight } from './preflight';

function readPrimary(raw: string) {
  return loadState({
    getItem: key => key === STORAGE_KEY ? raw : null,
    setItem() { throw new Error('The migrated state reader is read-only'); },
  }, catalog);
}

export function openProductMedia(store: Storage, preflight: BootPreflight) {
  return openAtomicMedia({
    store,
    primaryKey: STORAGE_KEY,
    recoveryKey: BACKUP_KEY,
    preflight,
    withLock: action => withPlannerWriteLock(action, navigator.locks, true),
    legacyFence: (p, r) => assertLegacyWriteAllowed(store, p, r),
    backup: {
      emptyPrimary: JSON.stringify(initialState()),
      validPrimary(raw) {
        const result = readPrimary(raw);
        return !result.error && !result.recoveredRecognitionRaw && canonicalBackupJson(JSON.parse(raw)) === canonicalBackupJson(result.state);
      },
      exportLegacy: raw => createPlannerBackup(raw, catalog),
      async importLegacy(text) { return JSON.stringify((await parsePlannerBackup(text, catalog)).state); },
      stateIdentity: canonicalBackupJson,
    },
  });
}

export type MediaService = ReturnType<typeof openProductMedia>;

export function plannerView(primary: string) {
  const state = readPrimary(primary).state;
  const records = officialMediaAchievements(state.importedCourseAchievements, state.importedStudyRecords, catalog)
    .flatMap(view => {
      const official = state.importedCourseAchievements.find(record => record.id === view.sourceCourseId);
      if (!official || official.candidateOfferingIds.length || official.selectedOfferingId != null
        || state.importedCourseUserMeta[official.id]?.lifecycleStatus !== 'in_progress') return [];
      const original = view.records.find(slot => slot.rawTerm === 'メ');
      return original ? [{ id: official.id, name: view.rawName, year: original.rawYear, earned: view.earnedCreditsTotal }] : [];
    });
  return { plans: state.items.length + state.publicCourses.length, officialRows: state.importedCourseAchievements.length, records };
}

// Summaries are built only after the core has verified the selected input.
export async function transferSummary(text: string) {
  const file = JSON.parse(text);
  if (file.format === FORMAT) {
    return { kind: '新版の可搬バックアップ', tracks: file.tracks.length as number, ...plannerView(file.primaryRaw) };
  }
  const { state, backupVersion } = await parsePlannerBackup(text, catalog);
  return { kind: `旧版の通常バックアップ v${backupVersion}`, tracks: 0, ...plannerView(JSON.stringify(state)) };
}

export function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
