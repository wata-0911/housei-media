# Planner manual curated mappings

`planner_catalog_2026.json`の生成工程はこのrepositoryに含まれていないため、元catalogを直接編集せず、`planner_manual_mapping_overrides_2026.json`を読込時に適用する。

このledgerの個別offering-to-mapping対応は大学公式の照合済みデータではない。利用者が手動承認した対応、および利用者の監査指示に基づき根拠を確認した対応だけを`provenance: manual_curated`、`officialVerified: false`として保持する。offering名、`courseId`、クラスコード、科目コードは変更しない。

初回承認済み34開講（変更なし）。

- `英語S［1］〜［9］` 26開講 → `英語S`
- `日本史概説[S] / ［S］` 2開講 → `日本史概説`
- `西洋史概説[S] / ［S］` 2開講 → `西洋史概説`
- `東洋史概説[S] / ［S］` 2開講 → `東洋史概説`
- `地誌学特講[S] / ［S］` 2開講 → `地誌学特講`

同名mappingが複数scopeにある歴史概説は、未分類監査で得られた候補をすべて保持する。後続のcleanupでは下記18開講を追加した。

## 2026-09-22 mapping cleanup

[29件の監査](planner-mapping-cleanup-audit-2026.md)に基づき、18開講を個別offeringId指定で追加（計52開講）。

- 情報学入門8開講 → 各開講に7所属のmappingをすべて保持
- コンピュータ入門8開講 → 経済学科のmapping
- 歴史資料学（日本近代/近世）2開講 → 史学科の集合mapping「歴史資料学1〜6」

`targetCourseName`はcurriculum mappingのラベルであり、offering名・courseIdを置換しない。内容ラベルやclassCodeが違うofferingは別のまま。`provenance: manual_curated` / `officialVerified: false`を維持する。

史学演習8開講は修得順によってmapping 1〜4が異なるため保留。日本史特講（日本仏教史）（地理）1開講と【教職】政治学2開講もscopeの根拠不足で保留する。manual_reviewは29→11、unresolvedは59→41。outside_mapping_scope 30開講は変更しない。
