import type { MediaCourseProgress, Offering, PlannerCatalog, PlannerState } from '../plannerCatalog';
import { initialState } from '../backup/storage';
import { BACKUP_KEY, STORAGE_KEY, withPlannerWriteLock, type PlannerWriteLocks } from '../backup/storagePrimitives';
import { createPlannerBackup, parsePlannerBackup, validateBackupState } from '../backup/plannerBackup';
import { backupRawDigest, canonicalBackupJson } from '../digest';
import { readBrowserAuthorityInventory } from '../attempts/persistence/authorityInventory';
import { hasImportedMediaEvidence, independentImportedMedia, managedImportedMedia, mediaProgressAccess } from '../gradeImport/importedAchievementCalculations';
import { schoolingAcademicYear, type ImportedCourseAchievement, type ImportedStudyRecord } from '../gradeImport/gradeImportApply';
import { isMediaSchooling } from '../progress/mediaSchooling';
import { AUTHORITY as SEPARATED_AUTHORITY, validTrack } from './atomic-media.mjs';

export const SAME_ORIGIN_AUTHORITY = 'hosei-planner:2026:authority:v2';
const PORTABLE_FORMAT = {
  2: 'hosei-planner:2026:portable:v2',
  3: 'hosei-planner:2026:portable:v3',
  4: 'hosei-planner:2026:portable:v4',
  5: 'hosei-planner:2026:portable:v5',
} as const;
const PROTECTION_FORMAT = 'hosei-planner:2026:originals';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECEIPT_MS = 15 * 60 * 1000;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
type Capture = Readonly<{ p: string | null; r: string | null; a: string | null }>;
type OfferingTrack = {
  id: string;
  offeringId: string;
  sourceId: string | null;
  owner: string;
  progress: MediaCourseProgress;
  legacyOriginal?: string;
};
export type IndependentProgress = Omit<MediaCourseProgress, 'offeringId'>;
type ImportedLegacyProof = Readonly<{ offeringId: string; original: string; sourceFingerprint: string; recordFingerprint: string }>;
type IndependentTrack = {
  id: string;
  offeringId: null;
  sourceId: string;
  owner: string;
  progress: IndependentProgress;
  legacyImport?: ImportedLegacyProof;
};
type Track = OfferingTrack | IndependentTrack;
type Content = { primaryRaw: string; tracks: Track[]; version: keyof typeof PORTABLE_FORMAT };
type Envelope = Content & { generation: string; legacy: { p: string | null; r: string | null } };
export type LegacyProgressReview = Readonly<{
  offeringId: string;
  year: number;
  owner: string;
  original: string;
  imported?: Readonly<{ sourceId: string; term: string; sourceFingerprint: string; recordFingerprint: string }>;
}>;
export type AuthorityMediaEdit =
  | { offeringId: string; sourceId: string | null; progress: MediaCourseProgress }
  | { offeringId: null; recordId: string; sourceId: string; progress: IndependentProgress; approveV3: boolean }
  | { legacyReview: LegacyProgressReview };
export type AuthorityView = {
  raw: string | null;
  state: PlannerState;
  progress: PlannerState['mediaSchoolingProgress'];
  heldMediaOfferingIds: string[];
  independentProgress?: Record<string, IndependentProgress>;
  heldIndependentRecordIds?: readonly string[];
  carriedImportedOfferingIds?: readonly string[];
  linkedSourceIds?: string[];
  needsIndependentUpgrade?: boolean;
  legacyProgressReviews?: readonly LegacyProgressReview[];
  claimedLegacyOfferingIds?: readonly string[];
  generation?: string;
  error: string | null;
};
type RestoreReceipt = Readonly<{ protection: string; current: { planned: number; official: number; tracks: number };
  incoming: { planned: number; official: number; tracks: number };
  changed: readonly string[] }>;
type Options = {
  store: Store;
  catalog: PlannerCatalog;
  locks?: PlannerWriteLocks;
  isAdmitted: () => boolean;
  checkEnvironment: () => Promise<void>;
};

const holdMessage = '保存先または旧保存が変わりました。編集を停止しました。';
const carryForwardMessage = '引継ぎ先の履修回を確認できません。';
const formatMessage = '保存形式・原文・履修回の参照を確認できません。';
const same = (a: Capture, b: Capture) => a.a === b.a && a.p === b.p && a.r === b.r;
const exact = (v: unknown, keys: string) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === keys;
const validRaw = (v: unknown) => v === null || typeof v === 'string';

function ownerFor(state: PlannerState, catalog: PlannerCatalog, offeringId: string, sourceId: string | null) {
  if (!isMediaSchooling(catalog.offerings.find(offering => offering.id === offeringId))) return null;
  const item = state.items.find(row => row.offeringId === offeringId);
  if (sourceId === null) {
    if (!item) return null;
    const source = item.importedSourceCourseId === undefined ? null
      : state.importedCourseAchievements.find(row => row.id === item.importedSourceCourseId);
    if (source === undefined || (source && (source.selectionSource !== 'manual' || source.selectedOfferingId !== offeringId))) return null;
    return JSON.stringify([item.plannedYear, item.plannedTerm, item.studyYear, source?.id ?? null, source?.fingerprint ?? null]);
  }
  const source = state.importedCourseAchievements.find(row => row.id === sourceId);
  return source?.selectionSource === 'manual' && source.selectedOfferingId === offeringId
    ? JSON.stringify([source.id, source.fingerprint]) : null;
}

