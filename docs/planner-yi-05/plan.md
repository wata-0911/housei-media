# YI-05 実装前計画

基準 origin/dev: afed0a9b6cb463fcbf7395e43fc817c6e30a18b0。独立clone / feat/yi-05-isolated-attempt-ui。既存worktreeと#145は変更しない。

## 現状と変更対象

既存PlannerPageはloadState(localStorage)とcommit/savePlannerStateを所有し、Offering IDをキーに計画・進捗・評価を更新する。courses/progress等の子コンポーネントはPageのcallbackを呼ぶ。バックアップパネルは独自にrawとLockを扱う。これらは新画面には再利用しない。

- src/planner/attempts/workbench/: 純粋な操作、ID発行、参照選択、view model、migration session。YI-03/04 validatorを利用。
- dev/attempts/: 独立React entry、controller、科目検索・Attemptフォーム・進捗・評価・TODO・移行保留UI。production App/PlannerPageは変更しない。
- vite.config.js: serveかつ非productionかつ明示環境変数の時だけ開発entryを配信。標準buildのentryは既存のまま。
- tests/: CRUD/不変条件、migration訂正、実Reactブラウザ操作、storage getter/write trap、flag境界。
- docs/planner-yi-05/: 操作契約・動作確認・結果・YI-06/07引き継ぎ。

## 契約

新規操作にUUIDv4の操作ID/Attempt IDを一回発行。同操作receiptはメモリ内で保持し、別payloadの再送は拒否。編集は明示fieldだけを許しowner/他Attemptを維持。削除/UndoはYI-03の厳密なsnapshot/元active位置契約を使用。復元不能な順序競合は保留し、clampやticketの捏造はしない。新履修回は新IDで進捗なし。

進捗編集とTODO owner変更は別操作。payload編集でownerを変更できない。数量・評価・日付はYI-03で拒否し、入力draftを残す。null/0/省略を区別。本人適用はunknownのまま。

migrationは隔離fixture原文のみ。decode→固定割当→preview→ready graphを一度初期化。元target/原文/retainedは保持。CRUD後にpreservation検証や旧projectionを適用しない。同source再previewは固定表を再利用。日付訂正は原文と提案比較・明示確認後に別rawを全decode/preview。新digestには新ID割当が必要なことを明示し、旧IDを無断継承しない。

## 検証方針

指定9npmコマンドとdiff checkを実行。新しい純粋操作テストをtest:plannerへ追加。既存ブラウザsuiteと新React UIのPC/モバイル・キーボード操作をChromiumで確認。localStorage read/write trapとproduction buildの基準devとの全ファイルSHA比較で隔離を検証。過去PASSは今回の結果に含めない。iPhone Safari実機は未実施として明記。
