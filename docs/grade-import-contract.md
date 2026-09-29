# 成績表 import contract v1

`HoseiGradeImportV1` は、法政Web学習サービスの成績表をローカルの Chrome 拡張が読み取るための、versioned JSON hand-off format です。`schemaVersion: 1` と source を固定し、Planner は `isHoseiGradeImportV1` で全フィールドを再検証します。

この contract に `offeringId`、catalog 名への変換、Planner 状態、最終評価は含めません。単位修得試験の評価は科目最終評価ではないためです。次の feature が、安全な照合と明示的な適用画面を実装します。

各表示値は raw を保存します。日付は有効な日付だけ ISO `YYYY-MM-DD` に正規化し、無効値は `null` と raw を保持します。リポートは empty / `○` / `×` / `*` / その他を、それぞれ none / passed / resubmit / processing / unknown として表現します。`×` を成績の D と解釈しません。

スクーリングは slot 1・2 を独立して保存します。24 logical cells でない table row は解析せず、`***` で始まる category row は次の科目の `categoryRaw` にのみ引き継ぎます。