function linkedSources(tracks: Track[], state: PlannerState) {
  const sourceByOffering = new Map(state.items.map(item => [item.offeringId, item.importedSourceCourseId]));
  return tracks.flatMap(track => {
    if (track.offeringId === null) return [];
    const sourceId = track.sourceId ?? sourceByOffering.get(track.offeringId);
    return sourceId ? [sourceId] : [];
  });
}

export function sameOriginImportedRows(state: PlannerState, offerings: Map<string, PlannerCatalog['offerings'][number]>, linked: readonly string[]) {
  const rows = independentImportedMedia(state, offerings).filter(({ row }) => !linked.includes(row.id));
  const independent = new Set(rows.map(({ row }) => row.id));
  const managed = managedImportedMedia(state.importedCourseAchievements.filter(row => !independent.has(row.id)),
    state.importedStudyRecords, state.importedCourseUserMeta, offerings, new Set(linked));
  return { independent: rows, managed };
}

export function sameOriginMediaCanEdit(state: PlannerState, catalog: PlannerCatalog, offeringId: string, sourceId: string | null, linked: readonly string[] = []) {
  if (ownerFor(state, catalog, offeringId, sourceId) === null) return false;
  const offerings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  const { managed } = sameOriginImportedRows(state, offerings, linked);
  return mediaProgressAccess(state.items, offerings, managed).owners.get(offeringId) === sourceId;
}

// The search route stays separate from the official detail route.
function legacyPlan(state: PlannerState, catalog: PlannerCatalog, offeringId: string) {
  const offering = catalog.offerings.find(row => row.id === offeringId);
  const items = state.items.filter(row => row.offeringId === offeringId);
  const item = items[0];
  if (!offering || !isMediaSchooling(offering) || items.length !== 1 ||
    item.importedSourceCourseId !== undefined || item.plannedYear !== offering.academicYear ||
    (item.plannedTerm !== null && item.plannedTerm !== offering.period) ||
    !Object.hasOwn(state.mediaSchoolingProgress, offeringId)) return null;
  return { item, offering, progress: state.mediaSchoolingProgress[offeringId] };
}

function legacyReviewFor(state: PlannerState, catalog: PlannerCatalog, offeringId: string): LegacyProgressReview | null {
  const plan = legacyPlan(state, catalog, offeringId);
  if (!plan || plan.item.status !== 'in_progress'
    || state.importedCourseAchievements.some(row => sourceReferencesOffering(row, plan.offering))
    || state.importedStudyRecords.some(row => row.offeringId === offeringId)
    || (plan.offering.courseId !== null && state.items.some(item => item.offeringId !== offeringId &&
      (item.plannedYear === null || item.plannedYear === plan.item.plannedYear) &&
      catalog.offerings.some(offering => offering.id === item.offeringId &&
        offering.courseId === plan.offering.courseId && isMediaSchooling(offering))))) return null;
  const owner = ownerFor(state, catalog, offeringId, null);
  return owner === null ? null : { offeringId, year: plan.offering.academicYear, owner, original: canonicalBackupJson(plan.progress) };
}

function sourceReferencesOffering(row: ImportedCourseAchievement, offering: Offering) {
  return row.selectedOfferingId === offering.id || row.candidateOfferingIds.includes(offering.id)
    || (!row.selectedOfferingId && !row.candidateOfferingIds.length && offering.courseId !== null
      && row.courseId === offering.courseId && (row.academicYear === null || row.academicYear === offering.academicYear));
}

function isClaimedBySeparateSearchTrack(
  state: PlannerState, catalog: PlannerCatalog, tracks: Track[], offeringId: string, target: Track | undefined,
) {
  if (!target) return false;
  const claims = tracks.filter(track => trackOffering(track) === offeringId);
  const claim = claims[0];
  if (claims.length !== 1 || !claim || isIndependentTrack(claim) || claim.sourceId !== null
    || claim.legacyOriginal === undefined || claim.progress.offeringId !== offeringId
    || claim.id === target.id || claim.owner === target.owner) return false;

  const review = legacyReviewFor(state, catalog, offeringId);
  return !!review && claim.owner === review.owner && claim.legacyOriginal === review.original;
}

