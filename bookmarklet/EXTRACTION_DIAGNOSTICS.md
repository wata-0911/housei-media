# 実ページのextract例外：安全な境界診断

実ページで確認されたコードは **GI_EXTRACT_EXCEPTION**。この時点では抽出中の例外だけが確認でき、toJSONやclipboard cleanupを直接原因とは扱いません。今回の変更は診断境界の追加です。実ページの根本原因は未確定、production blockerは利用者の成功確認まで継続します。

## 表示と境界

通知は細分化コードを先頭に表示し、既存のfamily code `GI_EXTRACT_EXCEPTION` も併記します。raw例外を調べる、保存する、再throwする、consoleへ出す処理はありません。共有extractorが生成した安全なfailureだけを内部identityで識別して伝播させます。failureはnull prototypeで、codeと任意の整数indexだけを保持します。

| 固定コード | 処理境界 | 出せるindex |
|---|---|---|
| GI_EXTRACT_INITIALIZE | 許容評価Setの初期化。失敗を記録しextract呼出時に通知 | なし |
| GI_EXTRACT_TABLE_QUERY | documentの固定table selectorとArray.fromによる候補列挙 | なし |
| GI_EXTRACT_TABLE_INSPECT | 各inspectTable全体のうち内側コードで捕捉されない処理・結果構築 | table |
| GI_EXTRACT_ROW_QUERY | tableの固定row selectorとArray.fromによるrow列挙 | table |
| GI_EXTRACT_CELL_QUERY | row.querySelectorAll('td')とArray.from | table / row |
| GI_EXTRACT_CELL_FILTER | filter呼出、classList取得、contains('line_y_label') | table / row / cell（callback到達時） |
| GI_EXTRACT_CELL_TEXT | map呼出、textContent取得、String/replace/trimによるclean | table / row / cell（callback到達時） |
| GI_EXTRACT_ROW_CLASSIFY | logical 24-cell判定、category/course分類、分類filter | table / row（個別判定到達時） |
| GI_EXTRACT_CANDIDATE_SELECT | largest courseRowCount、Math.max、tie判定・選択 | なし |
| GI_EXTRACT_DIAGNOSTICS | 既存の候補件数・選択index・tie indexの構築 | table（選択済みの場合） |
| GI_EXTRACT_CAPTURE_TIME | capturedAt用new Date().toISOString() | 選択table |
| GI_EXTRACT_COURSE_PARSE | extractRows、行の正規化、number/report/schooling/course生成 | 選択table / logical row（行処理到達時） |
| GI_EXTRACT_EXCEPTION | 上記の外の予期しない失敗／既存family code | なし |

queryコードはselector呼出とその戻り値の列挙を含みます。列挙callback内で起きた例外は、より具体的な内側コードを維持します。stageを絞るためにquerySelectorAllとArray.fromを別実装へ置き換えてはいません。

- indexはすべて0始まり。tableは固定selectorの候補順。
- rowは対象tableの `tr.column_even, tr.column_odd` 順。category rowや24-cellでないrowも数えます。course indexではありません。
- cellは `.line_y_label` を除いたlogical cell順。CELL_FILTERでは現在のcellを採用できるか未確定なので、直前までに採用したcell数＝次のlogical候補位置です。CELL_TEXTでは確定logical indexです。
- `.filter` / `.map` 自体がcallback前に失敗した場合など、分からないindexは付けません。推測しません。
- 非整数・負数・文字列等のindexは診断に含めません。

## Privacy contract

通知・console・安全なfailureに出すのは固定コード・index・既存の候補件数だけです。科目名、評価、修得単位値、rawTerm、rawYear、日付、categoryRaw、法政ID、Cookie、URL query/hash、HTML、textContent、exception.message/stack/cause、innerHTML/outerHTMLは出しません。

raw throwableにcode/messageがあっても読みません。throwされたProxyのproperty/getPrototypeOf trapも呼びません。内部failureを識別するための instanceof やpage由来constructor、Function.prototype.callにも依存しません。診断自身のindex転記にもArray iterator/map/filterを使いません。正常payloadには診断を追加しません。

## Page world依存の監査

