# YI-02 独立制度科目read model

Issue #142。基準 `origin/dev` は `7bcdfca24cbcdac1c95133ed6cfd36d6a0cf57d4`（実装開始時）。実装は `src/planner/institutional/`、ID registryは `src/data/institutional_registry.json`。既存Plannerの保存・表示・成績取込・卒業consumerへの接続はない。

## 実装した契約

| モジュール | 責務 |
| --- | --- |
| `types.ts` | 資料revision、制度科目、課程版、配置、判定、監査入力、互換archiveの型 |
| `validation.ts` | namespace、一意性、発行request、原版digest集合、全member/scope/evidence参照、safe採用gate、配置role、null/0、方式・分類の整合 |
| `loader.ts` | 検証後に公式原行と固定registryだけを使うpure変換。ID発行・年度推定・storage書込みなし。返却値は入力からdeep clone |
| `query.ts` | 原ラベルの検索、明示版/scopeでの閲覧、entity種別＋旧ID＋原版digestでのcrosswalk参照 |
| `yi01.ts` | YI-01資料を使う明示的な独立entry。既存catalog/Offeringやarchiveをimportしない |
| `legacyArchive.ts` | 任意の686 Offering/209 provisional Course archive検証・互換参照。独立masterのloadには不要 |

`InstitutionalCourse` → 名称履歴・identity根拠。単位・分類・方式は恒久属性にしない。`CurriculumPlacement` → version/scope/role、nullable IC、監査候補、構成単位・分類・必選・制度方式、公式原行locator/bbox、脚注・判定rule参照。`CurriculumVersion` → sourceRevision参照と適用条件・改正根拠・未確認範囲。

本人適用を確認できる根拠が不足しているため、今回のcvは **監査済み課程表のdocumented slice** を識別する。`applicabilityStatus=unknown`、`applicableTo=null`、確定適用条件なし。資料の2026表示年を学生適用課程と同一視しない。改正根拠はp.60/p.65の抜粋と未確認範囲を記録する。完全な2013改正・旧課程版を発行したとは扱わない。

## 固定IDと資料版

safe221件のみ、既存 `curriculum:<UUID>` を限定採用。未確定100件にICを発行しない。cv1件とcp502件のUUIDv4はregistry作成時に一度発行し、`issuanceRequestId`とともに固定した。今後の新IC namespaceは `hosei:ic:`。今回のYI-01 loaderは新ICの根拠レビュー・新規発行を行わない。

cpのroleは原表のtable＋物理行へpin。キーは `(version, scope, ICまたは旧監査identity, role)`。4単位必修と2単位S選択必修は同じscope内に共存できる。名前・コード・単位をmerge条件にしない。全namespaceに跨るUUID衝突、発行request重複も拒否する。

原PDF SHA-256と旧6ファイルの**バイトdigest集合**をregistryへpinし、入力manifestと各crosswalkのdigestを検証する。別資料版・欠損/追加digest・backup v1のenriched digest・backup v2のsemantic digestを拒否する。loaderはファイルI/Oをしないため、外部の原版を渡す呼出側は実測digestを渡す必要がある。digest文字列は真正性証明ではない。独立entryの根拠はGitに固定されたYI-01資料で、実ファイルの6digestと台帳全件は `python3 docs/planner-yi-01/verify.py` と新テストで確認する。未検証の任意JSONをこのentryの信頼済み資料として置き換えてはならない。

公式コード表の行は原監査形式に個別sourceDigestがないため、同じ資料revisionのコード台帳として保持する。教職コードは本科コード根拠へ移さない。脚注は行のnotesPageに属する全注記を保守的に参照し、記号がないことを「適用なし」と解釈しない。元footnoteMarkersも公式原行に保持する。

## 判定保持

| 対象 | safe | ambiguous | conflict | unmatched |
| --- | ---: | ---: | ---: | ---: |
| CurriculumCourse | 221 | 85 | 6 | 9 |
| Mapping / Placementのidentity判定 | 273 | 214 | 6 | 9 |

502公式原行の照合はsafe、配置定義はsafe496/conflict6。公式原行の照合とIC確定は別field。非safeの採用IDはnull、旧321監査record・502 Mapping recordを全field保持。候補は `candidateAuditIds` であり、未採用の旧IDを確定IC参照として扱わない。peer・旧equivalence・理由・旧Offering参照・コード用途・override来歴は監査record/archiveに残る。

