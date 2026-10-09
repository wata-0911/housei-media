# Issue #56 確認が必要な条件の監査・表示整理

監査日: 2026-10-09〜10（Asia/Tokyo）。開始base: `origin/dev` `bd67f5646d3d28da3c7749dff42ac1b775fce934`（PR #115）。独立clone、feature `fix/planner-unresolved-conditions-audit`。

## 結論と数え方

卒業算入エンジンは変更していない。新設 `projectUnresolvedConditions` は既存計算結果を読む表示projectionであり、`requirements` / `cards` / `referenceProgress` / `importedWarnings` / `unknownReasons` を書き換えない。

- **A 利用者**: 実際に発生した入力・選択・照合の不足だけを「確認が必要な条件」へ。同じ入力操作を解決キーでまとめ、対象をすべて列挙する。reason文字列による汎用groupingはしない。例: 卒論選択1操作は法律の4分岐ルール、2カード、参考進捗を含み得る。
- **B 大学**: 旧課程・経過措置、教授会特例は「自動判定できない条件」の大学確認へ。プロフィール操作で確定するとは案内しない。
- **C 実装・根拠不足**: 汎用ルール未対応、制度Mapping・構成値・source identity・公式S証拠・個別開講上限等。入力すれば解消すると言わない。新しい理由はこの保留へfallbackする。
- **D 表示整理**: 正確な`scopeLabel`で他学科・他コースと証明できるunsupported行だけを除外。対応する専用カードが存在し、2026課程で、監査済みruleIdかつ静的な汎用エラーの場合だけ説明をカードへ集約する。動的な公式保留等を連結した理由は集約しない。内部unknownは解除しない。

A件数は操作数。B/C件数は個別ルール・カード・参考進捗の各保留数で、独立した条件を同じ文章だけで1件にしない。Dは個別ルール数。成績取込警告は従来のkind別件数のまま別掲し、A/B/Cと足さない。カードの特講supplementも元の位置に維持する。`unknownCount` はrequirementsのみ、`coverageSummary` はcardsのみで、A/B/Cの合計ではない。UIにもこの区別、集約数、他scope除外数を明示した。A/B/Cが0なら空のdetailsを出さず、卒業可否の免責と内部件数は残す。

## 全体棚卸し

[生成した全発生経路一覧](planner-unresolved-conditions-inventory-2026.md)に、168ケース、771通りのID×理由×表示先を記録。6学科に加えて日本文学科の3コースすべてを含む。各行に requirementId / ruleId / ruleType / scope / 発生ケース / reason / 公式根拠 / 既存処理・操作先 / 解決主体 / 解除しない判断を掲載した。これは771個の独立した制度要件やバグという意味ではない。

再生成: `node --import tsx scripts/audit-unresolved-conditions.mjs --write`。A〜Jと追加ケースの具体的な入力は `tests/fixtures/unresolved-condition-scenarios.mjs`。新規/保存済みプロフィールの一致は別テストで確認。

### Bケース（1年次入学・2026課程・実績なし・任意卒論は非選択）

| 学科 | 旧表示=内部unknown 前→後 | A 操作 | B 大学 | C 実装等 | D カード集約 | D 他scope除外 | coverage 前=後（済/部分/未知） |
|---|---|---|---|---|---|---|---|
| 法律 | 53→53 | 0 | 3 | 9 | 10 | 31 | 4/4/0 |
| 日本文・言語 | 51→51 | 0 | 3 | 8 | 9 | 31 | 5/4/0 |
| 日本文・芸能文化 | 51→51 | 0 | 3 | 8 | 9 | 31 | 5/4/0 |
| 日本文・文学 | 51→51 | 0 | 3 | 8 | 9 | 31 | 5/4/0 |
| 史学 | 55→55 | 0 | 3 | 16 | 8 | 28 | 5/5/0 |
| 地理 | 62→62 | 0 | 5 | 19 | 9 | 29 | 5/5/0 |
| 経済 | 52→52 | 0 | 3 | 8 | 9 | 32 | 4/2/0 |
| 商業 | 52→52 | 0 | 3 | 8 | 9 | 32 | 4/2/0 |

2年次編入未入力（D）は8scopeすべてA=4（一般内訳、外国語、体育、公式認定結果）。確認済み編入（E）と学士免除（F）はA=0。任意卒論が未定なら選択操作を1件追加。史学の汎用ルールに「修得順」と書かれているだけでは操作要求しない。実際に修得順未入力の史学演習がある場合のみAへ集約する。

## 調査した経路

