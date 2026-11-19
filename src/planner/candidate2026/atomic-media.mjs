// This key and file format belong to the separate 2026 planner origin.
export const AUTHORITY = 'hosei-planner:2026-media:v1';
export const FORMAT = 'hosei-planner-2026-media';
const PROTECTION = 'hosei-planner-2026-media-protection';
const VERSION = 1;
const RECEIPT_LIFETIME_MS = 15 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encode = value => new TextEncoder().encode(value);
const json = text => JSON.parse(text);
const exactShape = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === keys;
const rawValue = value => value === null || typeof value === 'string';
const unique = values => new Set(values).size === values.length;
const within = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const idValid = value => typeof value === 'string' && UUID.test(value);
const isoDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

function validTrack(track) {
  return exactShape(track, 'assessments,id,lessons,totalLessons')
    && idValid(track.id)
    && within(track.totalLessons, 1, 200)
    && Array.isArray(track.lessons)
    && track.lessons.every(item => exactShape(item, 'lesson,testCompleted,videoCompleted')
      && within(item.lesson, 1, track.totalLessons)
      && typeof item.videoCompleted === 'boolean' && typeof item.testCompleted === 'boolean')
    && unique(track.lessons.map(item => item.lesson))
    && Array.isArray(track.assessments)
    && track.assessments.every(item => exactShape(item, 'completed,id,label,scheduledDate')
      && idValid(item.id) && typeof item.completed === 'boolean'
      && typeof item.label === 'string' && item.label.trim().length > 0 && item.label.length <= 200
      && (item.scheduledDate === null || isoDay(item.scheduledDate)))
    && unique(track.assessments.map(item => item.id));
}

const validTracks = tracks => Array.isArray(tracks) && tracks.every(validTrack) && unique(tracks.map(track => track.id));

async function digest(input) {
  const bytes = typeof input === 'string' ? encode(input) : input;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
}

function sameBytes(expectedText, actualBytes) {
  const expected = encode(expectedText);
  return actualBytes instanceof Uint8Array && actualBytes.length === expected.length
    && actualBytes.every((byte, index) => byte === expected[index]);
}

function sameCapture(a, b) {
  return a.authorityRaw === b.authorityRaw && a.legacyP === b.legacyP && a.legacyR === b.legacyR;
}

function makeBody(primaryRaw, planner, tracks) {
  return { format: FORMAT, version: VERSION, primaryRaw, planner, tracks };
}

