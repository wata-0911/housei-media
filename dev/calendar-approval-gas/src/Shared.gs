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
