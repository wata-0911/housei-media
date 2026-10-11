# 設計書・監査書とdevの整合性監査（2026-10-11）

監査日: 2026-10-11（Asia/Tokyo）。基準: fetchした`origin/dev` **`05dac8c7deb5f9abea93c9967237aacf0427863c`**（PR #138 merge）。文書専用branch: `feature/docs-year-independent-design-20261011`。独立cloneで実施し、既存worktree・無関係な変更・sourcesを変更していない。

状態: **現行仕様の照合と目標設計の監査。年度非依存化・卒業エンジンの実装監査完了ではない。** 過去のH/F項目、PASS記録、公式資料確認履歴はそのまま保存する。H01〜H66を全件再評価した記録ではない。

## 今回の照合範囲

確認したのはdocs全体の版・年度・backup・未実装表現、型/schema、runtime catalog/generator、storage/validation、import source/年度、BackupPanel/Pageの保存経路、進捗/評価/Undo/年度計画、既存テストである。GitHubで#95、#129、#133、#132、#134、#137、#98とPR #126/#138の状態・本文も確認した。個人のlocalStorage・実成績、公式PDFの再取得・全リンク再検証は対象外。iPhone実機についてはPR #138のユーザー報告を参照したが、Workによる再検証はしていない。

既存公式資料の年月・ページ・SHAは既存監査から参照し、新規確認をしたとは記録しない。読み取り不能な公式表を新しい文書へ推測転記しない。

## 現行実装の再確認

| 現行事実 | 根拠 / 目標との差 |
| --- | --- |
| state22 / catalog1 / 2026固定 | [型](../src/planner/plannerCatalog.ts)、[schema](../src/planner/planner_catalog_2026.schema.json)、[loader](../src/planner/catalog.ts)。state/catalog版は別。年度非依存保存は未導入 |
| runtime: 686 Offering、502 Mapping、209 legacy Course、321 CurriculumCourse | catalogを実際にimportして件数確認。requirements182（structured142/unsupported40）。Courseは全provisional |
| Offering relation: unique616 / ambiguous32 / unmatched38、候補Openingなしの制度科目36 | [generated curriculum](../src/data/planner_curriculum_2026.json)、[attach](../src/planner/curriculumCatalog.ts)。制度科目候補は開講なしでも存在するがloader自体は年別relation coverageに依存 |
| imported rowのStage A制度照合とStage B開講照合は独立 | [matcher](../src/planner/curriculumImportMatch.ts)、[apply](../src/planner/gradeImportApply.ts)。現行のname/aliasによるexactは現在カタログ接続であり、歴史的同一性の永久保証ではない |
| 一つのOfferingに一PlannerItem | [validation](../src/planner/validation.ts)、[item state](../src/planner/plannerItemState.ts)。別Openingなら同科目の複数記録は可能、同Openingの再履修は独立ID未対応 |
| future plannedYearは1000〜9999の既存範囲 | validation、[未来表示](../src/planner/planTable.ts)。希望暦年を保存できるがOpeningは2026、方式/期/年間上限は参考。年度非依存実装完了ではない |
| media / correspondence / evaluations / TODOはOpening参照 | [media](../src/planner/mediaSchooling.ts)、[通信](../src/planner/correspondenceProgress.ts)、型。削除後もmapが残る。Attempt IDへの移行は未実装 |
| 公式修得単位の正本はearnedCreditsTotal | [公式数量](../src/planner/officialCourseCredits.ts)、[official facts](../src/planner/officialGraduationFacts.ts)。原行と内訳、元のnull/0を保持。CourseProgressと卒業算入は別consumer |
| 卒論はscope別、public/metaは独立ID | 型、[Page](../src/pages/PlannerPage.tsx)。Offering非依存の経路も存在するため一律Attempt化しない |
| stale annual exactの限定回復は実装済み | [identity validation](../src/planner/curriculumIdentityValidation.ts)、storage。制度exactと旧selectionを保持しannual claimだけambiguousへ下げる。全参照修復や新制度照合ではない |
| loadは主キーへ書き込まない | [storage](../src/planner/storage.ts)。raw保持、future schema拒否、認定shadow。表示回復とraw正本を区別 |
| 原行の取得日を新規年度推定に使わない | PR #126、inferredCorrespondenceYear/sourceCourseFor。通信は試験日→最新リポート日、なければnull/unknown。既存推定/手動年度を一律修正しない |
| 安全な既存auto-registrationは限定earned / planned | autoPlannerItemsForImport。source↔Openingの双方一意性、原行positive等を検査。制度exactだけでOpening代表を選ばず、無条件planned生成も行わない |

## #95の現行仕様と検証境界

