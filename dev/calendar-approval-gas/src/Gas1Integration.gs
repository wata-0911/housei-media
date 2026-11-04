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
