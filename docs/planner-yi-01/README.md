# YI-01: 公式教育課程表と科目identity対応表の監査

監査日: 2026-10-11（Asia/Tokyo）。IssueはGitHub実番号 [#140](https://github.com/wata-0911/housei-media/issues/140)（タイトルは `Y-01`、本文は `YI-01`）。独立cloneで取得した最新`origin/dev`は `f6da38b7a968302b184d38bbcb328feb30a9c6c6`、[PR #139](https://github.com/wata-0911/housei-media/pull/139)のmerge commit。ブランチは`docs/yi-01-identity-audit`。他作業のcheckoutには触れていない。

**全321 CurriculumCourse・全502 Mappingの監査台帳を作成した。年度横断の同一性、全課程の卒業算入、公式リンク全件再検証のPASSではない。** `safe`は今回確認した資料版における制度科目参照の限定確定。過年度への自動適用を含まない。実装・runtimeカタログ・保存schema・migrationは無変更。

## 成果物と読み方

| 成果物 | 役割 |
| --- | --- |
| [公式表・脚注Markdown](official-evidence.md) / [502原行JSON](official-rows.json) | 画像照合済み物理行、正式ラベル、構成単位、分類、scope、方式記号、脚注、bbox。旧データの転記を公式確認と呼ばない |
| [科目コードMarkdown](official-codes.md) / [JSON](official-codes.json) | 本科生・選科生表と教職用途を区別した578行の必要抜粋。原列・記号・条件を保持 |
| [脚注JSON](official-notes.json) / [補助・改正資料](official-context.md) | 全84脚注の全文転記・冊子/PDFページ・marker・scope・source digest。監査者注記は別field |
| [321対応CSV](curriculum-crosswalk.csv) / [JSON](curriculum-crosswalk.json) | 既存CurriculumCourse全件。候補、限定採用ID、判定、peer、旧equivalence、rule版、証拠 |
| [502対応CSV](mapping-crosswalk.csv) / [JSON](mapping-crosswalk.json) | Mapping全件。原行対応と制度identity確定を別fieldにし、コード用途・scope・旧Offering参照を追跡 |
| [旧関係JSON](legacy-relations.json) | 686 Offering ID、209 legacy Course対応、明示Mapping edge、override来歴。日程・開講期・年別名称は収録しない |
| [stable ID設計](stable-id-design.md) / [YI-02契約](yi-02-handoff.md) | 採用条件と保留を区別。新read model・loaderの設計のみ |
| [集計JSON](summary.json) / [検証器](verify.py) | 件数・digest・参照・分類・禁止範囲の機械検証。PDFの再読解を機械PASSと代替しない |

CSVは一覧レビュー、JSONは根拠・元の値の確認用。JSONの`adoptedStableId`は監査上の採用可能値であって、runtimeへ書き込んだIDではない。`candidateStableIds`は不変の旧ID候補を保持し、保留対象への発行・統合を行っていない。`sourceDigest`は添付原版、`legacyDigest`は該当元JSONのバイトdigest。安全な再利用には下記6ファイルすべてのdigest集合の一致も必要。

## 原資料・版・ページ対応

| 項目 | 記録 |
| --- | --- |
| 添付ファイル名 | `shiori2026.pdf` |
| 表紙に示す版 | 法政大学通信教育部『学習のしおり』2026（2026年度）。改訂番号は確認できない |
| 原版SHA-256 | `1ab6bad5b372f2dd12f6a4ecc4b56d3b3c5338b201765b4de775b820d49e3bf0` |
| 原版ページ数 / サイズ | 248ページ、14,702,159 bytes、A4、PDF 1.4 |
| 提供経路 | このチャットで利用者が指定したローカルPDF。大学サイトからの元の取得元・取得日は不明（推測しない） |
| 原版metadata | Creator Adobe InDesign 18.5 / Producer iOS Version 26.6 Quartz PDFContext。Creation/ModDate 2026-08-26 22:27:57 JST。ファイル内部値であり取得日・刊行日ではない |
| 比較用別PDF | 大学既存台帳URLから2026-10-11に取得。SHA `bb7fee419cec0f9d421b1d206947cf8fb1facb69992d685352817f756d19c4a5`、248ページ、14,983,441 bytes、Adobe PDF Library 17.0。過去監査digestに一致。添付原版の同一バイトコピーと扱わない |
| 比較用取得URL | https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf |

冊子の「010」等を冊子p.10と表記し、PDF通算は1始まり。対象範囲は画像のフッター番号を確認し、いずれも`PDF通算=冊子+2`。表紙・見返しはこの式による冊子番号を付けない。

| 冊子 | PDF通算 | 監査範囲 |
| --- | --- | --- |
| 10-13 | 12-15 | 単位と方式、課程表の読み方、科目選択。開講日程は転載対象外 |
| 28-32 | 30-34 | 単位制度、構成単位と修得方法。認定・登録・算入を混同しない |
| 42-65 | 44-67 | 全学科課程表、注意点、2013改正の継続措置 |
| 66-69 | 68-71 | 進級と卒業の数量・条件の相違。締切・年度日程は収録しない |
| 199-213 | 201-215 | コード用途・本科生/選科生・教職新旧法/学科条件。p.214の教職続きは未監査 |

PDF本体・全ページ画像・全文抽出はGitへ追加しない。監査に必要な行・脚注・制度説明とlocatorのみを記録する。対象52ページをPDFiumで描画し目視確認した。テキスト抽出器はpdfplumber。Popplerは初回に日本語を空白描画したため、画像確認根拠に採用しなかった。ネイティブ描画の試行も完了しなかったため証拠に数えない。

抽出品質の重要事項:

- ページ外に隣接ページ文字があるため、ページ内・表内の座標で抽出する。
- 冊子p.50/51/52/54/56の右側表に非表示旧文字層がある。文字重複除去だけでは旧科目・旧脚注が混入する。MCID 126/190/253/382/472の旧層を、画像で確認した覆われた領域だけ除外した。左表や上段表は除外しない。
- p.199-203のコード最終列には右罫線欠落による抽出空欄がある。`None`を本当に空欄と判断せず、同じ物理行の座標と画像でコードを確認した。
- 可視内容の`unreadable`は0。ただし旧非表示層の内容を原表と認定していない。`image_verified`はこの資料の可視行を確認した意味で、旧overrideの`officialVerified`を変更しない。
- 原表空欄は`null`/`∅`。特に放送大学認定枠の構成単位空欄を10や0へ補完しない。結合列の展開は表の適用範囲を記録し、個別行に卒業要件の総枠を足さない。

## 実データの生成とentityの分離

| entity | 再検証件数・生成元・ID |
| --- | --- |
| CurriculumCourse | 321。`curriculumGeneration.ts`が502 source rowsと87 explicit groupsから生成。234 singletonは`curriculum:<mapping UUID>`、87 groupはledgerのpin済み`curriculum:<UUID>`。名称・構成単位はsource rows、開講名から生成しない |
| Mapping | 502。`planner_catalog_2026.json`の配置snapshot＋復元した`curriculum-rows-2026.json`。9 Program scope（全学共通1、学科/コース8）。UUIDは元import manifestの値を保持。元`contract.py`/PostgreSQL builder/manifest原本はdevに存在せず、厳密な最初のUUID発行アルゴリズムは未確認 |
| Offering | 686。2026 snapshot、UUIDを保持。rawのmanual_reviewにoverrideを適用後、curriculum関係をID join。旧Offering単位は構成単位ではない。classCode/subjectCodeは通信の5桁コードと別namespace |
| legacy Course | 209、すべてprovisional。Offering由来candidateの旧計算identity。338 OfferingにcourseId、348はnull。最初のUUID mint仕様のコードはdevにない。制度科目の正本として再利用しない |

実際のCurriculumCourse↔Mappingは502行の**partition**で、一Mappingのownerは必ず一CurriculumCourse、一CurriculumCourseは複数Mappingを持てる。現データを無制約の多対多だと説明しない。Offering↔Mappingは複数edgeを持ち、Offering↔CurriculumCourseは候補として多対多になり得る。目標InstitutionalCourse↔課程・scopeの関係はPlacementを介し、複数配置・版を許す。

`generate-curriculum-catalog.mts --check`はoverride適用後のsource全件一致・頁一致・group重複/既存edge連結・同定義・ID重複・生成JSONのbyte一致を検証する。`attachCurriculumCatalog`は全Mapping coverage、単位とscope、686 relation coverage、候補のstale検査。これらは**公式PDFの正しさや年度横断同一性の検証ではない**。name/code/creditsの類似による候補抽出は別のimport matcherであり、資料改正を確定しない。

再確認した旧relation: unique616 / ambiguous32 / unmatched38。候補OfferingなしのCurriculumCourse36。209 legacy Course relationは現generated表ではunique209だが、制度stable確定を意味しない。旧overrideはmanual_curated53 Offering、official_source_verified2 Offering、未適用631。手動元の学科限定・コード別名・テーマ等を今回無条件に公式昇格しない。

履歴: `planner-mapping-cleanup-audit-2026.{md,json}`、`planner-special-cases-2026.md`、`planner-teacher-training-source-gap.md`、`planner-curriculum-course-foundation.md`、`curriculum-equivalences-2026.json`を直接確認。政治学の既存official overrideは別の教職手引きに依拠するが、今回は当該別PDFを全件再検証していない。過去監査を削除・改変していない。

## 全件結果

| entity | safe | ambiguous | conflict | unmatched | 合計 |
| --- | --- | --- | --- | --- | --- |
| CurriculumCourse | 221 | 85 | 6 | 9 | 321 |
| Mapping（identityを含む判定） | 273 | 214 | 6 | 9 | 502 |

502 Mappingすべてに公式物理行の一意locatorがある。原行照合ができてもidentityを確定できない場合がある。`officialRowMatchStatus=safe` 502、配置定義はsafe496/conflict6、歴史的連続性は全件unverified。279 Mappingに本科生/選科生の用途scopeに一致するコード、223は当該表にその方式・科目のコードが掲載されない。S/メディア-onlyや算入枠等の未掲載を`unmatched`と混同しない。

判定ルールはversion1。CurriculumCourse内訳: S-ROW221 / A-GROUP58 / A-PEER22 / A-ORDER5 / C-METHOD6 / U-BUCKET9。`safe`を増やすための自動統合は行わない。

| 状態・具体例 | 追える根拠・判断 |
| --- | --- |
| safe: `curriculum:06d2b70f-13b4-43e1-8753-8dfd0f495a60` 監査論Ⅱ | Mapping同UUID、p58-商業-選択-left-r10、2単位、選択、商業、p.59注意点。本科コード64547、p.202。ⅠとⅡを区別 |
| safe: 日本文学科内の複数コースgroup | p.48の全コース科目を履修できる説明とp.49-51の行・区分を合わせて限定確定。他学科へ広げない |
| ambiguous: `curriculum:0203762e-4a77-4eca-b1e0-e361cb4b780a` 史学概論 | p54-地理-選択-r01・34504に対応。史学科にも同名科目がある。既存別IDを同じ制度identityに統合する直接証拠が不足 |
| ambiguous: 史学演習1〜4 / 歴史資料学1〜6 | p.53 e/iは数字が内容ではなく修得順であると明示。既存5 IDを内容別科目に昇格しない |
| conflict: `curriculum:c644b305-f312-4b08-8f8f-aaf02cf9069e` 日本史概説2単位 | p52-史学-スクーリング選択必修-r01、p.53 c、p.42。区分はS必須、既存schoolingOnly=false。4単位必修の別配置と併せ6単位の規則を保持 |
| unmatched: `curriculum:3a37ed61-b884-47d0-a25a-e0d7c39c4d3c` 公開科目枠 | p49-日文文学-選択-r16、p.42公開科目説明。公式枠自体は存在するが個別制度科目を指さない |
| unmatched: 放送大学単位認定科目 | p44-common-一般教育-r29。認定枠。構成単位空欄、最大10は認定上限。InstitutionalCourseを確認しない |

C-METHODの6件は**bool表現の意味・完全性の不整合**で、既存requirementTypeには必須方式が残る。元parserが「個別Ⓢ印があるか」をboolへ転記した可能性を否定できない。bool=falseを「通信履修可能」と読む独立マスターを作ってはならないため、後続採用を保留する。現卒業engineの誤計算をこの文書だけで断定しない。単位・名称・分類・最低学年の残り照合に数値矛盾は確認されなかった。

## 未解決・確認事項

- 85 ambiguous、6 conflict、9 unmatchedのCurriculumCourse（Mapping229件）は確定stable参照へ自動変換しない。詳細は各JSONのrule/peer/元groupを参照。
- 史学科概説4＋2単位、地理の演習・現地研究・追加算入先はPlacementと履修回/算入ruleを分ける。旧IDが違うことは別制度科目の証明ではない。
- 西洋哲学史等の学科別通信コード・教職括弧コード、教育法と商法の新旧条件、社会思想史の用途別2/4単位は[コード注記](official-codes.md)参照。
- p.60-65は「抜粋」。ログイン後の2013変更資料、過年度全課程、大学個別回答の原本は未確認。追加確認一覧は[引き継ぎ](yi-02-handoff.md)。問い合わせ送信は行っていない。
- stable IDの221実値は今回の資料版のidentityとして再利用可能。歴史的continuityの合否を別fieldで保留する。未知/旧課程を2026に確定しない。

## 検証と変更境界

全件集合・digest・unique/reference・分類集計・source頁/scope/数量一致・safe採用条件を`python3 docs/planner-yi-01/verify.py`で検証する。Markdownの列数・文字化け・相対リンクも同検証器でチェックする。PR差分の範囲確認は台帳検証と分離し、比較元を明示して`python3 docs/planner-yi-01/verify.py --check-change-scope --base origin/dev`のように実行する。通常の実行はGit差分を読まない。公式表は52ページ画像と照合し、複雑表の旧層・結合セル・右端列を補正した。

変更はこのディレクトリの文書・監査JSON/CSV・監査検証器のみ。`src/`、`src/data/`、既存scripts、package/lockfile、既存docs履歴は無変更。state22、graduationCheckComplete=false、sourceLinksReverified=falseを保持。公式earnedCreditsTotalの再計算・内訳補完・source link自動付替え・migration・年度開講収録・mergeを行わない。

## 最終検証記録

- `python3 docs/planner-yi-01/verify.py`: PASS。321/502集合一致、502原行一対一、578コード行、686/209旧参照、digest一致、分類合計、safe証拠、番号/単位/scope、CSV整合、Markdown列数・文字化け・相対ファイルリンクを確認。
- 既存 `node --import tsx scripts/generate-curriculum-catalog.mts --check`: PASS（321 courses / 686 annual offerings）。実際のloaderも件数・false flagsを確認。依存は作業cloneにpnpm `--ignore-scripts --lockfile=false`で取得（package/lockfileは無変更、lockfile厳密再現の総合テストではない）。
- 元6ファイルのSHA-256一致、全tracked差分をこのdocsディレクトリに限定。schema/コード/元カタログは無変更。`git diff --check`をcommit前に実行。
- runtimeコード変更がないため新runtimeテスト、全UI/build、iPhone実機、全卒業engine suiteは実施していない。PDF可視52ページ確認と監査整合PASSを、これらのPASSとして報告しない。

## PR #141 独立監査フォローアップ

2026-10-11、添付PDF SHA-256を再確認し、冊子p.47/48/53/55/57/59の対象脚注を抽出テキストとページ画像で再照合した。公式の「公開科目」開講情報を含む6件の本文を全文へ修正し、製品境界の説明は`auditNote`へ分離した。残る脚注も確認し、p.57-i/mとp.59-i/n/oの5件が未収録だったため全文を追加した。合計84件についてmarker列とページ範囲を照合した。これらの証拠保存は年度別開講検索や科目マスターの実装範囲を変更しない。

`verify.py`の通常実行はYI-01台帳と監査開始時点のcatalog digestを検証する。PR差分範囲は`--check-change-scope --base <明示したcommit-or-branch>`で追加実行する。無関係な将来のGit変更は通常検証の対象外で、原版JSON digest pinは引き続き検証対象。
