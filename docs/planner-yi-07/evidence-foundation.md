# YI-07 第2段階：共通証拠判定

## 実装前の調査・範囲決定（2026-10-20）

開始・再開時にfetchし、dev `3eae77665711756e54785022856d5cfae3043f90`、PR #179のdevへのmerge、Issue #177のClosed、作業ツリーの未コミット変更0件を確認した。指定HEADとの差分なし。専用checkout/branchは `yi-07-evidence-foundation` / `feat/yi-07-evidence-foundation`。sources/は変更しない。

年度非依存design/migration、YI-07 README/handoff/adapter-contract/consumer-audit/acceptance、YI-01 README/official-context/yi-02-handoff、YI-02 README・制度型/registry、Attempt validator、migration transform、persistence codec、卒業adapter/impact/officialCourseCreditsを照合した。Issue #133の本文・コメント（0件）も確認した。

| 根拠の種類 | 確認できる内容 | 確認できない内容 |
| --- | --- | --- |
| YI-01の原資料転記・画像監査記録 | 2026しおりp.10–13,28–32の制度構成・通信/Sの区別、p.42–59のscope別配置、p.60–65の改正抜粋 | 個別学籍、本人課程、完全な2013読替、個別履修回の実績 |
| YI-02固定マスター | safe221 IC、502配置、資料revision、科目identityと配置の独立した参照 | cvはdocumented sliceのみ。applicabilityStatus=unknown、effectiveConditions空。本人confirmed根拠なし |
| 現行コードの契約 | 検証済みsourceとretained完全一致、exact旧科目＋safe crosswalkによる科目単位の公式aggregate所有 | detail参照は存在検査のみ。履修回対応・排他性の公式証明ではない |
| Issue #133 / YI-01追加確認事項 | 根拠不足の分類、教務回答・対象課程・確認日の必要性 | 未回答を推測で達成にしない。両監査flag=false |

公式情報は既存の版固定監査記録に基づく。今回PDF再監査・大学への問い合わせ・sourceリンク再検証は行っていない。資料の記述とコード上の所有ポリシーは別であり、aggregate所有は「同一科目の手動earned incrementを追加しない」契約に限定する。

## コード変更前に固定した安全条件

1. IC identity、Placement、CurriculumVersion、本人適用を独立に返す。資料掲載だけで本人適用をsupportedにしない。unknown/unverifiedを保持し、現在のマスターで偽装confirmedはvalidatorが拒否する。
2. 本人適用に必要な根拠を、公式の本人所属学科・コース、入学年度/入学区分、学籍変更/復籍/再入学履歴と適用措置、完全な版別適用規則に分ける。これらを自己申告profileで充足しない。
3. methodの自己申告・旧Offering参考・公式内訳の表示値を分離する。予定年・取得日・実績年を代入しない。普通/S/完成量は別判定とし、4構成・通信2・S2でも完成4/S4を生成しない。
4. ID存在、親aggregateの科目identity、科目単位のincrement所有、detail→Attempt対応、複数参照、排他性を別判定にする。一件だけの参照でも排他性を証明しない。
5. 現資料には本人適用・公式履修回証明の受理経路がない。この2つのconfirmed正常系を架空の公式証明で作らない。追加提出された未審査根拠も自動採用しない。
6. 公式null/0/2/4・省略はsourceのまま。detail数量は観察値であり加算・配分しない。正当な同科目所有と既知公式量を他科目参照/未知Attemptで失わせない。
7. 既存adapterの検証入口を再利用する独立pure APIとする。既存adapter/impact/保存/schema/catalog/production入口は変更しない。retainedの疎配列・accessor・不正値は同じ拒否境界を通す。
8. 本人適用未確定の他scope候補を理由に保留範囲を縮めず、scope外要件を混ぜない。第1段階のP2/R1/R2と固定192ケースのassertionを変更しない。

次に上記を独立テストとして先に記述し、未実装APIでREDを確認した後、同じ期待値でGREENを検証する。新正値・完成・反復配分・学科allocator・UI・保存形式の追加は対象外。

## API契約

```ts
import { assessAttemptEvidence } from '../../src/planner/attempts/graduation/evidence';

const evidence = assessAttemptEvidence({ graph, retained }, decodedSource, selectedScopeId);
// YI-06のloadで再検証されたsource/stateからも同じ呼出しが可能。
```

`evidenceTypes.ts`に判定型と不足根拠の識別子を定義した。`assessAttemptEvidence`は既存adapterを一度呼び、同じsource認証・graph検証・retained完全一致・安全snapshot境界を通る。既存adapterを逆向きに新APIへ依存させない。計算済み結果を引数として信頼する入口は設けない。時計・乱数・ネットワーク・storage・入力の変更なし。新規出力をfreezeし、候補は既存catalog順、共有Attempt IDはソートして返す。同じ入力の結果は同一である。

