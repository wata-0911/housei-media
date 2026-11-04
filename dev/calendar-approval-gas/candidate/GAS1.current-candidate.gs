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


/** GAS1 only. Invoke recordSavedDraft AFTER saveDraftToDrive has actually completed successfully. */
var CalendarDraftSender = (function () {
  'use strict';
  var KEY = 'CALENDAR_DRAFT_SYNC_OUTBOX_V1';
  function state() {
    var value = CalendarDraftSync.readState(KEY); if (value === null) return null;
    if (!CalendarDraftSync.object(value) || value.schemaVersion !== 1 || !CalendarDraftSync.revision(value.lastRevision) || !CalendarDraftSync.object(value.latest)) CalendarDraftSync.fail('STATE_CORRUPT');
    var latest = value.latest; CalendarDraftSync.metadata(latest);
    if (latest.revision !== value.lastRevision || ['pending','synced','blocked'].indexOf(latest.syncStatus) < 0) CalendarDraftSync.fail('STATE_CORRUPT');
    return value;
  }
  function status(value, code) {
    return { saved: true, synced: value.latest.syncStatus === 'synced', queued: true, syncStatus: value.latest.syncStatus,
      revision: value.latest.revision, draftId: value.latest.draftId, code: code };
  }
  function requireCurrentDraft(meta) {
    var pointer = CalendarDraftSync.props().getProperties();
    if (pointer.draft_file_id !== meta.fileId || pointer.draft_year_month !== meta.yearMonth) CalendarDraftSync.fail('CURRENT_DRAFT_CHANGED');
  }
  function prepare(yearMonth, fileId) {
    if (!CalendarDraftSync.month(yearMonth)) CalendarDraftSync.fail('INVALID_METADATA');
    var checked = CalendarDraftSync.file(fileId, CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID'));
    var generatedAt = checked.file.getDateCreated().toISOString();
    if (!CalendarDraftSync.iso(generatedAt) || Date.parse(generatedAt) > Date.now() + 300000) CalendarDraftSync.fail('INVALID_METADATA');
    return { yearMonth: yearMonth, fileId: fileId, generatedAt: generatedAt };
  }
  // Private: only called while this project ScriptLock is held.
  function queuePrepared(meta) {
    var old = state();
    if (old && meta.generatedAt < old.latest.generatedAt) CalendarDraftSync.fail('SAVED_DRAFT_SUPERSEDED');
    if (old && meta.generatedAt === old.latest.generatedAt && meta.fileId !== old.latest.fileId) CalendarDraftSync.fail('TIMESTAMP_COLLISION');
    requireCurrentDraft(meta);
    if (old && meta.fileId === old.latest.fileId) {
      if (meta.yearMonth !== old.latest.yearMonth || meta.generatedAt !== old.latest.generatedAt) CalendarDraftSync.fail('FILE_ID_CONFLICT');
      return old;
    }
    var rev = CalendarDraftSync.next(old ? old.lastRevision : null);
    var latest = { yearMonth: meta.yearMonth, fileId: meta.fileId, generatedAt: meta.generatedAt, revision: rev,
      draftId: Utilities.getUuid(), syncStatus: 'pending' };
    var value = { schemaVersion: 1, lastRevision: rev, latest: latest };
    CalendarDraftSync.writeState(KEY, value); return value;
  }
  function failedRecord(error) { return { saved: true, synced: false, queued: false, code: CalendarDraftSync.errorCode(error) }; }
  function recordSavedDraft(yearMonth, fileId) {
    try {
      var meta = prepare(yearMonth, fileId);
      return CalendarDraftSync.locked(function () { return status(queuePrepared(meta), 'SAVED'); });
    } catch (error) { return failedRecord(error); }
  }
  function saveAndRecord(saveFunction) {
    return CalendarDraftSync.locked(function () {
      // Preserve the supplied source save body and its legacy approval-reset semantics.
      var saved = saveFunction(); // A thrown/uncertain original save never starts synchronization.
      var recorded;
      try {
        if (!saved || saved.ok !== true || saved.status !== 'draft_ready') CalendarDraftSync.fail('SAVE_NOT_CONFIRMED');
        recorded = status(queuePrepared(prepare(saved.yearMonth, saved.fileId)), 'SAVED');
      } catch (error) { recorded = failedRecord(error); }
      return { result: saved, recorded: recorded };
    });
  }
  function endpoint() {
    var value = CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_ENDPOINT');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value)) CalendarDraftSync.fail('CONFIGURATION_ERROR');
    return value;
  }
  function send(payload) {
    var r = UrlFetchApp.fetch(endpoint(), { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
      followRedirects: false, validateHttpsCertificates: true, muteHttpExceptions: true });
    var code = r.getResponseCode();
    if (code === 302 || code === 303) {
      var headers = r.getAllHeaders(), location = headers.Location || headers.location;
      // ContentService response retrieval only. Do not replay the POST or forward any secret/header.
      if (typeof location !== 'string' || location.length > 8192 ||
          !/^https:\/\/script\.googleusercontent\.com\/macros\/echo\?[^\s#\\]+$/.test(location)) CalendarDraftSync.fail('UNSAFE_REDIRECT');
      r = UrlFetchApp.fetch(location, { method: 'get', followRedirects: false, validateHttpsCertificates: true, muteHttpExceptions: true });
      code = r.getResponseCode();
    }
    if (code !== 200) CalendarDraftSync.fail('HTTP_ERROR');
    var content = r.getContentText(); if (content.length > 4096) CalendarDraftSync.fail('INVALID_RESPONSE');
    var result; try { result = JSON.parse(content); } catch (_) { CalendarDraftSync.fail('INVALID_RESPONSE'); }
    if (!CalendarDraftSync.object(result)) CalendarDraftSync.fail('INVALID_RESPONSE');
    return result;
  }
  function retryLatestDraftSync(expectedRevision, expectedDraftId) {
    var pending;
    try {
      CalendarDraftSync.locked(function () {
        var value = state();
        if (value === null) CalendarDraftSync.fail('NO_SAVED_DRAFT');
        requireCurrentDraft(value.latest);
        if (expectedRevision && (value.latest.revision !== expectedRevision || value.latest.draftId !== expectedDraftId)) CalendarDraftSync.fail('NEWER_DRAFT_PENDING');
        pending = CalendarDraftSync.metadata(value.latest);
        // A previous ACK is historical evidence, not proof of today's receiver state.
        // Persist verification intent first; an unsuccessful recheck must not remain durably "synced".
        if (value.latest.syncStatus !== 'pending') {
          value.latest.syncStatus = 'pending';
          CalendarDraftSync.writeState(KEY, value);
        }
      });
      CalendarDraftSync.file(pending.fileId, CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID'), pending.generatedAt);
      var request = { action: CalendarDraftSync.ACTION, secret: CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_WRITE_SECRET'), yearMonth: pending.yearMonth,
        fileId: pending.fileId, generatedAt: pending.generatedAt, revision: pending.revision, draftId: pending.draftId };
      if (typeof request.secret !== 'string' || request.secret.length < 32 || request.secret.length > 1024 || request.secret === CalendarDraftSync.props().getProperty('CALENDAR_DRAFT_BRIDGE_SECRET')) CalendarDraftSync.fail('CONFIGURATION_ERROR');
      var result = send(request);
      if (result.ok !== true || result.synced !== true || ['SYNCED','ALREADY_SYNCED'].indexOf(result.code) < 0 ||
          !CalendarDraftSync.same(result, pending)) CalendarDraftSync.fail('SYNC_NOT_ACKNOWLEDGED');
      return CalendarDraftSync.locked(function () {
        var now = state();
        if (now === null || !CalendarDraftSync.same(now.latest, pending)) CalendarDraftSync.fail('NEWER_DRAFT_PENDING');
        requireCurrentDraft(pending);
        now.latest.syncStatus = 'synced'; CalendarDraftSync.writeState(KEY, now); return status(now, result.code);
      });
    } catch (error) {
      // Do not persist untrusted responses or exceptions: they may contain secrets, URLs or file IDs.
      return { saved: !!pending, synced: false, queued: !!pending, code: CalendarDraftSync.errorCode(error),
        revision: pending ? pending.revision : undefined, draftId: pending ? pending.draftId : undefined };
    }
  }
  return { send: send, saveAndRecord: saveAndRecord, recordSavedDraft: recordSavedDraft, retryLatestDraftSync: retryLatestDraftSync, state: state };
})();


/** GAS1 durable save journal. Never saves after uncertain reserve/save results. */
var CalendarReservedSender = (function () {
  'use strict';
  var KEY='CALENDAR_DRAFT_SAVE_JOURNAL_V1', MODE='reserve-before-save-v1';
  function hash(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return ('0'+(b&255).toString(16)).slice(-2);}).join(''); }
  function state() {
    var s=CalendarDraftSync.readState(KEY); if(s===null)return null;
    if(!CalendarDraftSync.object(s)||s.schemaVersion!==1||['intent','reserved','saving','saved','synced','abandoned'].indexOf(s.stage)<0||
      !CalendarDraftSync.object(s.intent)||typeof s.intent.operationId!=='string'||!/^[a-f0-9-]{36}$/i.test(s.intent.operationId)||
      !CalendarDraftSync.month(s.intent.yearMonth)||typeof s.intent.imageSha256!=='string'||!/^[a-f0-9]{64}$/.test(s.intent.imageSha256)||
      typeof s.intent.expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(s.intent.expectedVersion))CalendarDraftSync.fail('SAVE_JOURNAL_CORRUPT');
    if(s.stage!=='intent'&&s.stage!=='abandoned') {
      var p=s.reservation;
      if(!CalendarDraftSync.object(p)||p.operationId!==s.intent.operationId||p.expectedVersion!==s.intent.expectedVersion||p.yearMonth!==s.intent.yearMonth||p.imageSha256!==s.intent.imageSha256||
        !CalendarDraftSync.revision(p.revision)||typeof p.draftId!=='string'||!/^[a-f0-9-]{36}$/i.test(p.draftId)||!CalendarDraftSync.iso(p.expiresAt)||!CalendarDraftSync.iso(p.reservedAt)||Date.parse(p.expiresAt)!==Date.parse(p.reservedAt)+900000)CalendarDraftSync.fail('SAVE_JOURNAL_CORRUPT');
    }
    if(['saved','synced'].indexOf(s.stage)>=0) {CalendarDraftSync.metadata(s.saved);if(s.saved.revision!==s.reservation.revision||s.saved.draftId!==s.reservation.draftId||s.saved.yearMonth!==s.reservation.yearMonth)CalendarDraftSync.fail('SAVE_JOURNAL_CORRUPT');}
    return s;
  }
  function write(s){CalendarDraftSync.writeState(KEY,s);}
  function request(action,data) {
    var secret=CalendarDraftSync.secrets().write;
    var r=CalendarDraftSender.send(Object.assign({action:action,secret:secret},data||{}));
    if(r.ok!==true||r.protocol!==MODE)CalendarDraftSync.fail(r.ok===false&&typeof r.code==='string'&&/^[A-Z_]+$/.test(r.code)?r.code:'INVALID_RESERVATION_ACK');
    return r;
  }
  function status(s,code){return {saved:['saved','synced'].indexOf(s.stage)>=0,synced:s.stage==='synced',queued:['saved','synced'].indexOf(s.stage)>=0,
    revision:s.reservation?s.reservation.revision:undefined,draftId:s.reservation?s.reservation.draftId:undefined,operationId:s.intent.operationId,code:code};}
  function verifyReservation(r,intent) {
    var p=r.reservation;
    if(r.code!=='RESERVED'||!CalendarDraftSync.object(p)||p.operationId!==intent.operationId||p.expectedVersion!==intent.expectedVersion||p.yearMonth!==intent.yearMonth||p.imageSha256!==intent.imageSha256||
      !CalendarDraftSync.revision(p.revision)||typeof p.draftId!=='string'||!/^[a-f0-9-]{36}$/i.test(p.draftId)||!CalendarDraftSync.iso(p.reservedAt)||!CalendarDraftSync.iso(p.expiresAt)||Date.parse(p.expiresAt)!==Date.parse(p.reservedAt)+900000||Date.now()>=Date.parse(p.expiresAt))CalendarDraftSync.fail('INVALID_RESERVATION_ACK');
    return p;
  }
  function save(bytes,yearMonth,saveFunction) {
    return CalendarDraftSync.locked(function(){
      var previous=state();if(previous&&['synced','abandoned'].indexOf(previous.stage)<0)CalendarDraftSync.fail('SAVE_RECOVERY_REQUIRED');
      var view=request('inspect_save_authority_v1');
      if(view.pending!==null||typeof view.expectedVersion!=='string'||!/^[a-f0-9]{64}$/.test(view.expectedVersion))CalendarDraftSync.fail('SAVE_PENDING');
      var s={schemaVersion:1,stage:'intent',intent:{operationId:Utilities.getUuid(),yearMonth:yearMonth,imageSha256:hash(bytes),expectedVersion:view.expectedVersion}};
      write(s); // A lost reservation ACK must never create a PNG.
      var ack=request('reserve_draft_save_v1',s.intent);
      s.reservation=verifyReservation(ack,s.intent);s.stage='reserved';write(s);
      s.stage='saving';write(s); // Any subsequent interruption requires owner outcome review.
      var result=saveFunction();
      if(!result||result.ok!==true||result.status!=='draft_ready')CalendarDraftSync.fail('SAVE_OUTCOME_UNKNOWN');
      var file=CalendarDraftSync.file(result.fileId,CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID'));
      if(result.yearMonth!==yearMonth||hash(file.bytes)!==s.intent.imageSha256)CalendarDraftSync.fail('SAVE_OUTCOME_UNKNOWN');
      s.saved={fileId:result.fileId,yearMonth:yearMonth,generatedAt:file.file.getDateCreated().toISOString(),revision:s.reservation.revision,draftId:s.reservation.draftId};
      s.stage='saved';write(s);
      return {result:result,journal:s};
    });
  }
  function retry(expectedRevision,expectedDraftId) {
    try {return CalendarDraftSync.locked(function(){
      var s=state();if(!s)CalendarDraftSync.fail('NO_SAVED_DRAFT');
      if(['saved','synced'].indexOf(s.stage)<0)CalendarDraftSync.fail('SAVE_RECOVERY_REQUIRED');
      if(expectedRevision&&(s.saved.revision!==expectedRevision||s.saved.draftId!==expectedDraftId))CalendarDraftSync.fail('NEWER_DRAFT_PENDING');
      var props=CalendarDraftSync.props();if(props.getProperty('draft_file_id')!==s.saved.fileId||props.getProperty('draft_year_month')!==s.saved.yearMonth)CalendarDraftSync.fail('CURRENT_DRAFT_CHANGED');
      var f=CalendarDraftSync.file(s.saved.fileId,CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID'),s.saved.generatedAt);if(hash(f.bytes)!==s.intent.imageSha256)CalendarDraftSync.fail('IMAGE_CHANGED');
      s.stage='saved';write(s);
      var ack=request('commit_reserved_draft_v1',Object.assign({},s.saved,{operationId:s.intent.operationId,reservation:s.reservation}));
      if(ack.synced!==true||['SYNCED','ALREADY_SYNCED'].indexOf(ack.code)<0||ack.operationId!==s.intent.operationId||JSON.stringify(ack.reservation)!==JSON.stringify(s.reservation)||
        !CalendarDraftSync.object(ack.current)||!CalendarDraftSync.same(ack.current,s.saved)||ack.current.imageSha256!==s.intent.imageSha256||ack.current.operationId!==s.intent.operationId)CalendarDraftSync.fail('SYNC_NOT_ACKNOWLEDGED');
      s.stage='synced';write(s);return status(s,ack.code);
    });}catch(e){var s;try{s=state();}catch(_){}return {saved:!!s&&['saved','synced'].indexOf(s.stage)>=0,synced:false,queued:!!s&&['saved','synced'].indexOf(s.stage)>=0,code:CalendarDraftSync.errorCode(e)};}
  }
  // Owner only: after reviewing an uncertain legacy save, journal the exact verified output.
  function recoverSaved(yearMonth,fileId,operationId,confirmation) {
    if(confirmation!=='ALL_WRITERS_QUIESCED_AND_SAVE_OUTCOME_VERIFIED')CalendarDraftSync.fail('RECOVERY_REVIEW_REQUIRED');
    return CalendarDraftSync.locked(function(){
      var s=state();if(!s||s.intent.operationId!==operationId||s.stage!=='saving'||!s.reservation||s.intent.yearMonth!==yearMonth)CalendarDraftSync.fail('SAVE_RECOVERY_REQUIRED');
      var p=CalendarDraftSync.props();if(p.getProperty('draft_file_id')!==fileId||p.getProperty('draft_year_month')!==yearMonth)CalendarDraftSync.fail('CURRENT_DRAFT_CHANGED');
      var checked=CalendarDraftSync.file(fileId,CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID'));if(hash(checked.bytes)!==s.intent.imageSha256)CalendarDraftSync.fail('IMAGE_CHANGED');
      s.saved={fileId:fileId,yearMonth:yearMonth,generatedAt:checked.file.getDateCreated().toISOString(),revision:s.reservation.revision,draftId:s.reservation.draftId};s.stage='saved';write(s);return status(s,'RECOVERED_FOR_REVIEW');
    });
  }
  function reconcileReviewedJournal(expectedRaw, confirmation) {
    if(confirmation!=='ALL_WRITERS_QUIESCED_AND_SAVE_OUTCOME_VERIFIED')CalendarDraftSync.fail('RECOVERY_REVIEW_REQUIRED');
    return CalendarDraftSync.locked(function(){
      if(CalendarDraftSync.props().getProperty(KEY)!==expectedRaw)CalendarDraftSync.fail('BASE_CHANGED');
      var s=state();if(!s)CalendarDraftSync.fail('NO_SAVED_DRAFT');var remote=request('inspect_save_authority_v1');
      if(remote.pending!==null)CalendarDraftSync.fail('SAVE_PENDING');
      // Current image retains its own commit receipt across another producer's abandonment.
      if(remote.current&&remote.current.operationId===s.intent.operationId&&remote.current.commitReservation) remote.lastOperation={outcome:'committed',reservation:remote.current.commitReservation};
      if(remote.lastOperation&&remote.lastOperation.reservation&&remote.lastOperation.reservation.operationId===s.intent.operationId){var terminal=remote.lastOperation.reservation;if(terminal.expectedVersion!==s.intent.expectedVersion||terminal.yearMonth!==s.intent.yearMonth||terminal.imageSha256!==s.intent.imageSha256||(s.reservation&&JSON.stringify(s.reservation)!==JSON.stringify(terminal)))CalendarDraftSync.fail('RESERVATION_MISMATCH');}
      if(remote.lastOperation&&remote.lastOperation.reservation.operationId===s.intent.operationId&&remote.lastOperation.outcome==='committed'){
        var c=CalendarDraftSync.metadata(remote.current);if(remote.current.operationId!==s.intent.operationId||remote.current.imageSha256!==s.intent.imageSha256||remote.current.yearMonth!==s.intent.yearMonth)CalendarDraftSync.fail('RESERVATION_MISMATCH');
        if(s.reservation&&JSON.stringify(s.reservation)!==JSON.stringify(remote.lastOperation.reservation))CalendarDraftSync.fail('RESERVATION_MISMATCH');
        var p=CalendarDraftSync.props();if(p.getProperty('draft_file_id')!==c.fileId||p.getProperty('draft_year_month')!==c.yearMonth)CalendarDraftSync.fail('CURRENT_DRAFT_CHANGED');
        var f=CalendarDraftSync.file(c.fileId,CalendarDraftSync.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID'),c.generatedAt);if(hash(f.bytes)!==s.intent.imageSha256)CalendarDraftSync.fail('IMAGE_CHANGED');
        s.reservation=remote.lastOperation.reservation;s.saved=c;s.stage='synced';
      }else if((remote.lastOperation&&remote.lastOperation.outcome==='abandoned'&&remote.lastOperation.reservation.operationId===s.intent.operationId)){s.stage='abandoned';}
      else CalendarDraftSync.fail('SAVE_RECOVERY_REQUIRED');
      write(s);return status(s,'OWNER_RECONCILED');
    });
  }
  return {reconcileReviewedJournal:reconcileReviewedJournal,save:save,retry:retry,state:state,recoverSaved:recoverSaved};
})();


/** Wraps the supplied current save body; leaves getDraftInfo, LINE and publication bodies unchanged. */
function saveDraftToDrive(base64Data, year, month, folderId) {
  var S = CalendarDraftSync;
  year = Number(year); month = Number(month);
  var yearMonth = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0');
  if (!Number.isInteger(year) || !Number.isInteger(month) || !S.month(yearMonth)) S.fail('INVALID_METADATA');
  var expectedFolder = S.setting('CALENDAR_DRAFT_SYNC_FOLDER_ID');
  if (folderId !== expectedFolder || !S.id(expectedFolder)) S.fail('INVALID_FOLDER');
  if (typeof base64Data !== 'string' || base64Data.length > Math.ceil(S.MAX_BYTES / 3) * 4 + 22) S.fail('INVALID_PNG');
  var match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(base64Data);
  if (!match) S.fail('INVALID_PNG');
  var bytes; try { bytes = Utilities.base64Decode(match[1]); } catch (_) { S.fail('INVALID_PNG'); }
  S.png(bytes);
  var saved = CalendarReservedSender.save(bytes, yearMonth, function () {
    return calendarDraftLegacySave_(base64Data, year, month, folderId);
  });
  var result = saved.result, sync = CalendarReservedSender.retry(saved.journal.saved.revision, saved.journal.saved.draftId);
  result.saved = true; result.synced = sync.synced === true; result.queued = true; result.syncCode = sync.code;
  result.revision = saved.journal.saved.revision; result.draftId = saved.journal.saved.draftId;
  return result;
}
function retryLatestDraftSync(expectedRevision, expectedDraftId) {
  return CalendarReservedSender.state() ? CalendarReservedSender.retry(expectedRevision, expectedDraftId) : CalendarDraftSender.retryLatestDraftSync(expectedRevision, expectedDraftId);
}
function recoverSavedDraftSync(yearMonth, savedFileId) {
  if (CalendarReservedSender.state()) CalendarDraftSync.fail('SAVE_RECOVERY_REVIEW_REQUIRED');
  var recorded = CalendarDraftSender.recordSavedDraft(yearMonth, savedFileId);
  if (!recorded.queued) return recorded;
  return CalendarDraftSender.retryLatestDraftSync(recorded.revision, recorded.draftId);
}


function doGet() {

  var htmlContent = getAppHtml();

  return HtmlService.createHtmlOutput(htmlContent)

         .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)

         .setTitle('カレンダー自動生成・一括保存ツール');

}



function saveImageToDrive() { throw new Error("UNRESERVED_SAVE_DISABLED"); }

function getCalendarEventsData(targetYear, targetMonth) {

  var calendarIds = [

    '[CALENDAR_ID_REDACTED]',

    '[CALENDAR_ID_REDACTED]',

    '[CALENDAR_ID_REDACTED]',

    '[CALENDAR_ID_REDACTED]',

    '[CALENDAR_ID_REDACTED]'

  ];



  var startDate = new Date(targetYear, targetMonth - 1, 1);

  var endDate = new Date(targetYear, targetMonth, 0, 23, 59, 59);

  var eventsMap = {};

  var cancellationCalendarId = '[CALENDAR_ID_REDACTED]';



  for (var c = 0; c < calendarIds.length; c++) {

    var calId = calendarIds[c];

    var isCancellation = calId === cancellationCalendarId;

    if (!calId || calId.indexOf('xxxx') !== -1) continue;



    var calendar = CalendarApp.getCalendarById(calId);

    if (!calendar) continue;



    var events = calendar.getEvents(startDate, endDate);

    for (var i = 0; i < events.length; i++) {

      var event = events[i];

      var rawTitle = event.getTitle();

      var startTime = event.getStartTime();

      var endTime = event.getEndTime();



      var isAllDay = event.isAllDayEvent();

      var startD = new Date(startTime.getTime());

      var endD = new Date(endTime.getTime());



      if (isAllDay) {

        endD.setTime(endD.getTime() - 1);

      }



      var startDayNum = startD.getDate();

      var endDayNum = endD.getDate();

      var isMultiDay = (startD.toDateString() !== endD.toDateString());



      var current = new Date(startD.getTime());



      while (current <= endD) {

        if (current.getMonth() === targetMonth - 1) {

          var dayNum = current.getDate();

          var formattedTitle = "";



          if (isMultiDay) {

            if (dayNum === startDayNum && current.getMonth() === startD.getMonth()) {

              formattedTitle = formatEventTitle(rawTitle, 'start');

            } else if (dayNum === endDayNum && current.getMonth() === endD.getMonth()) {

              formattedTitle = formatEventTitle(rawTitle, 'end');

            } else {

              formattedTitle = formatEventTitle(rawTitle, 'middle');

            }

          } else {

            formattedTitle = formatEventTitle(rawTitle, 'single');

          }



          if (formattedTitle !== '') {

            if (!eventsMap[dayNum]) {

              eventsMap[dayNum] = [];

            }

            var existingEvent = eventsMap[dayNum].find(function(item) {

              return item.title === formattedTitle;

            });



            if (existingEvent) {

              if (isCancellation) {

                existingEvent.isCancellation = true;

              }

            } else {

              eventsMap[dayNum].push({

                title: formattedTitle,

                isCancellation: isCancellation

              });

            }

          }

        }

        current.setDate(current.getDate() + 1);

      }

    }

  }

  return eventsMap;

}



function formatEventTitle(rawTitle, position) {

  if (!rawTitle) return '';

  var t = rawTitle;



  var groupMatch = t.match(/([0-9０-９]群)/);

  var groupStr = groupMatch ? groupMatch[1] : '';



  t = t.replace(/（[^）]+）/g, '');

  t = t.replace(/\([^)]+\)/g, '');

  t = t.replace(/※.+/g, '');

  t = t.trim();



  if (t.indexOf('夏期スクーリング') !== -1 || t.indexOf('夏スク') !== -1) {

    return '夏スク' + groupStr;

  }



  if (position === 'middle') {

    return '';

  }



  if (t.indexOf('10月') !== -1 && t.indexOf('新規リポート') !== -1) {

    return '10月受験科目<br>新規リポート受付開始';

  }



  t = t.replace(/後期メディアスクーリング/g, '後期メディア');

  t = t.replace(/後期週末スクーリング/g, '後期週末スク');

  t = t.replace(/秋期スクーリング/g, '秋スク');

  t = t.replace(/札幌市スクーリング/g, '札幌スク');

  t = t.replace(/福岡市スクーリング/g, '福岡スク');

  t = t.replace(/名古屋市スクーリング/g, '名古屋スク');

  t = t.replace(/冬期スクーリング/g, '冬スク');

  t = t.replace(/単位修得試験/g, '単修');

  t = t.replace(/リポート提出受付期間/g, 'リポート受付');



  if (position === 'start') {

    t = t.replace(/履修申請期間/g, '<br>履修申請開始');

    t = t.replace(/受講料振込期間/g, '<br>受講料振込開始');

    t = t.replace(/リポート受付/g, 'リポート受付開始');

    t = t.replace(/申込期間/g, '申込開始');

  } else if (position === 'end') {

    t = t.replace(/履修申請期間/g, '<br>履修申請締切');

    t = t.replace(/受講料振込期間/g, '<br>受講料振込締切');

    t = t.replace(/リポート受付/g, 'リポート受付締切');

    t = t.replace(/申込期間/g, '申込締切');

  } else {

    t = t.replace(/履修申請期間/g, '<br>履修申請');

  }



  return t;

}



function getAppHtml() {

  return `<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<link rel="preconnect" href="https://fonts.googleapis.com">

<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

<link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@900&display=swap" rel="stylesheet">

<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>

<style>

  html, body { margin: 0; padding: 0; background-color: #f4f4f9; font-family: "コーポレート・ロゴ", "Corporate Logo", "Corporate Logo B", "Hiragino Kaku Gothic ProN", "メイリオ", sans-serif; font-weight: 900; }

  .toolbar { position: fixed; top: 0; left: 0; right: 0; height: 50px; background-color: #333; color: #fff; display: flex; align-items: center; padding: 0 20px; z-index: 9999; gap: 15px; font-size: 14px; font-family: sans-serif; }

  .toolbar input { padding: 6px 10px; width: 320px; border-radius: 4px; border: none; font-size: 13px; }

  .toolbar button { background-color: #ff7a00; color: #fff; border: none; padding: 8px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; }

  .toolbar button:hover { background-color: #e06b00; }

  .status { font-weight: bold; color: #00ffcc; }

  .stage-wrapper { margin-top: 60px; display: flex; justify-content: center; padding: 20px; }

  .container { width: 1280px; height: 720px; background-color: #ff7a00; padding: 20px; box-sizing: border-box; position: relative; color: #000000; overflow: hidden; font-weight: 900; }

  .inner-content { width: 100%; height: 100%; background-color: #ffffff; border-radius: 20px; box-sizing: border-box; display: flex; padding: 15px 30px; overflow: hidden; }

  .left-side { width: 90px; display: flex; align-items: center; justify-content: center; }

  .left-text { transform: rotate(-90deg); transform-origin: center center; white-space: nowrap; font-size: 38px; font-weight: 900; letter-spacing: 4px; -webkit-text-stroke: 0.5px #000000; }

  .main-content { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }

  .header-title { text-align: center; font-size: 40px; font-weight: 900; letter-spacing: 2px; margin-bottom: 4px; -webkit-text-stroke: 0.5px #000000; }

  .calendar-table { width: 100%; border-collapse: collapse; table-layout: fixed; }

  .calendar-table th, .calendar-table td { border: 1.5px solid #000000; text-align: center; vertical-align: top; }

  .calendar-table th { height: 30px; font-size: 16px; font-weight: 900; background-color: #ffffff; vertical-align: middle; -webkit-text-stroke: 0.3px #000000; }

  .calendar-table td { height: 82px; padding: 3px 2px; box-sizing: border-box; }

  .day-number { font-size: 17px; font-weight: 900; margin-bottom: 2px; text-align: center; -webkit-text-stroke: 0.3px #000000; }

  .event-item { font-size: 12px; font-weight: 900; line-height: 1.2; text-align: center; word-break: keep-all; overflow-wrap: break-word; margin-bottom: 2px; -webkit-text-stroke: 0.2px #000000; }

  .footer-title { text-align: right; font-size: 32px; font-weight: 900; letter-spacing: 1px; margin-top: 2px; line-height: 1; -webkit-text-stroke: 0.5px #000000; }

  .nikumaru-font { font-family: "にくまるフォント", "Nikumaru", "Zen Maru Gothic", sans-serif; font-weight: 900; -webkit-text-stroke: 0.5px #000000; }

  .event-item.cancellation {

  color: #d32f2f;

  -webkit-text-stroke: 0.2px #d32f2f;

}

</style>

</head>

<body>

  <div class="toolbar">

    <label>生成月:</label>

    <input type="month" id="targetMonth" value="2026-10" onchange="previewCalendar()">



    <label>フォルダID:</label>

    <input type="text" id="folderId" value="[FOLDER_ID_REDACTED]" placeholder="フォルダIDを入力">



    <button onclick="startGeneration()">仮生成して保存</button>
    <button onclick="retryDraftSyncFromUi()">保存済み画像を再同期</button>

    <div class="status" id="statusText"></div>

  </div>

  <div class="stage-wrapper">

    <div class="container" id="calendarContainer">

    </div>

  </div>

  <script>

    var monthsEnglish = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

    var weekDays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

    function renderCalendarDom(year, month, eventsMap) {

      var englishMonth = monthsEnglish[month - 1];

      var firstDayObj = new Date(year, month - 1, 1);

      var startColIndex = (firstDayObj.getDay() + 6) % 7;

      var endDateObj = new Date(year, month, 0);

      var totalDays = endDateObj.getDate();

      var tableRowsHtml = "<tr>";

      for (var w = 0; w < weekDays.length; w++) {

        tableRowsHtml += "<th>" + weekDays[w] + "</th>";

      }

      tableRowsHtml += "</tr>";

      var colIndex = startColIndex;

      var currentWeekHtml = "<tr>";

      for (var pad = 0; pad < startColIndex; pad++) {

        currentWeekHtml += "<td></td>";

      }

      for (var d = 1; d <= totalDays; d++) {

        var eventList = eventsMap[d] ? eventsMap[d] : [];

        var eventHtml = "";

        for (var e = 0; e < eventList.length; e++) {

          var item = eventList[e];



          var safeTitle = String(item.title)

            .replace(/&/g, '&amp;')

            .replace(/</g, '&lt;')

            .replace(/>/g, '&gt;')

            .replace(/"/g, '&quot;')

            .replace(/'/g, '&#39;')

            .replace(/&lt;br&gt;/gi, '<br>');



          var className = item.isCancellation

            ? 'event-item cancellation'

            : 'event-item';



          eventHtml +=

            '<div class="' + className + '">' +

            safeTitle +

            '</div>';

      }

        currentWeekHtml += '<td><div class="day-number">' + d + '</div>' + eventHtml + '</td>';

        colIndex++;

        if (colIndex === 7) {

          currentWeekHtml += "</tr>";

          tableRowsHtml += currentWeekHtml;

          currentWeekHtml = "<tr>";

          colIndex = 0;

        }

      }

      if (colIndex > 0) {

        while (colIndex < 7) {

          currentWeekHtml += "<td></td>";

          colIndex++;

        }

        currentWeekHtml += "</tr>";

        tableRowsHtml += currentWeekHtml;

      }

      var innerHtml = '<div class="inner-content">' +

        '<div class="left-side"><div class="left-text">' + year + ' ' + englishMonth + '</div></div>' +

        '<div class="main-content"><div class="header-title">' + month + '月通教生向けスケジュール</div>' +

        '<table class="calendar-table">' + tableRowsHtml + '</table>' +

        '<div class="footer-title"><span class="nikumaru-font">法政通信メディア</span></div></div>' +

        '</div>';

      document.getElementById("calendarContainer").innerHTML = innerHtml;

    }

    var lastSavedDraftResult = null;
    var calendarUiEpoch = 0;
    var calendarSaveBusy = false;
    var calendarRetryBusy = false;
    function setCalendarControlsBusy(busy) {
      var controls = document.querySelectorAll('.toolbar input, .toolbar button');
      for (var i = 0; i < controls.length; i++) controls[i].disabled = busy;
    }
    function showDraftSyncStatus(result) {
      var recovery = result && ['SAVE_RECOVERY_REQUIRED','SAVE_RECOVERY_REVIEW_REQUIRED','RESERVATION_EXPIRED_RECOVERY_REQUIRED','SAVE_JOURNAL_CORRUPT','RESERVATION_ROLLOUT_REQUIRED'].indexOf(result.syncCode || result.code) >= 0;
      var changed = result && ['CURRENT_DRAFT_CHANGED','NEWER_DRAFT_PENDING'].indexOf(result.syncCode || result.code) >= 0;
      document.getElementById('statusText').innerText = recovery
        ? '保存処理の確認が必要です。再生成・再保存せず管理者が予約と保存結果を確認してください。'
        : changed
        ? 'この保存後に下書きが差し替わりました。最新の保存結果を確認してください。'
        : !result || !result.saved
        ? '保存結果を確認できません。画像を再生成せず状態を確認してください。'
        : result.synced ? 'PNG保存済み・GAS②同期済み'
        : result.queued ? 'PNG保存済み・同期未完了。再同期できます。'
        : 'PNG保存済み・同期情報の記録に失敗。再同期ボタンで復旧を試せます。';
    }
    function retryDraftSyncFromUi() {
      if (calendarSaveBusy || calendarRetryBusy) return;
      var saved = lastSavedDraftResult;
      if (!saved || !saved.saved) {
        document.getElementById('statusText').innerText = 'この画面の保存結果がありません。画像を再生成せず管理者が状態を確認してください。';
        return;
      }
      calendarRetryBusy = true;
      var operation = ++calendarUiEpoch;
      setCalendarControlsBusy(true);
      var finish = function() { calendarRetryBusy = false; setCalendarControlsBusy(false); };
      var run = google.script.run.withSuccessHandler(function(result) {
        if (calendarUiEpoch !== operation || lastSavedDraftResult !== saved) { finish(); return; }
        if (result.synced && saved.revision && (result.revision !== saved.revision || result.draftId !== saved.draftId)) result.synced = false;
        saved.synced = result.synced === true;
        saved.queued = result.queued === true;
        saved.syncCode = result.code || result.syncCode || '';
        if (!saved.revision && result.revision) { saved.revision = result.revision; saved.draftId = result.draftId; }
        showDraftSyncStatus(saved);
        finish();
      }).withFailureHandler(function() {
        if (calendarUiEpoch === operation && lastSavedDraftResult === saved) document.getElementById('statusText').innerText = 'PNG保存済み・同期結果は未確認。再生成せず再同期してください。';
        finish();
      });
      if (saved.queued) run.retryLatestDraftSync(saved.revision, saved.draftId);
      else run.recoverSavedDraftSync(saved.yearMonth, saved.fileId);
    }
    async function startGeneration() {
      if (calendarSaveBusy || calendarRetryBusy) return;
      var folderId = document.getElementById('folderId').value.trim();
      var targetMonthValue = document.getElementById('targetMonth').value;
      if (!targetMonthValue || !folderId) { alert('生成月と保存先フォルダを確認してください'); return; }
      calendarSaveBusy = true;
      var operation = ++calendarUiEpoch;
      setCalendarControlsBusy(true);
      var parts = targetMonthValue.split('-'), year = Number(parts[0]), month = Number(parts[1]);
      var statusText = document.getElementById('statusText');
      lastSavedDraftResult = null;
      try {
        statusText.innerText = year + '年' + month + '月のデータ取得中...';
        var eventsMap = await new Promise(function(resolve, reject) {
          google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).getCalendarEventsData(year, month);
        });
        if (calendarUiEpoch !== operation) return;
        renderCalendarDom(year, month, eventsMap);
        statusText.innerText = year + '年' + month + '月の画像キャプチャ中...';
        await new Promise(function(resolve) { setTimeout(resolve, 500); });
        if (calendarUiEpoch !== operation) return;
        var canvas = await html2canvas(document.getElementById('calendarContainer'), {scale: 1, useCORS: true});
        if (calendarUiEpoch !== operation) return;
        statusText.innerText = year + '年' + month + '月の仮生成画像を保存中...';
        var result = await new Promise(function(resolve, reject) {
          google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).saveDraftToDrive(canvas.toDataURL('image/png'), year, month, folderId);
        });
        if (calendarUiEpoch !== operation) return;
        lastSavedDraftResult = result;
        showDraftSyncStatus(result);
      } catch (_) {
        if (calendarUiEpoch === operation) statusText.innerText = '保存結果を確認できません。画像を再生成せず管理者が状態を確認してください。';
      } finally {
        calendarSaveBusy = false;
        setCalendarControlsBusy(false);
      }
    }

function previewCalendar() {
  if (calendarSaveBusy || calendarRetryBusy) return;
  var previewOperation = ++calendarUiEpoch;

  var targetMonthValue = document.getElementById("targetMonth").value;



  if (!targetMonthValue) return;



  var parts = targetMonthValue.split("-");

  var year = Number(parts[0]);

  var month = Number(parts[1]);



  var statusText = document.getElementById("statusText");

  statusText.innerText = year + "年" + month + "月を読み込み中...";



  google.script.run

    .withSuccessHandler(function(eventsMap) {
      if (calendarUiEpoch !== previewOperation || calendarSaveBusy || calendarRetryBusy) return;

      renderCalendarDom(year, month, eventsMap);

      statusText.innerText = "";

    })

    .withFailureHandler(function(error) {
      if (calendarUiEpoch !== previewOperation || calendarSaveBusy || calendarRetryBusy) return;

      statusText.innerText = "エラー: " + error.message;

    })

    .getCalendarEventsData(year, month);

}



// ページを開いたときに初期月を表示

window.onload = function() {

  previewCalendar();



  // 月を変更したら自動でプレビュー更新

  document

    .getElementById("targetMonth")

    .addEventListener("change", previewCalendar);

};

</script>

</body>

</html>`;

}



function calendarDraftLegacySave_(base64Data, year, month, folderId) {

  year = Number(year);

  month = Number(month);



  if (!Number.isInteger(year) ||

      !Number.isInteger(month) ||

      month < 1 || month > 12) {

    throw new Error('年月が不正です');

  }



  const match = /^data:image\/png;base64,(.+)$/.exec(base64Data);

  if (!match) {

    throw new Error('PNGデータが不正です');

  }



  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;



  const timestamp = Utilities.formatDate(

    new Date(),

    'Asia/Tokyo',

    'yyyyMMdd_HHmmss'

  );



  const fileName = `draft_${yearMonth}_${timestamp}.png`;



  const blob = Utilities.newBlob(

    Utilities.base64Decode(match[1]),

    'image/png',

    fileName

  );



  const file = DriveApp

    .getFolderById(folderId)

    .createFile(blob);



  PropertiesService.getScriptProperties().setProperties({

    draft_year_month: yearMonth,

    draft_file_id: file.getId(),

    draft_status: 'draft_ready',

    draft_generated_at: new Date().toISOString(),

    draft_approved_at: '',

    draft_published_at: ''

  });



  return {

    ok: true,

    status: 'draft_ready',

    yearMonth: yearMonth,

    fileId: file.getId(),

    url: file.getUrl()

  };

}



function testMergedCalendar() {

  const eventsMap = getCalendarEventsData(2026, 10);



  Logger.log(

    '10月12日の予定: ' +

    JSON.stringify(eventsMap[12] || [])

  );

}



function getDraftInfo() {

  const props = PropertiesService.getScriptProperties();

  const data = props.getProperties();

  return {

    yearMonth: data.draft_year_month || '',

    fileId: data.draft_file_id || '',

    status: data.draft_status || 'not_generated',

    generatedAt: data.draft_generated_at || '',

    approvedAt: data.draft_approved_at || '',

    publishedAt: data.draft_published_at || '',

    url: data.draft_file_id

      ? `https://drive.google.com/file/d/${data.draft_file_id}/view`

      : '',

  };

}



function publishApprovedDraft() {
  throw new Error("CENTRAL_APPROVAL_PUBLICATION_DISABLED");
}
function publishApprovedDraftForCurrentMonth() {
  throw new Error("CENTRAL_APPROVAL_PUBLICATION_DISABLED");
}

  function testGetDraftInfo() {

  const info = getDraftInfo();

  Logger.log(JSON.stringify(info, null, 2));

}



function notifyCurrentDraftToLine() {

  const draft = getDraftInfo();



  if (draft.status !== 'draft_ready' || !draft.fileId) {

    throw new Error('通知できる仮生成画像がありません');

  }



  // ファイルが実在し、PNGであることを確認

  const file = DriveApp.getFileById(draft.fileId);



  if (file.getMimeType() !== 'image/png') {

    throw new Error('仮生成ファイルがPNGではありません');

  }



  const message =

    '【カレンダー確認依頼】\n\n' +

    '対象月：' + draft.yearMonth + '\n\n' +

    '以下の画像をご確認ください。\n' +

    draft.url + '\n\n' +

    '問題がなければ「OK」、修正があれば内容をご返信ください。\n\n' +

    '※まだWebサイトには公開されていません。';



  sendLinePushMessageAsMultipleBubbles([message]);



  Logger.log('LINEへの確認依頼を送信しました');

}



function testCalendarLineDelivery() {

  const props = PropertiesService.getScriptProperties();



  const groupId = props.getProperty('CALENDAR_LINE_GROUP_ID');

  const token = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');



  if (!groupId || !token) {

    throw new Error('LINEの設定が不足しています');

  }



  const response = UrlFetchApp.fetch(

    'https://api.line.me/v2/bot/message/push',

    {

      method: 'post',

      contentType: 'application/json',

      headers: {

        Authorization: 'Bearer ' + token

      },

      payload: JSON.stringify({

        to: groupId,

        messages: [

          {

            type: 'text',

            text: '【カレンダーBot】通知テスト成功！'

          }

        ]

      }),

      muteHttpExceptions: true

    }

  );



  Logger.log('HTTPステータス: ' + response.getResponseCode());



  if (response.getResponseCode() !== 200) {

    throw new Error(response.getContentText());

  }

}
