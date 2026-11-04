'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function source(name){return fs.readFileSync(path.join(root,'src',name),'utf8');}
function replaceOnce(text,from,to){if(!text.includes(from)||text.indexOf(from)!==text.lastIndexOf(from))throw Error('Baseline drift; manual source review required');return text.replace(from,to);}
let current=fs.readFileSync(path.join(root,'reference','GAS1.current.redacted.gs'),'utf8');
current=replaceOnce(current,'function saveDraftToDrive(base64Data, year, month, folderId) {','function calendarDraftLegacySave_(base64Data, year, month, folderId) {');
current=replaceOnce(current,'    <button onclick="startGeneration()">仮生成して保存</button>',
 '    <button onclick="startGeneration()">仮生成して保存</button>\n    <button onclick="retryDraftSyncFromUi()">保存済み画像を再同期</button>');
const rawSaveStart=current.indexOf('function saveImageToDrive('), rawSaveEnd=current.indexOf('function getCalendarEventsData(',rawSaveStart);
if(rawSaveStart<0||rawSaveEnd<0)throw Error('Raw save boundary drift');
current=current.slice(0,rawSaveStart)+'function saveImageToDrive() { throw new Error("UNRESERVED_SAVE_DISABLED"); }\n\n'+current.slice(rawSaveEnd);
const start=current.indexOf('    async function startGeneration() {');
const end=current.indexOf('function previewCalendar() {',start);
if(start<0||end<0)throw Error('Supplied UI function boundaries unavailable');
current=current.slice(0,start)+fs.readFileSync(path.join(root,'tools','ui-fragment.js.txt'),'utf8')+'\n'+current.slice(end);
current=replaceOnce(current,'function previewCalendar() {',`function previewCalendar() {
  if (calendarSaveBusy || calendarRetryBusy) return;
  var previewOperation = ++calendarUiEpoch;`);
current=replaceOnce(current,'    .withSuccessHandler(function(eventsMap) {',`    .withSuccessHandler(function(eventsMap) {
      if (calendarUiEpoch !== previewOperation || calendarSaveBusy || calendarRetryBusy) return;`);
current=replaceOnce(current,'    .withFailureHandler(function(error) {',`    .withFailureHandler(function(error) {
      if (calendarUiEpoch !== previewOperation || calendarSaveBusy || calendarRetryBusy) return;`);
// Deliberate safety interlock: GAS1 legacy publisher cannot bypass the GAS2 authority.
const publishStart = current.indexOf('function publishApprovedDraft()');
const publishEnd = current.indexOf('  function testGetDraftInfo()', publishStart);
if (publishStart < 0 || publishEnd < 0) throw Error('Publisher boundary drift');
current = current.slice(0, publishStart) + 'function publishApprovedDraft() {\n  throw new Error("CENTRAL_APPROVAL_PUBLICATION_DISABLED");\n}\nfunction publishApprovedDraftForCurrentMonth() {\n  throw new Error("CENTRAL_APPROVAL_PUBLICATION_DISABLED");\n}\n\n' + current.slice(publishEnd);
// Calendar/title/getDraftInfo/LINE/save remain unchanged; publication is intentionally disabled.
const gas1=[source('Shared.gs'),source('Gas1Sender.gs'),source('Gas1Reservation.gs'),source('Gas1Integration.gs'),current].join('\n\n');
const gas2=[source('Shared.gs'),source('Gas2Receiver.gs'),source('Gas2Reservation.gs'),source('Gas2Integration.gs')].join('\n\n');
for(const [name,text] of [['GAS1.current-candidate.gs',gas1],['GAS2.current-candidate.gs',gas2]]) {
 new vm.Script(text,{filename:name});
 if(name.startsWith('GAS1')) {const context=vm.createContext({});vm.runInContext(text,context);for(const match of context.getAppHtml().matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:'generated-client.js'});}
 fs.writeFileSync(path.join(root,'candidate',name),text);
}
console.log('Built syntax-checked candidates from exact redacted supplied sources. No live deployment verified.');
