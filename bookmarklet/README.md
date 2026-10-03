# 成績表 Bookmarklet

Plannerの「成績データを取り込む」→「成績JSONの取得方法」からコードをコピーし、ブラウザのブックマークの **URL欄** に登録します。`javascript:` を含む全体を保存してください。ログイン済みの法政Web学習サービスで成績表を表示して実行し、科目数とコピー成功を確認してからPlannerの既存JSON貼り付け欄へ貼り付けます。「読み込み・検証」でプレビューし、保存操作まではPlannerデータを変更しません。

## 共通sourceと生成物

- `shared/grade-import/extractor.js` が唯一のparser sourceです。既存の date / report / numberField / schooling / course / cellsForRow / isCategoryRow / isCourseRow / extractRows / inspectTable / selectCandidate / extractCurrentDocument の処理を変更せず移しています。
- extension: `extension/hosei-planner-import/parser/entry.js` → 同じextractor → `extension/hosei-planner-import/parser/extractor.js`。既存のisolated-world global API、popup・content bridge・background・manifestはそのまま利用します。
- bookmarklet: `bookmarklet/entry.js` → 同じextractor + Plannerの `src/planner/gradeImportContract.ts` validator + `serialize.ts` + `clipboard.js` → `src/generated/gradeImportBookmarklet.json`。
- 両成果物を `npm run build:grade-import`（別名 `npm run build:bookmarklet`）で再生成します。esbuildをlockfileで固定し、source mapや実行時の外部依存は生成しません。既存extensionがcheckout直後に利用できる方針を維持するため、成果物をcommitします。
- `npm run check:grade-import` はソースから再生成した内容との完全一致を検査します。`npm run build` と `npm run build:extension-dev` もこのcheckを実行します。生成物を直接編集しないでください。
- `npm run test:bookmarklet` は生成物をVMで実行し、32科目fixtureで拡張との出力一致、validator、diagnostics、コピーの成功/失敗、ローカルfallback、importPreviewの同一性、禁止API不在、Planner表示を検査します。既存 `npm run test:extension` も実行してください。

## self-checkとtransport

生成直後に `Array.isArray(payload.courses)` とPlannerのvalidatorを適用します。コピー直前のserializerでも検証し、JSON文字列の先頭 `{`、JSON.parse後のschemaVersion 1、courses配列と全nested contractを再確認します。`courses` だけをJSON文字列化しません。

extractorとclipboard transportは分離しています。将来のpostMessage adapterもextractorと既存Planner importPreviewを再利用できます。今回のBookmarkletにpostMessage・自動保存・ダウンロードは含めません。

クリップボードAPIが拒否/未提供なら一時textareaと `document.execCommand('copy')` を利用し、成否を確認します。一時要素は削除し、focusとDOM selectionを復元します。両方式が失敗すると科目数と失敗を明示し、Chrome拡張のJSON保存を案内します。診断は件数・候補indexだけをconsoleへ出し、同数候補は通知にも表示します。diagnosticsはcontractへ混ぜません。

## 安全性とブラウザ制限

- HTTPSの `hosei.ac.jp` / `.hosei.ac.jp` 配下のみで動作し、現在のdocument内の `table[id="seisekiTabele110"]` を読みます。frame探索、認証状態の照会、ログイン処理はしません。ログインして成績表を開く操作は利用者が行います。公開案内: https://www.tsukyo.hosei.ac.jp/about-weblearning/
- ネットワークAPI、remote script injection、eval、ストレージ保存、telemetryはありません。法政ID・認証Cookie・全ページHTMLを読みません。出力はextractorが明示的に構築するcontractの項目のみです。
- 成績JSONをURL/query/hashへ含めません。ブックマークURLにあるのは共通ソースから生成したプログラムだけです。URIエンコードで `#` / `%` / 改行の解釈を避け、voidラッパーで実行結果によるページ置換を防ぎます。
- React 19の `sanitizeURL` が `javascript:` hrefをブロックするため、Plannerではリンク属性へ設定せず、JSON moduleから取得した文字列をread-only textareaとコピーAPIへ渡します。Vite build後も不活性な文字列です。`dangerouslySetInnerHTML` やDOMへのhref強制設定は使いません。
- self-containedでも、ブラウザや成績ページ側のCSPによりBookmarklet実行が拒否される場合があります。CSPを緩和/迂回せず、既存Chrome拡張へ戻れる案内にしています。実ページでのCSP・ブックマーク登録・クリップボード権限の組合せは実機確認が必要です。

## 公開前の実機チェック

1. 新しいBookmarkletコードをブックマークへ保存し、法政成績ページで実行する。
2. 科目数、重複テーブル通知（ある場合）、コピー成功を確認する。
3. Plannerへ貼り付け、「読み込み・検証」で32科目等の実際の内容を確認する。プレビューでは保存されないことを確認する。
4. コピーを許可しないブラウザではfallbackの結果または失敗案内を確認する。
5. ページCSPが実行を拒否する場合はChrome拡張を利用する。法政ページやブラウザのセキュリティ設定を変更しない。

実データはfixtureやリポジトリへ保存しないでください。テストは合成fixtureのみです。
