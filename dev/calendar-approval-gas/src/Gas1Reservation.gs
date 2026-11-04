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
