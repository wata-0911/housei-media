# 第1段階の受け入れ・回帰記録

2026-10-18初回実装、Issue [#177](https://github.com/wata-0911/housei-media/issues/177)。初回記録は実装者による検証。独立監査で見つかったP2 2件に対する2026-10-19の修正は末尾に記録する。修正後の独立再監査待ちで、Draftのままとする。

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

新規は一括266件をPASS後、追加したmatrix/保持/公式予定13件を対象実行してPASS（固有279件）。CIの `test:planner` では既存3,492件と新規279件の計3,771件全てPASS、FAIL/SKIPともに0。[実装commit d77e3c7のCI](https://github.com/wata-0911/housei-media/actions/runs/39120071158) でtypecheck/lint/planner/extension/bookmarklet/buildの全step成功。コマンド間で重複する件数を単純合算しない。

| コマンド | 結果 |
| --- | --- |
| `npm run test:attempt-graduation` | 266 PASS / 0 FAIL / 0 SKIP |
| 追加matrix/保持/公式予定の対象実行 | 13 PASS / 0 FAIL / 0 SKIP |
| `npm run test:planner`（CI） | 3,771 PASS / 0 FAIL / 0 SKIP、うち新規279件 |
| `npm run test:migration` | 133 PASS / 0 FAIL |
| `npm run test:attempt-ui` | 84 PASS / 0 FAIL |
| `npm run test:attempt-persistence` | 103 PASS / 0 FAIL / 0 SKIP |
| `npm run build` | PASS、変更前devの全12ファイルとbyte一致 |
| `python3 docs/planner-yi-01/verify.py` | PASS |
| `npm run test:attempts` | 132 PASS / 0 FAIL |
| `npm run test:institutional` | 36 PASS / 0 FAIL |
| `npm run test:extension` | 54 PASS / 0 FAIL |
| `npm run test:bookmarklet` | 168 PASS / 0 FAIL |
| `npm run test:attempt-persistence-browser` | 再実行17 PASS / 0 FAIL / 0 SKIP |
| `npm run test:attempt-ui-browser` | 9 PASS / 0 FAIL / 0 SKIP |
| `npm run test:planner-browser` | 全44件: 42 PASS / 2 FAIL / 0 SKIP。下記に失敗と再検証を記録 |
| 書道・文学コースの同一test単独再実行 | 1 PASS / 0 FAIL / 0 SKIP、期待値・timeout無変更 |
| `npm run typecheck` / `npm run lint` | PASS |
| `git diff --check` | PASS |

[件数・環境・ログSHAの記録](test-results.json)。指定scriptは全て実行した。ローカルの全planner実行は中断されたため完走扱いにせず、同一実装のCIで `npm run test:planner` 全件完了を確認した。最終の変更は監査記録のみである。

初回の並行ブラウザ実行ではYI-06可搬復旧の共有fixtureが再読込待ちtimeoutとなり、6件に連鎖した（11 PASS / 6 FAIL）。既存問題とは分類せず、コード・期待値・timeoutを変更せず、他ブラウザsuiteとの並行実行をやめて再実行した結果17件全てPASS。通常plannerとdev比較の並行実行は負荷調整のため終了し、完走として集計していない。

## 最新devの既知ブラウザ失敗

最新dev `1866c6b` をgit archiveで展開した別directoryで、#145の `restore invalidates an unsaved media draft even when the stored value is identical` を単独再実行し、同じ `tests/planner-save-lock.browser.mjs:315` のfile input待機が30000ms timeoutになることを確認した。[再現ログ](baseline-browser-failure.txt)。当該testのコード・期待値・timeout・skip設定は変更していない。今回ブランチの全suite結果と区別して記録する。

今回ブランチの全44件では、上記#145と `calligraphy P2 Chromium card state matrix 文学コース` の2件が失敗した。[全体結果・両失敗ログ](feature-browser-results.txt)。後者は再読込後の卒業要件section表示待機timeout（line 549）であり、数量assertionの不一致ではない。保存suite完了後、同一testを単独再実行し1 PASSを確認した。期待値・timeout・skipは変更していない。発生原因は確定しておらず、#145と同じ既知問題には分類しない。初回失敗を成功で上書きせず記録し、独立監査時のブラウザ再現性確認へ引き継ぐ。

既存src159ファイル・既存test・schema22/23・backup・YI-06 authority・通常PlannerPageは変更なし。[build比較](build-comparison.json) の全12ファイルも一致。追加adapterは通常productionから参照されない。独立監査前のReady化・merge・Issue closeは実施していない。

## 制限

全学科の新Attempt正値allocator・完成判定・本人適用の新証明・official detailの排他的associationは未実装。詳細は [adapter-contract.md](adapter-contract.md) と [handoff.md](handoff.md)。Chromium結果はiPhone/Safari実機・大学による公式確認・独立監査の代替ではない。既存v22との比較完了は、新Attempt特殊規則の実装完了を意味しない。

## 2026-10-19 独立監査P2 2件の修正

開始時に`git fetch origin`を実行し、GitHub PR #179のOpen/Draft、head branch `feat/yi-07-graduation-adapter`、最新HEAD `765401484e4b4bdf71f56a1a18699e7cc2eed309`、base dev `1866c6b7668458a6c664d3b2461b4f78c6cc9697`を照合した。作業開始時の未コミット変更は0件。Issue #177はOpen。同じブランチに追記し、別Issue/PR/ブランチ、rebase/reset/force-push、dev/mainへのcommitは行わない。

### P2-1 参照閉包から公式所有への誤昇格

旧実装は`plan.importedSourceCourseId`と方法/年度detailの`sourceCourseId`を無条件にexclusiveへ昇格させていた。validatorは参照IDの存在を検証するが、科目同一性や排他的対応を証明しない。`official_association_unverified`診断が残っても、その後のofficial-owned除外がordinary/Sをsupported 0へ上書きした。

修正後は原行のexact旧CurriculumCourse → safe crosswalk → confirmed Attemptの同一ICだけを所有根拠にする。第1段階には、これに代わる検証済み排他的公式associationの別経路はない。リンクとdetail parentは保持し、非exclusiveの参照原行はpossibleに残す。未証明のdirect linkにもassociation診断を返す。診断に加え、ordinary/Sの両結果がheld/nullとなる。

反例は行政法原行/detailを民事訴訟法のearned本人寄与4からaggregate・方法・年度・両detail経由で参照するケース。同一identity、unknown/ambiguous/conflict/unmatched、未照合/曖昧parent、parentなし、unsafe crosswalkまで検証する。同一科目の厳密な所有では公式null/0/4を手動で補完せず追加経路だけ0除外する。別科目detailが混在しても、別に存在する正当な同一科目aggregate所有は保持する。dangling aggregate linkは既存validatorが拒否する。

既存の`held official matching is not completed by a manual source link`は、未照合原行のリンクだけで0除外を期待していたため、null保留とpossible-overlap診断を期待するよう修正した。このテスト自体が今回の不適切な旧契約を固定していた。固定192 baseline、legacy engineの期待出力、他の既存suiteのassertion/timeout/skipは変更していない。

### P2-2 engine全警告とAttempt潜在影響の混同

旧実装はselected/commonかつ非nullのdescriptorを先に絞ったうえで、見つからないdescriptorを`!r`で無条件採用した。engineは全学科のunsupported警告を返すため、法律scopeの物理学1に他学科31件を紐付けた。

修正後はcatalog descriptorを起点とし、structuredの明示scope、unsupportedの既知scopeLabelを解決して、候補category/科目名との潜在依存を照合する。選択専門内の振替・上限・科目数依存は保守的に保持する。commonの自然/外国語再履修は該当categoryに限定し、一般教育から他学科専門や外国語・体育へ広げない。descriptor欠落や未知scopeLabelを全Attemptの影響へ昇格させない。既存全警告はretainedProgressにそのまま保持する。

追加テストは全8scopeそれぞれで、common3categoryのrequirement ID集合の完全一致、選択専門・候補なし・本人適用未確認の他学科候補の完全一致を検証する。法律/commonの物理学1では一般教育10要件だけとなり、他学科unsupported31件を含まない。選択専門の未対応要件を除外せず、未知Attemptには選択scope/common全候補を残す。category/cardだけの確認に依存しない。

### RED → GREENと検証の扱い

追加64テストの最終版を監査HEADのpristine archiveへコピーし、元実装で**6 PASS / 58 FAIL / 0 SKIP**を確認。同じテストを修正実装で**64 PASS / 0 FAIL / 0 SKIP**として確認した。成功6件は同一科目・parentなし等の対照例。試験用archiveはブランチを作らず使用し、既存checkoutやsourceを巻き戻していない。

初期テスト記述では既存engineが参考専用としてrequirementsから除く`common_total_min_credits`も期待していたため、24件が余分な期待IDで失敗した。engineと固定baselineを確認してテスト記述を修正し、その後、同じ最終版で上記RED/GREENを取り直した。教養42・放送大学認定上限はreference側の扱いを維持する。

初回byte比較ではTailwindが追加変数の`!visible`をCSSクラスとして抽出し、CSSと参照する成果物に差分が生じた。変数名を`evaluatedRequirementIds`へ変更して再buildし、最新devのpristine archiveから同じ依存で再buildした全12ファイルとbyte一致した。初回第1段階のmanifest全12件とも一致。通常PlannerPage・CSS設定・既存productionソースを変更して差分を隠していない。

| 検証 | 今回の結果 |
| --- | --- |
| 監査HEADの追加テストRED | 64件: 6 PASS / 58 FAIL / 0 SKIP |
| 修正後の同じ追加テストGREEN | 64 PASS / 0 FAIL / 0 SKIP |
| 全planner（既存scriptと同じ全22ファイル） | **3,835 PASS / 0 FAIL / 0 SKIP**、18分13秒で完走 |
| 固定192件 | 上記に含む。全8scope×24件、gzipと非圧縮SHA不変、全field一致 |
| YI-07 suite | 上記に含む。既存279＋追加64＝343件 |
| extension / bookmarklet | 54 PASS / 168 PASS、いずれもFAIL/SKIP 0 |
| typecheck / lint | PASS。CSS抽出を避ける変数名変更後にも再実行してPASS |
| build / grade-import check / catalog check | PASS。変数名変更後にもbuildを再実行してPASS |
| 最新devとのproduction byte比較 | **12/12一致**、[今回のmanifest](p2-build-comparison.json) |
| YI-01 verify / diff check | PASS |
| Chromium YI-05 | **9 PASS / 0 FAIL / 0 SKIP** |
| Chromium YI-06 | **17 PASS / 0 FAIL / 0 SKIP**、今回初回で全件成功 |
| Chromium 通常planner | **43 PASS / 1 FAIL / 0 SKIP**。失敗は既存#145のfile input待機timeoutのみ |
| 最新devの#145単独再現 | **0 PASS / 1 FAIL / 0 SKIP**、同じline 315の同じselectorで30000ms timeout |

通常画面の[今回全44件結果](p2-feature-browser-results.txt)と[最新devの単独再現](p2-baseline-browser-failure.txt)を保存した。devはfetch済み`1866c6b`のpristine archiveを別directoryで起動し、同じPlaywright/Chromium、同じテスト・期待値・timeoutで確認した。YI-05→YI-06→通常画面→dev単独の順で、ブラウザsuiteを並行実行していない。前回の書道・文学コースの表示timeoutは今回は再現せず、3コースの状態matrixと後続テストも初回で成功した。今回の#145失敗を成功で上書きしたりskipしたりしていない。#145の修正は本P2修正に含めない。

ローカル全plannerは`package.json`の`test:planner`と同じファイル集合・既存assertionを使い、実行器に`--test-concurrency=2`だけを加えて負荷を制限した。CIは既存workflowの`npm run test:planner`をそのまま使う。新変数名への変更は算入ロジックを変えず、最終pushのCIでそのHEADの全チェックを照合する。CI結果は[同一PRのChecks](https://github.com/wata-0911/housei-media/pull/179/checks)とPR本文に最終HEADとともに記録する。

[RED/GREENの全64件結果](p2-red-green.txt)と[件数・実行オプション・ログSHA](p2-test-results.json)を保存する。コマンド間の重複件数を合算しない。本PRに既に含まれていたYI-07テストのうち、不適切な旧契約を直接固定していた1件の期待値を修正した。その他の既存期待値、固定baseline、既存テストのtimeout/skipは変更していない。

schema22/23、legacy engine、YI-04 projection、YI-06保存/backup/IDB authority、通常PlannerPage、公式catalogは変更なし。新Attemptの正のordinary/S・完成判定はheld/unsupportedを維持し、架空Offeringを生成せず、retained-onlyを全体判定へ接続しない。

修正範囲の実装者検証では新たなP1/P2を検出していないが、独立再監査は未実施。再監査では、(1) aggregate/detailリンク単独からordinary/Sの0除外へ到達しないこと、(2) 同一ICの公式null/0と正当な重複除外が残ること、(3) 全8scopeのrequirement ID包含/非包含とretained側全警告の保持を重点に確認する。Draft・Issue Openを維持し、Ready化・merge・Issue close・一般公開は行わない。

## 2026-10-19 独立監査R1/R2の修正

開始時にfetchし、PR #179の最新HEADが監査対象`7fe931dd5de407ed4cc9b0704ec84ba6c4fd212a`、devが`1866c6b7668458a6c664d3b2461b4f78c6cc9697`であること、既存ブランチ`feat/yi-07-graduation-adapter`がクリーンであることを確認した。同じPR・ブランチを使用し、別Issue/PR/ブランチ、rebase/reset/force-push、dev/mainへのcommitは行わない。

### R1 候補追加による保留範囲の消失

原因は`unknown = relevant.length === 0`で、scope外候補を捨てた後の空/非空だけから不明範囲を決めていたこと。他学科のみの未確認候補にcommon候補を追加すると、未解決の専門影響まで消えていた。

修正は絞り込み前に`unverifiedOutside`（本人適用未確定かつscope外候補あり）を評価し、候補が残る間は`selected_scope_unknown`を維持すること。既存のselected/common要件filterは変更せず、前回の他学科unsupported31件混入を再発させない。confirmed時の局所化も保持する。

全8scope×common3区分の24ケースで、unknown/unverifiedの両状態、候補追加前後のrequirementIds/cardIds包含、配列の完全一致、順序反転後のimpact完全一致、pure helperへ渡す候補順の反転を検証する。confirmedの3対照例はpure helperの事前条件だけを制御し、scope外だけならnone、common追加後はそのcommonだけへ局所化することを確認する。同じ偽装graphは既存validatorが拒否する。実catalogに存在しない本人適用証拠を作ってadapterに受理させるテストではない。

### R2 疎配列・アクセサによるsource一致検査の回避

旧`sameAttemptData`は配列に`.every()`を使い、穴のindexを検査しなかった。さらにobject同一参照の即時成功、getterを実行する値読取り、比較後のcaller retained再cloneがあり、不正入力や比較後に異なる値を返す入力から算入データを取得し得た。

共有比較関数をown property descriptorによるplain data比較へ変更した。配列長・index存在・範囲・追加property、data descriptor、列挙性、prototypeを確認し、穴、accessor、symbol/非列挙property、関数・bigint・非有限数・Date/Map/Set、循環参照を一致としない。キー順やfreezeによるwritable/configurable差は比較しない。配列順と省略/null/0/正値を区別する。bare undefined同士は省略pathの比較にだけ維持し、明示undefined propertyは拒否する。

adapter envelopeもdescriptorから読み、getter/setterを起動しない。sourceとの完全一致確認後に、計算と返却のretainedを検証済みsourceからcloneする。caller retainedを比較後に再利用しない。graphの反射・clone失敗はrejectedとし、graph JSON guardでも疎配列や独自array prototypeをschema検査前に拒否する。schema22/23の定義・保存形式・authorityは変更しない。

公開科目2単位を持つ正規decode sourceを使い、通常削除・書換えと疎配列削除を独立に検証した。collection/index/credit/envelopeのgetter、setter-only、array追加accessorは呼出し0回で拒否する。比較に成功するdata descriptorのviewでも、caller側get trapを算入へ使わずsourceの公開2単位と既存engineの全出力を維持することを確認する。循環・反射失敗・clone不能graph・範囲外numeric propertyで穴を隠すケースも別に検証する。

graphもclone前後のデータ一致を確認してから使用する。Date/Map/Set/RegExpのprototypeをObjectへ偽装すると、事前検査時に見えていたown fieldがstructuredClone後に消える入力もあるためである。このようなsnapshotの欠落も計算へ流さずrejectedとする。clone失敗をcatchするだけでなく、cloneが成功した場合の保持も確認する。

### 反例のRED → GREEN

追加71件の同じ最終テストを、監査HEADのpristine archiveへコピーして**17 PASS / 54 FAIL / 0 SKIP**を確認した。最後の追加1件は、実catalogの言語コースの共有ICから他コース配置も候補に入るケース。同一ブランチのcheckoutをresetせず、試験用archiveで旧実装を実行した。既存のscopeLabel対応表は新テストからも参照できるよう宣言位置だけを移した。

前回P2テストとの初回同時実行は133 PASS / 1 FAILだった。「選択scopeだけの専門科目」を検証する言語コースfixtureが、日本文芸研究特講・韻文の共有ICを使い、実際には3コースの候補を含んでいたためである。R1の修正条件ではこれを専門局所化に戻してはならない。fixtureをscope内だけの候補へ限定し、前回のrequirement ID完全一致・他学科の非包含という期待値は変更していない。実共有ICの不明保留は新しい独立テストへ残し、fixture選択でこの反例を隠していない。固定baseline、既存卒業engine、schema22/23、catalog、既存のtimeout/skipは変更していない。

修正後の最終sourceで、新規71＋前回P2の64件を同時実行し、**135 PASS / 0 FAIL / 0 SKIP**。R1のREDは要件・カード両方の失われたIDをまとめて表示する。[全件結果と代表反例](r1-r2-red-green.txt)、[件数・実行条件・source/log SHA](r1-r2-test-results.json)を保存した。

| 検証 | R1/R2修正時の結果 |
| --- | --- |
| 最終反例のRED | 71件: 17 PASS / 54 FAIL / 0 SKIP |
| 最終sourceの反例＋前回P2 | 135 PASS / 0 FAIL / 0 SKIP（新規71＋既存64） |
| 全Plannerローカル初回 | 3,905件: 3,904 PASS / 1 FAIL / 0 SKIP、19分19秒で完走。旧fixtureの1件だけ失敗 |
| 固定192件 | 上記全Planner内で全件PASS。全8scope×24件、gzip/非圧縮SHAとも不変 |
| YI-04 / YI-05 / YI-06 | 全Planner内のmigration133、workbench84、persistence103は全件PASS |
| Chromium YI-05 / YI-06 | 9 PASS / 17 PASS、いずれもFAIL/SKIP 0、初回で成功 |
| extension / bookmarklet | 54 PASS / 168 PASS、いずれもFAIL/SKIP 0 |
| typecheck / lint / build | PASS。最終のgraph clone保持検査後にも再実行してPASS |
| grade-import / catalog / YI-01 verify / diff check | PASS |
| 最終production byte比較 | 最新devのpristine archiveと双方再build、[12/12ファイル一致](r1-r2-build-comparison.json)。前回manifestとも一致 |

ローカル全Plannerは既存scriptと同じ22ファイルを並列数2で実行した。このprocessは旧fixtureと追加70件の版を既に読み込んでいたため、その失敗を消さず記録する。最終suiteは既存343＋追加71＝414件、全Plannerは既存3,492＋414＝**3,906件**となる。最終の全件判定はpushしたHEADの既存CI（`npm run test:planner`無変更）で照合し、[同一PRのChecks](https://github.com/wata-0911/housei-media/pull/179/checks)とPR本文にHEAD・CI結果を記録する。部分実行の重複件数を合算して完走扱いにしない。

変更はadapter、impact、共有比較/JSON guard、YI-07テスト、契約・受け入れ・検証記録に限定する。保存/復元/authorityの実装、YI-04 projection、schema22/23、固定baseline、legacy engine、公式catalog、production PlannerPageは変更しない。新Attemptの正値・完成判定はheld/unsupported、両完了flagはfalseのままとする。

独立再監査は未実施。再監査は、未確認scope外候補を含むunionの要件/カード包含と順序不変性、他学科unsupported非混入、疎配列・accessor・clone欠落の拒否、計算retainedのsource固定、YI-04/05/06の有効なJSONデータ互換性を重点に確認する。PR Draft・Issue #177 Openを維持し、Ready化・merge・Issue closeは行わない。

## N1・F3残存の再監査対応（2026-10-23）

- [x] N1: 組込み型列挙では任意Proxy/内部slotを証明できないため、提出入力をprimitive JSON文字列へ変更。自動stringify fallbackなし。有効な未審査JSONはheld。
- [x] WeakRef / Proxy Map / Promise、通常JSON、null-prototype、疎配列、accessor、循環、boxed String、toJSON、JSON構文・固定schema違反を回帰対象に含む。
- [x] F3: completion固有の公式年度・detail binding前提をmissingEvidenceへ追加し、本人source申告で解除しない。他軸・既存判定状態/value/reasons・数量・影響範囲を維持。
- [x] 公開入力型・valid test呼出側・旧F1正常object受理ケースへの影響と安全性の限界をevidence-foundation.mdに明記。
- 検証結果はevidence-n1-f3-verification.json、RED/GREENはevidence-n1-f3-red-green.txtを参照。N2は#183（確認時Draft/Open）、dev未取込。最終CIはPR #181本文に記録する。
