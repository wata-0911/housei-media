# Planner manual curated mappings

`planner_catalog_2026.json`の生成工程はこのrepositoryに含まれていないため、元catalogを直接編集せず、`planner_manual_mapping_overrides_2026.json`を読込時に適用する。

このledgerは大学公式文書による表記規則の確認結果ではない。利用者が手動承認した対応だけを`provenance: manual_curated`、`officialVerified: false`として保持する。offering名、`courseId`、クラスコード、科目コードは変更しない。

対象は次の34開講。

- `英語S［1］〜［9］` 26開講 → `英語S`
- `日本史概説[S] / ［S］` 2開講 → `日本史概説`
- `西洋史概説[S] / ［S］` 2開講 → `西洋史概説`
- `東洋史概説[S] / ［S］` 2開講 → `東洋史概説`
- `地誌学特講[S] / ［S］` 2開講 → `地誌学特講`

同名mappingが複数scopeにある歴史概説は、未分類監査で得られた候補をすべて保持する。情報学入門、コンピュータ入門、史学演習、歴史資料学、日本史特講（日本仏教史）（地理）は対象外であり、`manual_review`のまま残す。
