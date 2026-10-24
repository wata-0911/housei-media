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
両方に監査済みの裏付けがあるものだけ。`teacher_only` は本科から除外する。
教職検索は明示 `usage='teacher'` で `teacherCodeEvidenceIds` だけを使う。
`sameNameCodeCandidateEvidenceIds` チャネルだけではコード検索対象にしない（本科/教職と同じ証拠行が
別チャネルにも含まれる場合はある）。コード証拠のscope・conditions・原行を保持し、
同名・同コードでidentityを確定/統合しない。年度別クラスコードや開講期は検索条件にしない。

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

`npm run test:institutional` は既存36件＋追加16件を実行する。追加suiteは `test:planner` にも登録。
合成値（null/0、配当学年unknown、教職専用/名称候補コード等）はtests内のみで、公式registryを変更しない。
変更2モジュールに限定したstrict TypeScript検証と変更コードのESLintも実施する。
全体のtypecheck / lint / test:planner / buildはユーザー担当。

未確定事項はYI-02から継承する本人適用、学科横断identity、過年度連続性、方式conflict、公式資料の未監査範囲。
新たな解決・確認済みへの昇格はしていない。本番接続、Attempt登録、独立監査、mergeは後続工程。