function hasLegacyConflict(
  state: PlannerState, catalog: PlannerCatalog, tracks: Track[], row: ImportedCourseAchievement, record: ImportedStudyRecord,
) {
  const hasReference = record.offeringId || row.selectedOfferingId || row.candidateOfferingIds.length || row.courseId;
  const rawTerm = record.rawTerm?.normalize('NFKC').replace(/\s/g, '');
  const existing = tracks.find(track => isIndependentTrack(track) && track.owner === record.id && track.sourceId === row.id);
  return catalog.offerings.some(offering => {
    if (!Object.hasOwn(state.mediaSchoolingProgress, offering.id)) return false;
    if (record.offeringId === offering.id || sourceReferencesOffering(row, offering)) return true;
    // A broad period match can hold an unresolved original, but a verified
    // search claim already accounts for it when editing a different saved UUID.
    return !hasReference && (record.academicYear === null || record.academicYear === offering.academicYear)
      && (!rawTerm || rawTerm === 'メ' || rawTerm === 'メディア' || rawTerm === offering.deliveryCategory)
      && !isClaimedBySeparateSearchTrack(state, catalog, tracks, offering.id, existing);
  });
}

function importedLegacyReviewFor(state: PlannerState, catalog: PlannerCatalog, offeringId: string): LegacyProgressReview | null {
  const offering = catalog.offerings.find(candidate => candidate.id === offeringId);
  if (!offering || !offering.courseId || !offering.period || !offering.deliveryCategory
    || !isMediaSchooling(offering) || !Object.hasOwn(state.mediaSchoolingProgress, offeringId)) return null;

  const sources = state.importedCourseAchievements.filter(row => sourceReferencesOffering(row, offering));
  const source = sources[0];
  if (sources.length !== 1 || !source || source.selectedOfferingId !== offeringId || source.courseId !== offering.courseId
    || source.candidateOfferingIds.length !== 1 || source.candidateOfferingIds[0] !== offeringId
    || (source.selectionSource !== 'manual' && (source.selectionSource !== 'auto' || source.match !== 'exact_unique'))
    || source.academicYear !== offering.academicYear || source.yearSource !== 'source') return null;

  const details = state.importedStudyRecords.filter(record => record.method === 'schooling'
    && (record.sourceCourseId === source.id || record.offeringId === offeringId));
  const record = details[0];
  if (details.length !== 1 || !record || record.sourceCourseId !== source.id || record.offeringId !== offeringId
    || record.academicYear !== offering.academicYear || record.yearSource !== 'source'
    || schoolingAcademicYear(record.rawYear) !== offering.academicYear
    || record.rawTerm?.normalize('NFKC').replace(/\s/g, '') !== offering.deliveryCategory
    || record.term !== offering.deliveryCategory
    || (source.selectionSource === 'auto' && record.match !== 'exact_unique')
    || !source.fingerprint || !record.fingerprint) return null;

  const meta = state.importedCourseUserMeta[source.id];
  if (!meta || (meta.plannedYear !== null && meta.plannedYear !== offering.academicYear)
    || (meta.plannedTerm !== null && meta.plannedTerm !== offering.period)) return null;

  // The old automatic import adds a planned placeholder without a source ID.
  // An active unlinked personal plan or another source is a competing owner.
  const items = state.items.filter(item => item.offeringId === offeringId);
  if (items.length > 1 || items.some(item => item.plannedYear !== offering.academicYear
    || (item.plannedTerm !== null && item.plannedTerm !== offering.period)
    || (item.importedSourceCourseId === undefined ? item.status !== 'planned' : item.importedSourceCourseId !== source.id))
    || state.items.some(item => item.offeringId !== offeringId
      && (item.plannedYear === null || item.plannedYear === offering.academicYear)
      && catalog.offerings.some(candidate => candidate.id === item.offeringId
        && candidate.courseId === offering.courseId && candidate.period === offering.period && isMediaSchooling(candidate)))) return null;

  return { offeringId, year: offering.academicYear, owner: record.id,
    original: canonicalBackupJson(state.mediaSchoolingProgress[offeringId]),
    imported: { sourceId: source.id, term: offering.deliveryCategory,
      sourceFingerprint: source.fingerprint, recordFingerprint: record.fingerprint } };
}

function trackOffering(track: Track) {
  return track.offeringId ?? track.legacyImport?.offeringId ?? null;
}

function importProof(review: LegacyProgressReview) {
  if (!review.imported) return undefined;
  return { offeringId: review.offeringId, original: review.original,
    sourceFingerprint: review.imported.sourceFingerprint, recordFingerprint: review.imported.recordFingerprint };
}

function claimReview(state: PlannerState, catalog: PlannerCatalog, tracks: Track[], offeringId: string) {
  if (tracks.some(track => trackOffering(track) === offeringId)) return null;
  const search = legacyReviewFor(state, catalog, offeringId);
  if (search) return search;
  const review = importedLegacyReviewFor(state, catalog, offeringId);
  if (!review?.imported || state.importedCourseUserMeta[review.imported.sourceId]?.lifecycleStatus !== 'in_progress'
    || tracks.some(track => track.owner === review.owner || track.sourceId === review.imported?.sourceId
      || (!isIndependentTrack(track) && state.items.some(item => item.offeringId === track.offeringId
        && item.importedSourceCourseId === review.imported?.sourceId)))) return null;
  return review;
}

