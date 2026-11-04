/** Shared by GAS1 and GAS2. Draft only. No credentials or deployment IDs belong here. */
var CalendarDraftSync = (function () {
  'use strict';
  var MAX_BYTES = 2621440;
  var ACTION = 'sync_current_draft_v1';
  function fail(code) { var e = new Error(code); e.syncCode = code; throw e; }
  function props() { return PropertiesService.getScriptProperties(); }
  function setting(name) { var value = props().getProperty(name); if (!value) fail('CONFIGURATION_ERROR'); return value; }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(value); }
  function month(value) { return typeof value === 'string' && /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(value); }
  function iso(value) {
    return typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value) &&
      !isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
  }
  function revision(value) { return typeof value === 'string' && /^[1-9][0-9]{0,29}$/.test(value); }
  function compare(a, b) { return a.length === b.length ? (a === b ? 0 : a > b ? 1 : -1) : a.length > b.length ? 1 : -1; }
  function next(previous) {
    var seed = String(Date.now()) + '000000';
    if (!previous || compare(seed, previous) > 0) return seed;
    var digits = previous.split(''), i = digits.length - 1;
    while (i >= 0 && digits[i] === '9') { digits[i] = '0'; i--; }
    if (i < 0) digits.unshift('1'); else digits[i] = String(Number(digits[i]) + 1);
    var result = digits.join(''); if (!revision(result)) fail('REVISION_EXHAUSTED'); return result;
  }
  function metadata(value) {
    if (!object(value) || !month(value.yearMonth) || !id(value.fileId) || !iso(value.generatedAt) ||
        Date.parse(value.generatedAt) > Date.now() + 300000 || !revision(value.revision) ||
        typeof value.draftId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.draftId)) fail('INVALID_METADATA');
    return { yearMonth: value.yearMonth, fileId: value.fileId, generatedAt: value.generatedAt, revision: value.revision, draftId: value.draftId };
  }
  function same(a, b) { return a.yearMonth === b.yearMonth && a.fileId === b.fileId && a.generatedAt === b.generatedAt && a.revision === b.revision && a.draftId === b.draftId; }
  function locked(work) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) fail('BUSY');
    try { return work(); } finally { lock.releaseLock(); }
  }
  function readState(key) {
    var raw = props().getProperty(key); if (raw === null) return null;
    try { var value = JSON.parse(raw); if (value === null) fail('STATE_CORRUPT'); return value; } catch (_) { fail('STATE_CORRUPT'); }
  }
  function writeState(key, state) {
    var encoded = JSON.stringify(state);
    try { props().setProperty(key, encoded); }
    catch (_) {
      // A failed request can have committed. Confirm the exact one-property snapshot before acknowledging.
      try { if (props().getProperty(key) === encoded) return; } catch (ignored) {}
      fail('STATE_WRITE_FAILED');
    }
  }
  function secrets() {
    var write = setting('CALENDAR_DRAFT_SYNC_WRITE_SECRET');
    var read = setting('CALENDAR_DRAFT_BRIDGE_SECRET');
    if (write.length < 32 || write.length > 1024 || write === read) fail('CONFIGURATION_ERROR');
    return { write: write, read: read };
  }
  function equalSecret(a, b) {
    if (typeof a !== 'string' || a.length > 1024) return false;
    var diff = a.length ^ b.length;
    for (var i = 0; i < b.length; i++) diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ b.charCodeAt(i);
    return diff === 0;
  }
  function file(fileId, folderId, generatedAt) {
    if (!id(fileId) || !id(folderId)) fail('INVALID_FILE');
    var f, blob, bytes;
    try {
      f = DriveApp.getFileById(fileId);
      if (f.isTrashed() || f.getMimeType() !== 'image/png' || f.getSize() < 33 || f.getSize() > MAX_BYTES) fail('INVALID_FILE');
      var parents = f.getParents(), found = false;
      while (parents.hasNext()) { if (parents.next().getId() === folderId) found = true; }
      if (!found) fail('INVALID_FOLDER');
      if (generatedAt && f.getDateCreated().toISOString() !== generatedAt) fail('INVALID_GENERATED_AT');
      blob = f.getBlob(); bytes = blob.getBytes();
    } catch (e) { if (e.syncCode) throw e; fail('FILE_UNAVAILABLE'); }
    png(bytes);
    return { file: f, blob: blob, bytes: bytes };
  }
  function png(bytes) {
    var sig = [137,80,78,71,13,10,26,10];
    if (!bytes || bytes.length < 45 || bytes.length > MAX_BYTES) fail('INVALID_PNG');
    for (var i = 0; i < sig.length; i++) if ((bytes[i] & 255) !== sig[i]) fail('INVALID_PNG');
    function u32(at) { return ((bytes[at] & 255) * 16777216) + ((bytes[at+1] & 255) << 16) + ((bytes[at+2] & 255) << 8) + (bytes[at+3] & 255); }
    var at = 8, first = true, data = false, ended = false, palette = false, dataEnded = false, dataBytes = 0;
    while (at + 12 <= bytes.length) {
      var len = u32(at), type = String.fromCharCode(bytes[at+4]&255, bytes[at+5]&255, bytes[at+6]&255, bytes[at+7]&255);
      if (len > MAX_BYTES || at + 12 + len > bytes.length || !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) fail('INVALID_PNG');
      if (/^[A-Z]/.test(type) && ['IHDR','PLTE','IDAT','IEND'].indexOf(type) < 0) fail('INVALID_PNG');
      if (first) {
        if (type !== 'IHDR' || len !== 13 || !u32(at+8) || !u32(at+12) || u32(at+8) > 2147483647 || u32(at+12) > 2147483647) fail('INVALID_PNG');
        var depth = bytes[at+16]&255, color = bytes[at+17]&255;
        var depths = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
        if (!depths[color] || depths[color].indexOf(depth) < 0 || (bytes[at+18]&255) !== 0 || (bytes[at+19]&255) !== 0 || (bytes[at+20]&255) > 1) fail('INVALID_PNG');
        first = false;
      }
      else if (type === 'IHDR') fail('INVALID_PNG');
      var crc = -1;
      for (var n = at + 4; n < at + 8 + len; n++) {
        crc ^= bytes[n] & 255;
        for (var bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
      }
      if (((crc ^ -1) >>> 0) !== u32(at+8+len)) fail('INVALID_PNG');
      if (type === 'PLTE') {
        if (palette || data || color === 0 || color === 4 || len === 0 || len > 768 || len % 3 !== 0 || (color === 3 && len / 3 > Math.pow(2, depth))) fail('INVALID_PNG');
        palette = true;
      }
      if (type === 'IDAT') {
        if (dataEnded || (color === 3 && !palette)) fail('INVALID_PNG');
        data = true; dataBytes += len;
      } else if (data) dataEnded = true;
      at += 12 + len;
      if (type === 'IEND') { if (len !== 0 || !data || dataBytes === 0 || at !== bytes.length) fail('INVALID_PNG'); ended = true; break; }
    }
    if (!ended) fail('INVALID_PNG');
  }
  function response(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
  function errorCode(error) { return error && error.syncCode ? error.syncCode : 'INTERNAL_ERROR'; }
  return { ACTION: ACTION, MAX_BYTES: MAX_BYTES, props: props, setting: setting, object: object, id: id, month: month, iso: iso,
    revision: revision, compare: compare, next: next, metadata: metadata, same: same, locked: locked, readState: readState,
    writeState: writeState, secrets: secrets, equalSecret: equalSecret, file: file, png: png, response: response, errorCode: errorCode, fail: fail };
})();


