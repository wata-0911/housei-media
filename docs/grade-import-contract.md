# 成績表 import contract v1

`HoseiGradeImportV1` は、法政Web学習サービスの成績表をローカルの Chrome 拡張が読み取るための、versioned JSON hand-off format です。`schemaVersion: 1` と source を固定し、Planner は `isHoseiGradeImportV1` で全フィールドを再検証します。

この contract に `offeringId`、catalog 名への変換、Planner 状態、最終評価は含めません。単位修得試験の評価は科目最終評価ではないためです。Plannerは名称のtrimと空白正規化だけで照合し、一意一致以外は確認対象です。

各表示値は raw を保存します。日付は有効な日付だけ ISO `YYYY-MM-DD` に正規化し、無効値は `null` と raw を保持します。リポートは empty / `○` / `×` / `*` / その他を、それぞれ none / passed / resubmit / processing / unknown として表現します。`×` を成績の D と解釈しません。

スクーリングは slot 1・2 を独立して保存します。24 logical cells でない table row は解析せず、`***` で始まる category row は次の科目の `categoryRaw` にのみ引き継ぎます。

## 24 logical columns と年度

列は科目名、構成単位・追加履修・認定/免除・修得・スクーリング単位、リポート1〜4、単位修得試験（日付・単位・評価）、スクーリング1と2（各 年度・期・日付・単位・評価）の順です。一行には通信とスクーリングが共存できるため、Plannerでは通信1件と各スクーリングslotを別々の実績候補にします。

スクーリングの明示年度は `25` を `2025` に正規化して初期値にし、元の文字列も保持します。通信には年度列がないため、日付だけから年度を決めず未設定にします。利用者が直した年度はmanual、将来安全な既存計画から補う場合だけinferredとして表示します。

`*4` は保留マーカー付きの4単位であり、`pendingMarker: true` と `credits: 4` を同時に保持します。componentの試験・スクーリング評価は最終評価へコピーしません。カタログにないImported Courseは卒業要件mappingを持たず、`graduationCheckComplete=false` は変わりません。

## 成績取り込み時の履修計画への仮登録（schema v22）

取り込みは公式の `ImportedCourseAchievement` / `ImportedStudyRecord` を保持したうえで、具体的なOfferingを安全に一意照合できる場合だけ通常の `PlannerItem` も作成します。手動JSONと拡張機能のdirect handoffは、同じプレビュー・反映経路を通ります。

- 詳細レコードは既存の名前（trim・空白正規化）＋履修形態matcherの候補が1件で、プレビューの照合先とも一致する場合に登録します。詳細のない成績表行は、履修形態を問わず名前の候補が1件である場合に限ります。いずれもカタログ上 `resolutionStatus=matched` かつ `courseId` が存在することを確認します。
- `sourceCourseFor` の `exact_unique` はcourseIdの一意性を表し、`selectedOfferingId` は代表Offeringの場合があります。自動登録helperはこの代表値を使用せず、現在の全カタログから具体Offeringの候補数を再確認します。曖昧・未一致はImported-onlyとして保持します。新たなfuzzy matchingや表示時identityの書き換えは行いません。
- 生成は検索追加と同じ `plannerItemFromCourseSearch` を使います。一意な公式sourceの `earnedCreditsTotal !== null && earnedCreditsTotal > 0` が確認できる新規項目は `earned`、null / 0は `planned` です。複数sourceが同じOfferingへ競合する場合はplannedを維持します。component grade・schooling grade・exam grade・reportから修得を推測しません。学年・修得順は `null`、評価や進捗はコピーしません。年度はsourceの明示値またはプレビューでのmanual入力が、同じOfferingの選択済みレコード間で一致する場合だけ設定します。推定年度や競合は `null` です。Plannerの既定年度2026をimportの確定年度として扱いません。
- 時期は元の期と一致し、既存Plannerの標準値（前期・後期・通年・夏期・冬期・その他）で、同じOfferingのレコード間に競合がない場合だけ設定します。「夏」「冬」「前期メディア」等は変換・推測せず `null` にします。
- 同一Offeringの既存PlannerItemとその評価・進捗は上書きしません。同じ取り込み内・再取り込みでもPlannerItemは増殖しません。公式状態の表示は既存のunified viewを維持し、Planner状態へ同期しません。
- 公式修得単位はImported側の科目行aggregateを正本とします。新規earned PlannerItemに任意の `importedSourceCourseId` を保存し、公式sourceを関連づけます。exactなCurriculumCourseの公式行がある場合、そのCourseのearned PlannerItemも計算入力から除外します。修得単位・区分・卒業進捗・指導条件は公式aggregateを優先し、単位を二重計上しません。年度上限の参考表示には通常の計画として含まれ、推定年度から年次を作成しません。
- 反映noticeは成績表行・詳細レコード・PlannerItemの実際の追加差分を表示します。既存のundo用state全体のsnapshotが、自動PlannerItemも含めて取り込み前へ戻します。
- 保存schemaは21、キーは `hosei-planner:v1`、`graduationCheckComplete=false` を維持します。永続provenanceを追加しないため、取り込み後の手動照合変更によるPlannerItemの生成・削除は対象外です。

### 保存済み成績の再取り込みによるPlannerItem補完

公式成績の `sourceDuplicate` 判定とPlannerItem生成を分離します。保存済み成績のプレビューは公式保存対象としては未選択のままですが、既存と同じ安全条件で具体Offeringが決まり、そのPlannerItemが存在しない場合はPlannerItemだけを仮登録します。Importedの科目行・詳細・照合先等は書き換えず、同じ操作の再実行は完全no-opです。曖昧・未一致は補完しません。

UIの実行ボタンも反映処理と同じpure helperで候補を判定し、安全な補完候補があれば件数を表示して実行できます。候補がなく公式成績への変更もなければボタンは無効です。初期値・年度と時期の安全な仮入力・公式単位の正本性・schema v22・全state snapshotによるundoは変更しません。