function isIndependentTrack(track: Track): track is IndependentTrack { return track.offeringId === null; }

function validateIndependent(track: IndependentTrack, state: PlannerState, offerings: Map<string, PlannerCatalog['offerings'][number]>) {
  const row = state.importedCourseAchievements.find(row => row.id === track.sourceId);
  const record = state.importedStudyRecords.find(row => row.id === track.owner);
  const progress = track.progress;
  if (!row || !record || !hasImportedMediaEvidence(record, row, offerings)
    || !exact(progress, 'assessments,lessons,totalLessons') || !Array.isArray(progress.assessments)
    || progress.assessments.some(row => !exact(row, 'completed,id,label,scheduledDate,type')
      || !['midterm', 'final', 'other'].includes(row.type))) return false;
  return validTrack({
    id: track.id, totalLessons: progress.totalLessons, lessons: progress.lessons,
    assessments: progress.assessments.map(({ id, label, scheduledDate, completed }) => ({ id, label, scheduledDate, completed })),
  });
}

function validateContent({ primaryRaw, tracks, version }: Content, catalog: PlannerCatalog) {
  if (typeof primaryRaw !== 'string' || !Array.isArray(tracks)) throw new Error(formatMessage);
  const state: unknown = JSON.parse(primaryRaw);
  validateBackupState(state, catalog);
  const progress = { ...state.mediaSchoolingProgress };
  const ids = new Set<string>();
  const offerings = new Set<string>();
  const independent = new Map<string, IndependentProgress>();
  const importedClaims = new Set<string>();
  const carriedSources = new Set<string>();
  const trackedSources = new Set<string>();
  const catalogOfferings = new Map(catalog.offerings.map(offering => [offering.id, offering]));
  let hasLegacyClaim = false;
  for (const track of tracks) {
    const claimed = Object.hasOwn(track ?? {}, 'legacyOriginal');
    const importedClaim = Object.hasOwn(track ?? {}, 'legacyImport');
    const keys = claimed ? 'id,legacyOriginal,offeringId,owner,progress,sourceId'
      : importedClaim ? 'id,legacyImport,offeringId,owner,progress,sourceId' : 'id,offeringId,owner,progress,sourceId';
    if (!exact(track, keys)
      || typeof track.id !== 'string'
      || !UUID.test(track.id) || ids.has(track.id)) throw new Error(formatMessage);
    ids.add(track.id);
    const sourceId = track.sourceId ?? (track.offeringId
      ? state.items.find(item => item.offeringId === track.offeringId)?.importedSourceCourseId : undefined);
    if (sourceId && (carriedSources.has(sourceId) || (importedClaim && trackedSources.has(sourceId)))) throw new Error(formatMessage);
    if (sourceId) trackedSources.add(sourceId);
    if (isIndependentTrack(track)) {
      if (version < 3 || claimed || independent.has(track.owner) || !validateIndependent(track, state, catalogOfferings)) throw new Error(formatMessage);
      if (importedClaim) {
        const proof = track.legacyImport;
        if (version !== 5 || !proof || !exact(proof, 'offeringId,original,recordFingerprint,sourceFingerprint')
          || typeof proof.offeringId !== 'string' || importedClaims.has(proof.offeringId)) throw new Error(formatMessage);
        const review = importedLegacyReviewFor(state, catalog, proof.offeringId);
        if (review?.owner !== track.owner || review.imported?.sourceId !== track.sourceId
          || canonicalBackupJson(proof) !== canonicalBackupJson(importProof(review))) throw new Error(formatMessage);
        importedClaims.add(proof.offeringId);
        carriedSources.add(track.sourceId);
      }
      independent.set(track.owner, track.progress);
      continue;
    }
    if (importedClaim || typeof track.offeringId !== 'string'
      || offerings.has(track.offeringId) || !validRaw(track.sourceId) || typeof track.owner !== 'string'
      || ownerFor(state, catalog, track.offeringId, track.sourceId) !== track.owner
      || !track.progress || track.progress.offeringId !== track.offeringId) throw new Error(formatMessage);
    if (claimed) {
      const plan = legacyPlan(state, catalog, track.offeringId);
      if (version < 4 || track.sourceId !== null || !plan ||
        track.legacyOriginal !== canonicalBackupJson(plan.progress)) throw new Error(formatMessage);
      hasLegacyClaim = true;
    } else if (Object.hasOwn(state.mediaSchoolingProgress, track.offeringId)) throw new Error(formatMessage);
    // Verify the v22 representation with the frozen validator without writing the
    // projection back into the original planner state.
    const lessons = track.progress.lessons;
    const assessments = track.progress.assessments;
    if (!exact(track.progress, 'assessments,lessons,offeringId,totalLessons') || !Array.isArray(lessons)
      || lessons.some(row => !exact(row, 'lesson,testCompleted,videoCompleted')) || !Array.isArray(assessments)
      || assessments.some(row => !exact(row, 'completed,id,label,scheduledDate,type'))) throw new Error(formatMessage);
    offerings.add(track.offeringId);
    progress[track.offeringId] = track.progress;
  }
  if ((version === 4 && !hasLegacyClaim)
    || (version === 5 && !importedClaims.size)
    || [...importedClaims].some(id => offerings.has(id))) throw new Error(formatMessage);
  if (offerings.size) validateBackupState({ ...state, mediaSchoolingProgress: progress }, catalog);
  for (const id of importedClaims) delete progress[id];
  return { state, progress, independent: Object.fromEntries(independent), carriedImportedOfferingIds: [...importedClaims] };
}

