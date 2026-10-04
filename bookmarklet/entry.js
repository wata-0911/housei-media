import { extractCurrentDocument, isSafeExtractionFailure } from '../shared/grade-import/extractor.js';
import { diagnoseHoseiGradeImportV1 } from '../src/planner/gradeImportContract.ts';
import { GradeImportSerializationError, serializeGradeImport } from './serialize.ts';
import { copyText } from './clipboard.js';

// Error messages/stacks from the page never reach these sinks. Even a broken
// console/alert must not turn a handled failure into an unhandled rejection.
const notify = message => { try { alert(message); } catch { /* no unsafe fallback logging */ } };
const logDiagnostics = diagnostics => { try { console.info('Hosei grade import diagnostics', diagnostics); } catch { /* optional */ } };
const structure = issue => issue ? `\ncourse index: ${issue.courseIndex ?? '—'} / field: ${issue.fieldPath} / category: ${issue.category}` : '';
const fail = (code, message, issue = null) => notify(`[${code}] ${message}${structure(issue)}\nコピーしていません。`);

async function run() {
  let outcome;
  try {
    // Only inspect the current document. Never traverse frames or read login inputs.
    if (location.protocol !== 'https:' || !(location.hostname === 'hosei.ac.jp' || location.hostname.endsWith('.hosei.ac.jp'))) {
      fail('GI_ORIGIN', '法政大学のWeb学習サービスにログインし、成績表ページで実行してください。');
      return;
    }
    outcome = extractCurrentDocument();
  } catch (error) {
    if (isSafeExtractionFailure(error)) {
      // Only the identity-branded, null-prototype failure built by our extractor.
      // Keep the existing family code alongside the more precise boundary code.
      let position = '';
      if (error.tableIndex !== undefined) position += `\ntable index: ${error.tableIndex}`;
      if (error.rowIndex !== undefined) position += `\nrow index: ${error.rowIndex}`;
      if (error.cellIndex !== undefined) position += `\ncell index: ${error.cellIndex}`;
      if (error.field !== undefined) position += `\nfield: ${error.field}`;
      fail(error.code, `成績表の読み取りに失敗しました。 [GI_EXTRACT_EXCEPTION]${position}`);
    } else fail('GI_EXTRACT_EXCEPTION', '成績表の読み取りに失敗しました。');
    return;
  }
  if (!outcome.ok) {
    if (outcome.reason === 'table_not_found') fail('GI_EXTRACT_NO_TABLE', '成績表が見つかりません。Web学習サービスの成績表ページで実行してください。');
    else fail('GI_EXTRACT_NO_COURSES', '成績表は見つかりましたが、科目行が見つかりません。ページを再読み込みしてお試しください。');
    return;
  }
  const payload = outcome.value;
  let issue;
  try {
    issue = !Array.isArray(payload.courses)
      ? { courseIndex: null, fieldPath: 'courses', category: 'type' }
      : diagnoseHoseiGradeImportV1(payload);
  } catch { fail('GI_CONTRACT_EXCEPTION', '成績データの形式検証を実行できませんでした。'); return; }
  if (issue) { fail('GI_CONTRACT_INVALID', '成績データの形式検証に失敗しました。', issue); return; }

  let text;
  try { text = serializeGradeImport(payload); }
  catch (error) {
    if (error instanceof GradeImportSerializationError) fail(error.code, 'コピー用JSONの生成・再検証に失敗しました。', error.issue);
    else fail('GI_SERIALIZE_EXCEPTION', 'コピー用JSONの生成・再検証を実行できませんでした。');
    return;
  }
  const { diagnostics } = outcome;
  const tieNote = diagnostics.tieCandidateIndexes.length > 1
    ? `\n同数の候補テーブルが${diagnostics.tieCandidateIndexes.length}個あります。既存ルールにより候補${diagnostics.selectedCandidateIndex + 1}を使用しました。`
    : '';
  // Counts/indexes only, never the payload. Console is not required for copying.
  logDiagnostics(diagnostics);
  let result;
  try { result = await copyText(text); }
  catch { notify('[GI_CLIPBOARD_EXCEPTION] コピー結果を確認できませんでした。'); return; }
  const codes = result.codes.length ? `\n診断コード: ${result.codes.join(', ')}` : '';
  notify(`${payload.courses.length}科目の成績JSONを生成しました。${tieNote}\n${result.ok
    ? 'コピーしました。Plannerの「JSONを貼り付け」に貼り付け、「読み込み・検証」を押してください。'
    : 'クリップボードへのコピーに失敗しました。ブラウザのコピー権限を確認して再実行するか、Chrome拡張のJSON保存をご利用ください。'}${codes}`);
}
void run();
