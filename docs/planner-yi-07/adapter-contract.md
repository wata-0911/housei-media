# 共通read-only adapter契約

## 呼出しと信頼境界

```ts
import { adaptAttemptGraduation } from '../../src/planner/attempts/graduation/adapter';

// YI-04 decode/previewの未編集targetにも、YI-05編集済みgraphにも使える。
const result = adaptAttemptGraduation({ graph, retained }, decodedSource, selectedScopeId);

// YI-06で再読込した検証済みhandleからもread-onlyで実行できる。
const loaded = await persistence.load();
if (loaded) {
  const result = adaptAttemptGraduation(loaded.state, loaded.source, selectedScopeId);
}
```

`SourceArchive` は既存decoderが受理したlive handleを要求する。JSONコピーを自己認証させない。YI-06 loadは元raw/raw6・全履歴・authorityを既存手順で検証してからこのhandleを返す。adapter自体は保存・発行・履歴認証を行わず、ID付きgraphを既存validatorで独立検証する。本人の合法な自己申告を大学の公式証明とは扱わない。

`retained` の全field/省略/null/配列順を元sourceの同じ非Attempt部分と完全比較する。編集可能なgraphを元sourceと比較しない。YI-04の割当表、ledgerや`projectLegacyState`を新算入用に使用しない。非Attempt情報の編集・新取込は第1段階の入力契約外であり、source再検証と別の明示contractを要する。

未知scope、未検証source、retained変更、invalid graphは`status=rejected`と既存validator等の診断。構造的に正常なunknown/ambiguous/conflict/unmatched、未確認課程は`status=adapted`で情報を保持する。`adapted`は算入成功ではない。

## 出力

| field/type | 意味 |
| --- | --- |
| `AttemptGraduationResult` | rejectedまたはadapted。両最終監査flagはfalse |
| `graph` / `retained` | deep cloneしてfreezeした完全な記録。元inputをfreeze/変更しない |
| `source` | 元raw SHA、元catalog SHA、資料revision、明示scope。SHAは破損検出・識別であり大学認証ではない |
| `attempts[].record` | Attempt ID、identityと確定状態/候補、cp/cv/scope/evidence、本人適用、方法/由来、予定年と実績年、本人寄与、修得順、旧参照を全保持 |
| `placementCandidates` | explicit候補・exact ICの配置・監査候補のunion。全件返し、先頭を採用しない |
| `quantities` | 構成、本人寄与、旧登録量の独立authority。参考量を算入へコピーしない |
| `official` | aggregate所有ID、重複可能性ID、参照detail ID、複数Attemptで共有するdetail ID。数量の配分ではない |
| `evidence` | owner record ID、同exact ICのactive Attempt ID、本人修得順、潜在規則familyとunsupported capability |
| `decisions` | completion / ordinary / schooling / inProgress / plannedごとの判定。入力量と最終算入は別 |
| `diagnostics` | 理由code、影響する軸、IDでaddressするsource path。配列index式JSON Pointerではない |
| `impact` / `attemptImpacts` | 当該scopeで影響し得るrequirement/card/referenceのunion。配分や合計ではない |
| `unresolvedOwners` | 元旧owner参照と理由。payloadはgraphに保持し、別Attemptへ付替えない |
| `officialEvidence` | 既存deriveOfficialGraduationFactsのfacts/allocations。allocationは最終算入前の入力budget |
| `retainedProgress` | items空で既存engineを呼んだretained-only結果。公式/認定/公開/卒論を既存規則のまま評価。新Attempt合算結果ではない |

**consumerは`retainedProgress`を新モデル全体の卒業判定として表示してはいけない。** 数値の近くにその対象範囲と`attemptImpacts`の保留を表示し、未対応量を0へ変換しない。raw寄与・detail・officialEvidenceとretainedProgressを加算しない。第1段階はUIへ接続しない。

## 数量authorityとゼロ

`RecordedQuantity`は`omitted`、`unknown/value:null`、`zero/value:0`、`positive/value:number`。記録の省略/null/0/正値を別にする。

1. 構成単位: confirmed Placementからのみ取得。未確定候補の量は各candidate内に保持し、主量はomitted。ICから本人量を作らない。
2. 旧登録単位: known legacy Offering refと元catalogの実在IDに限定した参考値。新Attemptへfallbackしない。
3. 本人寄与: `plan.contribution`だけ。方法欄がschoolingでもS実績や完成量とは認定しない。
4. 公式aggregate: `retained.importedCourseAchievements[].earnedCreditsTotal`が唯一の正本。fingerprint/source/rawName/categoryRaw/capturedAt/全数量/任意field/順序を保持。
5. 公式内訳: 全recordとsourceCourseIdを保持。単純合算・複数Attemptへの配分なし。共有参照はdiagnosticとなり排他的な履修回証拠として使わない。
6. S量: 原行S/既存の検証済み公式証拠と、新Attempt本人寄与を分ける。本人ordinary寄与0からS0も推定しない。
7. 完成量: 新Attemptでは未実装。earned状態・最終評価・寄与4・同科目2＋2から完成を主張しない。既存公式completedCreditsはCourse単位でありAttemptへ分配しない。
8. 最終算入量: retained-onlyの既存allocatorだけ。`OfficialAllocationInput.credits`は法律8科目gate等の前の値で、合算可能な最終単位ではない。

## supported / held / unsupported

