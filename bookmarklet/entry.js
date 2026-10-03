import { extractCurrentDocument } from '../shared/grade-import/extractor.js';
import { isHoseiGradeImportV1 } from '../src/planner/gradeImportContract.ts';
import { serializeGradeImport } from './serialize.ts';
import { copyText } from './clipboard.js';

async function run() {
  try {
    // Only inspect the current document. Never traverse frames or read login inputs.
    if (location.protocol !== 'https:' || !(location.hostname === 'hosei.ac.jp' || location.hostname.endsWith('.hosei.ac.jp'))) {
      alert('法政大学のWeb学習サービスにログインし、成績表ページで実行してください。');
      return;
    }
    const outcome = extractCurrentDocument();
    if (!outcome.ok) {
      alert(outcome.reason === 'table_not_found'
        ? '成績表が見つかりません。Web学習サービスの成績表ページで実行してください。'
        : '成績表は見つかりましたが、科目行が見つかりません。ページを再読み込みしてお試しください。');
      return;
    }
    const payload = outcome.value;
    if (!Array.isArray(payload.courses) || !isHoseiGradeImportV1(payload)) {
      throw new Error('成績データの形式を検証できませんでした。コピーしていません。');
    }
    const { diagnostics } = outcome;
    const tieNote = diagnostics.tieCandidateIndexes.length > 1
      ? `\n同数の候補テーブルが${diagnostics.tieCandidateIndexes.length}個あります。既存ルールにより候補${diagnostics.selectedCandidateIndex + 1}を使用しました。`
      : '';
    // Diagnostics contain counts/indexes only, and never become part of the contract.
    console.info('Hosei grade import diagnostics', diagnostics);
    const copied = await copyText(serializeGradeImport(payload));
    alert(`${payload.courses.length}科目の成績JSONを生成しました。${tieNote}\n${copied
      ? 'コピーしました。Plannerの「JSONを貼り付け」に貼り付け、「読み込み・検証」を押してください。'
      : 'クリップボードへのコピーに失敗しました。ブラウザのコピー権限を確認して再実行するか、Chrome拡張のJSON保存をご利用ください。'}`);
  } catch {
    // Do not expose page-derived values or an exception stack in the UI/log.
    alert('成績データの読み取り・形式検証に失敗しました。コピーしていません。成績表ページを確認してください。');
  }
}
void run();
