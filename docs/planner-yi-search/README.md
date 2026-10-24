# 現行課程の制度科目検索read model（Issue #190）

開始時に `git fetch origin dev` で確認した基準は `042960e6b81e4ab85a79d68c5ae1ab7f8ba4dc78`。
独立cloneの `feature/issue-190-current-curriculum-search` に追加したopt-in APIで、本番検索への接続はない。
YI-02のregistry、監査資料、公開APIは変更していない。

## 公開APIと検索条件

- `currentSearch.ts`: `CURRENT_CURRICULUM_SEARCH_TARGET`、`loadCurrentCurriculumSearchAdapter()`。
- `search.ts`: `createInstitutionalSearchAdapter(catalog, target)`。検証済みYI-02 catalogと明示targetを受け取り、入力をsnapshot化する。
- 型: `InstitutionalSearchTarget`、`InstitutionalSearchRequest`、`InstitutionalSearchRow`、`InstitutionalSearchResponse`、`InstitutionalSearchAdapter`。
- `adapter.search(request)` は同期pure read。返却値もdeep cloneし、呼出側の変更が次回検索や資料を変更しない。

```ts
import { loadCurrentCurriculumSearchAdapter } from '../../src/planner/institutional/currentSearch';

const adapter = loadCurrentCurriculumSearchAdapter();
const result = adapter.search({
  scope: { kind: 'all' },
  text: '簿記Ⅰ',
});
// 特定学科/コースは scope: { kind: 'scope', scopeId, includeCommon: true }
// 本科コードは officialCode: { value: '監査済みコード', usage: 'undergraduate' }
```

名称は公式表示名/canonicalNameの部分一致。YI-02の原ラベル検索を再利用し、既存の
`normalizeInstitutionalCanonicalName()` による空白・全半角の比較を追加する。
Ⅰ/Ⅱ/Ⅳ、ASCII I、A/B、(1)/(2)を同一化せず、テーマや方式ラベルを削除しない。
一般的な表記揺れの対象は空白とUnicode互換幅。任意の略称・旧名称・番号表記の推測は行わない。

`category`、`field`（null指定可）、`requirementType` は完全一致、`eligibleYear` は公式原行の
配当学年配列への包含で絞る。条件はAND。未指定条件は絞らず、配当学年nullは年指定検索に一致しない。
空のtextは全名称、該当なしは正常な空配列。順序は正規化canonicalName → scope ID → role → Placement IDの
コードポイント比較で固定し、locale・元配列順に依存しない。

## 検索対象CV・scope・資料版

現行entryは2026年版しおりの監査済みdocumented sliceを明示的にpinする。

- CV: `hosei:cv:8a3e5ca4-ff0b-4b09-906c-6fddcec29887`
- revision: `yi-01:source:shiori-quartz`
- PDF SHA-256: `1ab6bad5b372f2dd12f6a4ecc4b56d3b3c5338b201765b4de775b820d49e3bf0`

版を年・配列先頭・本人の計画年から選ばない。未知CVは `unknown_curriculum`、未知scopeは
`unknown_scope`、版/revision/digestの不一致は `revision_mismatch` と空配列を返す。
正常検索の `documented_slice_only` は資料掲載を意味する。
本人への `applicabilityStatus=unknown`、`applicableTo=null` はCV原値を維持する。

`scope.kind='all'` は当該CVの全配置。`kind='scope'` はregistryの学科/コースscope IDを厳密に使い、
既定で `officialScopeLabel='common'` の配置も含める。`includeCommon=false` で選択scopeのみ。
共通scope自身を選んでも重複しない。別学科/コースを親学科名や同名科目で自動包含しない。

## 検索結果と後続Attemptへの引き渡し

1行=1 CurriculumPlacementで、同一ICの複数配置も集約しない。
公式データはIC221件、Placement502件。identity内訳はsafe273 / ambiguous214 / conflict6 / unmatched9。

`InstitutionalSearchRow` は以下を保持する。

| field | 契約 |
| --- | --- |
| `placement` | 元Placement全field。ID、nullable IC参照、監査候補、kind、scope/role、構成単位、分類/分野/必選、方式制約、公式原行（配当学年・脚注marker・頁/表/行/bbox）、判定rule、旧値、差分、監査record |
| `institutionalCourse` | safeな科目配置だけ確認済みIC。未確定候補を先頭採用しない |
| `scope` | 学部/学科/コースのregistry定義 |
| `curriculumVersion` / `sourceRevision` | 資料版、本人適用unknown、改正根拠・未確認範囲、原版digest・品質・制約 |
| `notes` | Placementのnote IDsに対応する全脚注原文 |
| `codeEvidence` | 監査codeStatus、本科リンク、教職リンク、名称一致候補の証拠原行を別々に保持 |

ambiguousは候補ID（未採用のaudit ID）と理由を保持し、確定ICとして解決しない。
conflictは公式schooling必須と旧schoolingOnly=falseの双方、conflict状態・差分・証拠を維持。
unmatchedは `non_course_bucket`、IC null。公開科目/放送大学認定枠を個別科目へ変換しない。
構成単位nullを0や認定上限、年度別登録単位で補完しない。

公式コードは完全一致（NFKC・前後空白のみ）。本科検索は `mainCodeEvidenceIds` と `mainCodes` の
両方に監査済みの裏付けがあり、証拠scopeが当該Placementに適合するものだけ。
YI-02 loaderが公式原行scopeとregistryのPlacement scopeの一致を検証するため、原行scopeを使って
以下の固定関係を照合する。未知scopeは同名同士でも許可せず、前方一致・部分一致は使わない。