[#95](https://github.com/wata-0911/housei-media/issues/95)はclosed/completed、[#138](https://github.com/wata-0911/housei-media/pull/138)はdevへmerged。実装の存在とIssue全ACの実機確認を同一視しない。

| 契約 | 現行コード・挙動 |
| --- | --- |
| 全永続化stateの出力 | [plannerBackup.ts](../src/planner/plannerBackup.ts)。items/public/todos、3進捗/評価map、公式原行/内訳/meta、profile、卒論/指導/scope。メモリの未保存draftは対象外 |
| backup v2 / v1読み込み | [compatibility](../src/planner/plannerBackupCompatibility.ts)。v2はenriched runtime原版＋full/semantic SHA。v1は同一SHAまたは固定registry。未知原版は拒否 |
| compatibilityVersion1 | source.url/page（Offering/Mapping）とProgram.displayNameだけをsemantic比較から除外。他の数量/identity/規則/未知field/配列順まで一致が必要。SHAは大学の真正性認証ではない |
| source/target両方のstate検証 | v2 source snapshotも検証、current catalogに対しても検証。再loadで変化・認定shadowが必要なら正常backup/restore拒否。最新loadをmigrationとして無言使用しない |
| プレビュー | file textのparse/数量要約のみ。state/storageに書かず、全件置換説明・事前backup・最終checkbox確認がある |
| 確定復元 | [restore](../src/planner/plannerBackupStorage.ts)。原text再検証、共通Web Lock内expectedRaw比較、主キー一回setItem、recovery不変。マージなし。Pageは成功後にstate更新/Undoとdraft失効 |
| 通常保存・初期化 | savePlannerState/recoverPlannerStateも共通Lock。通常saveはLockなし既存ブラウザ支援を残すが復元はLockなし拒否。初期化の旧recovery処理と復元は別契約 |
| 原文保護 | [protection](../src/planner/plannerBackupProtection.ts)。primaryRaw/recoveryRaw、各SHA、原版を保持。primary null＋recoveryのみも対応。通常復元には使えずinspectも書かない |
| 保存失敗 | read/quota/security例外・stale raw拒否。rollbackによる再書込なし。原文保護出力は自動修復・自動ダウンロードではない |
| 入力確定 | Page/各editorのdraft、blur/Enter/保存で確定、IME中Enter抑止、失敗後全文再試行。保存待ち中編集停止。復元後古いdraftを継続しない |

関連回帰は`tests/planner.test.mjs`のbackup/protection/legacy-v22/Lock群と`tests/planner-save-lock.browser.mjs`。PR #138の実Chromium17件・extension54件・bookmarklet168件は過去PRでの報告で、本監査の再実行結果と区別する。PR #138に関する利用者報告では、iPhone Safari実機のbackup/restore確認は全項目PASSで、入力確定保存後の追加実機4項目（メディア試験名の連続入力、全回数の複数桁入力とプリセット、日付入力、日本語変換中の入力）もPASS。本監査・PR #139でのiPhone Safari再検証はしていない。将来schema/年度モデル移行は未実装で、その実機検証も未実施。Web Locks非参加の旧タブの制約は残る。

## 文書の不一致と今回の処置

| 文書 / Issue | 古い表現・衝突 | 今回の処置 |
| --- | --- | --- |
| planner/architecture | #95以前の基準、multi-year旧スコープ | 最新追記で全backup/復元と目標へのリンク。元H/F履歴を保持 |
| planner-multi-year-design | annual registry/実開講link前提、v21→提案v22 | 旧案の冒頭明示。保存保護判断だけ継承。現行schemaと今回の目標を混同しない |
| planner-curriculum-centered-model | 年別registryを前提とする後続工程、旧UI説明 | identity/Placement分離は継承、年別開講工程は優先しない。現CourseView UIは別文書/コードで確認 |
| planner-future-year-policy | schema21と古い開講依存方針 | 現行22・将来希望年保存と目標を追記、本文は導入時履歴と明示 |
| course-foundation / course-attempts | 初期Stage Bやauto planned、後続の年度カタログ案 | PR #126後の根拠/非代表選択と現行条件を追記。過去テスト数は当時の記録として維持 |
| course-evaluations / media進捗 | schema6/5を現在形で読む可能性、別年度に評価が共有されないという旧説明 | 現schema22、同Offeringで別年予定は同ownerとなる制約、finalGrade/assessmentと独立Attempt未実装を冒頭追記 |
| grade-import-contract | 通信は日付から年度を推定しないとの古い説明、trimだけの全体照合 | 現Stage A/Bと#126の年度分離へ更新。取得contractとPlanner内部照合を区別 |
| graduation監査 / unknown監査 | 過去「次slice」とH未修正記述の現在化 | 追記で今回の保存設計監査の範囲を限定。全Hやofficial根拠を完了にしない |
| #129（open） | sourceDuplicateなど既存機能と全差分UXが混同され得る | 既存安全機能あり/全面差分対応は後続を区別 |
| #133/#132/#134（open） | 公式確認・公開説明の未完了 | 年度非依存化と別工程。未完を維持 |
| #98（closed） | current_2026新規defaultをhistoricalへ適用する誤読 | 既存明示/unknown/legacyを新defaultで書換えない。具体課程版への移行は別対応表 |
| #137（open） | 開講期/長期休暇スクーリングの検索は確定方針外。分野・区分分類は年度非依存の候補 | 分類フィルター候補のみ維持。時期/長期休暇フィルター（2026参考版を含む）を推奨工程から外す。後続でIssue範囲変更、本PRではIssue改変なし |

各既存文書のschema追加時点・旧PASS件数・検証不能の記録を削除しない。最新版と表示した追記を先に読み、履歴本文を現在の実装指示にしない。

## 旧ZIPの照合

`planner-docs-update.zip`をローカルDownloadsで確認（SHA-256 `eabcd26f33a50ad6ef7217589ea26dd6b2deb171f26bacf1cff4e2195d79f401`）。基準`cb70e4d`、7文書/patch、GitHub権限不足による未反映のREADMEがある。パッチを適用していない。

採用した方針は教育課程表正本、開講追跡除外、旧ID/原記録保護、annual registry旧案の明示、過去監査保持。更新が必要な点は#95完了、#138のv2/v1/原文保護/入力確定/Lock、最新基準、具体的な履修回ownerとmigration規則。ZIP内の問い合わせ回答原本・β必須条件・PDF新規再確認は今回確認していないため、確定事実として転用しない。

## 今回の検証と限界

- `npm run typecheck`、`npm run lint`、`npm run test:planner`: **2155 PASS、fail/skip 0**。既存168ケースの卒業計算baseline比較もPASS。
- `npm run build`: PASS。grade-import生成物検査とcatalog:check（321制度科目/686 Opening）を含む。既存500kB超chunk警告あり。
- 新たに追加した相対リンク/fragment84箇所の存在を確認し、エラー0。変更21ファイルはすべてdocs内Markdown、3監査書の元本文はbyte単位でprefix一致。`git diff --check`もPASS。既存リンクの公式再確認とは区別する。
- 新規テスト・コード変更なし。今回extension/bookmarklet専用suiteと実ブラウザsuiteを再実行していない。PR #138のiPhone実機PASSは利用者報告として記録し、Workによる独立再現とは区別する。PDF再確認・今回のiPhone再検証・新モデルのmigration/数量不変テストは未実施。

目標・未実装・未確定の全体は[方針](planner-curriculum-release-policy.md)、[詳細設計](planner-year-independent-design.md)、[移行/Issue候補](planner-year-independent-migration.md)を参照。flagsは`graduationCheckComplete=false`、`sourceLinksReverified=false`、state22のまま。全公式リンク、全旧課程、全H項目の完了判定を変更しない。

## 変更ファイル一覧

新規4文書:

- `docs/planner-curriculum-release-policy.md`: 確定方針・現状/目標の境界・旧ZIP/Issueとの関係。
- `docs/planner-year-independent-design.md`: domain/参照・単位・owner・改正/課程と未確定事項。
- `docs/planner-year-independent-migration.md`: 旧v22/v1/v2、対応表、純粋変換、失敗保護、テスト、YI-01〜08候補。
- `docs/planner-docs-current-audit-2026-10-11.md`: 本監査、検証と変更一覧。

既存17文書:

| ファイル | 差分 |
| --- | --- |
| `docs/planner/architecture.md` | 最新参照案内＋第15節。#95/#126と目標境界を追加 |
| `docs/grade-import-contract.md` | 現Stage A/Bと年度推定の2段落を修正、backup契約の分離を追加 |
| `docs/planner-backup-compatibility.md` | #138後の現行確認と新モデル未実装の案内 |
| `docs/planner-save-ui-verification.md` | 実装・今回再実行・実機未検証の区別 |
| `docs/planner-curriculum-centered-model.md` | 旧annual工程と最新設計の優先順位 |
| `docs/planner-multi-year-design.md` | 旧案・旧提案v22の明示 |
| `docs/planner-future-year-policy.md` | 現state22、希望年保存と開講保証の境界 |
| `docs/planner-curriculum-course-foundation.md` | #126後の年度/代表Opening/auto-registration現状 |
| `docs/planner-course-attempts.md` | Offering ownerと現UI、#95/#126後の現状 |
| `docs/planner-curriculum-course-view-ui.md` | 現read model継続と年別registry旧工程の区別 |
| `docs/planner-course-evaluations.md` | 現schema/全評価fieldと複数回未対応 |
| `docs/planner-media-schooling-progress.md` | 現schema/assessment/draft/backupと旧記述の区別 |
| `docs/planner-correspondence-credit-progress.md` | 現owner/寄与/公式情報の分離と年度根拠の限界 |
| `docs/planner-export.md` | CSV/PNGと全state JSON復元の区別 |
| `docs/graduation-engine-audit-2026.md` | 現評価を末尾追記、過去本文は無変更 |
| `docs/graduation-false-unknown-audit-2026.md` | 現評価を末尾追記、過去本文は無変更 |
| `docs/planner-unresolved-conditions-audit-2026.md` | 現評価を末尾追記、過去本文は無変更 |
