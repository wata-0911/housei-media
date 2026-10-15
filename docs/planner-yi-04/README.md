# YI-04 読み取り専用 v22 → Attempt migration

2026-10-15 / Issue [#169](https://github.com/wata-0911/housei-media/issues/169)。基準dev `aa74fef364ce1ac583c2599eb2e92f2404e73a42`（PR #168 merge）。専用clone / `feat/yi-04-pure-migration`。

新モジュールは `src/planner/attempts/migration/` に隔離。既存Plannerの保存・UI・計算からのimportなし。**readyは情報保存を確認したread-only previewであり、永続化・本人への課程適用・卒業算入の承認ではない。** 新state schema番号・backup形式を定義しない。schema22、両false flag、公式earnedCreditsTotalの正本性を維持。

[実装前計画](plan.md)、[検証記録](acceptance.md)、[後続引き継ぎ](handoff.md)。前提は [YI-03 handoff](../planner-yi-03/yi-04-handoff.md)、[backup互換](../planner-backup-compatibility.md)、[設計](../planner-year-independent-design.md)、[移行計画](../planner-year-independent-migration.md)、[製品方針](../planner-curriculum-release-policy.md)、[architecture](../planner/architecture.md)、[YI-01](../planner-yi-01/README.md)、[YI-02](../planner-yi-02/README.md)。過去PASSを今回の結果に数えない。

## SourceとTargetの境界

| モジュール | 責務 |
| --- | --- |
| `contracts.ts` | 独立ドメイン型、rule ID/version、archive・割当・台帳・判定、deep freeze |
| `source.ts` | raw6原文の実測SHA、固定原版の検証、source別decoder、原文/state/catalog保存。正規化検出・参照検証 |
| `assignments.ts` | 旧キーの列挙、UUIDv4の一度の発行、固定表・発行済みreceipt・衝突/順序/coverage検証 |
| `transform.ts` | 純粋なAttempt/owner/独立保持領域と全field台帳の構築。内部builderであり単独利用を公開承認APIとしない |
| `preview.ts` | public preview、target検証、対応と往復検証、原値付き日付診断、旧計算projection |

`prepareMigrationEnvironment(rawFiles, targetCatalog?)` へYI-01でpinされた6ファイルの**UTF-8原文**を渡す。ファイル名集合と全SHAを実測する。YI-02 loaderとlegacy archive validatorを再利用。原版runtime catalogは既存loaderで構成するが、固定v1 registryのfull SHAとsemantic SHAへ一致したもののみ採用する。将来runtimeが変わってこの原版を再構成できなくなれば `fixed_origin_unavailable` で止まり、最新値で代用しない。

`decodeMigrationSource(raw, environment, localCatalog?)` はrawをparse直後のstateとして検証する。JSONの重複key（escapeされた同じkeyも含む）、非有限数、safe integer外の整数、negative zeroは読み取り時の情報消失を避け拒否。入力rawは失敗結果にもそのまま返す。正常sourceはdeep freezeし、decoder発行済みのhandleだけを変換へ渡せる。objectの自己申告SHAやJSON化したarchiveの再投入で検証を迂回できない。

| 入力 | 受理条件 / 拒否・保留 |
| --- | --- |
| local state22 | 保存時原版を呼出側が明示。local stateにカタログ情報がないため自動推定しない。今回の固定原版full SHAに一致。v22 schema・semantic validation、再読込無変化、migration参照閉包を確認 |
| backup v1/state22 | envelope・日時・固定registryに対応する完全原版を解決。未知v1には現在のtargetを当てない。source/target双方を検証 |
| backup v2/state22 | 同梱snapshot/full SHA/semantic SHA/互換規則v1、監査原版とのsemantic一致、source/target双方を検証。許可済みsource citation/program displayName差分は原版のまま保持 |
| schema1〜21 / 未来schema / 未知backup版 | 拒否。既存local load migrationへ渡して成功扱いしない |
| protection v1 | 拒否。原文保護ファイルを正常migrationにしない |
| 原版/digest/semantic不一致 | 拒否。未知field・配列順序変更も互換性の例外にしない |
| 正規化・認定shadow・不正参照 | 原文を保持し保留または構造拒否。修復しない |

sourceには既存 `validateState` を使い、backupには既存 `validateBackupState` の条件を維持する。localでもmigrationの追加安全ゲートとしてbackupの全参照・重複・nested closed shapeを確認する。localの表示可能性を移行可能性と同一視しない。`loadState` はメモリだけのread-only storeで前後一致を調べるために使い、返されたstateを移行正本には使用しない。正常optional fieldは追加しない。

## Archive・ID割当契約

`SourceArchive` は原文、そのSHA、parse直後stateとSHA、source種別、全原版catalogとfull/semantic SHA、元catalog metadata、raw6原文・実測SHA集合、互換version1、`yi-04:state22-attempt` rule/version1、検証済みmaster/archive/公式ID contextを保持する。backup envelopeのcreatedAtやbackupVersionを含む原文をそのまま再現できる。元カタログの名称・出典・旧登録単位も捨てない。SHAは署名や大学の認証ではない。

IDは `prepareMigrationIds` だけが `crypto.randomUUID()` を呼び、Attempt・作成操作・owned recordを独立namespaceに発行。旧科目・年度・indexからIDを導出しない。割当表のbindingはraw SHA/state SHA/source catalog SHA/source種別/rule ID/version、各行は旧Offering/item indexまたは元map/TODO位置を持つ。

- 同じ表で `previewMigration` を反復し、`prepareMigrationIds(source, reservedIds, existing)` は同表を返して再発行しない。
- existingなしの発行は**新規割当要求**。同操作再送では必ず既存handleを渡す。通常CRUDや永続的なリトライhandlerではない。
- 全ID/namespaceのUUID衝突を検証。既存master、旧catalog、source内ID、呼出側が渡す既存namespaceの予約IDも対象。予約集合はprepare/preview/projectionで同じものを指定。
- 件数、旧キー、item位置、record種別・map key、owner、raw/rule bindingが一致しない表は拒否。
- 発行済み表をdeep freezeし、in-memory receiptで確認する。UUIDを有効な別UUIDへ交換しても、未発行のJSONコピーは `unverified_assignment_history`。任意の表を「発行履歴」として受理しない。
- 今回はプロセス/ページを跨ぐ割当表のexport/import・永続化を提供しない。YI-06で元archiveと割当履歴の保護・再検証を別途設計する。この制限を既存表の自動再発行で回避しない。

## 全field・全参照の対応

| source | target / 台帳 | 保存・照合 |
| --- | --- | --- |
| items配列位置 / offeringId | active Attempt順、legacyRefs、attempt ledger.itemIndex/offeringId | 旧itemごと別ID。順序・件数・原版を維持 |
| status/plannedYear/plannedTerm/studyYear/earnedOrder | planの同名field | 値・nullをコピー。実績年度・修得順を生成しない |
| courseCreditContribution | plan.contribution.value/source=learner/note=null | 省略・0・正値を区別。旧v22のnullは不正のため受理しない（targetだけのnull能力をsourceへ逆適用しない） |
| importedSourceCourseId | plan.importedSourceCourseId | 明示リンクの省略/存在を維持。公式quantityは移動しない |
| Offeringのname/参照/方式/単位/出典 | originalTitle、legacyRefs、method legacy_reference、sourceCatalog | 公式実績を生成しない。登録単位fallbackは旧projectionだけ |
| 旧relationとYI-01/02監査 | identity/placementの状態・候補・根拠、archive/master | safeの確認済みidentityだけconfirmed。uniqueだけでは確定しない |
| graduationProfile.curriculumApplicability | retained内原値＋Attempt.applicability.legacyApplicability/originalValue | 本人適用はunknown。documented sliceを本人適用confirmedにしない |
| mediaSchoolingProgress / correspondenceProgress / courseEvaluations | kind別ownedRecords、record ledger.sourceCollection/sourceKey/offeringId | payloadのofferingIdだけowner参照へ分離。旧map keyと内部ID双方を往復照合 |
| todos | ownedRecords kind=todo、元配列位置・元ID | unowned nullを維持。TODOだけの旧Offeringにもdetached ownerを発行 |
| itemのない共通旧owner | detached / legacy_orphan、plan=null | 同旧Offeringの進捗/評価/TODOは同owner。別旧ownerは統合しない |
| ImportedCourseAchievement全field | retained.importedCourseAchievements | id/fingerprint/source/rawName/categoryRaw/capturedAt/全数量/年度根拠/手動選択/候補/確定関係/省略/配列順を同じownerで維持 |
| ImportedStudyRecord全field | retained.importedStudyRecords | id/fingerprint/sourceCourseId/原年度・期/全数量/date/examDate/reports/評価/取得日/省略/順序を維持 |
| importedCourseUserMeta全field | retained.importedCourseUserMeta | 元公式IDがkey、lifecycle/plannedYear/Term/studyYearを保持 |
| 認定・卒業profile全field | retained.graduationProfile | 認定aggregateと内訳を別保持、professional参照と元ID、mode/数量/null/言語を不変 |
| 卒論選択・scope進捗・指導全field | retained.thesisSelection/thesisProgressByScope/thesisGuidanceByScope | step ID/status/passedOn/geographyReportSubmittedを保持。別課程へ転記しない |
| publicCourses全field | retained.publicCourses | 元ID/名称/数量/予定/評価/順序を保持、Attempt化しない |
| schemaVersion / selectedScopeId | retainedの同名field | source22と旧scopeを保つ。targetの永続schema指定ではない |

全フィールド（nested object/arrayを含む）のsource JSON Pointerとtarget Pointerを `ledger.fields` に列挙する。items/map/TODOのコンテナの空状態・件数・順序は `sourceSlots`、ledger完全一致、逆projectionで検証する。raw6/catalog側の全定義・参照はarchive内でそのまま保持する。

## 成功と完全保存の証明範囲

`previewMigration` は割当を検証し、pure builderでtargetを生成する。`verifyMigrationPreservation` は外部提案targetも監査できる。

1. source/target原版でのschema・参照閉包・既存安全性をsource decoderで検証。
2. 固定割当とsourceから再構成したexpected targetに対し、graph・retained・全台帳をdeep equality比較。unknown/extra/missingを許さない。
3. `validateAttemptGraph()` でtarget閉包・owner・日付・数量を検証。公式ID contextはdecoderが検証した元ID。
4. 各field pointerの値・null・array順を照合。ownerの合法な別Attemptへの付替えもexpected correspondenceで拒否する。
5. **targetのplan/owner/payload/retainedから**旧stateを逆構築し、source stateと全field比較する。archive.stateを返すだけの比較にしない。公式原行とmeta・内訳・認定・卒論・公開科目も同時に照合。
6. 同じsource/tableから再構築し再実行一致。数量は合計ではなく各field・省略を比較する。earnedCreditsTotalの再集計・内訳補完・null→0を行わない。

すべて通過した場合のみ `status=ready` と `target` が返る。保留は `candidate` と診断を返し、成功型のtargetは返さない。拒否も元source/rawは呼出側に残る。候補を手動で編集してsourceと不一致のまま承認するAPIはない。

不実在試験日は `assessment_date` を維持し、診断に元source path、旧Offering、target owner、元assessment全field、元progress全payloadを添付する。assessment IDにslash等があってもIDそのものを照合する。全体をheldにし、日付の修正/削除/null化も部分成功も行わない。

| 判定/代表code | 理由 |
| --- | --- |
| rejected: source_json/source_shape/source_version/unsupported_state_version | 不正JSON・重複key・表現不能数・未知field・必須欠損・未対応版 |
| rejected: source_catalog | 原版未指定/未知/digest不一致/非互換semantic/不正envelope日時 |
| rejected: protection_not_migratable | 保護原文は通常移行入力ではない |
| held: source_validation/source_references | owner/公式/認定/参照/quantity/重複/backup境界を満たさない |
| held: source_normalization | 現行loadの修復・正規化で変化する（結果は使わない） |
| rejected: migration_contract | 未検証source、割当binding/coverage/衝突/未確認発行履歴、不整合原版edge |
| held: assessment_date/その他target validator code | targetの実在日付等を満たさない |
| held: target_correspondence/field_preservation/roundtrip_preservation/deterministic_result | 元情報・対応台帳・順序・数量・再実行の不一致 |
| rejected: preservation_contract | 不正な提案targetを安全に検証・逆構築できない |

未確定制度identityだけなら、候補・理由・原情報を完全保持してreadyとなり得る。identityの未確定と移行全体の保留は別軸。旧参照が存在しない場合を未確定identityとしてごまかさない。

## 旧計算adapter

`projectLegacyState(source, table, target, reservedIds?)` は上記検証を再実行しreadyだけ受理する。targetから復元した全v22 stateと**source原版catalog**のdeep-frozenコピーを返す。架空Offeringを作らず、新旧progressを混ぜず、既存engineを呼び出す入力だけを提供する。source.stateを返す近道や、held candidateでの算入はない。

全8scopeと既存168シナリオを確認。正規原版の160ケースは全出力（ordinary/S/completion、区分進捗、上限・超過・配分、公式優先、unknown・診断）一致。8ケースは意図的にcatalog単位をnullへ改変した合成入力のため原版契約で拒否する。既存168baselineテストはそのまま別途実行し、既存のsix reviewed P2差分処理も変更しない。新Attemptの算入正当性や大学制度の未確認部分を保証するものではない。
