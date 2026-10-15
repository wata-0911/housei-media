# YI-03 独立Attempt・owner validator契約

実装日: 2026-10-14（Asia/Tokyo）。Issue [#167](https://github.com/wata-0911/housei-media/issues/167)。開始時の最新 `origin/dev`: `27bb75d273fc717731a56694f1b7a9326a62d401`。専用clone、ブランチ `feat/yi-03-attempt-owner-contract`。他checkout・#145の作業は変更していない。

**独立ドメイン型と検証だけを実装。一般利用者の保存・UI・卒業計算には未接続。** `AttemptGraph`はPlannerStateの次schemaでもバックアップ形式でもない。YI-04〜08のmigration・CRUD・保存・計算・公開は実装していない。

## 前提と確定範囲

[製品方針](../planner-curriculum-release-policy.md)、[目標設計](../planner-year-independent-design.md)、[移行計画](../planner-year-independent-migration.md)、[YI-01監査](../planner-yi-01/README.md)、[stable ID](../planner-yi-01/stable-id-design.md)、[YI-02 handoff](../planner-yi-01/yi-02-handoff.md)、[YI-02実装](../planner-yi-02/README.md)、[backup互換](../planner-backup-compatibility.md)、[現行architecture](../planner/architecture.md)を継承する。過去監査の結果・日付・基準commitは書き換えない。

- 制度科目は資料版に限定したidentity。Placementは課程版・scope・物理行role。本人への適用、歴史的連続性、卒業算入は別の判断。
- safe221限定IC、cv1/cp502の固定発行対応、unverified continuity、S必須conflict6・非科目bucket9を変更しない。
- 同一制度科目、同一年、同じ希望方式、同じ旧Offeringに複数Attemptを許す。履修制度上その方式/反復が許可されることを意味しない。
- 単位を計算するAPIを追加しない。構成単位4と本人寄与2、公式aggregate、公式内訳、卒業算入を別に保つ。

## モジュールとAPI

| ファイル | 実装した責務 |
| --- | --- |
| `src/planner/attempts/types.ts` | Attempt、独立判定、原版参照、owner付きpayload、Undo snapshot、検証context/resultのTypeScript型 |
| `src/planner/attempts/schema.ts` | 独立closed shape。Ajvはcoercion/default/removeなし。保存schemaの変更ではない |
| `src/planner/attempts/validation.ts` | `validateAttemptGraph(value: unknown, context)`。構造・参照・数量・owner・原版・Undo snapshotの純粋検証 |
| `src/planner/attempts/planTransition.ts` | `validateAttemptPlanTransition(before, after, context, action)`。削除/Undoの提案が元IDと全owner/payloadを保存するか検証 |

contextにはYI-02 loaderで検証済みの `InstitutionalCatalog`、必要なら対応する検証済み `LegacyArchive`、source decoderが確認した公式原行/内訳ID一覧を渡す。read modelから年間Offeringや利用者stateをロードしない。contextの公式IDは参照閉包を確認する材料であり、元の公式数量・fingerprint・内訳・metaをAttemptへコピーしない。

```ts
import { validateAttemptGraph } from '../../src/planner/attempts/validation';
import { validateAttemptPlanTransition } from '../../src/planner/attempts/planTransition';

const checked = validateAttemptGraph(proposedGraph, trustedContext);
// { valid: boolean, issues: [{ code, path, message }] }
// validであっても保存・移行・大学の履修資格を承認する結果ではない。
const removalChecked = validateAttemptPlanTransition(before, proposedAfter, trustedContext, {
  kind: 'delete_plan', attemptId, operationId,
});
```

## Attempt型と現型の対応

具体型の正本は `types.ts`。以下の対応は実移行を行った記録ではない。

| 現行型/field | 新契約 | 意味・保護 |
| --- | --- | --- |
| `PlannerItem.offeringId`が主キー | `readonly Attempt.id: hosei:attempt:<UUIDv4>` | 独立・一度発行・不変。科目、Offering、年度、配列位置、名称/hashから生成しない |
| 同Offering重複禁止 | `creationOperationId: hosei:attempt-op:<UUIDv4>` | 同じ操作再送は同じ操作IDとAttempt IDを使う。意図的別回は新しい両ID |
| `Offering.curriculumCourseId` | `identity: Resolution<CourseRef>` | confirmedは存在するIC＋sourceRevision＋その名称定義に属するevidence。旧relationから埋めない |
| Mapping/scope選択 | `placement: PlacementResolution` | confirmedはcp/cv/scope/revision/evidence。候補cpと候補audit identityを別配列で保持 |
| 旧 `current_2026/legacy_or_transition/unknown` | `applicability` | 元区分・原値を保持。unknownはcv/scope/evidence null。documented sliceはunverifiedで閲覧可、本人適用のconfirmedにはしない |
| 原名称・旧ID | `originalTitle`, `legacyRefs[]` | entity種別＋旧ID＋sourceRevision/sourceDigest＋raw6ファイルdigest集合。backup semantic/enriched digestで代替しない |
| `PlannerItem.status` | `plan.status` | planned/in_progress/waiting/earned/failed/droppedをそのまま区別。評価/動画/レポートから変更しない |
| plannedYear/Term/studyYear | `plan`内の同名field | 希望暦年1000〜9999、希望文字列、本人の履修学年1〜4/null。開講・履修可否の保証ではない |
| 内訳のacademicYear/yearSource等 | `actualYear: { value, source, evidence, reason }` | planとは独立の実績年度context。manual/source/inferred/unknown、推定理由を区別。原内訳field自体は別ownerのまま |
| Offering.method/deliveryCategory | `method: { value, source, evidence }` | correspondence/schooling/media/unknownと本人希望・旧参考・公式内訳・未知を区別。mediaを元のschoolingへ無言で潰さない |
| `courseCreditContribution?` | `plan.contribution?: { value: number \| null, source: 'learner', note }` | property省略＝未設定、null＝明示不明、0＝明示0。有限非負の数値。Offering/Placement/公式値のfallbackなし |
| `earnedOrder` | `plan.earnedOrder: number \| null` | 本人が確認した正のsafe integer。順序は年度・作成順・状態から生成しない。科目別制度gateは将来consumerの責務 |
| `importedSourceCourseId?` | `plan.importedSourceCourseId?` | 元の明示原行IDへの関連だけを保持。存在検証するが、公式量は移動しない |
| 計画行なしの旧進捗 | membership detached/legacy_orphan＋plan null | status、寄与、修得順を捏造しない |
| 計画行削除 | membership detached/plan_deleted | 全Attempt fieldは同じIDで残る。削除操作ID＋完全なactive snapshot＋元active計画位置をUndo ticketへ保持 |

`Resolution`は `confirmed/ref非null/reason null` または `unmatched/ambiguous/conflict/unknown/ref null/reason非空`。候補audit IDはYI-01の旧CC identityを指し、未採用ICの確定参照ではない。Placementの候補には独立の `candidatePlacementIds` を持つ。

科目確定でもPlacement未確定を許す。配置定義がsafeでIC nullのPlacementは、科目未確定のままconfirmedな配置参照を保持できる。ただしICが既知のconfirmed Placementと矛盾する未確定/別ICは拒否する。未解決ICのPlacementを、別途確定したICへ接続する証拠がない場合も拒否する。conflict配置・非科目bucketはconfirmedな科目配置にしない。unresolved候補としては保持できる。

IDの形式検証はUUIDの乱数発行を証明しない。今回ID発行器・再送handlerは実装しない。将来の発行側は独立乱数を一度だけ発行し、操作ID→Attempt IDを永続的に保持して再送をno-opにする。validatorは重複Attempt IDを同じpayloadでも拒否し、同じ操作IDが別Attemptを作る競合も拒否する。ID集合を科目や年度でdedupeしない。

## Owner契約

`AttemptOwnedRecord.id`は `hosei:owned:<UUIDv4>`。payloadの元assessment ID、TODO ID、番号、名称、日付、状態は別fieldとして保持する。進捗を持つ同一Attemptにはkindごと一つのmedia/correspondence/evaluation payloadを許す。TODOは複数可、元TODO IDは全体で一意。

| 情報 | owner / 保持payload |
| --- | --- |
| メディア動画/テスト/試験 | 明示Attempt ID。totalLessonsのnull/0、lesson番号と完了、assessment ID/type/label/date/completed |
| 通信リポート/試験 | 明示Attempt ID。requiredReportsのnull/0、全report番号/status/grade、examGrade、optional calligraphyBatchStatus |
| 科目最終/通信/スクーリング評価 | 同じAttemptのevaluation payload。final/report/schoolingGradeは独立。状態やcomponentから最終評価を生成しない |
| TODO | 明示Attempt owner、未解決旧Offering owner、またはunowned null。元ID/text/doneを保持 |
| 残る旧進捗 | `unresolved_legacy` owner＋原版Offering ref＋理由。別回へ推測で移動しない |
| 削除・Undo | Attemptはdetachedで存続。ownerは元Attempt IDのまま。Undoは元snapshot/ID/位置、全owner/payloadを復元 |

希望方式は進捗種類や大学の修得可否を強制するauthorityではない。旧混在payloadを消すことを避けるため、mediaとcorrespondenceの存在だけでmethod/statusを変更・禁止しない。calligraphyの一括進捗も無条件変換しない。

既知の旧Offering参照でも未解決ownerを保持できる。その同じ原版旧Offeringに対応するAttempt上で同種payloadが既に存在する場合は `competing_legacy_owner` として競合を拒否する。同じ旧Offeringを参照する別Attemptの独立payload同士は合法であり、共有/コピーしない。

削除/Undoのtransition validatorは全owner付きrecordをIDで比較し、消失・再割当・payload変更・別IDへの復元を拒否する。削除対象以外のAttempt/ticketも保存し、変更可能なのは対象membershipとその一つのticketだけ。これは提案の検証で、remove/restore操作やUIは実装していない。単一snapshotのvalidatorだけでは以前のownerからの付替えを検出できないため、操作前後の検証が必要。

卒論進捗/指導はscope、公式原行はachievement ID、公式内訳はsourceCourseId、公式metaはachievement ID、公開科目は独立公開IDを継続する。本graphにそれらのpayload kindやquantityを追加していない。unknown field/kindは拒否して入力を残し、捨てて成功にしない。

## 実装済みの検証

| 検証 | 主な識別code |
| --- | --- |
| closed構造、namespace、型・数値範囲、不正JSON値、未知field | `shape_*`, `non_json_value` |
| Attempt ID/操作ID/resource ID/全namespace UUID衝突 | `duplicate_attempt_id`, `duplicate_creation_operation`, `duplicate_owned_record_id`, `uuid_collision`, `operation_collision` |
| IC/cp/cv/scope/evidenceの存在・資料版・配置整合 | `unknown_course`, `unknown_placement`, `unknown_evidence`, `source_revision_mismatch`, `placement_context_mismatch`, `placement_identity_conflict` |
| 候補の参照、確定と競合する候補、未解決のref矛盾 | `unknown_audit_candidate`, `unknown_placement_candidate`, `resolution_candidate_conflict`, `shape_oneOf` |
| 本人適用を資料表示年から確定しない | `unknown_applicability_ref`, `unknown_applicability_context`, `unreviewed_applicability`, `applicability_placement_conflict` |
| 原版raw6digest/種別/旧ID・旧候補との明示矛盾 | `legacy_revision_mismatch`, `legacy_namespace`, `unknown_legacy_id`, `legacy_identity_conflict`, `legacy_placement_conflict`, `invalid_legacy_archive` |
| owner存在・同種重複・元TODO ID・未解決旧owner競合 | `dangling_owner`, `duplicate_owner_payload`, `duplicate_todo_id`, `competing_legacy_owner`, `duplicate_official_id` |
| active/detached/孤立・削除ticket/元snapshotの整合 | `active_without_plan`, `invalid_orphan`, `missing_removal`, `removal_owner_conflict`, `undo_snapshot_mismatch` |
| 数量・重複番号・日付・リポート評価状態 | `shape_minimum/maximum/type`, `duplicate_lesson`, `lesson_range`, `duplicate_report`, `report_grade_status`, `duplicate_assessment`, `assessment_date` |
| 実績年度/方式の由来と公式IDの参照閉包 | `year_provenance`, `method_provenance`, `unknown_official_achievement`, `unknown_official_detail` |
| 削除/Undo前後のID・owner・全payload保存 | `attempt_id_reassigned`, `creation_operation_changed`, `owner_reassigned`, `owned_record_lost`, `owned_payload_changed`, `invalid_delete_ticket`, `invalid_undo_ticket` |

進捗count/番号は非負/正のsafe integer、earnedOrderは正のsafe integer、studyYearは1〜4/null。未知countはnull、明示0は0。gradeは現型のenum（reportにはDなし）。grade非nullのreportはpassedを必要とするがpassed/grade nullは可能。元の余分なreportをrequiredReportsの縮小で捨てたり拒否したりせず保持する。media lessonの番号は既知totalを超えない。制度や年度の公式上限を新しく定義しない。

結果はコード/安定entity IDのpath/説明を持ち、意味検証のissuesはpath/code/messageでsortする。duplicateは全件を競合として扱い、最初の行をwinnerにしない。registry/Attempt/ownedRecord配列の並び替えで意味検証の結果は変わらない。構造エラーのJSON pointerは実際の入力位置を示す。payload内部のlesson/report/assessment順序とUndoの計画位置には意味があり、並べ替えを正規化しない。

## 検証記録・変更境界

新Attempt suiteは `npm run test:attempts`。既存CIの `test:planner`にも組み込む。合成fixtureはtests内のみ、実利用者データや架空年間開講catalogは取得・配信しない。一つの独立配置契約の確認には既存YI-02 read modelを読み込む。

既存lockfileから `npm ci --ignore-scripts --no-audit --no-fund` で依存を取得。以下は今回の最終ローカル検証。過去YI-01/02のPASSを今回の実施結果に流用しない。

| コマンド/確認 | 結果 |
| --- | --- |
| `npm run test:attempts` | PASS 116件、fail/skip 0 |
| `npm run test:institutional` | PASS 36件、fail/skip 0 |
| `npm run test:planner` | PASS 3,156件（既存3,040＋新116）、fail/skip 0。制度36件も内包 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS。grade-import生成物検査・catalog:check 321/686を含む。既存500kB chunk警告あり |
| `git diff --check` / staged diff check | PASS |
| `python3 docs/planner-yi-01/verify.py` | PASS: CC321/Mapping502/Offering686/legacy Course209、公式原行502・脚注84・digest・判定保持。差分範囲検査とは別 |
| 基準devを一時ディレクトリへ `git archive` し同じ固定依存でbuild | PASS。新旧dist全12ファイルのパスとSHA-256が一致、完全なバイト不変 |
| 既存保存/成績/卒業/カタログ/監査/lockfileのGit差分 | なし。新moduleへ既存srcからのimportがないことも新testで検証 |
| 実利用者state移行、保存ブラウザ、拡張/bookmarklet独立suite、iPhone実機 | 未実施。production未接続のこのsliceではPASSとしない |

既存Planner suiteはschema22、公式優先処理、原行/内訳の再取込、全fieldバックアップ、v2原版/旧v1、未知版拒否、Lock/stale/quota/原文保護、null/0を含む。卒業168完全出力の既存baseline検査もPASS。既存のテスト名にある「six reviewed P2 completion quantities」は基準devが既に採用した差分で、YI-03で追加した例外ではない。卒業engine・基準/期待値を変更していない。

変更ファイルは次の9件に限定する。

- `src/planner/attempts/types.ts`
- `src/planner/attempts/schema.ts`
- `src/planner/attempts/validation.ts`
- `src/planner/attempts/planTransition.ts`
- `tests/fixtures/attempt-fixture.mjs`
- `tests/attempt-contract.test.mjs`
- `package.json`（test:attempts追加、test:plannerへの組込のみ）
- `docs/planner-yi-03/README.md`
- `docs/planner-yi-03/yi-04-handoff.md`

既存srcは変更せず新 `attempts/` を追加する。packageの変更はテストコマンドのみ、依存/lockfileは無変更。保存schema、storage/backup v1/v2、UI、catalogデータ・adapter、成績取り込み・公式優先処理、卒業engine、旧監査は基準devと同一。一般利用者には未適用で、schemaVersion=22、graduationCheckComplete=false、sourceLinksReverified=falseを維持する。

## 未解決・独立監査と後続

[YI-04 handoff](yi-04-handoff.md)に実移行との境界を記録する。公式追加根拠が不足する科目同一性、過年度適用、反復/方式別単位、2013改正、S必須bool、卒論/読替等はYI-01/02の保留を維持する。

validatorは構造・資料版/参照・記録の保存を検証し、大学の真正性、履修方式の許可、実績年度の真偽、科目完成・卒業算入を認証しない。source decoderが提示した公式IDと、値/年度/方式の証拠内容の突合はYI-04で明示的なassociation/原field保存比較として検証する。未知原版のlegacy refは自動的に現在の版へ通さず、原文を保持して拒否/個別対応とする。

独立監査では、confirmedの資料版ゲート、IC未確定/配置確定の組合せ、原版digest集合、二重操作ID、旧ownerと別Attemptの競合境界、削除/Undoの完全保存、既存consumerへ依存が逆流しないことを確認する。型の形式だけでID不変や未来のmigration安全性が保証されるとは扱わない。Draft解除・merge・Issue closeは行わない。

## PR #168 独立監査P2フォローアップ（監査対象1320c98）

この節は初回提出HEAD `1320c98408c9b6c8d06afd89702cbd3e7a02bc88` に対する追加検証。上の初回116/3,156件やbuild比較の記録は履歴のまま保持し、今回の実施結果へ置換しない。開始時に最新 `origin/dev=27bb75d273fc717731a56694f1b7a9326a62d401`、既存PR HEADとの一致、Draft/Open、初回CI success、作業ツリーcleanを確認した。同じIssue #167・featureブランチ・Draft PR #168を更新する。

### P2-1: active-plan相対順序

監査対象実装はAttemptをIDで比較し、Undo対象のactive位置だけをticketで確認していた。他のactive Attemptの相対順序を検証していなかったため、`[A,B,C]`からA削除後`[C,B]`、B削除後`[C,A]`がともにvalidになった。Undoで対象A/Bを元のactive位置に戻して他の2行だけを反転させるケースもvalidになった。今回の4拒否テストは、変更前のproductionコードでは `true !== false` でFAILした。

`planTransition.ts`に、操作対象を除外した **active Attempt ID列** の前後比較を追加した。差があれば `active_plan_order_changed`。削除対象がdetachedになること・Undoの元位置・ID/作成操作/owner/payload/ticketの既存検証は維持する。全Attempt配列の一致は要求せず、detached行の相対位置やactive行への挿入位置、ownedRecord/ticket registryの並び替えは引き続き許可する。

追加した順序/保存テストは11件。active A/B削除後の逆転、A/Bの正しい位置へのUndo＋他行逆転の4拒否、A/B/Cの合法削除・Undo3件、detached再配置と別削除ticket保持1件、detached media/評価/TODOのpayload変更拒否3件。すべて前後graphのstatic検証が通ることを先に確認し、無関係なdangling等による拒否を排除する。frozenな前後入力の不変、元ID/作成操作ID、全ownedRecord、ticket snapshotとactive位置を確認する。

static graphのregistry順序非依存と、transitionのactive表示順序保存は別契約。後者では操作対象を除くactive行の相対順序が意味を持つ。

### P2-2候補: v22との日付差分と判断

`src/planner/planner_catalog_2026.schema.json`のmedia assessment `scheduledDate`はnullまたは `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`。`src/planner/validation.ts`の `validateState`も実在暦日を追加検証していない。実在する既存media Offeringと `initialState()` の合成stateを使い、実際のv22 `validateState`へ通した。同じ日付文字列を別の合成Attemptへ置いて比較し、元入力の完全な不変も確認した。これは移行処理の実装ではない。

| scheduledDate | 既存v22 | YI-03 |
| --- | --- | --- |
| `2027-02-30` | 受理 | `assessment_date`で拒否 |
| `2027-99-99` | 受理 | `assessment_date`で拒否 |
| `2027-02-28` | 受理 | 受理 |
| `2028-02-29` | 受理 | 受理（閏日） |
| null | 受理 | 受理、nullを保持 |

新validatorは初回から実在暦日を検証しており、記録された試験日を有効な暦日として扱うtarget契約として維持する。形式だけ有効な旧データは旧v22として正常でも、そのままtargetへ移行可能とは限らない。互換性の差は実在するため、無条件に正常v22を全件移行可能とは宣言しない。旧validatorを強化したり新validatorを弱めたりせず、補正/null化/field削除を行わない。今回、日付の型・schema・validatorと本番保存経路のコード変更はない。

YI-04は [日付互換引き継ぎ](yi-04-handoff.md#既存v22の試験日付とtarget検証の差) のとおり、原値・原文・原版を保持し、明示的な修正確認までtarget全体の移行成功を保留する必要がある。そのpreview・修正/再検証・書込み保護は今回は未実装。

### フォローアップ検証記録

同じ追加16テストをproductionコード変更の前後で実行した。変更前は12 PASS / 4 FAIL（順序拒否4件）、変更後は16 PASS / 0 FAIL。日付差分5件と合法操作/保存7件は変更前からPASS。既存116件や他suiteの期待値は緩めていない。

今回の最終ローカル結果は次のとおり。初回検証とは別に実行した。

| 検証 | フォローアップ結果 |
| --- | --- |
| `npm run test:attempts` | PASS 132件（初回116＋追加16）、fail/skip 0 |
| `npm run test:institutional` | PASS 36件、fail/skip 0 |
| `npm run test:planner` | PASS 3,172件（前回3,156＋追加16）、fail/skip 0 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS。grade-import生成物・catalog:check 321/686を含む。既存chunk size警告あり |
| `git diff --check` / staged diff check | PASS |
| 初回README/handoffの原文prefix照合 | PASS。以前の結果・判断を保持して末尾追記のみ |
| 変更境界・本番非接続 | PASS。4ファイルのみ。既存保存・UI・engine・日付schema/validator・データ・依存/lockfile無変更。既存srcからAttempt moduleへの新importなしもテストで確認 |
| 実利用者移行、修正UI、ブラウザ保存・iPhone実機 | 未実施。新しい移行/保存機能のPASSを主張しない |

卒業168完全出力の既存baseline検査、成績再取込、公式優先処理、backup v1/v2と保存保護を含む既存回帰もPASS。既存のsix reviewed P2の期待値や他テストを変更していない。

変更対象は `planTransition.ts`、`tests/attempt-contract.test.mjs`、このREADMEとYI-04 handoffの4ファイル。初回の9ファイル変更一覧とは別の差分範囲である。schema22・両false flag・公式aggregate・型/ID/unknown/null/0/旧参照・既存保存/UI/成績取込/卒業計算は無変更。新Issue/PR/ブランチ・migration/CRUD・新保存は追加せず、独立再監査前のDraftを維持する。
