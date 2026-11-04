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