- supported: 当該軸に適用できる根拠がある。第1段階の新Attemptでは、非active/当該状態でないincrementの除外、明示本人寄与0のordinary/予定/履修中increment、公式aggregate所有のmanual earned increment除外のみ。値0はその追加経路の除外であり、元量0・科目未修得・卒業要件達成を意味しない。
- held: 根拠不足。値nullと全不足理由を保持する。未確認を0へ変更しない。
- unsupported: 規則が未実装。`evidence.ruleSupport`は全新Attemptで明示unsupported。計算軸では根拠不足があればheldを優先し、未実装理由も診断に残す。

全新Attemptで正のordinary/S/完成算入を行わない。本人適用を証明できない現YI-02の全documented sliceをconfirmedにする逃げ道を設けない。方法/年度のofficial_detailポインタも参照閉包だけではsource slotの完全照合・排他割当を証明しないため、保留する。

## 公式優先と既知数量

原行のexact旧CurriculumCourseをsafe crosswalkでconfirmed Attemptと同じICへ結び付けられる場合だけ、原行がそのmanual earned incrementを所有する。原行がnull/0/partial/heldでも本人値で補完しない。ordinaryとschoolingの両追加経路に同じ所有条件を適用する。

明示`plan.importedSourceCourseId`や参照detailの`sourceCourseId`は参照先の存在を示すだけで、排他的公式対応の証明ではない。第1段階にはidentityに代わる検証済みassociation契約がないため、リンクだけから`exclusiveAchievementIds`へ昇格させない。他科目、unknown/ambiguous/conflict/unmatched identity、未照合/曖昧parent、unsafe crosswalkは保留する。未証明の明示リンク先と内訳parentは`possibleAchievementIds`に残し、`official_association_unverified`を返す。parentなしdetailも保留し、存在しないaggregateへのリンクは既存validatorが拒否する。名前一致やcandidateの一致は確定根拠にしない。

例えば民事訴訟法のearned本人寄与4から行政法detailを方法・年度根拠として参照しても、ordinary/Sは`held/null`のままである。同一科目の厳密な同一性が別途成立するときは、内訳の方法/年度associationが未確認でもCourse単位の公式所有による追加経路の除外は可能。これは履修回への公式量配分や完成認定ではない。

非対象状態や明示本人寄与0による独立の0除外条件は維持する。その場合も未検証リンクを所有根拠へ昇格せず、schoolingを本人ordinary寄与0から推定しない。

`retainedProgress`/`officialEvidence`の入力はgraphに依存しない。未解決Attemptが追加されても既知公式4は4のまま。公式側で元から存在するunknown・H19/H43・認定・卒論targetの条件は既存engineのまま保持する。本PRは既存公式heldを解除しない。

## 保留codeと局所化

| code | 区別する不足 |
| --- | --- |
| identity_unresolved | identityの元unknown/ambiguous/conflict/unmatchedを保持 |
| placement_ambiguous / placement_unresolved | 複数配置候補と未特定配置 |
| applicability_unverified | 本人適用課程が未確認 |
| method_evidence_insufficient | 本人希望・旧参考・未検証detailを算入方法の証明にしない |
| official_year_unverified | 予定年/手動年/推定年は公式実績年度でない |
| contribution_omitted / contribution_unknown | 未設定と明示nullを区別 |
| earned_order_unconfirmed | 複数active earnedのnull/重複順。連番だから反復許可とはしない |
| official_overlap_possible / official_detail_shared | 公式との重複可能性、同一detailの複数参照 |
| official_matching_held / official_association_unverified | 原行の旧算入保留、Attempt-detail association証明不足 |
| completion_evidence_insufficient | 状態/進捗/寄与は科目完成の証明ではない |
| attempt_rule_unimplemented / multiple_attempt_rule_unimplemented | 特殊・通常配分、複数回完成/反復の未実装 |

候補からcategory単位で影響を閉じる。専門は当該学科内の振替・上限・科目数依存を含め保守的に広げるが、無関係な一般教育・外国語・体育へ広げない。common候補は該当common categoryに局所化。候補なしは当該選択scope＋common内の不明として返す。他学科全要件をunknownにしない。未確認の他学科配置だけではこの本人への「影響なし」を証明できないため、明示適用がなければselected-scope不明に留める。

`requirementIds`は既存engineの警告一覧ではない。structured descriptorの明示scope、unsupported descriptorの既知`scopeLabel`（law/history/geography/economics/commerce/日文3コース/common）を解決したうえで候補category・名前と照合する。commonの自然再履修は一般教育、外国語再履修は外国語だけに紐付ける。専門の未対応規則は選択学科の専門候補へ保守的に残す。欠落descriptorや未知scopeLabelを全Attemptへ自動展開しない。

scope外・未知labelのunsupported警告を含む既存全警告は、変更しない`retainedProgress.requirements` / `unknownReasons`に保持する。影響先に含まれないことは、その規則の対応済み・達成・影響なしの証明を意味しない。固定192比較、旧engineの全警告、不明Attemptの選択scope/common内の保留は維持する。参考専用でengineのrequirementsに存在しない要件ID（教養42・放送大学認定上限）は追加せず、全体/S参考への潜在影響は`referenceIds`で返す。

detached/failed/dropped/waitingは現算入incrementを作らない。owner record、元plan、receipt/Undoは削除せず、保持した記録と算入除外を別にする。impactは潜在範囲であり、既存の既知数量・statusを直接書き換えない。