| ファイル群 | 確認内容 |
|---|---|
| `graduationProgress.ts` | evaluateStructured→requirements→withCoverage→unknownReasons/unknownCount。grouped/professional/thesis/public/history cardsとrecognition overlay。reference prerequisiteと公式保留追記。|
| `graduationSources.ts` | reason文字列分類は認定・修得順と実装未対応を混同し得るため、操作主体判定に流用しない。sourceRefsは既存値を維持。|
| `plannerHelpers.ts` | unsupportedは全scope採用（H45）。エンジンの監査数は維持し表示側でのみscopeLabelを限定。|
| `unresolvedEarnedImpact.ts` | earned manual_reviewのglobal/local影響。候補edgeは算入証拠ではない。Planner catalog側の未照合を利用者の入力ミスとしない。|
| `unresolvedOfficialImpact.ts` / `unresolvedSchoolingImpact.ts` | H41/H42の局所化・monotone下限・global fallback。ordinary/Sは独立。projectionはこの影響計算を再実装しない。|
| `officialGraduationFacts.ts` / `importedGraduationNotices.ts` | official aggregate正本、0/null/正数、duplicate、metadata、認定overlap、schooling根拠。notice四種は既存UIへ維持。|
| `graduationProfile.ts` | first_yearのeffective recognitionを維持。PR #115の「なし」追加入力を復活させない。一般・外国語・体育・global Sの確認は現実の保留から案内。|
| `thesisSelection.ts` | 文学必修、法律/経済/商業任意。非選択分岐はengineに存在しないためprojectionで復活させない。|
| `GraduationProgress.tsx` / `PlannerPage.tsx` | 下部unknownの表示を置換。カード・参考進捗・公式警告を維持。プロフィールへのボタンと照合画面のリンク。|
| `tests/planner.test.mjs` / `tests/graduation-audit.test.mjs` / 既存audit script | H-family、認定、source、ordinary/S/completion、局所化等の既存安全境界を回帰確認。|
| `docs/graduation-false-unknown-audit-2026.md` / `docs/planner/architecture.md` | 過去66項目と実装済みfollow-upを区別。旧監査の未解決記述を現在の事実と誤認しない。|

## 集約したもの・残したもの

| 対象 | 根拠となる既存処理 | 表示の扱い |
|---|---|---|
| 同一外国語4/S2/1言語/上限4（4ルール） | groupedCards `group-foreign` | 同じ要件群を示すカードへ説明集約。4個別unknownは維持。|
| 自然同一系列上限 | groupedCards `group-general` | 分野内の上限と一般総計の区別を示すカードへ。|
| 基礎特講4/2回、総合特講16/8回 | specialLectureProgressと該当カード | supplementが実在する場合に集約。上限まで履修を求めない。|
| 公開科目16/8回 | publicCourseLimit / public-course card | 総量上限のみ集約。**個別開講ごとの制約は独立してCに残す**。|
| 選択必修超過→選択 | electiveOverflowRule、withOverflow、各学科専門カード | 明示したruleIdだけ集約。史学/地理の別の段階配分・前提条件は独立して残す。|
| 法律の専門S8と＊除外 | professional-law-schooling | global S30とは別のカードへ集約。|
| 他学科/他日本文学コースunsupported | カタログのscopeLabelとprogramのdepartment/course | 表示除外。unknown/new scopeLabelはCに残す。|
| 旧課程・経過措置 | 公式表の経過措置注記 | Bに維持。current_2026選択だけで履歴の旧新科目同一性が証明されるとはしない。|
| 汎用全単位修得・特例・履修禁止・個別開講上限・source/公式S証拠 | 既存ガード・未実装経路 | 独立した条件を含むためCに維持。算入結果が似ていても同一条件とはみなさない。|

手動照合は、正の/不明のofficial行に保留noticeがあり、実際に選べるmatched Offering→Course候補が存在する場合だけAへ案内する。候補の選択自体は本処理で実行しない。カタログ側manual_reviewや単位数未定はCのまま。公式の算入保留はAを出しても上部警告・カードに残る。

## 公式根拠と今回の照合範囲

2026-10-10に[大学公式2026年度 学習のしおり](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf)を取得し、以下のページ全体を画像で確認した。PDF表示ページは印刷ページ+2。最初のPoppler描画・pypdf抽出は埋込フォントの欠落/文字化けがあったため、PDFiumで描画し直して確認した。以下は今回の表示所有権を確認する範囲であり、リンク全件の再検証ではない。`sourceLinksReverified=false`のまま。