function decode(raw: string, catalog: PlannerCatalog) {
  const value: Envelope = JSON.parse(raw);
  if (!exact(value, 'generation,legacy,primaryRaw,tracks,version') || ![2, 3, 4, 5].includes(value.version)
    || typeof value.generation !== 'string' || !UUID.test(value.generation)
    || !exact(value.legacy, 'p,r') || !validRaw(value.legacy.p) || !validRaw(value.legacy.r)) throw new Error(formatMessage);
  return { envelope: value, ...validateContent(value, catalog) };
}

const identity = (track: Track) => JSON.stringify([
  track.id, track.offeringId, track.sourceId, track.owner,
  isIndependentTrack(track) ? (track.legacyImport ? canonicalBackupJson(track.legacyImport) : null) : track.legacyOriginal ?? null,
]);
export async function checkSameOriginEnvironment(isExpectedWindow = () => window.top === window.self) {
  if (!window.isSecureContext || !isExpectedWindow() || !navigator.serviceWorker
    || navigator.serviceWorker.controller) throw new Error('安全なウィンドウまたは Service Worker の状態を確認できません。');
  const registrations = await navigator.serviceWorker.getRegistrations();
  if (!Array.isArray(registrations) || registrations.length || navigator.serviceWorker.controller
    || (await readBrowserAuthorityInventory()).status !== 'ABSENT' || navigator.serviceWorker.controller) {
    throw new Error('Service Worker または旧保存領域の状態を確認できません。');
  }
}