export function openAtomicMedia({ store, primaryKey, recoveryKey, preflight, withLock, legacyFence, backup }) {
  // A receipt is local to this document/service. A new tab or reload must prepare again.
  let activeRestore;

  function capture() {
    preflight.checkLocal();
    const legacyP = store.getItem(primaryKey);
    const legacyR = store.getItem(recoveryKey);
    if (legacyP !== null || legacyR !== null) throw new Error('Legacy storage is present');
    const authorityRaw = store.getItem(AUTHORITY);
    return Object.freeze({ authorityRaw, legacyP, legacyR });
  }

  function requirePrimary(primaryRaw) {
    if (typeof primaryRaw !== 'string' || !backup.validPrimary(primaryRaw)) throw new Error('Unsupported planner primary');
  }

  async function parseSnapshot(raw) {
    const record = json(raw);
    if (!exactShape(record, 'anchor,generation,primaryRaw,sha256,tracks,version')
      || record.version !== VERSION || !idValid(record.generation)
      || !exactShape(record.anchor, 'p,r') || !rawValue(record.anchor.p) || !rawValue(record.anchor.r)
      || !validTracks(record.tracks)) throw new Error('Invalid committed snapshot');
    const { sha256, ...body } = record;
    if (sha256 !== await digest(JSON.stringify(body))) throw new Error('Invalid committed snapshot digest');
    requirePrimary(record.primaryRaw);
    return record;
  }

  async function read() {
    try {
      await preflight.check();
      const before = capture();
      if (before.authorityRaw === null) {
        const primaryRaw = backup.emptyPrimary;
        requirePrimary(primaryRaw);
        return { status: 'ready', capture: before, primaryRaw, generation: null, tracks: [] };
      }
      const current = await parseSnapshot(before.authorityRaw);
      await preflight.check();
      if (!sameCapture(before, capture())) return { status: 'hold', reason: 'storage-changed-during-read' };
      if (current.anchor.p !== before.legacyP || current.anchor.r !== before.legacyR) {
        return { status: 'hold', reason: 'legacy-diverged' };
      }
      return { status: 'ready', capture: before, primaryRaw: current.primaryRaw, generation: current.generation, tracks: current.tracks };
    } catch {
      return { status: 'hold', reason: 'read-or-format-failed' };
    }
  }

  async function requireCurrent(before) {
    const view = await read();
    if (view.status !== 'ready' || !sameCapture(view.capture, before)) throw new Error('Snapshot changed or held');
    return view;
  }

  async function commit(before, change, isCurrent) {
    return withLock(async () => {
      if (!isCurrent()) throw new Error('Operation no longer current');
      const view = await requireCurrent(before);
      const next = change(view);
      requirePrimary(next.primaryRaw);
      if (!validTracks(next.tracks)) throw new Error('Invalid learner progress');
      const record = {
        version: VERSION,
        generation: crypto.randomUUID(),
        anchor: { p: before.legacyP, r: before.legacyR },
        primaryRaw: next.primaryRaw,
        tracks: next.tracks,
      };
      const nextRaw = JSON.stringify({ ...record, sha256: await digest(JSON.stringify(record)) });
      await preflight.check();
      await legacyFence(before.legacyP, before.legacyR);
      if (!isCurrent()) throw new Error('Operation no longer current');
      if (!sameCapture(before, capture())) throw new Error('Snapshot changed or held');
      // The integrity check, generation and both logical records commit together.
      store.setItem(AUTHORITY, nextRaw);
      return record.generation;
    });
  }

  const catalogueState = raw => backup.stateIdentity(json(raw));

  async function makePortable(primaryRaw, tracks) {
    const planner = await backup.exportLegacy(primaryRaw);
    const body = makeBody(primaryRaw, planner, tracks);
    return JSON.stringify({ ...body, sha256: await digest(JSON.stringify(body)) });
  }

  async function exportPortable(before) {
    const view = await requireCurrent(before);
    const text = await makePortable(view.primaryRaw, view.tracks);
    await requireCurrent(before);
    return text;
  }

  async function parsePortable(text) {
    const value = json(text);
    if (value?.format !== FORMAT) {
      const primaryRaw = await backup.importLegacy(text);
      requirePrimary(primaryRaw);
      return { primaryRaw, tracks: [], legacyFile: true };
    }
    if (!exactShape(value, 'format,planner,primaryRaw,sha256,tracks,version')
      || value.version !== VERSION || !validTracks(value.tracks)) throw new Error('Invalid portable format');
    requirePrimary(value.primaryRaw);
    const body = makeBody(value.primaryRaw, value.planner, value.tracks);
    if (value.sha256 !== await digest(JSON.stringify(body))) throw new Error('Invalid portable digest');
    const plannerRaw = await backup.importLegacy(JSON.stringify(value.planner));
    if (catalogueState(plannerRaw) !== catalogueState(value.primaryRaw)) throw new Error('Planner contents disagree');
    return { primaryRaw: value.primaryRaw, tracks: value.tracks, legacyFile: false };
  }

  async function prepareRestore(source, before) {
    const selection = {};
    activeRestore = { selection };
    const text = typeof source === 'string' ? source : new TextDecoder('utf-8', { fatal: true }).decode(source);
    const [next, sourceHash] = await Promise.all([parsePortable(text), digest(source)]);
    const view = await requireCurrent(before);
    if (activeRestore?.selection !== selection) throw new Error('Restore selection expired');
    if (next.legacyFile && view.tracks.length) throw new Error('Legacy backup cannot replace saved learner progress');
    const receipt = Object.freeze({
      protectionText: JSON.stringify({ format: PROTECTION, version: VERSION, ...view.capture }),
    });
    const protectionHash = await digest(receipt.protectionText);
    if (activeRestore?.selection !== selection) throw new Error('Restore selection expired');
    activeRestore = {
      selection, receipt, next, before: view.capture, generation: view.generation,
      sourceHash, protectionHash, issuedAt: Date.now(), verified: false, proofRevision: 0,
    };
    return receipt;
  }

  function isActiveReceipt(intent) {
    const age = Date.now() - intent?.issuedAt;
    return activeRestore === intent && age >= 0 && age < RECEIPT_LIFETIME_MS;
  }

  async function exportRestoreProtection(receipt, source, isCurrent, deliver) {
    const intent = activeRestore;
    if (!intent || intent.receipt !== receipt) throw new Error('Restore selection expired');
    const checkIntent = () => {
      if (!isActiveReceipt(intent) || !isCurrent()) throw new Error('Restore selection expired');
    };
    checkIntent();
    return withLock(async () => {
      checkIntent();
      const [sourceHash, protectionHash] = await Promise.all([digest(source), digest(receipt.protectionText)]);
      if (intent.sourceHash !== sourceHash || intent.protectionHash !== protectionHash) {
        throw new Error('Restore protection source changed');
      }
      checkIntent();
      const current = await requireCurrent(intent.before);
      await preflight.check();
      checkIntent();
      if (current.generation !== intent.generation || !sameCapture(intent.before, capture())) {
        throw new Error('Snapshot changed or held');
      }
      checkIntent();
      // Hand off the original captured bytes in the same turn, while still holding the lock.
      deliver(receipt.protectionText);
    });
  }

  async function verifyProtection(receipt, bytes) {
    const intent = activeRestore;
    if (!intent || intent.receipt !== receipt || !isActiveReceipt(intent)) throw new Error('Restore selection expired');
    intent.verified = false;
    const revision = ++intent.proofRevision;
    await requireCurrent(intent.before);
    if (!isActiveReceipt(intent) || intent.proofRevision !== revision) throw new Error('Restore selection expired');
    if (!sameBytes(receipt.protectionText, bytes)) throw new Error('Protection bytes do not match');
    intent.verified = true;
  }

  async function restore(receipt, isCurrent) {
    const intent = activeRestore;
    if (!intent || intent.receipt !== receipt || !intent.verified) throw new Error('Protection not verified');
    if (!isActiveReceipt(intent)) throw new Error('Restore selection expired');
    try {
      return await commit(intent.before, () => intent.next,
        () => isActiveReceipt(intent) && intent.verified && isCurrent());
    } finally {
      if (activeRestore === intent) activeRestore = undefined;
    }
  }

  return {
    read, exportPortable, prepareRestore, exportRestoreProtection, verifyProtection, restore,
    cancelRestore() { activeRestore = undefined; },
    upsertTrack(before, track, mode, isCurrent) {
      if (!validTrack(track) || !['create', 'edit'].includes(mode)) throw new Error('Invalid learner progress edit');
      const input = structuredClone(track);
      return commit(before, view => {
        const otherTracks = view.tracks.filter(previous => previous.id !== input.id);
        const exists = otherTracks.length !== view.tracks.length;
        if (exists !== (mode === 'edit')) throw new Error('Learner progress ownership mismatch');
        return { primaryRaw: view.primaryRaw, tracks: [...otherTracks, input] };
      }, isCurrent);
    },
    // Explicit raw protection. The current document must still pass isolation checks.
    async exportQuarantine() {
      await preflight.check();
      const before = capture();
      return JSON.stringify({ format: PROTECTION, version: VERSION, ...before });
    },
  };
}
