importScripts('planner-target.js', 'planner-target-config.js', 'handoff-store.js');
const handoff = globalThis.HoseiPlannerHandoffStore;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'hosei-grade-handoff-store') { handoff.store(chrome.storage.session, { token: message.token, importData: message.importData }).then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'storage_unavailable' })); return true; }
  if (message.type === 'hosei-grade-handoff-read') { handoff.read(chrome.storage.session, { token: message.token, senderUrl: sender.tab?.url ?? sender.url ?? '' }).then(sendResponse).catch(() => sendResponse({ ok: false, reason: 'storage_unavailable' })); return true; }
});
