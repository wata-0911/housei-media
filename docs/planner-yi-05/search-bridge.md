# 制度Placement検索 → 独立Attempt（Issue #193）

親Issue [#188](https://github.com/wata-0911/housei-media/issues/188)、検索 [#190](https://github.com/wata-0911/housei-media/issues/190) / [PR #191](https://github.com/wata-0911/housei-media/pull/191)。
開始時にfetchしたorigin/devは `ae87f2cd33d82dfda025c913c21b857c3f326f69`。#191のmerge commitと一致し、dev祖先に存在することを確認した。同内容のOpen Issueがないことを検索し、#193を#188の子Issueとして作成した。
既存のcleanなIssue #190 checkoutを変更せず、専用worktreeの `feature/yi-search-attempt-bridge` で作業する。

## 操作と隔離

`YI05_WORKBENCH=1 npm run dev -- --host 127.0.0.1` → `/__dev/attempts` → 「新しい履修回」。

1. 科目名・公式コード（完全一致、本科/教職の用途を明示）・学科/コースscope・共通科目の包含で検索する。
2. 1行=1 Placement。名称、区分、構成単位、identity、IC未確定、方式制約を確認し、「この配置を選択」を押す。
3. 選択根拠・候補・出典を開いて確認する。検索条件を変更しても選択を保持し、別配置へ自動変更しない。解除して手入力へ戻れる。
4. 予定年度・本人希望の方式・状態等を入力し、別の「新規Attemptを追加」で確定する。検索input/selectのEnterは登録しない。IME抑止は既存form handlerも維持する。
5. Attempt ID、候補、本人適用unknown、選択Placementをカードで確認できる。詳細には参照から解決した資料原値・脚注・コード証拠を表示する。

初期表示30件、総件数・表示件数・残件数を表示し、次の30件ボタンで全件にアクセスできる。非科目枠も表示するが、理由を示して選択ボタンを無効化する。bridgeも独立に登録を拒否する。
予定年度はnull、方式はunknown。構成単位は表示参考であり本人寄与に転記しない。寄与単位の省略/null/0と同一科目複数Attemptを維持する。

WorkbenchはYI-06からも再利用されるため、新検索は`searchEnabled={!seed}`でYI-05の独立Workbenchだけに有効化する。seedを渡すYI-06は従来のForm経路を維持する。保存コード・保存型・migration契約は変更しない。
本番entry、CourseSearch、PlannerPage、feature flag、Vite gateは変更しない。新しい本番リンク/importはない。

## 変換契約

`PlacementSearch` は既存 `createInstitutionalSearchAdapter(catalog, CURRENT_CURRICULUM_SEARCH_TARGET).search()` を直接利用する。catalogは既存Workbenchの`loadYi01InstitutionalCatalog()`が供給する検証済みマスター。plannedYearからCV/revisionを選ばず、Offeringも参照しない。

`makeSearchAttempt(catalog, selection, input, ids)` は小さな新規bridge。

- UIのrowを信頼せず、登録直前のcatalogと固定CV/revision/digestから同じ検索APIで再取得する。Placement存在と全rowのplain-data一致を`sameAttemptData()`で検証する。
- IC・scope・CV/revision・候補・role・根拠・脚注・方式・構成単位等が変わっていれば拒否する。別ICだけを注入する入力や非科目枠のkind書換えも拒否。検索条件は本人資格の判定には使わない。
- `makeAttempt()`をIC/Placement未指定で呼び、既存初期値・plan・methodの構築を再利用する。ambiguous/conflictを`selectedReferences(courseId)`へ渡さない。
- safeはPlacementとICの双方のsafe判定、adoptedStableIdの一致と公式行evidenceを確認した場合だけ、資料版内のICをconfirmed参照にする。
- ambiguous/conflict/unmatchedはそのstatusと全candidateAuditIdsを保持し、identity.ref=null。候補が1件でも確定しない。複数候補の先頭採用もしない。
- Placementは全ケースでref=null、candidatePlacementIds=[明示選択ID]。safeでも本人適用unknownとしてplacement.status=unknown。ambiguous/conflictは維持する。方式conflictもconflictのまま。applicabilityは全fieldが従来のunknown初期値。
- 既存`legacyRefs`に既知Mappingを1件保持し、sourceRevisionId・sourceDigest・legacyDigestsをpinする。これは選択根拠の参照であり旧進捗の移植ではない。
- 最後に既存`validateAttemptGraph()`で新Attemptを検証し、`newAttemptIds()`のUUIDv4と`applyCommand()`の既存add/receipt/衝突拒否/transactionを使用する。

### 保持する情報と既存型の境界

検索rowをAttemptへ丸ごと埋め込まない。既存YI-03型・schema・validatorを一切変更しない。

| 情報 | 保持先 |
| --- | --- |
| 確定ICと公式evidence | identity.ref（safeのみ） |
| identity未確定状態・監査候補 | identity.status / candidateAuditIds / reason |
| 本人の選択Placement・配置候補 | placement.candidatePlacementIds、candidateAuditIds、reason |
| 原版digest・資料revision・Mapping | legacyRefsの既存revision付き参照 |
| CV・scope・role・公式原行/脚注/コード用途・方式制約/conflict・構成単位null/0 | 上記Placement IDとrevision付きMappingから同一マスターをjoinして解決 |
| 本人適用・寄与単位 | 従来Attemptのunknown・本人入力を保持。資料値から補完しない |

既存PlacementResolutionは未確定の場合ref=nullで、資料版を直接持つ専用snapshotではない。このため既存Mapping参照で原版digestをpinし、同版マスターへの参照として保全する。資料そのものの複製や、新revisionへ参照を持ち越す方式は実装しない。異なる資料版に変わった後の自動復旧・再解決・永続化は対象外。safeな資料identityも本人資格・希望方式での履修可能・修得・卒業算入の証明ではない。

## 局所検証

最終結果は[search-bridge-verification.md](search-bridge-verification.md)に記録する。

新規テストは既存`attempt-workbench.test.mjs`に集約し、既存npm script・CIへ追加設定なしで含まれる。既存CRUD全体のテストを複製せず、新しい参照変換・反例・検索由来Attemptでの不変条件を検証する。
合成マスターのnull/0と複数監査候補ケースはread-model境界のテスト用であり公式registryの変更ではない。旧migration/手入力経路の既存テストを維持する。
ブラウザは既存suiteを更新し、1280px/390px、safe/ambiguous/conflict、非科目枠、全結果へのアクセス、コード/scope/共通科目、選択維持、IME、入力エラー、本人適用unknown、ページ幅を検証する。gate無効・production serveで新moduleへの直接アクセスを含め404も検証する。
本番bundle混入は本番entryの推移的import graphとgateで局所検証する。全体buildを実施したとは主張しない。

## 既知リスク・後続判断

PR [#181](https://github.com/wata-0911/housei-media/pull/181) / [#183](https://github.com/wata-0911/housei-media/pull/183) は開始時Open/Draft・未マージ。取り込まず、両作業ブランチ・validation・graduation adapter・persistenceは変更しない。#181の共通証拠APIには依存しない。
#183のgraph安全性修正がdev未統合なので一般利用者向け公開は禁止のまま。今回のrow照合を、未統合のgraph全体のsnapshot修正や独立監査の代わりとは扱わない。
本人適用・学科横断identity・過年度連続性・方式conflictと公式リンク再検証の未完了状態は継承する。
Safari/iPhone実機は未検証。全体typecheck/lint/test:planner/buildは原則ユーザーまたは同一HEADのCIで確認する。同一HEADのCIが成功していれば同じ検証の重複は不要。
Draft PR提出後は停止し、独立監査・Ready化・merge・Issue closeはユーザー判断とする。
