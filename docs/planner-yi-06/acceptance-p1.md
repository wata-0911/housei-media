# 独立監査P1修正の受入追補

既存Issue #175・Draft PR #176・`feat/yi-06-attempt-persistence`を継続。基準devは再fetchして`a0fa267ca1acd4663c399da394552c46de366cbc`のまま。合成fixtureと隔離保存のみで検証し、実利用者データは使用していない。通常v22のコード、保存/backup契約、卒業engineは変更していない。

## 空DBからの実復旧

Playwright + Chromium headless shell 1243で、ブラウザAの独立contextで保存・複数Attempt追加・TODO作成/削除・複数削除を実施し、UIからbackup v2をdownloadした。別BrowserContextのブラウザBは別port/originで起動し、IndexedDB一覧が空であることを確認した。別contextは独立profile相当であり、Firefox/Safari等の別製品実機を使った試験ではない。

Bでファイルを選択し、preview後もDB一覧が空であること、保護・全件置換確認だけでは保存ボタンが有効にならないことを確認した。保護ファイルの`backupRaw`が選択ファイル全文と一致することを確認し、別の「復旧元として採用」チェック後だけcommitした。実IndexedDBのputを観測し、初回は`versionchange` transactionで一回だけだった。

復元直後・reload後・同一backup再復元後の全stateをAとdeepEqualで比較した。Attempt/record/TODO ID、owner、receipt、source、原版、raw6、公式aggregate、非Attempt情報、数量、配列順を含む。削除TODO IDの再利用を拒否し、原DBが不変であることも確認した。最初の削除からのUndoは拒否し、逆順にUndoして元graph/owner/数量を復元した。[390px復旧画面](screenshots/portable-390.png)を目視確認し、横overflowも検査した。

## 拒否と保存の不変性

- 全namespaceについてsource・両catalog・初期割当・未使用予約・削除済みIDとの衝突を検証。旧sourceのTODO IDと非Attempt IDの衝突も拒否。
- 不正SHA、SHA再計算済みの偽receipt、raw6改変、catalog不一致、未来版、予約欠落/重複/未知prefixを拒否。以前の有効previewの後に不正ファイルを選んだ場合も、そのpreviewを取消す。
- 採用確認なし、別ファイルの採用情報、原文保護不一致、コピーpreview、確認前handleの編集を拒否。通常loadは可搬decoderへfallbackせず、host checkpoint欠落を拒否。
- 初回putへのQuotaExceededError注入で、state/証跡だけでなくDB作成自体もabortし、空DBを残さないことを実ブラウザで確認。Web Lockなしも同様に保存なし。
- native Web Lock待機中に別writerが初回保存した場合、待機側のCASがstale拒否し、勝ったwriterの空白を含むraw/metadataが完全に不変であることを確認。
- 既存の同一host内復元、quota、Lockなし、stale preview、通常primary/recovery原バイト不変、Storage API呼出し0の試験を維持。
- 現state外のrollback予約もbackup v2へ持ち出し、空hostで復旧後も再利用を拒否。未知の共有ID履歴は既存hostへの置換を拒否し、既知checkpointの巻戻しとID非重複置換では予約集合を維持。

## コマンド結果

| 対象 | 最終ローカル結果 |
| --- | --- |
| Planner全回帰（新YI-06 90件を含む） | 3,479 PASS / 0 FAIL / 0 SKIP |
| Attempt | 132 PASS / 0 FAIL / 0 SKIP |
| migration | 133 PASS / 0 FAIL / 0 SKIP |
| YI-05 UI単体 | 84 PASS / 0 FAIL / 0 SKIP |
| 原版 | 36 PASS / 0 FAIL / 0 SKIP |
| extension | 54 PASS / 0 FAIL / 0 SKIP |
| bookmarklet | 168 PASS / 0 FAIL / 0 SKIP |
| YI-05 Chromium | 9 PASS / 0 FAIL / 0 SKIP |
| 既存Planner Chromium | 43 PASS / 1 FAIL / 0 SKIP |
| YI-06 Chromium（可搬復旧・同一host復元） | 16 PASS / 0 FAIL / 0 SKIP |
| typecheck / lint / build / diff check / YI-01 verify | すべて成功 |

機械可読の最終集計は[p1-test-results.json](p1-test-results.json)。各コマンドの終了状態は[p1-regression-results.json](p1-regression-results.json)、[p1-browser-results.json](p1-browser-results.json)。Planner suiteは新旧の単体/統合suiteを含むため重複合算しない。

初回の新規単体実行は89件中88 PASS / 1 FAIL。予約集合の末尾（旧source UUID）を除去してSHAを付け直すケースで拒否漏れを検出したため、収録必須集合をstate履歴IDだけでなく旧source UUIDまで拡張した。該当1件の対象再実行はPASS。後から追加した旧source TODO衝突を含む対象12件もPASS。最終結果では初回失敗や対象再実行を全件PASSに読み替えない。

#145由来の旧メディアdraft復元testは最新devの別ディレクトリでも同じfile input待機timeoutを再現した。[基準dev再現ログ](p1-baseline-browser-failure.txt)。既存testをskip/削除/期待値変更していない。

## production・容量

基準dev・最終通常build・開発flag付きproduction buildの全12ファイルは、pathとSHA256がすべて一致した。[p1-build-comparison.json](p1-build-comparison.json)。通常v22の実装・既存browser testに差分はない。production previewの開発用URLは既存indexのSPA fallback（HTTP 200）で、新entry/moduleを含まない。[p1-production-preview.json](p1-production-preview.json)。通常primary/recovery原バイト不変、全Storage API呼出し0も実ブラウザで確認した。

合成mixed fixtureのstateは3,235,432 bytes、raw6は1,163,528 bytes、host recordのJSON表現は3,642,055 bytes、新backup v2は3,236,439 bytes。[capacity.json](capacity.json)。32MiB上限を維持し、原版archiveや予約を省略しない。計測値はIDB実ディスク割当量ではない。

## 保証外・未実施

[可搬復旧契約](portable-recovery.md)の脅威モデルを適用する。ファイル内部の整合性と利用者による採用を保証境界にし、発行者・実際の操作の真正性を認証しない。整合する全体改作、同一originの悪意あるscript、DevTools/profile改ざんは検出保証外。

旧Attempt backup v1単体で元hostを失った場合は、state外予約を補えず未対応。元hostがある場合はv1復元→v2書出しが可能。既存hostで未知の共有ID履歴が衝突する場合の自動マージ/分岐合流も未対応で、空の隔離環境を使う。

iPhone Safari・Files・Firefox・スクリーンリーダー・日本語IMEの実機、実ディスク枯渇、巨大長期履歴/低速端末の負荷は未実施。quotaは注入試験。YI-08の一般公開受入を完了したとは扱わない。Draft維持・未merge・Issue未close。
