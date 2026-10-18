# 第1段階の受け入れ・回帰記録

2026-10-18、Issue [#177](https://github.com/wata-0911/housei-media/issues/177)。実装者による検証。独立監査は未実施、Draftのままとする。

## 固定baseline

開始時に `origin/dev` をfetchし、`a4c9a088680b376daf7a66a22b62d755036a2107` と一致することを確認した。既存Open PRなし。専用featureブランチをこのdevから作成した。最終再開時のdevは `1866c6b7668458a6c664d3b2461b4f78c6cc9697`。PR #178のroot READMEだけの更新をfast-forwardで取り込んだ。卒業engine・保存・catalog・既存testの差分はない。

`tests/fixtures/yi07-legacy-baseline.json.gz` は変更前devの `git archive` を別directoryへ展開し、合成fixtureモジュールだけをコピーして採取した旧engineの完全出力。後に同じpristine archiveから192件を再計算し、全field完全一致を確認した。adapterから期待値を生成していない。

- 非圧縮JSON SHA-256: `a0aed205de6ad027d81351ef354e677b505785de66442f137fdfc21a8af34a7c`
- `sourceCommit` とSHAをテストで固定し、gzip内には読めるJSONの全出力を保存する。ハッシュだけの合計比較ではない。監査時は `gzip -dc tests/fixtures/yi07-legacy-baseline.json.gz` で全fieldを参照できる。通常テストは読み取りのみで、snapshot更新機能を持たない。
- `snapshotValue` はpresent-undefinedをタグ化する。property省略、null、0、配列順、数値、理由文を区別し、丸め・ソート・許容差・field whitelistを使わない。
- 各scope: 既存未解決条件20件＋全関連Offeringを含むearned/in_progress/planned/mixedの4件。合計24×8=192件。
- 元の未解決条件fixtureの `I-credits` 8件はcatalog自体を書き換えるため、この「同一元catalogのv22移行」集合には含めない。既存未解決条件suiteでは引き続き実行する。
- 初回fixture作成時の1単位Offeringへの寄与2、detail原名称/指紋の不整合は、移行validatorが拒否したためfixtureを修正した。修正したdense32件は変更前devから採取し直し、既存160件の期待出力が不変であることも確認した。validatorや既存テストの期待値は変更していない。

| scope | 固定旧出力 | 未編集projection | 新Attempt境界 |
| --- | --- | --- | --- |
| 日本文学・言語 | 24件 | 同じ24件 | 全Placement候補、完成/S/特殊規則の保留 |
| 日本文学・文学 | 24件 | 同じ24件 | 同上 |
| 日本文学・芸能文化 | 24件 | 同じ24件 | 同上 |
| 史学 | 24件 | 同じ24件 | 演習/概説/修得順/反復/振替の保留 |
| 地理 | 24件 | 同じ24件 | 必修S/演習/特講/段階配分の保留 |
| 法律 | 24件 | 同じ24件 | 8科目32/部分S2/移動/卒論の保留 |
| 経済 | 24件 | 同じ24件 | 選択必修/特講/演習/卒論の保留 |
| 商業 | 24件 | 同じ24件 | 同上、経済とは別scope |

比較対象は `calculateGraduationProgress` の全objectと `deriveCurriculumCourseProgress` の全object。requirements全件のstatus/earned/planned/inProgress/target/reason、cardsの数量/内訳、completion、ordinary/S、referenceProgress、unknownReasons、coverageSummary、公式重複抑制、特殊diagnostic、`graduationCheckComplete=false`を含む。元sourceと未編集targetのみに `projectLegacyState` を使用する。合法編集後はprojectionが拒否すること、新adapterが独立に受理することを別テストにする。

## 16必須回帰の所在

全て `tests/attempt-graduation.test.mjs`。fixtureは合成データのみ。

| 項目 | 検証 |
| --- | --- |
| 1 未編集v22 | 192固定完全比較＋未編集projection |
| 2 合法編集 | YI-05 edit成功、新adapter受理、旧projection拒否 |
| 3 2035年 | Offeringなし、legacyRefs空、公式実績年はnull |
| 4 同名/同年/同方式 | 別Attempt IDを維持し、合算完成を主張しない |
| 5 寄与の省略/null/0/正 | property存在とRecordedQuantityを分け、未確認はnull |
| 6 制度4/Offering2 | 構成・登録・本人量を別authorityに保持 |
| 7 通信2/S2 | 合計完成4/S4を生成しない |
| 8 公式4/手動2 | aggregate所有のmanual earned incrementのみ除外 |
| 9 aggregate/複数detail | 2＋99を101にしない。同detail複数参照を診断 |
| 10 公式held | 手動source linkでも公式nullを補完しない |
| 11 identity/Placement/適用 | unknown/ambiguous/conflict/unmatchedを保持、先頭選択なし |
| 12 完成 | 公式Course完成4と未完成2を区別。Attemptへ無根拠に完成を移さない |
| 13 修得順/反復 | null/重複順/異なる順を区別し、順序だけで反復許可にしない |
| 14 owner/Undo | detached、未解決旧owner、削除Undoで出力完全復元 |
| 15 認定/公開/卒論 | 全8scopeの非空指導・卒論、認定内訳、公開科目を別ownerのまま保持 |
| 16 全8scope | 固定比較、各scope、全Placement、共通3categoryの新境界matrix |

追加でofficial null/0/2/4、planned/in_progressを公式earned除外で消さないこと、native公式反復8scope、書道12条件、retained改変拒否、入力freeze/IO・clock・UUID trap、既知公式量の不変性、category局所化を確認する。

YI-06のin-memory AtomicStoreで移行commit→合法edit保存→別controller再読込→adapter→backupを実行。adapter前後でstate/graph/source/receipt/authorityとbackup文字列が完全一致し、store read/write回数も変化しない。実ブラウザ保存は別の既存YI-06 suiteで検証する。実利用者のprimary/recoveryへはアクセスしない。

## 実行環境・結果

Node 24.13.0、npm 11.6.2、ローカルmacOS。既存lockfileの依存を使用。Chromium headless shell 1243、Playwright 1.62.1、隔離contextと合成fixtureのみ。CIは既存Node22 jobの `test:planner` に新suiteを追加し、既存assertion/skip/timeoutは変更しない。

新規は一括266件をPASS後、追加したmatrix/保持/公式予定13件を対象実行してPASS（固有279件）。現在の `test:planner` は279件全てを含む。コマンド間で重複する件数を単純合算しない。

| コマンド | 結果 |
| --- | --- |
| `npm run test:attempt-graduation` | 266 PASS / 0 FAIL / 0 SKIP |
| 追加matrix/保持/公式予定の対象実行 | 13 PASS / 0 FAIL / 0 SKIP |
| `npm run test:migration` | 133 PASS / 0 FAIL |
| `npm run test:attempt-ui` | 84 PASS / 0 FAIL |
| `npm run build` | PASS、変更前devの全12ファイルとbyte一致 |
| `python3 docs/planner-yi-01/verify.py` | PASS |
| `npm run test:attempts` | 132 PASS / 0 FAIL |
| `npm run test:institutional` | 36 PASS / 0 FAIL |
| `npm run test:extension` | 54 PASS / 0 FAIL |
| `npm run test:bookmarklet` | 168 PASS / 0 FAIL |
| `npm run test:attempt-ui-browser` | 9 PASS / 0 FAIL / 0 SKIP |
| `npm run typecheck` / `npm run lint` | PASS |

残るsuite・CIの結果は完了後に追記する。初回の並行ブラウザ実行ではYI-06可搬復旧の共有fixtureが再読込待ちtimeoutとなり、6件に連鎖した（11 PASS / 6 FAIL）。既存問題とは分類せず、条件・期待値を変更せず再実行中。通常plannerとdev比較の並行実行は負荷調整のため終了し、完走として集計していない。

## 制限

全学科の新Attempt正値allocator・完成判定・本人適用の新証明・official detailの排他的associationは未実装。詳細は [adapter-contract.md](adapter-contract.md) と [handoff.md](handoff.md)。Chromium結果はiPhone/Safari実機・大学による公式確認・独立監査の代替ではない。既存v22との比較完了は、新Attempt特殊規則の実装完了を意味しない。