S必須6件は公式 `requiredMethod=schooling` と旧 `schoolingOnly=false` の双方、差分、conflict状態を保持。安全な履修方式や修正済み配置として返さない。公開科目枠等9件は `non_course_bucket`、IC null。放送大学認定の構成単位はnull（0・認定上限への補完なし）。全件のhistorical continuityはunverified。

## APIの利用例

```ts
import { loadYi01InstitutionalCatalog } from '../../src/planner/institutional/yi01';
import { searchInstitutionalPlacements, placementsForContext } from '../../src/planner/institutional/query';

const master = loadYi01InstitutionalCatalog(); // Offering/legacy archive不要
const rows = searchInstitutionalPlacements(master, '日本史概説');
// rowsには4単位配置/2単位S配置と、それぞれのidentity/conflict判断が残る。
const browse = placementsForContext(master, {
  curriculumVersionId: master.curriculumVersions[0].id,
  scopeId: rows[0].scopeId,
  applicability: 'unknown',
});
// documented_slice_onlyは閲覧可を意味し、本人への適用確定ではない。
```

未知scope → `unknown_scope` / 空配置、未知・null version → `unknown_curriculum` / 空配置。既存 `current_2026 / legacy_or_transition / unknown` は入力値を保持し、入学年・plannedYear・成績取得日から版を選ばない。検索では全scope候補と資料根拠を閲覧でき、番号Ⅰ/Ⅱ/A/B/(1)/(2)を消す正規化はしない。

archive resolverもunique legacy relationをstableへ昇格しない。全候補と対応する監査decisionを返す。欠損archiveがmaster loadを妨げることはない。互換archiveの全件coverageは同梱台帳のテストで別に確認する。

## 検証と後続への引き継ぎ

`npm run test:institutional` は合成fixtureと全件台帳の15テスト。`test:planner`にも組み込み、既存CIで実行する。合成fixtureはtests内だけに置き、架空年度の公式catalogを配信しない。既存raw6ファイルのbyte digest、完全な旧catalog adapter出力、既存表示/卒業projectionの不変性も検証する。

YI-03は本APIのnullable IC/配置と監査候補を区別し、未知課程・非科目枠・unverified continuityを保持するowner/Attempt validator契約を設計する。Attempt、保存migration、旧current_2026から具体cvへの固定adapter、読替lineage、過年度名称履歴、改正のsame/split/merge、全ambiguous解消は未実装。公式追加確認は [YI-01 handoff](../planner-yi-01/yi-02-handoff.md#大学公式追加資料への確認事項) を継承する。

`PlannerState.schemaVersion=22`、`graduationCheckComplete=false`、`sourceLinksReverified=false`、公式正本 `ImportedCourseAchievement.earnedCreditsTotal` は既存経路のまま。Draft PRの独立監査を待ち、実装者はmergeしない。

## 最終検証記録

依存関係は既存lockfileから `npm ci --ignore-scripts --no-audit --no-fund` で取得し、package-lockは変更していない。最初の借用依存で出たLintエラーは、固定依存で再検証して解消した。以下は固定依存での結果。

| 検証 | 結果 |
| --- | --- |
| 新read modelテスト | PASS: 15件（既存Planner suiteにも組込） |
| `npm run test:planner` | PASS: 2,170件（既存2,155＋新15）、168卒業engine基準出力も一致 |
| `python3 docs/planner-yi-01/verify.py` | PASS: 321/502/686/209、公式行502・コード578・脚注84、原版digest・分類整合 |
| `npm run catalog:generate` / `catalog:check` | PASS: 再生成後の既存catalog差分なし |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS: 既存chunk size警告あり |
| `git diff --check` | PASS |
| 保存ブラウザ・拡張・bookmarklet独立suite、iPhone実機 | SKIP: 本sliceは既存UI/保存へ接続せず、実機検証を行っていない |

Offering 0の合成fixture、旧Offeringのedgeがない実在配置、原版不一致・dangling・未知namespace・非safe採用の拒否、同名別identity・4/2別role・番号差・null/0を確認。これらのPASSは本人適用課程や年度横断同一性、全卒業判定の確定を意味しない。
