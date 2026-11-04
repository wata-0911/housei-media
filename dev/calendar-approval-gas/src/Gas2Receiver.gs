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
