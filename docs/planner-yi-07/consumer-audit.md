# 既存卒業consumer監査（第1段階）

基準: `a4c9a088680b376daf7a66a22b62d755036a2107`。2026-10-18。実装者による調査であり、独立監査完了ではない。

## 数量authority

| 数量 | 現在の正本・consumer | 新Attemptを代入した場合の危険 |
| --- | --- | --- |
| 制度構成単位 | CurriculumCourse/Mapping、YI-02 Placement.compositionCredits | 構成4を本人寄与4とみなすと未完成S2を完成にする |
| 旧登録単位 | 原版Offering.credits | 同じ制度4のS2、翌年度の開講なしAttemptへ無条件fallbackできない |
| 本人寄与 | PlannerItem.courseCreditContribution、新plan.contribution | 旧helperは `?? offering.credits`。省略/nullを通すと未知を数値に変える |
| 公式修得単位 | ImportedCourseAchievement.earnedCreditsTotal | 内訳や手動値で再構築・補完・加算しない |
| 公式内訳単位 | ImportedStudyRecord.credits、parent sourceCourseId | aggregateに足さない。詳細ID参照は排他的な履修回割当の証明ではない |
| スクーリング単位 | 原行S、検証済みmedia/反復証拠、旧Offeringの方式・登録量 | 本人寄与の方式ラベルだけでS実績を作れない。ordinary/Sの独立枠を同じ数値へ潰さない |
| 完成判定量 | completedCurriculumCredits、公式completedCredits、書道専用モデル | earned状態や寄与合計だけでは特殊完成・反復・科目数を保証しない |
| 最終卒業算入 | professionalCards等の排他的配分後の数量 | OfficialAllocationInput.creditsも入力budget。法律部分S2、上限・振替を通す前は最終算入ではない |

## 処理順と依存

`src/planner/graduation/graduationProgress.ts:calculateGraduationProgress` の入力はitems/catalog/scope、公開催科目、卒論選択・scope進捗、公式原行/内訳、本人profile、旧Offering ownerの通信進捗。

1. 入学区分別認定と卒論policyを決定。scopeが不明なら空結果、卒業最終判定は常にfalse。
2. `deriveOfficialGraduationFacts` がexact制度ID、Course.mappingIds、全候補の同等signature、duplicate、aggregate、認定重複、特殊条件を検査。内訳は方式・反復証拠であり加算原資ではない。
3. `plannerItemsWithoutOfficialEarned` が公式exact科目/明示source linkに属するmanual earnedを除外。公式heldでも除外し、planned/in_progress/waitingは独立保持。
4. 認定専門科目の旧Offering参照をordinary専用入力へ加える。schooling入力へは加えない。この既存認定互換処理を新Attempt用変換として再利用しない。
5. `evaluateStructured` と grouped/professional cards を評価。前者の対象名称→Offering→Mapping、科目数のOffering ID集合、後者のCurriculumEntry groupingには旧入力の意味がある。
6. 通常科目完成、書道専用完成、史学順序・5科目gate、地理段階配分、反復上限、選択必修超過移動、法律8科目32単位ANDと部分S2を処理。日本文学/地理の一部Structured minimaと法律totalは配分結果を共有。
7. 認定・卒論・公開科目を別ownerでoverlay。ordinary/Sの未解決影響を局所化し、既知のquantityとevaluationを分離。
8. referenceProgressへ排他的普通量、独立S、認定を反映。unknownReasons/coverageSummary/公式通知/史学diagnosticを組み立てる。

## Offering/PlannerItemに依存する箇所

| consumer | 依存・危険経路 |
| --- | --- |
| evaluateStructured | Offering存在必須、名称一致でtarget Mapping集合、Offering IDによる科目数、full_course条件、ordinary寄与とS登録量の分岐 |
| groupedCards | Offering.credits/method/name。外国語S、体育choose-one、基礎特講上限を本人寄与へ単純置換できない |
| curriculumEntryKey/professionalCards | 制度ID＋scope分類signature、旧Mapping fallback、完成4と寄与2、書道の厳密IDと添削進捗owner |
| historySeminar/overview | 旧開講名のfamily/分野、earnedOrderの連続一意性、S5科目の完成で演習2の移動。予定年やUUID順は証拠でない |
| repeatableRule | 旧開講名のfamily、Offering ID集合で回数。新Attempt IDが別でも制度上独立な修得を証明しない |
| geographyTransferRules | 旧Course canonicalName/開講名互換fallback、earned→in_progress→planned、段階cap、不可分のOffering数量。新履修回の分割/順序を推測できない |
| countedSchoolingCredits | Offering.method/creditsと制度完成・上限。本人希望mediaを公式Sへ変換できない |
| recognition/public/thesis | source owner/独立ID/scope進捗。Attemptへ変換・重複加算しない。指導記録は完成証明と同義でない |
| unresolvedEarnedImpact | manual_review Offeringの明示Mapping候補を不確実性としてだけ使用。新Attemptを擬似Offeringにして通さない |
| unresolvedOfficialImpact/unresolvedSchoolingImpact | exact Course/Mappingから潜在的な振替先、S30と法律S8、外国語を別に保留。未知Attemptの追加でこの既知公式数量をnull化しない |

## 読んだ設計・根拠

年度非依存design/migration、YI-01 README/台帳・handoff、YI-02/03/04 README、YI-04/05/06 handoff、YI-06 persistence-contract/portable-recovery、Attempt validator/migration/persistence、上記全consumerとtests/planner.test.mjsを照合。

- [Issue #133](https://github.com/wata-0911/housei-media/issues/133): 未確認を推測で達成にせず、両監査flag=falseを維持。大学への追加照会は今回実施していない。
- [PR #156](https://github.com/wata-0911/housei-media/pull/156): 未完成寄与を通常完成として算入しない。法律S2の限定例外と、日本文学/地理の完成配分を共有する範囲。
- [PR #157](https://github.com/wata-0911/housei-media/pull/157): 書道添削一括＋S1/別開講S1＋S1、状態別寄与、公式2/S1・2/S2優先。
- [PR #162](https://github.com/wata-0911/housei-media/pull/162): native source-v2、全slot照合、別原年度/日付とaggregate一致による反復。コピー競合・0矛盾・H19/H43 fallback禁止。
- [PR #75](https://github.com/wata-0911/housei-media/pull/75): 卒論未定のtargetと既知quantityを分ける。

YI-04 projectLegacyStateは未編集target完全一致専用。新adapterはこのAPIをimportしない。旧engine本体・既存公式規則・catalog・保存契約を変更せず、retained-onlyの既存出力を比較可能な別軸として返す。