export function openSameOriginAuthority({ store, catalog, locks, isAdmitted, checkEnvironment }: Options) {
  const capture = (): Capture => ({ p: store.getItem(STORAGE_KEY), r: store.getItem(BACKUP_KEY), a: store.getItem(SAME_ORIGIN_AUTHORITY) });
  let blocked = false;
  let current: Capture = { p: null, r: null, a: null };
  try { current = capture(); } catch { blocked = true; }
  let environmentConfirmed = false;
  let receipt: { token: RestoreReceipt; expected: Capture; bytes: Uint8Array; content: Content; until: number;
    issued: boolean; verified: boolean } | null = null;

  function invalidate() { blocked = true; receipt = null; }
  const cancelRestore = () => { receipt = null; };

  function currentData(snapshot: Capture) {
    if (snapshot.a === null) return null;
    const data = decode(snapshot.a, catalog);
    if (data.envelope.legacy.p !== snapshot.p || data.envelope.legacy.r !== snapshot.r) throw new Error(holdMessage);
    return data;
  }

  function admit(expected = current) {
    if (blocked || !locks || !isAdmitted() || !same(expected, current) || !same(expected, capture())
      || store.getItem(SEPARATED_AUTHORITY) !== null) {
      invalidate();
      throw new Error(holdMessage);
    }
    currentData(expected);
  }

  async function checked(expected = current) {
    try {
      admit(expected);
      await checkEnvironment();
      admit(expected);
      environmentConfirmed = true;
    } catch (error) {
      invalidate();
      throw error;
    }
  }

  function view(): AuthorityView {
    try {
      const data = current.a === null ? null : decode(current.a, catalog);
      const legacyPresent = current.p !== null || current.r !== null;
      let state = data?.state ?? initialState();
      if (!data && current.p !== null) {
        try { const legacy: unknown = JSON.parse(current.p); validateBackupState(legacy, catalog); state = legacy; }
        catch { return { raw: null, state, progress: state.mediaSchoolingProgress, heldMediaOfferingIds: [], error: formatMessage }; }
      }
      const tracks = data?.envelope.tracks ?? [];
      const linked = tracks.filter((track): track is OfferingTrack => !isIndependentTrack(track));
      const linkedSourceIds = linkedSources(linked, state);
      const heldMediaOfferingIds = linked.filter(track =>
        !sameOriginMediaCanEdit(state, catalog, track.offeringId, track.sourceId, linkedSourceIds)
        || (track.legacyOriginal !== undefined && !legacyReviewFor(state, catalog, track.offeringId))).map(track => track.offeringId);
      const claimedLegacyOfferingIds = linked.filter(track => track.legacyOriginal !== undefined).map(track => track.offeringId);
      const legacyProgressReviews = data ? Object.keys(state.mediaSchoolingProgress).flatMap(id => {
        const review = claimReview(state, catalog, tracks, id);
        return review ? [review] : [];
      }) : [];
      const carriedRecords = new Set(tracks.flatMap(track => isIndependentTrack(track) && track.legacyImport ? [track.owner] : []));
      const heldIndependentRecordIds = independentImportedMedia(state, new Map(catalog.offerings.map(offering => [offering.id, offering])))
        .filter(({ row, record }) => !carriedRecords.has(record.id) && hasLegacyConflict(state, catalog, tracks, row, record))
        .map(({ record }) => record.id);
      return { raw: current.a, state, progress: data?.progress ?? state.mediaSchoolingProgress, heldMediaOfferingIds,
        independentProgress: data?.independent ?? {}, linkedSourceIds, heldIndependentRecordIds,
        carriedImportedOfferingIds: data?.carriedImportedOfferingIds,
        needsIndependentUpgrade: data?.envelope.version === 2,
        legacyProgressReviews, claimedLegacyOfferingIds, generation: data?.envelope.generation,
        error: blocked || !environmentConfirmed || !isAdmitted() || !locks ? holdMessage : !data && legacyPresent ? '旧保存は閲覧用です。保護付きの移行を確認してください。' : null };
    } catch { return { raw: current.a, state: initialState(), progress: {}, heldMediaOfferingIds: [], error: formatMessage }; }
  }

  async function refresh() {
    try { await checked(); } catch { /* Preserve the last available view and keep writes closed. */ }
    return view();
  }

  async function commit(expected: Capture, content: Content | (() => Content), isCurrent: () => boolean) {
    return withPlannerWriteLock(async () => {
      await checked(expected);
      if (!isCurrent()) throw new Error(holdMessage);
      const replacement: Envelope = { generation: crypto.randomUUID(),
        legacy: { p: expected.p, r: expected.r }, ...(typeof content === 'function' ? content() : content) };
      const raw = JSON.stringify(replacement);
      decode(raw, catalog);
      // No await is allowed between the final raw comparison and the write.
      if (!isCurrent()) throw new Error(holdMessage);
      admit(expected);
      if (!same(expected, capture())) throw new Error(holdMessage);
      store.setItem(SAME_ORIGIN_AUTHORITY, raw);
      current = { ...expected, a: raw };
      cancelRestore();
      return view();
    }, locks, true);
  }

  async function save(expectedRaw: string | null, next: PlannerState, isCurrent: () => boolean,
    media?: AuthorityMediaEdit) {
    const expected = current;
    if (expectedRaw !== expected.a) throw new Error(holdMessage);
    const previous = currentData(expected);
    if (!previous && (expected.p !== null || expected.r !== null)) throw new Error('旧保存の保護付き移行が必要です。');
    const previousState = previous?.state ?? initialState();
    if (canonicalBackupJson(next.mediaSchoolingProgress) !== canonicalBackupJson(previousState.mediaSchoolingProgress)) {
      throw new Error('旧進捗の原本は上書きできません。');
    }
    if (media && 'legacyReview' in media) {
      const reviewed = { ...media.legacyReview, ...(media.legacyReview.imported ? { imported: { ...media.legacyReview.imported } } : {}) };
      return commit(expected, () => {
        const live = currentData(expected);
        if (!live || canonicalBackupJson(next) !== canonicalBackupJson(live.state)) throw new Error(holdMessage);
        const { offeringId } = reviewed;
        const review = claimReview(live.state, catalog, live.envelope.tracks, offeringId);
        if (!review || canonicalBackupJson(review) !== canonicalBackupJson(reviewed)) throw new Error(carryForwardMessage);
        const progress = live.state.mediaSchoolingProgress[offeringId];
        const id = crypto.randomUUID();
        const entry: Track = review.imported
          ? { id, offeringId: null, sourceId: review.imported.sourceId, owner: review.owner,
            legacyImport: importProof(review),
            progress: { totalLessons: progress.totalLessons, lessons: progress.lessons, assessments: progress.assessments } }
          : { id, offeringId, sourceId: null, owner: review.owner, legacyOriginal: review.original, progress };
        const version = review.imported || live.envelope.version === 5 ? 5 : 4;
        return { primaryRaw: live.envelope.primaryRaw, version, tracks: [...live.envelope.tracks, entry] };
      }, isCurrent);
    }
    const tracks = [...(previous?.envelope.tracks ?? [])];
    const version = previous?.envelope.version ?? 3;
    const primaryRaw = () => previous && canonicalBackupJson(next) === canonicalBackupJson(previousState)
      ? previous.envelope.primaryRaw : JSON.stringify(next);

    if (media?.offeringId === null) {
      return commit(expected, () => {
        if (canonicalBackupJson(next.mediaSchoolingProgress) !== canonicalBackupJson(previousState.mediaSchoolingProgress)) {
          throw new Error('旧進捗の原本は上書きできません。');
        }
        const mediaRows = independentImportedMedia(next, new Map(catalog.offerings.map(offering => [offering.id, offering])));
        const match = mediaRows.find(entry => entry.record.id === media.recordId && entry.row.id === media.sourceId);
        if (!match || linkedSources(tracks, next).includes(media.sourceId)) throw new Error(holdMessage);
        if (version === 2 && !media.approveV3) throw new Error('保存形式の更新を確認してください。');
        const index = tracks.findIndex(track => isIndependentTrack(track) && track.owner === media.recordId);
        const prior = tracks[index];
        const legacyImport = prior && isIndependentTrack(prior) ? prior.legacyImport : undefined;
        const oldRow = previousState.importedCourseAchievements.find(row => row.id === media.sourceId);
        const oldDetail = previousState.importedStudyRecords.find(record => record.id === media.recordId);
        if (prior && prior.sourceId !== media.sourceId) throw new Error(formatMessage);
        if (!legacyImport && (hasLegacyConflict(next, catalog, tracks, match.row, match.record)
          || (oldRow && oldDetail && hasLegacyConflict(previousState, catalog, tracks, oldRow, oldDetail)))) {
          throw new Error('元のメディア進捗が残っています。履修回を確認するまで保存を保留します。');
        }
        const entry: IndependentTrack = { id: prior?.id ?? crypto.randomUUID(), offeringId: null, sourceId: media.sourceId,
          owner: media.recordId, progress: media.progress, ...(legacyImport ? { legacyImport } : {}) };
        if (index === -1) tracks.push(entry);
        else tracks[index] = entry;
        return { primaryRaw: primaryRaw(), tracks, version: version === 2 ? 3 : version };
      }, isCurrent);
    }
    if (media) {
      const owner = ownerFor(next, catalog, media.offeringId, media.sourceId);
      if (!owner || !sameOriginMediaCanEdit(next, catalog, media.offeringId, media.sourceId, linkedSources(tracks, next))) throw new Error('編集対象の履修回を確認できません。');
      const index = tracks.findIndex(track => track.offeringId === media.offeringId);
      const prior = tracks[index];
      if (prior && (prior.owner !== owner || prior.sourceId !== media.sourceId)) throw new Error(formatMessage);
      const legacyOriginal = prior && !isIndependentTrack(prior) ? prior.legacyOriginal : undefined;
      if (Object.hasOwn(next.mediaSchoolingProgress, media.offeringId)
        && (legacyOriginal === undefined || media.sourceId !== null || !legacyReviewFor(next, catalog, media.offeringId))) {
        throw new Error('編集対象の履修回を確認できません。先に引継ぎ先を確認してください。');
      }
      const entry: OfferingTrack = { id: prior?.id ?? crypto.randomUUID(), offeringId: media.offeringId,
        sourceId: media.sourceId, owner, progress: media.progress,
        ...(legacyOriginal === undefined ? {} : { legacyOriginal }) };
      if (prior) tracks[index] = entry;
      else tracks.push(entry);
    }
    return commit(expected, { primaryRaw: primaryRaw(), tracks, version }, isCurrent);
  }

  const encoder = new TextEncoder();
  const utf8 = (value: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(value);
  const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

  async function prepareRestore(bytes: Uint8Array) {
    cancelRestore();
    const expected = current;
    const intent = ++previewSequence;
    const source = bytes.slice();
    await checked(expected);
    const text = utf8(source);
    const parsed = JSON.parse(text);
    const previous = currentData(expected)?.envelope;
    let content: Content;
    if (Object.values(PORTABLE_FORMAT).some(format => format === parsed?.format)) {
      if (!exact(parsed, 'envelope,format,sha256') || typeof parsed.envelope !== 'string'
        || parsed.sha256 !== await backupRawDigest(parsed.envelope)) throw new Error(formatMessage);
      const incoming = decode(parsed.envelope, catalog).envelope;
      if (PORTABLE_FORMAT[incoming.version] !== parsed.format) throw new Error(formatMessage);
      if (previous && previous.version >= 4 && incoming.version < previous.version) throw new Error('確認済みの引継ぎを以前の保存形式で置き換えられません。');
      const ids = new Set(incoming.tracks.map(identity));
      if (previous && (previous.tracks.length !== ids.size || !previous.tracks.every(track => ids.has(identity(track))))) {
        throw new Error('バックアップと今の履修回が一致しません。');
      }
      if (!previous && (expected.p !== null || expected.r !== null)) throw new Error('旧保存から先に移行してください。');
      content = { primaryRaw: incoming.primaryRaw, tracks: incoming.tracks, version: previous?.version === 3 && incoming.version === 2 ? 3 : incoming.version };
    } else {
      if (previous) throw new Error('旧形式で新しい保存先を置き換えられません。');
      if (expected.p === null && expected.r !== null) throw new Error(formatMessage);
      const old = await parsePlannerBackup(text, catalog);
      if (expected.p !== null && canonicalBackupJson(old.state) !== canonicalBackupJson(JSON.parse(expected.p))) {
        throw new Error('選択したバックアップが今の旧保存と一致しません。');
      }
      // Keep the original string, including formatting, for in-place migration.
      content = { primaryRaw: expected.p ?? JSON.stringify(old.state), tracks: [], version: 2 };
    }
    const { state } = validateContent(content, catalog);
    await checked(expected);
    if (intent !== previewSequence) throw new Error(holdMessage);
    const counts = (data: PlannerState, tracks: number) => Object.freeze({
      planned: data.items.length + data.publicCourses.length, official: data.importedCourseAchievements.length, tracks,
    });
    const present = view().state;
    const changed: string[] = [];
    if (canonicalBackupJson(present) !== canonicalBackupJson(state)) changed.push('一次Plannerの内容');
    if ((previous?.primaryRaw ?? expected.p) !== content.primaryRaw) changed.push('一次Plannerの保存原文');
    if (canonicalBackupJson(previous?.tracks ?? []) !== canonicalBackupJson(content.tracks)) changed.push('本人履修回と進捗');
    const token = Object.freeze({ protection: JSON.stringify({ format: PROTECTION_FORMAT, ...expected, inputSha256: await backupRawDigest(text) }),
      current: counts(present, previous?.tracks.length ?? 0), incoming: counts(state, content.tracks.length), changed: Object.freeze(changed) });
    admit(expected);
    if (intent !== previewSequence) throw new Error(holdMessage);
    receipt = { token, expected, bytes: source, content, until: Date.now() + RECEIPT_MS, issued: false, verified: false };
    return token;
  }
  let previewSequence = 0;

  function requireReceipt(token: RestoreReceipt) {
    if (!receipt || receipt.token !== token || Date.now() >= receipt.until) throw new Error(holdMessage);
    return receipt;
  }

  async function protectionFile(token: RestoreReceipt, download: (raw: string) => void) {
    const item = requireReceipt(token);
    await checked(item.expected);
    if (requireReceipt(token) !== item) throw new Error(holdMessage);
    download(token.protection);
    item.issued = true;
  }

  async function verifyRestore(token: RestoreReceipt, source: Uint8Array, protection: Uint8Array) {
    const item = requireReceipt(token);
    item.verified = false;
    await checked(item.expected);
    if (requireReceipt(token) !== item || !item.issued || !equal(item.bytes, source)
      || !equal(encoder.encode(token.protection), protection)) throw new Error('選択した元ファイルまたは保護ファイルが一致しません。');
    item.verified = true;
  }

  async function restore(token: RestoreReceipt, isCurrent: () => boolean) {
    const item = requireReceipt(token);
    if (!item.verified) throw new Error('元ファイルと保護ファイルを再選択してください。');
    try {
      return await commit(item.expected, item.content,
        () => receipt === item && item.verified && Date.now() < item.until && isCurrent());
    } finally { if (receipt === item) cancelRestore(); }
  }

  function legacyOriginals(deliver: (text: string) => void) {
    const { p, r } = capture();
    deliver(JSON.stringify({ format: PROTECTION_FORMAT, p, r }));
  }

  async function legacyBackup(deliver: (text: string) => void) {
    const before = capture();
    if (before.p === null) throw new Error('元の通常保存がありません。');
    const backup = await createPlannerBackup(before.p, catalog);
    if (!same(before, capture())) throw new Error(holdMessage);
    deliver(JSON.stringify(backup));
  }

  function authorityOriginal(deliver: (text: string) => void) {
    const { a } = capture();
    if (a === null) throw new Error('新しい保存はまだありません。');
    deliver(a);
  }

  async function exportAuthority(deliver: (text: string) => void) {
    const before = capture();
    if (!before.a) throw new Error('新しい保存はまだありません。');
    const version = decode(before.a, catalog).envelope.version;
    const sha256 = await backupRawDigest(before.a);
    if (capture().a !== before.a) throw new Error(holdMessage);
    deliver(JSON.stringify({ format: PORTABLE_FORMAT[version], envelope: before.a, sha256 }));
  }

  return { view, refresh, save, prepareRestore, protectionFile, verifyRestore,
    restore, cancelRestore: () => { ++previewSequence; cancelRestore(); }, invalidate, legacyOriginals, legacyBackup, authorityOriginal, exportAuthority };
}

export type SameOriginAuthority = ReturnType<typeof openSameOriginAuthority>;

export function observeSameOriginAuthority(authority: SameOriginAuthority, onHold: (view: AuthorityView) => void) {
  // Publish holds, not incidental successful refreshes that could reset UI drafts.
  const refresh = () => { void authority.refresh().then(view => { if (view.error) onHold(view); }); };
  const invalidate = () => { authority.invalidate(); refresh(); };
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && (event.key === null
      || [STORAGE_KEY, BACKUP_KEY, SAME_ORIGIN_AUTHORITY, SEPARATED_AUTHORITY].includes(event.key))) invalidate();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('pagehide', authority.invalidate);
  document.addEventListener('visibilitychange', refresh);
  navigator.serviceWorker?.addEventListener('controllerchange', invalidate);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('pageshow', refresh);
    window.removeEventListener('pagehide', authority.invalidate);
    document.removeEventListener('visibilitychange', refresh);
    navigator.serviceWorker?.removeEventListener('controllerchange', invalidate);
    authority.cancelRestore();
  };
}
