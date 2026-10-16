# YI-06 / YI-07 引き継ぎ

## YI-06 保存基盤

YI-05 Workspace、receipt、使用済みTODO ID、migration session/cacheはページ寿命のみ。新state schema番号やbackup形式として保存してはならない。リロードで消失する。一般利用者のprimary/recoveryを読む・書くAPIは追加していない。

保存工程では原raw/raw6/sourceCatalog・binding・発行履歴・receiptと新旧owner対応を監査し、Web Lock/expectedRaw/競合/原子的保存/失敗保護を設計する。YI-04発行receiptをJSONコピーから復元できるとは扱わない。永続的な同操作再送、旧タブ、別タブ、quota、長期Undo、容量上限、transactionは未実装。

独立監査P2により、YI-05のUndoは操作receiptで証明した削除の逆順だけを許可する。ticket単独のpreviousPositionや配列順から履歴を再構成してはならない。現在は削除receiptを失ったgraphからのUndoをfail-closedにするため、YI-06で履歴を永続化・復元する場合は順序の証明も保護する。YI-03 transition validator単独では複数ticket間の元順序を保証しない。

日付訂正は新source・新割当の方針。履歴を永続化するには原値・提案・明示確認・訂正前後のbinding/tableを保護する。安全なID継承が必要なら別の証明付き契約を監査する。現行は元rawを維持し、IDを引き継いだと表示しない。

YI-05のrecord編集は既存rowの消失を禁止する。必要なら将来、誤作成lesson/assessment/report削除を独立した明示操作として追加する。新履修回は過去進捗をコピーしない。TODO owner変更はexpectedOwner付きの専用操作を維持する。

## YI-07 卒業計算adapter

新画面には旧projectionも卒業engineも接続していない。YI-04の旧projectionは元sourceと完全一致した未編集target専用であり、YI-05合法編集後のgraphを通すために緩めない。新Attemptから架空Offeringを生成しない。

本人希望の方式・予定年・status・寄与は公式実績ではない。実績年度と公式aggregate、内訳の由来、本人適用課程、制度構成単位を別のauthorityとして扱う。公式earnedCreditsTotalを再集計/上書きせず、unknown/ambiguous/conflictの理由・候補を算入成功に昇格させない。一般公開はYI-08の判断を待つ。

## 独立監査の重点

- P1: production成果物/entry、storage getter/write trap、既存v22全経路不変、feature flagのserve/production境界。fixture/sourceの参照と正式原版、訂正の一field限定、heldを成功扱いしないこと。
- P1: CRUDの許容差分、owner不変と明示TODO再割当、再送receipt衝突、削除/Undoで全payload保持、編集graphが旧計算へ入らないこと。
- P2: 複数削除後のUndo元位置衝突と復元順、フォームの未確定draft、同時イベント、IME・キーボード・selectラベル、モバイルの長いID表示。
- P2: ページ内session/receiptのメモリ量と大規模入力時の応答、訂正でIDを新規発行する運用上の再確認。Safari実機とスクリーンリーダーの実機検証。

最新devの既存メディア復元ブラウザtestは#145によるバックアップ欄のタブ移動と前提が不一致で、YI-05なしでも1件failする。[再現記録](acceptance.md)を参照し、#145側の仕様・test期待の調整を別途判断する。

これは独立監査の結果ではなく、レビュー対象。Draft解除・merge・Issue closeを実施しない。