| 印刷 / PDF | 確認内容 |
|---|---|
| 45 / 47 | 共通一般36・分野8、自然同一種類6は分野判定だけ、外国語1言語4/S2、基礎特講2回4、再履修・既修得除外は別条件。|
| 47 / 49 | 法律8科目32超過配分、専門S8＊除外、総合特講8回16、公開総量8回16と個別開講条件の区別。|
| 48 / 50 | 日本文のコース区別、選択必修20超過配分、総合特講8回16、公開総量/個別、書道実技の方法・課題/期限の区別。|
| 53 / 55 | 史学演習の修得順、5科目による演習2の配分、受講前提は別条件、総合特講/公開上限。|
| 55 / 57 | 地理旧課程と段階配分、特講/公開総量と個別開講条件。|
| 57 / 59 | 経済24超過配分、総合特講8回16、公開総量と個別制約。|
| 59 / 61 | 商業20超過配分、総合特講8回16、公開総量と個別制約。|

補助参照: [卒業必要要件](https://www.tsukyo.hosei.ac.jp/system/requirements/)、[編入学者の単位認定](https://www.tsukyo.hosei.ac.jp/admission/accreditations/)、[卒業論文](https://www.tsukyo.hosei.ac.jp/system/graduation-thesis/)。個人の認定結果や旧課程の適用まで一律に証明する資料ではない。

## H-familyと不変条件

H45/H46/H63の**表示面だけ**を整理。H19/H20/H31/H37/H38/H41/H42/H43の計算・保留局所化は変更しない。H26〜30/H32〜35の汎用/metadata不足は明示的な所有権がない限り保留。H03/H14/H15〜18/H21/H40等のsource・認定重複・method/S証拠を入力案内で解除しない。H49は常に未完成。新アルゴリズムは追加していない。

`schemaVersion=22`、`graduationCheckComplete=false`、`sourceLinksReverified=false`、official earned aggregate正本、ordinary/S/completion、認定・免除、全上限・配分の境界を維持。`public/schedule-calendar.png`も変更なし。

## 検証とセルフレビュー

変更前に保存した168ケースの全engine結果をSHA-256で固定し、変更後のrequirements/cards/reference/import notices/coverage/数値/理由の全体一致を確認。hashは`tests/fixtures/unresolved-engine-baseline.json`（base SHA付き）。表示projectionの非mutationと全unknownの行先（A/B/C/D）の網羅性もテストした。

- P1: unknown→satisfiedや算入量の書換なし。公式保留を入力原因に吸収しない。動的保留、未知scope・未知reasonは保守的に残す。全回帰確認。
- P2: 認定なし負担の復活防止、同文別要件の件数保持、必修/任意/非選択卒論、修得順、保存前後、0件、内部unknownのみ、長文、PC/スマホを確認。
- P3: 生成棚卸しと実装の対応、件数の定義、操作先、aria-label、sourceRefsを確認。旧エンジン理由に実装用語が残る箇所は自動判定欄へ限定。

### 別Issue候補

1. 汎用ルールと専用計算の評価状態を正式に統合するH46対応。今回はエンジンの保留解除をしない。
2. H03/H40等のsource identity・重複/旧形式、official特殊科目の未対応証拠を個別監査して解除する。入力UIの変更だけで済ませない。
3. H63の理由を構造化code/owner/dependencyへ移行。今回のexact producer-message allowlistは未知理由をCに落とす暫定的な保守境界。
4. 公開科目ごとの年度・回数条件、旧課程、書道の期限/再提出、史学の受講前提は独立した制度要件として別途実装監査する。

### 実行結果

- 対象追加テスト: 182成功（168ケースの分類/UI・非mutation、13個の観点別テスト、1個の全出力比較）。
- `npm run test:planner`: 2,063成功、0失敗/skip。
- `npm run test:extension`: 54成功。
- `npm run test:bookmarklet`: 168成功。
- `node --import tsx --test scripts/audit-graduation-false-unknown.mjs`: 20成功。
- `npm run typecheck` / `npm run lint` / `npm run build` / `git diff --check`: 成功。
- ビルドの既存chunk-size警告あり。依存導入時のnpm監査は8件（moderate2/high6）を報告したが、このIssueで依存関係は更新していない。
- Chromium（独立profile、合成localStorageのみ）: 1280px/375px × 8scope × B/C/D/J-undecided = 64画面。detailsを展開し卒業進捗section内の横はみ出し0、0件時details非表示、プロフィールボタン遷移を確認。カード・参考進捗は維持。
- 2026-10-10の再fetchで`origin/dev=cafd7cc46f6fe47a17eeedeb1d2c4e7873b27c50`（PR #116）へ進行。追加差分はPlannerPageの成績取込配置/開閉のみ。featureへの通常mergeで取り込む（rebase/reset/force-pushなし）。
