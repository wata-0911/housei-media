# 履修可能学年の監査（2026 catalog）

対象は `src/data/planner_catalog_2026.json` の raw snapshot（686 offerings / 502 mappings）である。実行時には approved mapping override が offering の `mappingIds` と `resolutionStatus` だけを置換する。`eligibleYears` そのものは置換しないため、以下のフィールド監査は raw snapshot を基準にした。

## 件数と分布

| 種別 | null | non-null | 分布（non-null） |
| --- | ---: | ---: | --- |
| offering.eligibleYears | 453 | 233 | `[1,2,3,4]`: 57、`[2,3,4]`: 34、`[3,4]`: 134、`[4]`: 8 |
| mapping.eligibleYears | 4 | 498 | `[1,2,3,4]`: 141、`[2,3,4]`: 147、`[3,4]`: 194、`[4]`: 16 |

`[1]`、`[2]`、`[3]`、`[1,2]`、`[1,3,4]` を含むその他の値は 0 件だった。raw の `manual_review` は63件すべて null・mapping edge 0、本来 `outside_mapping_scope` は30件すべて null・mapping edge 0である。runtime override 適用後は manual_review は史学演習8件だけで、いずれも `eligibleYears=null` のままである。従って manual_review / outside_mapping_scope は年次判定に用いない。

## offering と mapping の関係

schema は両方を「1〜4のユニークな整数配列または null」とだけ規定し、優先順位・intersection・union は規定していない。生成元スクリプトは追跡されておらず、repository にある一次記録は catalog の source（offering は2026開講スナップショットのページ／syllabus URL、mapping は学科別カリキュラム表のページ）と schema だけである。そのため、この実装は推測で二つを合成しない。

- offering は catalog-wide な開講レコードの年次情報であり、所属未選択時に non-null なら表示できる唯一の公式根拠として使う。
- mapping は `scopeId` を持つ所属別カリキュラムの年次情報であり、所属選択時は selected scope の edge（なければ共通 scope edge）を使う。
- raw の mapped offering 593件のうち、複数mapping edge は274件。異なる年次値を持つ edge は52件あるが、selected scope ごとにグループ化すると複数edgeは26組、年次値の相違は0組だった。
- offering と関連 mapping の値が異なる selected-scope edge は40件ある（例: `史学概論`、`日本史概説`、`経済政策論B`）。これらは優先順位が記録されていないので `unknown` とする。すべての edge が同値でない offering も存在するため、cross-scope の値を union しない。

## 判定方針

`src/planner/yearEligibility.ts` が検索用判定と表示文言の共通実装である。

1. `manual_review` / `outside_mapping_scope`、null、不正値、解決不能edge は `unknown`。
2. 所属未選択では offering の non-null 値だけを使う。mapping を跨いで合成しない。
3. 所属選択時は直接scopeのmappingを優先して参照し、直接edgeがない場合のみ共通scopeのedgeを参照する。relevant edge がないことは「履修不可」の根拠ではないため `unknown`。
4. relevant mapping edge が複数でも年次配列がすべて等しく、かつ non-null offering 値があるならそれとも等しい場合だけ、その配列で eligible / ineligible を返す。相違はすべて `unknown`。

これにより `ineligible` は公式の単一・整合した年次配列からのみ返る。公開科目はcatalog外のsynthetic resultなので、学年指定時は常に `unknown` とし、判定保留表示をONにした時だけ表示する。