| 出力 | 意味 |
| --- | --- |
| `status=rejected` | 不正graph、未検証source、retainedの不一致/疎配列/accessor、不正な追加提出等。既存診断または`invalid_evidence_submission` |
| `status=assessed` | 入力検証と証拠分類が完了。卒業算入成功ではない |
| `source` | 元source raw SHA、catalog SHA、制度資料revision、選択scope。digestは大学署名ではない |
| `attempts[].record` | validated snapshot。method、本人適用unknown/unverified、予定年/実績年/手動寄与を元どおり保持 |
| `identity` | 版固定ICの参照判定。本人課程や履修回実績の証明ではない |
| `placement` / `placementCandidates` | 確認済み配置定義または全候補。候補を先頭選択しない |
| `applicability` | 元状態と本人適用の判定を分離。現マスターではheld。claimed confirmedはvalidatorでrejected |
| `method` / `actualYear` | 元記録と公式履修回についての判定を分離。detail表示値と矛盾する場合は追加reason。いずれもheld |
| `official.aggregates[]` | 同科目所有または重複可能性のある原行。全record、独立quantity、ID存在、Attemptと同科目か、increment所有かを分離 |
| `official.details[]` | method/actualYearから参照された内訳。全record、親原行の科目判定、履修回対応、排他性、参照Attempt集合を分離 |
| `quantities` | 制度構成・本人寄与・旧開講参考。権限の異なる参考数量を保持し、算入しない |
| `graduation` | 第1段階の軸別判定を変更せず、根拠の参照と不足項目を付加。正値解放なし |
| `impact` | 第1段階のscope限定・保守的な候補影響。独自の縮小/再配分をしない |
| `ruleSupport` | 新allocator能力はunsupported/null。証拠不足heldとは別 |
| `retainedProgress` / `officialEvidence` | 従来sourceだけの既知結果/公式入力budget。新Attemptとの合算結果ではない |

各`EvidenceDecision<T>`は既存`Decision<T>`のsupported/held/unsupported、value、reasonsに`missingEvidence`と`references`を追加する。supportedはその**命題だけ**を証明する。ID存在や同科目所有のsupportedを、本人適用・方法・履修回排他性へ伝播させない。held/unsupportedはvalue=null。missingEvidenceは今後必要な根拠の分類で、書類さえ添付すれば自動受理するschemaではない。

参照はentity IDを使うsourceRef・sourceRevisionId・sourceRawSha256を保持する。raw SHAは利用者source snapshotの識別、revisionは照合時の制度資料の文脈であり、本人入力を公式資料に記載された事実とみなさない。`record`内の元DocumentEvidence/legacy digest/official detail IDも失わない。YI-01の`/evidence/<id>`と`/placements/<id>`からofficialRowの冊子/PDF/行locatorへ追える。外部URLは取得・検証しない。

任意の`submittedEvidence`は `{attemptId,kind,sourceRevisionId,sourceRefs}` のread-only参照メモだけを受け付ける。未審査の種類は全てheld、未知revisionも理由を付けて保持する。既知revisionや`kind=official`を名乗っても昇格しない。現時点で受理済み公式証明の形式はない。schema22/23・backupには追加しない。unknown kindを現行Attempt graphへ直接追加することは既存closed schema違反としてrejectedとなる。

## 命題別の判定matrix

| 入力の根拠 | IC | 本人適用 | 公式method/年 | 科目increment所有 | 履修回対応 / 排他性 |
| --- | --- | --- | --- | --- | --- |
| unknown identity、候補なし | held | held | held | heldまたは対象原行なし | heldまたは参照なし |
| safe IC＋safe配置 | supported | held | held | 公式原行がなければ対象なし | 参照なし |
| 本人入力のmethod、2035予定 | identity次第 | held | held | identity次第 | held |
| 旧Offering.method | identity次第 | held | held（旧参考のまま） | identity次第 | held |
| official detail IDだけ | identity次第 | held | held | IDでは確定しない | held / held |
| exact旧科目→safe crosswalk→同じconfirmed IC | supported | held | held | supported（科目単位） | held / held |
| 同科目のdetailを1 Attemptが参照 | supportedになり得る | held | held | 親原行の正当な所有を維持 | held / held |
| 同じdetailを2 Attemptが参照 | identity次第 | held | held | 親原行の正当な所有を維持 | held / shared＋held |
| 他科目、未照合、曖昧、unsafe親 | identity次第 | held | held | 未証明はheld | held / held |
| 別の正当な同科目原行＋誤detail参照 | supported | held | held | 正当な原行だけsupported | 誤detailはheld |
| 未審査の追加提出（既知/未知revision） | 既存証拠に従う | heldのまま | heldのまま | 既存証拠に従う | heldのまま |
| 偽装された本人confirmed | graph全体をrejected | confirmedにしない | — | — | — |

