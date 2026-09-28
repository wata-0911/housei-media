# 外国語の未分類表示の調査

> 追記: この文書は原因調査時点の記録。クラス21005を含む番号付き英語Sは、後続の利用者承認に基づき`manual_curated` overrideで解決した。現在の適用範囲とprovenanceは`planner-manual-curated-mappings.md`を参照。

対象: `feature/planner-annual-plan`、調査開始時 `405643b`。

## 確認結果

`createCreditClassifier` は既に選択した所属と `isCommon: true` の両方の
scopeを対象としている。共通scopeの欠落は再現しない。
catalogでは元の `curriculum_category` / `curriculum_field` に相当する値を
`category` / `field` として保持している。

- 外国語mappingは7件（英語・独語・仏語）。すべて共通scope
  `0aa8cc58-04cd-40c8-aad1-0975d4b55f9c` に属する。
- それらに紐付く15開講は、全8所属で「外国語」に集計される。
- 例: 「英語２」offering `0fdb1cbc-7379-4acb-adb0-94b84bc4dba3` は
  `mappingIds: ['2696e9fb-7334-4299-9ae3-b964a87e9336']`、
  mappingは `category: '外国語'` / `field: '英語'`。
- 利用者が報告した未分類開講: 「英語Ｓ［５］（秋期スクーリング）」
  offering `066427dc-1df4-47bd-a6b1-538ab161e869`（クラス21005）は
  `mappingIds: []` / `resolutionStatus: 'manual_review'`。
  共通scopeに英語のmappingが存在していても、この開講との対応は未解決。
- 「対応情報の確認が必要」の表示は `manual_review` によって出る。
  選択scopeによってmappingが除外された時の表示ではない。

未解決開講を科目名・科目コードから推測して分類する変更は加えていない。
利用者の報告したクラス21005と実データの未解決開講が一致したため、
原因はこの開講のmapping未解決と特定した。分類の修正完了とは扱わない。
元データ側で根拠を確認したmappingの解決が必要となる。所属未提示でも、
この開講は全8所属で未分類となることをテストで確認している。

共通scopeには英語のスクーリング用mapping
`740cce61-61ab-48bb-ad52-5a404b4940b8`（英語・1単位・schoolingOnly）が
存在するが、科目名や単位数の一致だけを理由に開講へ紐付けていない。
元データの対応根拠と生成処理を確認してから、catalogの参照・coverageを
整合させたデータ更新が必要。

## 元snapshotまでの追跡

保存済み生成成果物 `planner_catalog_2026/snapshot/inputs` でも照合した。
`resolution_preview.json` / `offering_curriculum_links_2026.json` の
`offering_index: 563` がクラス21005に一致する。
開講区分の接尾辞を除去し正規化した `英語S[5]` に完全一致するmappingがなく、
`match_status: 'unmatched'` / `mapping_indices: []` となっていた。

`unmatched_analysis_2026.json` は同じ開講に
`reason_code: 'square_label_semantics_unverified'` を記録している。
`英語S`（mapping index 31）は確認候補として挙げられているが、
角括弧内の番号の意味が未確認のため `manual_review` に保持されている。
したがって今回の未分類は、元の照合処理が意図的に保留した対応関係を
画面がそのまま保持した結果であり、番号を無条件に除去する修正は行わない。

## 回帰テスト

既存12件に加え、実catalogの外国語15開講×8所属、共通scopeと選択scopeの
同一区分mappingによる重複集計防止（一般教育3分野・外国語・保健体育）、
報告された実catalogの未解決英語スクーリング開講の未分類維持を確認する3件を追加。

## Preview再確認

1. 所属を選択し、「英語２」を追加。「外国語」の計画中が2単位増えること。
2. 「仏語S(後期メディア)」を追加。「外国語」の計画中が1単位増えること。
3. 所属を切り替えても上記の共通科目が外国語のまま集計されること。
4. 「英語Ｓ［５］（秋期スクーリング）」クラス21005は引き続き要確認となり、「未分類/要確認」が
   1単位増えること（対応未解決のため意図した保留）。
5. 再読込後も計画と集計が保持されること。

既存の計画がある場合は合計値ではなく追加前からの増分で確認する。
この変更では画面の分類動作もcatalogも変えていない。