/** GAS2 only. Integrate dispatch with the recovered read handler; not a deployment-ready whole project. */
var CalendarDraftReceiver = (function () {
  'use strict';
  var KEY = 'CALENDAR_DRAFT_SYNC_CURRENT_V1';
  function current() {
    var state = CalendarDraftSync.readState(KEY);
    if (state === null) return null;
    if (state.schemaVersion === 3) { state = CalendarDraftReservation.envelope().current; if (state === null) return null; }
    return validateCurrent(state);
  }
  function validateCurrent(state) {
    if (!CalendarDraftSync.object(state) || [1,2].indexOf(state.schemaVersion) < 0) CalendarDraftSync.fail('STATE_CORRUPT');
    CalendarDraftSync.metadata(state);
    if (state.schemaVersion === 1) {
      if (state.status !== 'draft_ready' || state.approval !== undefined) CalendarDraftSync.fail('STATE_CORRUPT');
    } else {
      if ((typeof state.imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(state.imageSha256)) || ['draft_ready','approved'].indexOf(state.status) < 0) CalendarDraftSync.fail('STATE_CORRUPT');
      if (state.status === 'draft_ready' && state.approval !== undefined) CalendarDraftSync.fail('STATE_CORRUPT');
      if (state.status === 'approved') {
        var a = state.approval;
        if (!CalendarDraftSync.object(a) || (typeof a.userId !== 'string' || !/^U[0-9a-f]{32}$/.test(a.userId)) || !CalendarDraftSync.iso(a.approvedAt) ||
            a.approvedAt < state.generatedAt || Date.parse(a.approvedAt) > Date.now() + 300000 ||
            a.draftId !== state.draftId || a.revision !== state.revision || a.imageSha256 !== state.imageSha256 || a.yearMonth !== state.yearMonth || a.fileId !== state.fileId || a.generatedAt !== state.generatedAt) CalendarDraftSync.fail('STATE_CORRUPT');
      }
    }
    return state;
  }
  function legacyTimestamp() {
    // A valid legacy image must not be replaced by an older first notification.
    var p = CalendarDraftSync.props();
    if (!p.getProperty('draft_file_id') && p.getProperty('draft_status') !== 'draft_ready') return null;
    var raw = p.getProperty('draft_generated_at');
    if (!CalendarDraftSync.iso(raw)) CalendarDraftSync.fail('LEGACY_TIMESTAMP_REQUIRES_REVIEW');
    return raw;
  }
  function update(request) {
    if (CalendarDraftReservation.enabled() || (CalendarDraftSync.readState(KEY) || {}).schemaVersion === 3) CalendarDraftSync.fail('RESERVATION_REQUIRED');
    var config = CalendarDraftSync.secrets();
    if (!CalendarDraftSync.object(request) || !CalendarDraftSync.equalSecret(request.secret, config.write)) CalendarDraftSync.fail('UNAUTHORIZED');
    if (request.action !== CalendarDraftSync.ACTION) CalendarDraftSync.fail('INVALID_ACTION');
    var incoming = CalendarDraftSync.metadata(request);
    return CalendarDraftSync.locked(function () {
      if (CalendarDraftReservation.enabled() || (CalendarDraftSync.readState(KEY) || {}).schemaVersion === 3) CalendarDraftSync.fail('RESERVATION_REQUIRED');
      var old = current();
      if (old) {
        var order = CalendarDraftSync.compare(incoming.revision, old.revision);
        if (order < 0) CalendarDraftSync.fail('STALE_REVISION');
        if (order === 0) {
          if (!CalendarDraftSync.same(old, incoming)) CalendarDraftSync.fail('REVISION_CONFLICT');
          checkedImage(old);
          return { ok: true, synced: true, code: 'ALREADY_SYNCED', revision: old.revision, draftId: old.draftId, fileId: old.fileId, yearMonth: old.yearMonth, generatedAt: old.generatedAt };
        }
        if (incoming.draftId === old.draftId) CalendarDraftSync.fail('DRAFT_ID_CONFLICT');
        if (incoming.generatedAt < old.generatedAt) CalendarDraftSync.fail('STALE_GENERATED_AT');
      } else {
        var legacy = legacyTimestamp();
        // Equal timestamps lack legacy identity/revision, so require an explicit migration review.
        if (legacy && incoming.generatedAt <= legacy) CalendarDraftSync.fail('LEGACY_DRAFT_REQUIRES_REVIEW');
      }
      var checked = CalendarDraftSync.file(incoming.fileId, CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID'), incoming.generatedAt);
      var snapshot = { schemaVersion: 2, status: 'draft_ready', yearMonth: incoming.yearMonth, fileId: incoming.fileId,
        generatedAt: incoming.generatedAt, revision: incoming.revision, draftId: incoming.draftId, imageSha256: digest(checked.bytes) };
      CalendarDraftSync.writeState(KEY, snapshot);
      return { ok: true, synced: true, code: 'SYNCED', revision: incoming.revision, draftId: incoming.draftId, fileId: incoming.fileId, yearMonth: incoming.yearMonth, generatedAt: incoming.generatedAt };
    });
  }
  function handleUpdate(e) {
    try {
      if (!e || !e.postData || typeof e.postData.contents !== 'string' || e.postData.contents.length > 4096) CalendarDraftSync.fail('INVALID_REQUEST');
      var request; try { request = JSON.parse(e.postData.contents); } catch (_) { CalendarDraftSync.fail('INVALID_JSON'); }
      return CalendarDraftSync.response(update(request));
    } catch (error) { return CalendarDraftSync.response({ ok: false, synced: false, code: CalendarDraftSync.errorCode(error) }); }
  }
  function digest(bytes) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  }
  function checkedImage(state) {
    var checked = CalendarDraftSync.file(state.fileId, CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID'), state.generatedAt);
    if (state.schemaVersion === 2 && digest(checked.bytes) !== state.imageSha256) CalendarDraftSync.fail('IMAGE_CHANGED');
    return checked;
  }
  /** Call only after read authentication. Never fall back on corrupt canonical state. */
  function readCurrentImage(includeBinding) {
    return CalendarDraftSync.locked(function () {
      var state = current(); if (state === null) return null;
      var checked = checkedImage(state);
      var result = { ok: true, yearMonth: state.yearMonth, generatedAt: state.generatedAt, mimeType: 'image/png', imageBase64: Utilities.base64Encode(checked.bytes) };
      if (includeBinding && state.schemaVersion === 2 && CalendarDraftReservation.enabled() && CalendarDraftReservation.envelope().approvalsEnabled) {
        CalendarDraftReservation.assertApprovalsSafe();
        result.schemaVersion = 2; result.fileId = state.fileId; result.draftId = state.draftId;
        result.revision = state.revision; result.imageSha256 = state.imageSha256; result.status = state.status;
      }
      return result;
    });
  }
  function approvalConfig() {
    var secret = CalendarDraftSync.setting('CALENDAR_DRAFT_APPROVAL_SECRET');
    var config = CalendarDraftSync.secrets();
    if (secret.length < 32 || secret.length > 1024 || secret === config.write || secret === config.read) CalendarDraftSync.fail('CONFIGURATION_ERROR');
    return secret;
  }
  function approve(request) {
    if (!CalendarDraftSync.object(request) || !CalendarDraftSync.equalSecret(request.secret, approvalConfig())) CalendarDraftSync.fail('UNAUTHORIZED');
    if (request.action !== 'approve_current_draft_v1') CalendarDraftSync.fail('INVALID_ACTION');
    if (!CalendarDraftSync.object(request.actor) || (typeof request.actor.userId !== 'string' || !/^U[0-9a-f]{32}$/.test(request.actor.userId))) CalendarDraftSync.fail('INVALID_ACTOR');
    var target = CalendarDraftSync.metadata(request.target);
    if ((typeof request.target.imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(request.target.imageSha256))) CalendarDraftSync.fail('INVALID_METADATA');
    return CalendarDraftSync.locked(function () {
      CalendarDraftReservation.assertApprovalsSafe();
      if (CalendarDraftReservation.enabled() && CalendarDraftReservation.envelope().pending) CalendarDraftSync.fail('SAVE_PENDING');
      var state = current();
      if (!state || !CalendarDraftSync.same(state, target)) CalendarDraftSync.fail('STALE_DRAFT');
      if (state.schemaVersion !== 2) CalendarDraftSync.fail('MIGRATION_REQUIRED');
      if (state.imageSha256 !== request.target.imageSha256) CalendarDraftSync.fail('STALE_DRAFT');
      checkedImage(state);
      var code;
      if (state.status === 'approved') code = state.approval.userId === request.actor.userId ? 'ALREADY_APPROVED' : 'ALREADY_APPROVED_BY_OTHER';
      else {
        if (Date.now() < Date.parse(state.generatedAt)) CalendarDraftSync.fail('CLOCK_SKEW');
        state.status = 'approved';
        state.approval = { userId: request.actor.userId, approvedAt: new Date().toISOString(), draftId: state.draftId, revision: state.revision, imageSha256: state.imageSha256, yearMonth: state.yearMonth, fileId: state.fileId, generatedAt: state.generatedAt };
        CalendarDraftReservation.writeApproved(state);
        code = 'APPROVED';
      }
      return { ok: true, code: code, status: 'approved', yearMonth: state.yearMonth, fileId: state.fileId, generatedAt: state.generatedAt,
        draftId: state.draftId, revision: state.revision, imageSha256: state.imageSha256, approvedAt: state.approval.approvedAt };
    });
  }
  function handleApproval(e) {
    try {
      if (!e || !e.postData || typeof e.postData.contents !== 'string' || e.postData.contents.length > 4096) CalendarDraftSync.fail('INVALID_REQUEST');
      var request; try { request = JSON.parse(e.postData.contents); } catch (_) { CalendarDraftSync.fail('INVALID_JSON'); }
      return CalendarDraftSync.response(approve(request));
    } catch (error) { return CalendarDraftSync.response({ ok: false, code: CalendarDraftSync.errorCode(error) }); }
  }
  /** Owner-only explicit migration, not a network route; must review the exact old identity first. Does not approve. */
  function migrateReviewedCurrent(target, confirmation) {
    if (confirmation !== 'MIGRATE_REVIEWED_DRAFT_WITHOUT_APPROVAL') CalendarDraftSync.fail('MIGRATION_REQUIRES_REVIEW');
    CalendarDraftSync.metadata(target);
    return CalendarDraftSync.locked(function () {
      if (CalendarDraftReservation.enabled() && CalendarDraftReservation.envelope().pending) CalendarDraftSync.fail('SAVE_PENDING');
      var state = current();
      if (!state || !CalendarDraftSync.same(state, target)) CalendarDraftSync.fail('STALE_DRAFT');
      if (state.schemaVersion === 2) { checkedImage(state); return { migrated: false, status: state.status }; }
      var checked = checkedImage(state);
      state.schemaVersion = 2; state.imageSha256 = digest(checked.bytes);
      if (CalendarDraftReservation.enabled()) { var authority=CalendarDraftReservation.envelope(); authority.approvalsEnabled=false; authority.current=state; CalendarDraftSync.writeState(KEY,authority); }
      else CalendarDraftSync.writeState(KEY, state);
      return { migrated: true, status: 'draft_ready' };
    });
  }
  return { update: update, handleUpdate: handleUpdate, current: current, readCurrentImage: readCurrentImage,
    validateCurrent: validateCurrent, checkedImage: checkedImage, approve: approve, handleApproval: handleApproval, migrateReviewedCurrent: migrateReviewedCurrent };
})();


/** GAS2 authority. One property atomically binds the current image and every save fence. */
var CalendarDraftReservation = (function () {
  'use strict';
  var KEY = 'CALENDAR_DRAFT_SYNC_CURRENT_V1', MODE = 'reserve-before-save-v1';
  function enabled() { return CalendarDraftSync.props().getProperty('CALENDAR_DRAFT_RESERVATION_PROTOCOL') === MODE; }
  function hash(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Array.isArray(value) || typeof value === 'string' ? value : JSON.stringify(value)).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
  function sha(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
  function uuid(value) { return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value); }
  function validPending(p) {
    return CalendarDraftSync.object(p) && uuid(p.operationId) && uuid(p.draftId) && CalendarDraftSync.revision(p.revision) &&
      CalendarDraftSync.month(p.yearMonth) && sha(p.imageSha256) && sha(p.expectedVersion) && CalendarDraftSync.iso(p.reservedAt) &&
      CalendarDraftSync.iso(p.expiresAt) && Date.parse(p.expiresAt) === Date.parse(p.reservedAt) + 900000;
  }
  function envelope() {
    var a = CalendarDraftSync.readState(KEY);
    if (!enabled() || !CalendarDraftSync.object(a) || a.schemaVersion !== 3) CalendarDraftSync.fail('RESERVATION_ROLLOUT_REQUIRED');
    if (typeof a.approvalsEnabled !== 'boolean' || !CalendarDraftSync.revision(a.generation) || !(a.current === null || CalendarDraftSync.object(a.current)) ||
      !(a.pending === null || validPending(a.pending)) || !(a.lastOperation === null || CalendarDraftSync.object(a.lastOperation))) CalendarDraftSync.fail('STATE_CORRUPT');
    if (a.current !== null) {
      CalendarDraftReceiver.validateCurrent(a.current);
      if (a.current.operationId!==undefined || a.current.commitReservation!==undefined) { var receipt=a.current.commitReservation; if(!validPending(receipt)||receipt.operationId!==a.current.operationId||receipt.revision!==a.current.revision||receipt.draftId!==a.current.draftId||receipt.yearMonth!==a.current.yearMonth||receipt.imageSha256!==a.current.imageSha256)CalendarDraftSync.fail('STATE_CORRUPT'); }
    }
    if (a.lastOperation !== null && (!validPending(a.lastOperation.reservation) || ['committed','abandoned'].indexOf(a.lastOperation.outcome) < 0)) CalendarDraftSync.fail('STATE_CORRUPT');
    if (a.current && CalendarDraftSync.compare(a.generation,a.current.revision)<0) CalendarDraftSync.fail('STATE_CORRUPT');
    if (a.pending && (a.pending.revision!==a.generation || a.current && CalendarDraftSync.compare(a.pending.revision,a.current.revision)<=0)) CalendarDraftSync.fail('STATE_CORRUPT');
    if (a.lastOperation && a.lastOperation.outcome==='committed' && (!a.current || a.current.operationId!==a.lastOperation.reservation.operationId || a.current.revision!==a.lastOperation.reservation.revision || a.current.draftId!==a.lastOperation.reservation.draftId || a.current.yearMonth!==a.lastOperation.reservation.yearMonth || a.current.imageSha256!==a.lastOperation.reservation.imageSha256 || JSON.stringify(a.current.commitReservation)!==JSON.stringify(a.lastOperation.reservation))) CalendarDraftSync.fail('STATE_CORRUPT');
    return a;
  }
  function version(a) { return hash({ generation: a.generation, approvalsEnabled:a.approvalsEnabled, current: a.current, lastOperation: a.lastOperation }); }
  function inspect() { var a = envelope(); return { ok: true, protocol: MODE, expectedVersion: version(a), pending: a.pending, current: a.current, lastOperation:a.lastOperation }; }
  function sameIntent(p, r) { return p.operationId === r.operationId && p.expectedVersion === r.expectedVersion && p.yearMonth === r.yearMonth && p.imageSha256 === r.imageSha256; }
  function ack(p) { return { ok: true, protocol: MODE, code: 'RESERVED', reservation: p }; }
  function reserve(r) {
    var a = envelope();
    if (!uuid(r.operationId) || !sha(r.expectedVersion) || !CalendarDraftSync.month(r.yearMonth) || !sha(r.imageSha256)) CalendarDraftSync.fail('INVALID_RESERVATION');
    if (a.pending) {
      if (!sameIntent(a.pending, r)) CalendarDraftSync.fail('SAVE_PENDING');
      if (Date.now() >= Date.parse(a.pending.expiresAt)) CalendarDraftSync.fail('RESERVATION_EXPIRED_RECOVERY_REQUIRED');
      return ack(a.pending);
    }
    if (a.lastOperation && a.lastOperation.reservation.operationId === r.operationId) CalendarDraftSync.fail('OPERATION_TERMINAL');
    if (r.expectedVersion !== version(a)) CalendarDraftSync.fail('BASE_CHANGED');
    var now = new Date().toISOString();
    a.generation = CalendarDraftSync.next(a.generation);
    a.pending = { operationId: r.operationId, expectedVersion: r.expectedVersion, yearMonth: r.yearMonth, imageSha256: r.imageSha256,
      revision: a.generation, draftId: Utilities.getUuid(), reservedAt: now, expiresAt: new Date(Date.parse(now) + 900000).toISOString() };
    CalendarDraftSync.writeState(KEY, a); return ack(a.pending);
  }
  function commit(r, recovery) {
    var a = envelope(), incoming = CalendarDraftSync.metadata(r), p = a.pending;
    if (!validPending(r.reservation) || r.operationId !== r.reservation.operationId) CalendarDraftSync.fail('INVALID_RESERVATION');
    if (!p) {
      if (!a.current || JSON.stringify(a.current.commitReservation) !== JSON.stringify(r.reservation) ||
        a.current.operationId !== r.operationId || !CalendarDraftSync.same(a.current, incoming) || a.current.imageSha256 !== r.reservation.imageSha256) CalendarDraftSync.fail('RESERVATION_MISMATCH');
      CalendarDraftReceiver.checkedImage(a.current);
      return { ok: true, protocol: MODE, synced: true, code: 'ALREADY_SYNCED', operationId: r.operationId, reservation: r.reservation, current: a.current };
    }
    if (JSON.stringify(p) !== JSON.stringify(r.reservation) || p.operationId !== r.operationId || incoming.yearMonth !== p.yearMonth || incoming.revision !== p.revision || incoming.draftId !== p.draftId) CalendarDraftSync.fail('RESERVATION_MISMATCH');
    if (!recovery && Date.now() >= Date.parse(p.expiresAt)) CalendarDraftSync.fail('RESERVATION_EXPIRED_RECOVERY_REQUIRED');
    var checked = CalendarDraftSync.file(incoming.fileId, CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID'), incoming.generatedAt);
    if (hash(checked.bytes) !== p.imageSha256) CalendarDraftSync.fail('IMAGE_CHANGED');
    if (Date.parse(incoming.generatedAt) < Date.parse(p.reservedAt) - 300000) CalendarDraftSync.fail('INVALID_GENERATED_AT');
    a.current = { schemaVersion: 2, status: 'draft_ready', yearMonth: incoming.yearMonth, fileId: incoming.fileId, generatedAt: incoming.generatedAt,
      revision: p.revision, draftId: p.draftId, imageSha256: p.imageSha256, operationId: p.operationId, commitReservation:p };
    a.lastOperation = { reservation: p, outcome: 'committed' }; a.pending = null; a.generation = CalendarDraftSync.next(a.generation);
    CalendarDraftSync.writeState(KEY, a);
    return { ok: true, protocol: MODE, synced: true, code: 'SYNCED', operationId: r.operationId, reservation: r.reservation, current: a.current };
  }
  function handle(e) {
    try {
      var r = JSON.parse(e.postData.contents), config = CalendarDraftSync.secrets();
      if (!CalendarDraftSync.equalSecret(r.secret, config.write)) CalendarDraftSync.fail('UNAUTHORIZED');
      return CalendarDraftSync.response(CalendarDraftSync.locked(function () {
        if (r.action === 'inspect_save_authority_v1') return inspect();
        if (r.action === 'reserve_draft_save_v1') return reserve(r);
        if (r.action === 'commit_reserved_draft_v1') return commit(r, false);
        CalendarDraftSync.fail('INVALID_ACTION');
      }));
    } catch (error) { return CalendarDraftSync.response({ok: false, code: CalendarDraftSync.errorCode(error)}); }
  }
  // Owner editor only, after quiescing every old/new GAS1 invocation and writer deployment.
  function enableReviewedAuthority(expectedRaw, confirmation) {
    if (confirmation !== 'ALL_WRITERS_QUIESCED_AND_LEGACY_PUBLISHERS_DISABLED') CalendarDraftSync.fail('ROLLOUT_REVIEW_REQUIRED');
    return CalendarDraftSync.locked(function () {
      if (CalendarDraftSync.props().getProperty(KEY) !== expectedRaw) CalendarDraftSync.fail('BASE_CHANGED');
      var old = CalendarDraftSync.readState(KEY); if (old && old.schemaVersion === 3) CalendarDraftSync.fail('ALREADY_INITIALIZED');
      if (old) CalendarDraftReceiver.validateCurrent(old);
      else { var legacy=CalendarDraftSync.props().getProperties(); if (Object.keys(legacy).some(function(k){return k.indexOf('draft_')===0 && legacy[k]!=='';})) CalendarDraftSync.fail('LEGACY_AUTHORITY_REQUIRES_REVIEW'); }
      CalendarDraftSync.writeState(KEY, {schemaVersion:3,approvalsEnabled:false,generation:CalendarDraftSync.next(old ? old.revision : null),current:old,pending:null,lastOperation:null});
      // Mode is set separately by owner only AFTER this initialization. Missing mode always denies approval.
      return {initialized:true,approvalEnabled:false};
    });
  }
  function recoverReviewedReservation(expectedReservation, saved, confirmation) {
    if (confirmation !== 'ALL_WRITERS_QUIESCED_AND_SAVE_OUTCOME_VERIFIED') CalendarDraftSync.fail('RECOVERY_REVIEW_REQUIRED');
    return CalendarDraftSync.locked(function () {
      var a = envelope(); a.approvalsEnabled=false; CalendarDraftSync.writeState(KEY,a); if (!a.pending || JSON.stringify(a.pending) !== JSON.stringify(expectedReservation)) CalendarDraftSync.fail('RESERVATION_MISMATCH');
      if (saved !== null) return commit(Object.assign({}, saved, {reservation:expectedReservation,operationId:expectedReservation.operationId}), true);
      a.lastOperation = {reservation:a.pending,outcome:'abandoned'}; a.pending=null; a.generation=CalendarDraftSync.next(a.generation);
      CalendarDraftSync.writeState(KEY,a); return {ok:true,code:'ABANDONED',approvalEnabled:false};
    });
  }
  function abandonReviewedIntent(intent, expectedCurrentVersion, confirmation) {
    if(confirmation!=='ALL_WRITERS_QUIESCED_AND_SAVE_OUTCOME_VERIFIED')CalendarDraftSync.fail('RECOVERY_REVIEW_REQUIRED');
    return CalendarDraftSync.locked(function(){
      var a=envelope();if(a.pending)CalendarDraftSync.fail('SAVE_PENDING');
      if(!CalendarDraftSync.object(intent)||!uuid(intent.operationId)||!sha(intent.expectedVersion)||!sha(intent.imageSha256)||!CalendarDraftSync.month(intent.yearMonth))CalendarDraftSync.fail('INVALID_RESERVATION');
      if(expectedCurrentVersion!==version(a))CalendarDraftSync.fail('BASE_CHANGED');
      if(a.current&&a.current.operationId===intent.operationId||a.lastOperation&&a.lastOperation.reservation.operationId===intent.operationId&&a.lastOperation.outcome==='committed')CalendarDraftSync.fail('OPERATION_TERMINAL');
      var now=new Date().toISOString(),revision=CalendarDraftSync.next(a.generation);
      var p={operationId:intent.operationId,expectedVersion:intent.expectedVersion,yearMonth:intent.yearMonth,imageSha256:intent.imageSha256,revision:revision,draftId:Utilities.getUuid(),reservedAt:now,expiresAt:new Date(Date.parse(now)+900000).toISOString()};
      a.approvalsEnabled=false;a.lastOperation={reservation:p,outcome:'abandoned'};a.generation=CalendarDraftSync.next(revision);CalendarDraftSync.writeState(KEY,a);return {ok:true,code:'ABANDONED',approvalsEnabled:false};
    });
  }
  function assertApprovalsSafe() { var a=envelope(); if(!a.approvalsEnabled) CalendarDraftSync.fail('APPROVAL_DISABLED'); if(a.pending) CalendarDraftSync.fail(Date.now() >= Date.parse(a.pending.expiresAt) ? 'RESERVATION_EXPIRED_RECOVERY_REQUIRED' : 'SAVE_PENDING'); return a; }
  function setApprovalEnabled(enabledValue, expectedVersion, confirmation) {
    if (typeof enabledValue!=='boolean' || confirmation!=='REVIEWED_APPROVAL_RUNTIME_GATE') CalendarDraftSync.fail('ROLLOUT_REVIEW_REQUIRED');
    return CalendarDraftSync.locked(function(){var a=envelope();if(expectedVersion!==version(a))CalendarDraftSync.fail('BASE_CHANGED');if(enabledValue&&a.pending)CalendarDraftSync.fail('SAVE_PENDING');a.approvalsEnabled=enabledValue;CalendarDraftSync.writeState(KEY,a);return {approvalsEnabled:a.approvalsEnabled};});
  }
  function writeApproved(state) { var a=envelope(); if(a.pending)CalendarDraftSync.fail('SAVE_PENDING'); a.current=state; CalendarDraftSync.writeState(KEY,a); }
  return { MODE:MODE, enabled:enabled, hash:hash, envelope:envelope, handle:handle, assertApprovalsSafe:assertApprovalsSafe,
    abandonReviewedIntent:abandonReviewedIntent, writeApproved:writeApproved, setApprovalEnabled:setApprovalEnabled, version:version, enableReviewedAuthority:enableReviewedAuthority, recoverReviewedReservation:recoverReviewedReservation };
})();


/** GAS2 only. Replaces supplied doPost; original read-only branch retained below. */
function doPost(e) {
  var request;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string' || e.postData.contents.length > 4096) throw new Error();
    request = JSON.parse(e.postData.contents);
  } catch (_) { return CalendarDraftSync.response({ok: false, error: 'invalid_request'}); }
  if (CalendarDraftSync.object(request) && ['inspect_save_authority_v1','reserve_draft_save_v1','commit_reserved_draft_v1'].indexOf(request.action) >= 0) return CalendarDraftReservation.handle(e);
  if (CalendarDraftSync.object(request) && request.action === CalendarDraftSync.ACTION) return CalendarDraftReceiver.handleUpdate(e);
  if (CalendarDraftSync.object(request) && request.action === 'approve_current_draft_v1') return CalendarDraftReceiver.handleApproval(e);
  return calendarDraftLegacyRead_(e);
}

function calendarDraftBridgeResponse_(data) {

  return ContentService

    .createTextOutput(JSON.stringify(data))

    .setMimeType(ContentService.MimeType.JSON);

}



function calendarDraftLegacyRead_(e) {

  let request;



  try {

    request = JSON.parse(e.postData.contents);

  } catch {

    return calendarDraftBridgeResponse_({

      ok: false,

      error: 'invalid_request',

    });

  }



  const props =

    PropertiesService.getScriptProperties().getProperties();



  const secret = props.CALENDAR_DRAFT_BRIDGE_SECRET;



  // 呼び出し元の認証

  if (

    !secret ||

    request?.secret !== secret ||

    request?.action !== 'get_current_draft'

  ) {

    return calendarDraftBridgeResponse_({

      ok: false,

      error: 'unauthorized',

    });

  }



  try {
    const canonical = CalendarDraftReceiver.readCurrentImage(request.includeApprovalBinding === true);
    if (canonical) return calendarDraftBridgeResponse_(canonical);
  } catch (_) {
    return calendarDraftBridgeResponse_({ok: false, error: 'storage_error'});
  }

  const yearMonth = props.draft_year_month;

  const fileId = props.draft_file_id;

  const status = props.draft_status;

  const generatedAt = props.draft_generated_at || '';



  // 下書きが存在しない場合

  if (

    status !== 'draft_ready' ||

    !fileId ||

    !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth || '')

  ) {

    return calendarDraftBridgeResponse_({

      ok: false,

      error: 'draft_not_ready',

    });

  }



  try {

    const file = DriveApp.getFileById(fileId);



    if (file.getMimeType() !== 'image/png') {

      return calendarDraftBridgeResponse_({

        ok: false,

        error: 'invalid_file_type',

      });

    }



    // Vercelへの転送サイズを制限

    const MAX_BYTES = 2.5 * 1024 * 1024;



    if (file.getSize() > MAX_BYTES) {

      return calendarDraftBridgeResponse_({

        ok: false,

        error: 'file_too_large',

      });

    }



    const bytes = file.getBlob().getBytes();



    if (bytes.length > MAX_BYTES) {

      return calendarDraftBridgeResponse_({

        ok: false,

        error: 'file_too_large',

      });

    }



    return calendarDraftBridgeResponse_({

      ok: true,

      yearMonth,

      generatedAt,

      mimeType: 'image/png',

      imageBase64: Utilities.base64Encode(bytes),

    });



  } catch {

    return calendarDraftBridgeResponse_({

      ok: false,

      error: 'storage_error',

    });

  }

}
