let imported = null;
const handoff = globalThis.HoseiPlannerHandoffStore;
const $ = id => document.getElementById(id);
const status = text => { $('status').textContent = text; };
const injectAndRead = async tabId => {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['parser/extractor.js'] });
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.HoseiPlannerGradeExtractor.extractCurrentDocument() });
  return result.result;
};
$('read').addEventListener('click', async () => {
  $('result').hidden = true; status('成績表を読み取っています…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const outcome = await injectAndRead(tab.id);
    if (!outcome.ok) { status(outcome.reason === 'course_rows_not_found' ? '成績表は見つかりましたが、科目行を読み取れませんでした。ページを再読み込みしてもう一度お試しください。' : 'このページでは成績表を確認できません。Web学習サービスの成績表ページを開いてください。'); return; }
    imported = outcome.value; $('count').textContent = `${imported.courses.length}科目`;
    $('courses').replaceChildren(...imported.courses.map(course => { const item = document.createElement('li'); item.textContent = `${course.rawName} 構成${course.compositionCredits.raw || '—'}単位 / 修得${course.earnedCredits.raw || '—'}単位`; return item; }));
    $('result').hidden = false; status('');
  } catch { status('読み取りに失敗しました。成績表ページを開いてからもう一度お試しください。'); }
});
$('copy').addEventListener('click', async () => { if (!imported) return; await navigator.clipboard.writeText(JSON.stringify(imported, null, 2)); status('JSONをコピーしました。'); });
$('download').addEventListener('click', () => { if (!imported) return; const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(imported, null, 2)], { type: 'application/json' })); link.download = 'hosei-grade-import-v1.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); status('JSONを保存しました。'); });
$('planner').addEventListener('click', async () => {
  if (!imported) return;
  $('planner').disabled = true; status('Plannerを開いています…');
  try {
    const token = crypto.randomUUID();
    const stored = await chrome.runtime.sendMessage({ type: 'hosei-grade-handoff-store', token, importData: imported });
    if (!stored?.ok) throw new Error('handoff_unavailable');
    await chrome.tabs.create({ url: handoff.plannerUrl(token) });
    status('Plannerを開きました。内容を確認してから反映してください。');
  } catch { status('Plannerへ直接渡せませんでした。JSONを保存またはコピーして取り込めます。'); }
  finally { $('planner').disabled = false; }
});
