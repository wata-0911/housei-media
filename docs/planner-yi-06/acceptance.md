# YI-06 受入記録

実施日: 2026-10-16 JST。基準dev `a0fa267ca1acd4663c399da394552c46de366cbc`。合成fixtureと隔離DBのみを使用し、実利用者stateは読み書きしていない。独立監査前の実装者検証。

## 実施範囲

単体/統合は、v22・旧backup v1/v2 × 手動/公式/混在/孤立owner、原数量/順序/optional保持、日付heldと明示訂正、同操作再送・衝突、全進捗/評価/TODO編集、将来年度の同名別Attempt、寄与の省略/null/0/正値、保存→再読込、削除2順/3件全6順のLIFO、偽snapshot/receipt/owner、削除TODO ID、backup反復復元後も永久ID予約、原版/rule/hash/未知field/未来版、不正JSON、stale preview/Lock待機、read/write/quota/Lockなし、容量上限、原文保護を検証。

Playwright + Chromium headless shell 1243、PC1280×900・390×900で実React画面を操作。fixture移行preview→保護ファイルdownload→明示保存→reload→追加/予定編集→保存→新backup download→ファイル選択→復元を実行。同ファイルを2回復元し全state一致。削除→保存→reload→古いUndo拒否→逆順Undo、日付訂正2種、native Web Lockの別タブ競合、注入QuotaExceededError、Web Locksなしも確認。

通常のprimary/recoveryへ識別用の原バイトを先置きし、全Storage APIをtrap。新UIのget/set/remove/clear呼び出し0、両原バイト不変、予期しないpageerror 0を検証。新規originでpreview/取消後もIndexedDB自体が作成されないこと、破損保存はreload時に拒否され原文をdownloadできることも確認。

[PC画面](screenshots/1280.png)、[390px画面](screenshots/390.png)は実行から取得し目視。横overflow検査も実施。実保存容量は[capacity.json](capacity.json)。画像は実個人情報を含まない合成fixture。

## コマンド結果

最終集計は `test-results.json`、各回帰コマンドの終了状態は[regression-results.json](regression-results.json)。テストsuiteの重複を合算しない。`test:planner`はattempts/migration/attempt-ui/institutional/新persistenceを内包する。

| コマンド | 結果 |
| --- | --- |
| `npm run test:attempt-persistence` | 63 PASS / 0 FAIL / 0 SKIP |
| `追加の対象テスト（単体）` | 2 PASS / 0 FAIL / 0 SKIP |
| `npm run test:attempt-persistence-browser` | 10 PASS / 0 FAIL / 0 SKIP |
| `追加の対象テスト（Chromium）` | 1 PASS / 0 FAIL / 0 SKIP |
| `npm run test:attempts` | 132 PASS / 0 FAIL / 0 SKIP |
| `npm run test:migration` | 133 PASS / 0 FAIL / 0 SKIP |
| `npm run test:attempt-ui` | 84 PASS / 0 FAIL / 0 SKIP |
| `npm run test:attempt-ui-browser` | 9 PASS / 0 FAIL / 0 SKIP |
| `npm run test:institutional` | 36 PASS / 0 FAIL / 0 SKIP |
| `npm run test:planner` | 3452 PASS / 0 FAIL / 0 SKIP |
| `npm run test:extension` | 54 PASS / 0 FAIL / 0 SKIP |
| `npm run test:bookmarklet` | 168 PASS / 0 FAIL / 0 SKIP |
| `npm run test:planner-browser` | 43 PASS / 1 FAIL / 0 SKIP（既知1件、最新devでも再現） |
| `npm run typecheck` / `npm run lint` / `npm run build` | すべて終了0 |
| `git diff --check` / `python3 docs/planner-yi-01/verify.py` | 終了0 / PASS |

YI-06は単体63件の一括実行後に追加1件を対象実行して**固有64件**、Chromium10件の一括実行後に追加1件を対象実行して**固有11件**を検証した。対象実行に含む再確認ケースは重複加算しない。Planner一括実行時は新63件を含む3,452件であり、追加1件は上記の対象実行で確認。全件を64/11として一括実行済みと扱わない。

## 既知の旧ブラウザ失敗

最新devを別ディレクトリにgit archiveし、`restore invalidates an unsaved media draft even when the stored value is identical`を再実行。`tests/planner-save-lock.browser.mjs:315`のbackup region内file input待機が30000ms timeoutとなる。#145でbackup欄が年間計画へ移動した一方、testはメディアタブで探す。同じ失敗を今回ブランチの全既存suiteでも区別し、skip/削除/期待値変更はしていない。[基準devの再現ログ](baseline-browser-failure.txt)。この1件を今回の保存変更に混ぜず別Issueで調整することを提案する。

## ビルド・配信隔離

基準devを同じ依存でbuildし、通常build、`YI06_PERSISTENCE=1 YI05_WORKBENCH=1` buildと全path/SHA256比較。[build-comparison.json](build-comparison.json)。catalog/schema22/PlannerPage/旧storage/旧backup/engineの差分なし。flag無効・不正flag・query・直接module・encoding・`/@fs`経由を拒否し、production mode serveでも404。

production成果物をflag付きVite previewで実配信して検証。[production-preview.json](production-preview.json)の200は通常indexへのSPA fallbackであり、新entry/moduleを配信したものではない。本文に新entry importやcontrollerがなく、静的成果物にも新moduleがないことを確認。

## 実行中の調整と未実施

初回ブラウザ起動は試験port4190がFetchの禁止portだったため失敗。4206へ修正して再実行した。最初のsandbox実行はローカルlistenがEPERMのため、ローカルサーバー/Chromium実行許可で再実行。これらを製品PASSに数えず、最終の実assertion結果を記録する。

容量上限とQuotaExceededErrorは注入による失敗試験。端末の実ディスクを埋める破壊的試験は実施していない。容量測定のUTF-8サイズはIDB実ディスク割当量ではない。複数suite同時実行中の遅延を端末性能保証に使わない。

iPhone Safari実機、Files保存操作、Firefox、スクリーンリーダー実機、日本語IME実機、低速端末・巨大長期履歴の実負荷は未実施。YI-08へ引継ぐ。別端末/DB消失時の新backup復旧は実装上拒否される未対応領域であり、PASSやYI-06完全完了とはしない。
