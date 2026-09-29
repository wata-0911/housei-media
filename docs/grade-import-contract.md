# 成績表 import contract v1

`HoseiGradeImportV1` は、法政Web学習サービスの成績表をローカルの Chrome 拡張が読み取るための、versioned JSON hand-off format です。`schemaVersion: 1` と source を固定し、Planner は `isHoseiGradeImportV1` で全フィールドを再検証します。

この contract に `offeringId`、catalog 名への変換、Planner 状態、最終評価は含めません。単位修得試験の評価は科目最終評価ではないためです。Plannerは名称のtrimと空白正規化だけで照合し、一意一致以外は確認対象です。

各表示値は raw を保存します。日付は有効な日付だけ ISO `YYYY-MM-DD` に正規化し、無効値は `null` と raw を保持します。リポートは empty / `○` / `×` / `*` / その他を、それぞれ none / passed / resubmit / processing / unknown として表現します。`×` を成績の D と解釈しません。

スクーリングは slot 1・2 を独立して保存します。24 logical cells でない table row は解析せず、`***` で始まる category row は次の科目の `categoryRaw` にのみ引き継ぎます。

## 24 logical columns と年度

列は科目名、構成単位・追加履修・認定/免除・修得・スクーリング単位、リポート1〜4、単位修得試験（日付・単位・評価）、スクーリング1と2（各 年度・期・日付・単位・評価）の順です。一行には通信とスクーリングが共存できるため、Plannerでは通信1件と各スクーリングslotを別々の実績候補にします。

スクーリングの明示年度は `25` を `2025` に正規化して初期値にし、元の文字列も保持します。通信には年度列がないため、日付だけから年度を決めず未設定にします。利用者が直した年度はmanual、将来安全な既存計画から補う場合だけinferredとして表示します。

`*4` は保留マーカー付きの4単位であり、`pendingMarker: true` と `credits: 4` を同時に保持します。componentの試験・スクーリング評価は最終評価へコピーしません。カタログにないImported Courseは卒業要件mappingを持たず、`graduationCheckComplete=false` は変わりません。