| global / intrinsic | extractorでの用途・例外化時の到達境界 |
|---|---|
| Array.from | table/row/tdの列挙。最初の呼出が例外ならTABLE_QUERY、各NodeListのiteratorなら対応するQUERY |
| Array.prototype.filter | label除外→CELL_FILTER、row分類→ROW_CLASSIFY、候補tie→CANDIDATE_SELECT |
| Array.prototype.map | cell clean→CELL_TEXT、選択候補の件数/tie→CANDIDATE_SELECT、diagnostics→DIAGNOSTICS、選択row再正規化→COURSE_PARSE |
| Array.prototype.some | extractorでは不使用。例外化しても正常fixture出力不変をテスト |
| Array.prototype.every | extractorでは不使用。例外化してもextension抽出は不変。後段validatorは利用しているためcontract段階の別問題になり得る |
| String / trim / replace | clean、number、report等。最初のcleanはCELL_TEXT、course中の処理ならCOURSE_PARSE |
| Set / Set.prototype.has | 評価集合の構築→INITIALIZE、grade判定→COURSE_PARSE |
| Math.max | 最大科目行数→CANDIDATE_SELECT |
| Date / toISOString | capturedAt→CAPTURE_TIME |
| Date.UTC / getUTCFullYear / getUTCMonth / getUTCDate | date正規化→COURSE_PARSE |
| Element.querySelectorAll | table/row/cellの各固定selector。対応するQUERY |
| DOMTokenList.contains / classList | label除外→CELL_FILTER |
| Node.textContent getter | セル本文の読み取り→CELL_TEXT |
| Function.prototype.call / apply / bind | extractorは明示呼出なし。例外化しても正常fixture出力不変をテスト |
| Object.prototype汚染 | failureと座標contextは新規null-prototype object。message/stack/tableIndex汚染とthrowされたProxyをテスト |
| Array / NodeList iterator | Set構築、Array.from、Math.maxのspread、extractRowsのfor-of。NodeList iteratorの例外をquery別に、Array iteratorをINITIALIZE / CANDIDATE_SELECTで再現 |
| その他 | Array.isArray/push/slice、String.match/startsWith/charAt/slice/includes/padStart、Number、正規表現test等もpage worldから影響を受け得る。呼出元の境界で捕捉。診断用validRowIndexesは分類時にpushを使用 |

これは「どこに影響し得るか」の監査であり、法政ページがこれらを書き換えているという証拠ではありません。合成mutationは原因特定用コードの試験です。今回safe intrinsicへの一括置換、借用intrinsicへの迂回、法政ページprototypeの変更は行っていません。

## 意味論と互換性

single sourceは `shared/grade-import/extractor.js`。診断用wrapper・座標追跡以外に、selector、24-cell rule、category rule、largest-count/tie rule、date/report/grade/number ruleの変更はありません。Set初期化失敗の通知時期だけをextract呼出時へ移し、安全なコードにしています。正常初期化の評価集合は同じです。

`globalThis.HoseiPlannerGradeExtractor` は既存4メソッド（date/report/extractRows/extractCurrentDocument）のまま。isSafeExtractionFailureはBookmarkletが使用するESM内部連携用exportで、extension globalには追加していません。正常結果・table_not_found/course_rows_not_found結果は不変。例外時はraw Errorの代わりに安全な内部failureをthrowするため、popupの既存catch経路へ入ります。popup/content/background/session handoff/manifestは変更していません。

HoseiGradeImportV1はschemaVersion/source/capturedAt/coursesのままで、validatorも変更しません。diagnosticsは引き続きpayload外です。

## 固定baselineと試験

`tests/fixtures/extraction-741e780.json` はcommit `741e780b0db2db304024c22e5ad35805dc0bd731` の既存generated extensionを実行して取得した合成結果です。同commitのBookmarklet結果とも一致を確認しています。現実装から期待値を再生成しないでください。実データは含みません。

正常32科目・4候補・40行・重複tie、tableなし、courseなし、malformed/label除外、最大候補が一意の5ケースをdeep equalityで比較します。正常Bookmarkletはcourses配列・全course field・順序・category継承・diagnostics・selected/tieをbaselineと比較します。

例外試験は各境界を両generated artifactで実行し、`SECRET_PERSONAL_GRADE_VALUE` がalert / console / failureへ含まれないことを確認します。前回までの45 Bookmarklet tests（toJSON/clipboard含む）は変更せず維持します。

## 実ページでの次の1回

1. 最新feature commitに対応するVercel Previewの `/planner` を開く。
2. 「成績データを取り込む」→「成績JSONの取得方法」→「Bookmarkletのコードをコピー」を押す。
3. 保存済みブックマークのURLを全文置き換える（先頭javascript:を含む）。
4. ログイン済み法政成績表で実行する。
5. 失敗時は先頭の細分化GI_EXTRACT_*コードと表示されたtable/row/cell indexだけを共有する。成功した場合は科目数・コピー・Planner「読み込み・検証」を確認する。

通知に前回のGI_EXTRACT_EXCEPTIONだけでなく先頭の細分化コードがあることを確認してください。userの成功確認まではblockerを解除しません。