| Placement scope | 本科コード証拠scope |
| --- | --- |
| common / 法律 / 史学 / 地理 / 経済 / 商業 | それぞれ同一scopeのみ |
| 日文文学 / 日文言語 / 日文芸能 | 日文のみ |

根拠は [YI-01コード表](../planner-yi-01/official-codes.md) のp.199-202本科表（共通はp.199、
日文はp.200）と、[配置監査台帳](../planner-yi-01/mapping-crosswalk.json) の本科リンク全281件。
日本文学科3コースの定義は [registry](../../src/data/institutional_registry.json) と
[課程表監査](../planner-yi-01/official-evidence.md) p.49-51に対応する。
共通コードは共通Placement用であり、学科Placementへの無条件のfallbackにはしない。
学科検索で共通科目を含める処理は、共通Placement自体を検索対象に加える既存仕様を維持する。
将来の新scopeは、この許可関係の根拠をレビューするまで自動許可しない。

教職検索は明示 `usage='teacher'`、`teacherCodeEvidenceIds` のリンク、かつ証拠scopeが
`teacher_only` であることを必要とする。根拠は同コード表p.202-213の教職用途分類と、
配置監査台帳の教職リンク全528件（すべて `teacher_only`）。本科scopeの証拠が教職リンクに
入っていても教職コードとして一致しない。逆に教職証拠を本科へ転用しない。
`teacher_only` は教職掲載という用途domainで、学生本人の所属学科・免許教科・新旧法の資格判定ではない。

`codeEvidence` は**元の監査チャネル**であり、検索に利用可能な証拠だけの一覧ではない。
`undergraduate` は元の `mainCodeEvidenceIds`、`teacher` は元の `teacherCodeEvidenceIds`、
`nameOnlyCandidates` は元の `sameNameCodeCandidateEvidenceIds` に対応する全証拠原行を返す。
不適合証拠もscope・conditions・出典を含めてここに保持し、Placement内の元IDも維持する。
名称候補チャネルだけでは検索一致させない（別チャネルとの証拠重複はあり得る）。
コード一致判定でのみ上記scope・用途gateを適用し、監査チャネルの書換えやidentityの確定/統合は行わない。
`conditions` は条件付き掲載の根拠としてそのまま返し、本人の履修資格・適用年度・改正条件を評価しない。
年度別クラスコードや開講期は検索条件にしない。

後続Attempt登録はPlacement ID・CV/revision・nullable IC・identityDecision/candidateAuditIds・
kind・構成単位の不明状態・scope/role・方式制約・出典を区別して渡す必要がある。
検索結果だけで本人適用、年度の開講、希望方式の履修資格、修得単位、卒業算入を保証しない。
Attemptコマンド、保存、計算はこのAPIに含めない。

## 独立性と局所検証

YI-02の `loadYi01InstitutionalCatalog()` → `loadInstitutionalCatalog()` を使用し、
`searchInstitutionalPlacements()`、`placementsForContext()`、既存名称比較を再利用する。
旧YI-02 APIの挙動・シグネチャは変更しない。

新entryの推移的runtime import graphをTS型消去後に検査し、年度別catalog、legacy archive、
storage、Attempt、旧catalog adapterの依存がないことを確認する。
Offering空配列の合成fixtureを既存loaderで検証/ロードした上で検索する。
本番 `src/main.tsx` からの推移的import graphにも新adapterが入らないことを検査する。
既存institutional suiteで旧6ファイルdigestと本番catalog adapter出力の不変性も確認する。

`npm run test:institutional` は既存36件＋初回追加16件＋P2回帰10件を実行する。追加suiteは `test:planner` にも登録。
合成値（null/0、配当学年unknown、教職専用/名称候補コード等）はtests内のみで、公式registryを変更しない。
変更2モジュールに限定したstrict TypeScript検証と変更コードのESLintも実施する。
全体のtypecheck / lint / test:planner / buildはユーザー担当。

未確定事項はYI-02から継承する本人適用、学科横断identity、過年度連続性、方式conflict、公式資料の未監査範囲。
新たな解決・確認済みへの昇格はしていない。本番接続、Attempt登録、独立監査、mergeは後続工程。

## PR #191 独立監査P2修正の検証

監査対象 `1f2eb7101c5bf917418091a9d68e379ec4a8cec6` で、loaderを通る合成反例を再構築した。
実装修正前はP2テスト9件中7件FAIL（必須3反例を含む）、正常対照2件PASS。
修正後は追加した名称候補専用ケースも含めP2テスト10件PASS、`test:institutional` 全62件PASS。
公式全本科/教職コード315検索条件について、修正前の監査リンクから導いた検索Placement集合を全件比較する回帰テストを含む。
元のidentity、null、unknown、CV固定、snapshot、出典、Offering非依存、順序の既存テストも維持する。

P3性能最適化は保留。索引化・sort keyキャッシュ・ページ化は行わない。
本人資格engine、公式データ、YI-02 loader、公開APIのシグネチャには変更を加えていない。

変更箇所限定のstrict TypeScript検証・ESLint・差分チェックもPASS。
P3の必要最小限の影響確認として、同一プロセスで旧HEAD版/修正版を交互に各40回測定した中央値は、
全502件検索50.78/50.66ms、簿記Ⅰ検索2.53/2.52ms、本科コード01116検索5.60/5.56ms。
このローカル簡易測定では明らかな悪化を認めず、一般的な性能保証やP3解消を意味しない。
前回HEADのユーザー全体検証（3,932件等）とは別の実装者による局所検証記録であり、
今回HEADの全体typecheck/lint/test:planner/buildはユーザーとCIに引き渡す。