aggregateの`courseIdentity`は**Attemptとの同科目一致**の命題。`incrementOwnership`は科目全体の公式優先ポリシー。detailの`parentCourseIdentity`がsupportedでも、その内訳の履修回・独立性・配分量は証明されない。元adapterの`exclusiveAchievementIds`という名称を、新APIでは排他的detail associationの意味に使わない。

公式普通量・S量・構成量、detail component量はそれぞれ`RecordedQuantity`として省略/unknown(null)/zero/positiveを保持する。原行null/0を本人値や内訳合計で埋めない。原行4のうち2を特定Attemptへ割り当てる機能もない。`graduation`のsupported 0は追加経路の除外であり、原行が0だった、科目が完成した、S修得が0だったという主張ではない。

## 公式確認を必要とする後続作業

| 不足識別子 | 必要な根拠と次の判断 |
| --- | --- |
| official_learner_program | 本人の公式所属学科・コースと有効期間。scope選択UIの値は代替しない |
| official_admission_context | 本人の公式入学年度・入学区分・認定条件。plannedYearやcapturedAtで代替しない |
| official_curriculum_transition_history | 転学科/コース変更、復籍・再入学等の履歴と適用措置。変更なしの扱いもレビューが必要 |
| reviewed_applicability_rules | 全体の版別適用規則、2013改正全文、過年度原表、必要時の教務回答。現在のdocumented sliceに有効条件を捏造しない |
| official_attempt_method / academic_year | 対象履修回の公式方式・原年度の根拠。メディアと通常Sの区別、手動/推定年度の扱いをレビュー |
| official_attempt_detail_binding | 元原行・native内訳slot・対象履修回の束縛を証明する資料と検証規則。名前・ID存在・単一参照だけでは不足 |
| exclusive_detail_assignment | 同じ内訳の複数主張・重複source・再取込を含め、排他的であると検証する規則 |
| implemented_allocation_rule | 共通通常完成、反復、各学科、卒論等の別PR。証拠成立と数量配分を別レビュー |

上記は証拠要件の設計であり、大学が特定名称の証明書を発行すると確認したものではない。教務への問い合わせは送信していない。本人証明のデータ最小化・受理経路・原版binding・失効/矛盾処理も後続PRで設計する。今回の型は受理済み証明オブジェクトを定義しない。

## 検証手順と初回RED→GREEN

専用Issueは[#180](https://github.com/wata-0911/housei-media/issues/180)。既存の414件（固定192＋P2/R1/R2を含む）は無変更。新APIの最初の46テストを実装前に記述してREDを実行し、その後8件の提出境界ケースを追加した。

最初の実装試験は構文型assertionのエラーを修正後、39 PASS / 7 FAIL。うち3件はテストsourceのdetail.rawNameと親原行のrawName不一致でdecoderが正常に拒否、4件はfixtureが配置をconfirmedにせず構成4の観察を期待していた。fixtureを既存decoder/配置契約に合わせ、親名と明示配置を設定した。数量・保留・ownershipの期待値は変更しない。別途genericの型推論エラーを明示型引数で修正した。

同じ最終54テストをdevのpristine archiveで実行して **0 PASS / 54 FAIL / 0 SKIP**、実装上で **54 PASS / 0 FAIL / 0 SKIP**。REDの意味は新APIが未実装であること（missing export）であり、第1段階に54件のバグがあったという主張ではない。baseline checkout/reset/rebaseは行わない。

全8scopeの独立ケースは法律・史学・地理・経済・商業・日本文学言語/文学/芸能文化。本人適用unknownのscope外候補にcommon候補を追加してもrequirementIds/cardIdsを縮めず、scope外unsupportedを混入しない。第1段階のunknown/unverifiedの全組合せ・順序不変性・confirmedのpure helper対照も既存suiteで維持する。

新テストは本人データを合成するが、公式本人適用confirmedや排他的履修回対応を合成して実データとして受理させない。confirmedの正常系は実マスターに存在するIC/配置/同科目所有に限定する。

追加の自己点検では、detailのschoolingラベルを本人申告mediaの矛盾と断定していた点を検出した。ImportedStudyRecordにはmedia subtypeがなく、schoolingだけではmediaを証明も否定もできない。先に反例1件を追加して **0 PASS / 1 FAIL** を確認し、`media_method_unverified`としてheldを維持するよう修正した。通信との方式不一致は`method_claim_conflict`を維持する。最終新suiteは55件。
