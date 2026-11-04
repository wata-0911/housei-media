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
