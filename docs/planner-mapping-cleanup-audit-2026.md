# Planner mapping cleanup 2026：29件監査

> この監査はcleanup時点の記録（manual_review 11件）。後続の[公式教職資料確認](planner-teacher-training-source-gap.md)で政治学2件を解決し、現在は9件。JSON監査も当時の記録として保持する。

基準: `dev` `21c9663`（年間計画MVPのPR #2 merge済み）。判定日: 2026-09-22。

## 結果

| 指標 | before | after |
|---|---:|---:|
| manual_review | 29 | 11 |
| unresolved（manual_review + outside）| 59 | 41 |
| outside_mapping_scope | 30 | 30 |
| matched（manual curatedを含む）| 627 | 645 |
| manual curated | 34 | 52 |
| mapping edges | 1161 | 1227 |

新規解決18件。既存matched 627件（内manual curated 34件）、元catalog、offering identity、元名称は不変。追加ledgerは `manual_curated` / `officialVerified:false`。

## 根拠と境界

[2026年度 学習のしおり](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf)の印刷ページ46・49〜54・56・58を確認（PDFページは+2）。p.53のe/fとiで修得順の扱いを確認。

情報学系の判断は、利用者が確認した内容ラベルの意味、catalogの個別開講情報、mapping表のscope・授業方法・単位を組み合わせた手動の分類判断。公式の個別対応付けを確認したものではない。bare名はmappingのラベルとしてのみ使い、offering名・courseIdを変更しない。

史学演習の1〜4は修得順に依存する別mappingなので保留。歴史資料学1〜6は一つの集合mappingのため番号を推定せず分類できる。上限や卒業要件の評価は追加しない。

公式シラバスの代表URLはHTTP 403で取得不可。offering情報は既存snapshotを使用。日本仏教史（地理）のscope限定の意味、教職政治学の通常卒業区分への算入可否は未確定。

全件のcurrent statusは`manual_review`、current mappingIdsは`[]`、current UIは全8所属および所属未選択で`対応情報を確認中`。共通scope候補は全件なし。以下で候補と採用対象を区別する。詳細な全所属別UIは[JSON監査](planner-mapping-cleanup-audit-2026.json)に収録。

## 29件の一覧

| classCode | subjectCode | courseName | 判定 |
|---|---|---|---|
| 38002 | PRI200TG | 情報学入門［1］［データ演習］（夏期スクーリング） | safe_manual_curated |
| 38003 | PRI200TF | コンピュータ入門［1］［データ演習］（夏期スクーリング） | safe_manual_curated |
| 38005 | PRI200TG | 情報学入門［2］［表計算］（夏期スクーリング） | safe_manual_curated |
| 38006 | PRI200TF | コンピュータ入門［2］［表計算］（夏期スクーリング） | safe_manual_curated |
| 38009 | PRI200TG | 情報学入門［3］［データベース］（夏期スクーリング） | safe_manual_curated |
| 38010 | PRI200TF | コンピュータ入門［3］［データベース］（夏期スクーリング） | safe_manual_curated |
| 38012 | PRI200TG | 情報学入門［4］［表計算］（夏期スクーリング） | safe_manual_curated |
| 38013 | PRI200TF | コンピュータ入門［4］［表計算］（夏期スクーリング） | safe_manual_curated |
| 38015 | PRI200TG | 情報学入門［5］［データ演習］（夏期スクーリング） | safe_manual_curated |
| 38016 | PRI200TF | コンピュータ入門［5］［データ演習］（夏期スクーリング） | safe_manual_curated |
| 38019 | PRI200TG | 情報学入門［6］［データベース］（夏期スクーリング） | safe_manual_curated |
| 38020 | PRI200TF | コンピュータ入門［6］［データベース］（夏期スクーリング） | safe_manual_curated |
| 48005 | PRI200TG | 情報学入門［1］［表計算］（冬期スクーリング） | safe_manual_curated |
| 48006 | PRI200TF | コンピュータ入門［1］［表計算］（冬期スクーリング） | safe_manual_curated |
| 48008 | PRI200TG | 情報学入門［2］［データ演習］（冬期スクーリング） | safe_manual_curated |
| 48009 | PRI200TF | コンピュータ入門［2］［データ演習］（冬期スクーリング） | safe_manual_curated |
| 15005 | HIS300TD | 史学演習（東洋）（春期スクーリング） | remain_manual_review |
| 25003 | HIS300TD | 史学演習（日本）（秋期スクーリング） | remain_manual_review |
| 25004 | HIS300TD | 史学演習（西洋）（秋期スクーリング） | remain_manual_review |
| 35002 | HIS300TD | 史学演習（西洋）（夏期スクーリング） | remain_manual_review |
| 35003 | HIS300TD | 史学演習（日本）（夏期スクーリング） | remain_manual_review |
| 35007 | HIS300TD | 史学演習（日本）（夏期スクーリング） | remain_manual_review |
| 35015 | HIS300TD | 史学演習（東洋）（夏期スクーリング） | remain_manual_review |
| 45006 | HIS300TD | 史学演習（日本）（冬期スクーリング） | remain_manual_review |
| 25007 | CUM200TD | 歴史資料学（日本近代）（秋期スクーリング） | safe_manual_curated |
| 45010 | CUM200TD | 歴史資料学（日本近世）（冬期スクーリング） | safe_manual_curated |
| 35009 | HIS300TE | 日本史特講（日本仏教史）（地理）（夏期スクーリング） | remain_manual_review |
| 33003 | POL200TB | 【教職】政治学（夏期スクーリング）【オンライン】 | remain_manual_review |
| 43006 | POL200TB | 【教職】政治学（冬期スクーリング） | remain_manual_review |

## 38002：情報学入門［1］［データ演習］（夏期スクーリング）

- offeringId: `b1682775-8f72-46c8-8453-cbee94cf3d25`
- classCode / subjectCode: `38002` / `PRI200TG`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `ee06b350-5b46-4398-aff8-c187161defba`, `1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d`, `cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2`, `431409fd-5e1e-4272-aa03-36e0e5a27968`, `4eec8986-f2ec-4b6c-9292-3ee4dcd078f0`, `5736899c-eb14-4e2a-8328-f482291833ca`, `eae25b18-9c9f-410e-84fa-907103fdc9af`
- proposed category / field / scope: 専門教育 / null / 法学部 / 法律学科（e31201f3-4f1d-432a-906e-6af94af294c9）; 専門教育 / null / 文学部 / 日本文学科 / 文学コース（d242111d-f0c1-420b-a41f-a33a14d15909）; 専門教育 / null / 文学部 / 日本文学科 / 言語コース（74e81655-5390-4980-984d-e4580f28594d）; 専門教育 / null / 文学部 / 日本文学科 / 芸能文化コース（aafa0eb9-e158-461c-9b15-83e41da1830d）; 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）; 専門教育 / null / 文学部 / 地理学科（4d450b06-fb99-4bf2-a769-fe5f68dd337a）; 専門教育 / null / 経済学部 / 商業学科（6609ce7c-3d7a-423e-9f19-7841dd841ca9）
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科、文学部 / 日本文学科 / 文学コース、文学部 / 日本文学科 / 言語コース、文学部 / 日本文学科 / 芸能文化コース、文学部 / 史学科、文学部 / 地理学科、経済学部 / 商業学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602726&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| ee06b350-5b46-4398-aff8-c187161defba | 情報学入門 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |
| 1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 文学コース (d242111d-f0c1-420b-a41f-a33a14d15909) | 選択 / 49 |
| cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 言語コース (74e81655-5390-4980-984d-e4580f28594d) | 選択 / 50 |
| 431409fd-5e1e-4272-aa03-36e0e5a27968 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 芸能文化コース (aafa0eb9-e158-461c-9b15-83e41da1830d) | 選択 / 51 |
| 4eec8986-f2ec-4b6c-9292-3ee4dcd078f0 | 情報学入門 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 5736899c-eb14-4e2a-8328-f482291833ca | 情報学入門 | 専門教育 / null | 文学部 / 地理学科 (4d450b06-fb99-4bf2-a769-fe5f68dd337a) | 選択 / 54 |
| eae25b18-9c9f-410e-84fa-907103fdc9af | 情報学入門 | 専門教育 / null | 経済学部 / 商業学科 (6609ce7c-3d7a-423e-9f19-7841dd841ca9) | 選択 / 58 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38003：コンピュータ入門［1］［データ演習］（夏期スクーリング）

- offeringId: `088137f3-3d6c-430f-8ace-416b8a1bce4c`
- classCode / subjectCode: `38003` / `PRI200TF`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `b9f5f378-0985-40ad-918e-32f6f6ae5818`
- proposed category / field / scope: 専門教育 / null / 経済学部 / 経済学科（3641eb3c-91bd-4094-a56e-6e0f0da660f5）
- selected/common scope: 共通候補なし。候補所属は 経済学部 / 経済学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602727&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| b9f5f378-0985-40ad-918e-32f6f6ae5818 | コンピュータ入門 | 専門教育 / null | 経済学部 / 経済学科 (3641eb3c-91bd-4094-a56e-6e0f0da660f5) | 選択 / 56 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38005：情報学入門［2］［表計算］（夏期スクーリング）

- offeringId: `c2668703-00e7-41fa-a266-c69c4137c9a0`
- classCode / subjectCode: `38005` / `PRI200TG`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `ee06b350-5b46-4398-aff8-c187161defba`, `1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d`, `cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2`, `431409fd-5e1e-4272-aa03-36e0e5a27968`, `4eec8986-f2ec-4b6c-9292-3ee4dcd078f0`, `5736899c-eb14-4e2a-8328-f482291833ca`, `eae25b18-9c9f-410e-84fa-907103fdc9af`
- proposed category / field / scope: 専門教育 / null / 法学部 / 法律学科（e31201f3-4f1d-432a-906e-6af94af294c9）; 専門教育 / null / 文学部 / 日本文学科 / 文学コース（d242111d-f0c1-420b-a41f-a33a14d15909）; 専門教育 / null / 文学部 / 日本文学科 / 言語コース（74e81655-5390-4980-984d-e4580f28594d）; 専門教育 / null / 文学部 / 日本文学科 / 芸能文化コース（aafa0eb9-e158-461c-9b15-83e41da1830d）; 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）; 専門教育 / null / 文学部 / 地理学科（4d450b06-fb99-4bf2-a769-fe5f68dd337a）; 専門教育 / null / 経済学部 / 商業学科（6609ce7c-3d7a-423e-9f19-7841dd841ca9）
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科、文学部 / 日本文学科 / 文学コース、文学部 / 日本文学科 / 言語コース、文学部 / 日本文学科 / 芸能文化コース、文学部 / 史学科、文学部 / 地理学科、経済学部 / 商業学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602729&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| ee06b350-5b46-4398-aff8-c187161defba | 情報学入門 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |
| 1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 文学コース (d242111d-f0c1-420b-a41f-a33a14d15909) | 選択 / 49 |
| cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 言語コース (74e81655-5390-4980-984d-e4580f28594d) | 選択 / 50 |
| 431409fd-5e1e-4272-aa03-36e0e5a27968 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 芸能文化コース (aafa0eb9-e158-461c-9b15-83e41da1830d) | 選択 / 51 |
| 4eec8986-f2ec-4b6c-9292-3ee4dcd078f0 | 情報学入門 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 5736899c-eb14-4e2a-8328-f482291833ca | 情報学入門 | 専門教育 / null | 文学部 / 地理学科 (4d450b06-fb99-4bf2-a769-fe5f68dd337a) | 選択 / 54 |
| eae25b18-9c9f-410e-84fa-907103fdc9af | 情報学入門 | 専門教育 / null | 経済学部 / 商業学科 (6609ce7c-3d7a-423e-9f19-7841dd841ca9) | 選択 / 58 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38006：コンピュータ入門［2］［表計算］（夏期スクーリング）

- offeringId: `876d3acc-a81d-4cfe-9ce7-3597d50285bd`
- classCode / subjectCode: `38006` / `PRI200TF`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `b9f5f378-0985-40ad-918e-32f6f6ae5818`
- proposed category / field / scope: 専門教育 / null / 経済学部 / 経済学科（3641eb3c-91bd-4094-a56e-6e0f0da660f5）
- selected/common scope: 共通候補なし。候補所属は 経済学部 / 経済学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602730&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| b9f5f378-0985-40ad-918e-32f6f6ae5818 | コンピュータ入門 | 専門教育 / null | 経済学部 / 経済学科 (3641eb3c-91bd-4094-a56e-6e0f0da660f5) | 選択 / 56 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38009：情報学入門［3］［データベース］（夏期スクーリング）

- offeringId: `2b49a4ae-7201-45d2-a313-81eb2f7a8a97`
- classCode / subjectCode: `38009` / `PRI200TG`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `ee06b350-5b46-4398-aff8-c187161defba`, `1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d`, `cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2`, `431409fd-5e1e-4272-aa03-36e0e5a27968`, `4eec8986-f2ec-4b6c-9292-3ee4dcd078f0`, `5736899c-eb14-4e2a-8328-f482291833ca`, `eae25b18-9c9f-410e-84fa-907103fdc9af`
- proposed category / field / scope: 専門教育 / null / 法学部 / 法律学科（e31201f3-4f1d-432a-906e-6af94af294c9）; 専門教育 / null / 文学部 / 日本文学科 / 文学コース（d242111d-f0c1-420b-a41f-a33a14d15909）; 専門教育 / null / 文学部 / 日本文学科 / 言語コース（74e81655-5390-4980-984d-e4580f28594d）; 専門教育 / null / 文学部 / 日本文学科 / 芸能文化コース（aafa0eb9-e158-461c-9b15-83e41da1830d）; 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）; 専門教育 / null / 文学部 / 地理学科（4d450b06-fb99-4bf2-a769-fe5f68dd337a）; 専門教育 / null / 経済学部 / 商業学科（6609ce7c-3d7a-423e-9f19-7841dd841ca9）
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科、文学部 / 日本文学科 / 文学コース、文学部 / 日本文学科 / 言語コース、文学部 / 日本文学科 / 芸能文化コース、文学部 / 史学科、文学部 / 地理学科、経済学部 / 商業学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602733&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| ee06b350-5b46-4398-aff8-c187161defba | 情報学入門 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |
| 1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 文学コース (d242111d-f0c1-420b-a41f-a33a14d15909) | 選択 / 49 |
| cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 言語コース (74e81655-5390-4980-984d-e4580f28594d) | 選択 / 50 |
| 431409fd-5e1e-4272-aa03-36e0e5a27968 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 芸能文化コース (aafa0eb9-e158-461c-9b15-83e41da1830d) | 選択 / 51 |
| 4eec8986-f2ec-4b6c-9292-3ee4dcd078f0 | 情報学入門 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 5736899c-eb14-4e2a-8328-f482291833ca | 情報学入門 | 専門教育 / null | 文学部 / 地理学科 (4d450b06-fb99-4bf2-a769-fe5f68dd337a) | 選択 / 54 |
| eae25b18-9c9f-410e-84fa-907103fdc9af | 情報学入門 | 専門教育 / null | 経済学部 / 商業学科 (6609ce7c-3d7a-423e-9f19-7841dd841ca9) | 選択 / 58 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38010：コンピュータ入門［3］［データベース］（夏期スクーリング）

- offeringId: `3b29f222-7d02-4bb8-9147-00c366c7cac1`
- classCode / subjectCode: `38010` / `PRI200TF`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `b9f5f378-0985-40ad-918e-32f6f6ae5818`
- proposed category / field / scope: 専門教育 / null / 経済学部 / 経済学科（3641eb3c-91bd-4094-a56e-6e0f0da660f5）
- selected/common scope: 共通候補なし。候補所属は 経済学部 / 経済学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602734&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| b9f5f378-0985-40ad-918e-32f6f6ae5818 | コンピュータ入門 | 専門教育 / null | 経済学部 / 経済学科 (3641eb3c-91bd-4094-a56e-6e0f0da660f5) | 選択 / 56 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38012：情報学入門［4］［表計算］（夏期スクーリング）

- offeringId: `8da37ef1-b8a9-4dbf-a9c5-415281b49f44`
- classCode / subjectCode: `38012` / `PRI200TG`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `ee06b350-5b46-4398-aff8-c187161defba`, `1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d`, `cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2`, `431409fd-5e1e-4272-aa03-36e0e5a27968`, `4eec8986-f2ec-4b6c-9292-3ee4dcd078f0`, `5736899c-eb14-4e2a-8328-f482291833ca`, `eae25b18-9c9f-410e-84fa-907103fdc9af`
- proposed category / field / scope: 専門教育 / null / 法学部 / 法律学科（e31201f3-4f1d-432a-906e-6af94af294c9）; 専門教育 / null / 文学部 / 日本文学科 / 文学コース（d242111d-f0c1-420b-a41f-a33a14d15909）; 専門教育 / null / 文学部 / 日本文学科 / 言語コース（74e81655-5390-4980-984d-e4580f28594d）; 専門教育 / null / 文学部 / 日本文学科 / 芸能文化コース（aafa0eb9-e158-461c-9b15-83e41da1830d）; 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）; 専門教育 / null / 文学部 / 地理学科（4d450b06-fb99-4bf2-a769-fe5f68dd337a）; 専門教育 / null / 経済学部 / 商業学科（6609ce7c-3d7a-423e-9f19-7841dd841ca9）
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科、文学部 / 日本文学科 / 文学コース、文学部 / 日本文学科 / 言語コース、文学部 / 日本文学科 / 芸能文化コース、文学部 / 史学科、文学部 / 地理学科、経済学部 / 商業学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602736&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| ee06b350-5b46-4398-aff8-c187161defba | 情報学入門 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |
| 1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 文学コース (d242111d-f0c1-420b-a41f-a33a14d15909) | 選択 / 49 |
| cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 言語コース (74e81655-5390-4980-984d-e4580f28594d) | 選択 / 50 |
| 431409fd-5e1e-4272-aa03-36e0e5a27968 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 芸能文化コース (aafa0eb9-e158-461c-9b15-83e41da1830d) | 選択 / 51 |
| 4eec8986-f2ec-4b6c-9292-3ee4dcd078f0 | 情報学入門 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 5736899c-eb14-4e2a-8328-f482291833ca | 情報学入門 | 専門教育 / null | 文学部 / 地理学科 (4d450b06-fb99-4bf2-a769-fe5f68dd337a) | 選択 / 54 |
| eae25b18-9c9f-410e-84fa-907103fdc9af | 情報学入門 | 専門教育 / null | 経済学部 / 商業学科 (6609ce7c-3d7a-423e-9f19-7841dd841ca9) | 選択 / 58 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38013：コンピュータ入門［4］［表計算］（夏期スクーリング）

- offeringId: `347fac60-91c9-4836-ae8a-129d703725ff`
- classCode / subjectCode: `38013` / `PRI200TF`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `b9f5f378-0985-40ad-918e-32f6f6ae5818`
- proposed category / field / scope: 専門教育 / null / 経済学部 / 経済学科（3641eb3c-91bd-4094-a56e-6e0f0da660f5）
- selected/common scope: 共通候補なし。候補所属は 経済学部 / 経済学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602737&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| b9f5f378-0985-40ad-918e-32f6f6ae5818 | コンピュータ入門 | 専門教育 / null | 経済学部 / 経済学科 (3641eb3c-91bd-4094-a56e-6e0f0da660f5) | 選択 / 56 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38015：情報学入門［5］［データ演習］（夏期スクーリング）

- offeringId: `963b7557-4abe-4e0d-8c33-294e67541763`
- classCode / subjectCode: `38015` / `PRI200TG`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `ee06b350-5b46-4398-aff8-c187161defba`, `1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d`, `cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2`, `431409fd-5e1e-4272-aa03-36e0e5a27968`, `4eec8986-f2ec-4b6c-9292-3ee4dcd078f0`, `5736899c-eb14-4e2a-8328-f482291833ca`, `eae25b18-9c9f-410e-84fa-907103fdc9af`
- proposed category / field / scope: 専門教育 / null / 法学部 / 法律学科（e31201f3-4f1d-432a-906e-6af94af294c9）; 専門教育 / null / 文学部 / 日本文学科 / 文学コース（d242111d-f0c1-420b-a41f-a33a14d15909）; 専門教育 / null / 文学部 / 日本文学科 / 言語コース（74e81655-5390-4980-984d-e4580f28594d）; 専門教育 / null / 文学部 / 日本文学科 / 芸能文化コース（aafa0eb9-e158-461c-9b15-83e41da1830d）; 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）; 専門教育 / null / 文学部 / 地理学科（4d450b06-fb99-4bf2-a769-fe5f68dd337a）; 専門教育 / null / 経済学部 / 商業学科（6609ce7c-3d7a-423e-9f19-7841dd841ca9）
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科、文学部 / 日本文学科 / 文学コース、文学部 / 日本文学科 / 言語コース、文学部 / 日本文学科 / 芸能文化コース、文学部 / 史学科、文学部 / 地理学科、経済学部 / 商業学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602739&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| ee06b350-5b46-4398-aff8-c187161defba | 情報学入門 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |
| 1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 文学コース (d242111d-f0c1-420b-a41f-a33a14d15909) | 選択 / 49 |
| cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 言語コース (74e81655-5390-4980-984d-e4580f28594d) | 選択 / 50 |
| 431409fd-5e1e-4272-aa03-36e0e5a27968 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 芸能文化コース (aafa0eb9-e158-461c-9b15-83e41da1830d) | 選択 / 51 |
| 4eec8986-f2ec-4b6c-9292-3ee4dcd078f0 | 情報学入門 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 5736899c-eb14-4e2a-8328-f482291833ca | 情報学入門 | 専門教育 / null | 文学部 / 地理学科 (4d450b06-fb99-4bf2-a769-fe5f68dd337a) | 選択 / 54 |
| eae25b18-9c9f-410e-84fa-907103fdc9af | 情報学入門 | 専門教育 / null | 経済学部 / 商業学科 (6609ce7c-3d7a-423e-9f19-7841dd841ca9) | 選択 / 58 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38016：コンピュータ入門［5］［データ演習］（夏期スクーリング）

- offeringId: `7f939488-a393-4e51-bacf-00db26372828`
- classCode / subjectCode: `38016` / `PRI200TF`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `b9f5f378-0985-40ad-918e-32f6f6ae5818`
- proposed category / field / scope: 専門教育 / null / 経済学部 / 経済学科（3641eb3c-91bd-4094-a56e-6e0f0da660f5）
- selected/common scope: 共通候補なし。候補所属は 経済学部 / 経済学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602740&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| b9f5f378-0985-40ad-918e-32f6f6ae5818 | コンピュータ入門 | 専門教育 / null | 経済学部 / 経済学科 (3641eb3c-91bd-4094-a56e-6e0f0da660f5) | 選択 / 56 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38019：情報学入門［6］［データベース］（夏期スクーリング）

- offeringId: `adc888f1-463b-49ad-9f53-3ab49e3fb2f4`
- classCode / subjectCode: `38019` / `PRI200TG`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `ee06b350-5b46-4398-aff8-c187161defba`, `1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d`, `cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2`, `431409fd-5e1e-4272-aa03-36e0e5a27968`, `4eec8986-f2ec-4b6c-9292-3ee4dcd078f0`, `5736899c-eb14-4e2a-8328-f482291833ca`, `eae25b18-9c9f-410e-84fa-907103fdc9af`
- proposed category / field / scope: 専門教育 / null / 法学部 / 法律学科（e31201f3-4f1d-432a-906e-6af94af294c9）; 専門教育 / null / 文学部 / 日本文学科 / 文学コース（d242111d-f0c1-420b-a41f-a33a14d15909）; 専門教育 / null / 文学部 / 日本文学科 / 言語コース（74e81655-5390-4980-984d-e4580f28594d）; 専門教育 / null / 文学部 / 日本文学科 / 芸能文化コース（aafa0eb9-e158-461c-9b15-83e41da1830d）; 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）; 専門教育 / null / 文学部 / 地理学科（4d450b06-fb99-4bf2-a769-fe5f68dd337a）; 専門教育 / null / 経済学部 / 商業学科（6609ce7c-3d7a-423e-9f19-7841dd841ca9）
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科、文学部 / 日本文学科 / 文学コース、文学部 / 日本文学科 / 言語コース、文学部 / 日本文学科 / 芸能文化コース、文学部 / 史学科、文学部 / 地理学科、経済学部 / 商業学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602743&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| ee06b350-5b46-4398-aff8-c187161defba | 情報学入門 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |
| 1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 文学コース (d242111d-f0c1-420b-a41f-a33a14d15909) | 選択 / 49 |
| cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 言語コース (74e81655-5390-4980-984d-e4580f28594d) | 選択 / 50 |
| 431409fd-5e1e-4272-aa03-36e0e5a27968 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 芸能文化コース (aafa0eb9-e158-461c-9b15-83e41da1830d) | 選択 / 51 |
| 4eec8986-f2ec-4b6c-9292-3ee4dcd078f0 | 情報学入門 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 5736899c-eb14-4e2a-8328-f482291833ca | 情報学入門 | 専門教育 / null | 文学部 / 地理学科 (4d450b06-fb99-4bf2-a769-fe5f68dd337a) | 選択 / 54 |
| eae25b18-9c9f-410e-84fa-907103fdc9af | 情報学入門 | 専門教育 / null | 経済学部 / 商業学科 (6609ce7c-3d7a-423e-9f19-7841dd841ca9) | 選択 / 58 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 38020：コンピュータ入門［6］［データベース］（夏期スクーリング）

- offeringId: `e2260959-bb86-4c84-810f-c8b3ebe7b3da`
- classCode / subjectCode: `38020` / `PRI200TF`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `b9f5f378-0985-40ad-918e-32f6f6ae5818`
- proposed category / field / scope: 専門教育 / null / 経済学部 / 経済学科（3641eb3c-91bd-4094-a56e-6e0f0da660f5）
- selected/common scope: 共通候補なし。候補所属は 経済学部 / 経済学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602744&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| b9f5f378-0985-40ad-918e-32f6f6ae5818 | コンピュータ入門 | 専門教育 / null | 経済学部 / 経済学科 (3641eb3c-91bd-4094-a56e-6e0f0da660f5) | 選択 / 56 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 48005：情報学入門［1］［表計算］（冬期スクーリング）

- offeringId: `7f570269-3975-4faa-bd78-c786d8184e3f`
- classCode / subjectCode: `48005` / `PRI200TG`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `ee06b350-5b46-4398-aff8-c187161defba`, `1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d`, `cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2`, `431409fd-5e1e-4272-aa03-36e0e5a27968`, `4eec8986-f2ec-4b6c-9292-3ee4dcd078f0`, `5736899c-eb14-4e2a-8328-f482291833ca`, `eae25b18-9c9f-410e-84fa-907103fdc9af`
- proposed category / field / scope: 専門教育 / null / 法学部 / 法律学科（e31201f3-4f1d-432a-906e-6af94af294c9）; 専門教育 / null / 文学部 / 日本文学科 / 文学コース（d242111d-f0c1-420b-a41f-a33a14d15909）; 専門教育 / null / 文学部 / 日本文学科 / 言語コース（74e81655-5390-4980-984d-e4580f28594d）; 専門教育 / null / 文学部 / 日本文学科 / 芸能文化コース（aafa0eb9-e158-461c-9b15-83e41da1830d）; 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）; 専門教育 / null / 文学部 / 地理学科（4d450b06-fb99-4bf2-a769-fe5f68dd337a）; 専門教育 / null / 経済学部 / 商業学科（6609ce7c-3d7a-423e-9f19-7841dd841ca9）
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科、文学部 / 日本文学科 / 文学コース、文学部 / 日本文学科 / 言語コース、文学部 / 日本文学科 / 芸能文化コース、文学部 / 史学科、文学部 / 地理学科、経済学部 / 商業学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2624798&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| ee06b350-5b46-4398-aff8-c187161defba | 情報学入門 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |
| 1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 文学コース (d242111d-f0c1-420b-a41f-a33a14d15909) | 選択 / 49 |
| cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 言語コース (74e81655-5390-4980-984d-e4580f28594d) | 選択 / 50 |
| 431409fd-5e1e-4272-aa03-36e0e5a27968 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 芸能文化コース (aafa0eb9-e158-461c-9b15-83e41da1830d) | 選択 / 51 |
| 4eec8986-f2ec-4b6c-9292-3ee4dcd078f0 | 情報学入門 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 5736899c-eb14-4e2a-8328-f482291833ca | 情報学入門 | 専門教育 / null | 文学部 / 地理学科 (4d450b06-fb99-4bf2-a769-fe5f68dd337a) | 選択 / 54 |
| eae25b18-9c9f-410e-84fa-907103fdc9af | 情報学入門 | 専門教育 / null | 経済学部 / 商業学科 (6609ce7c-3d7a-423e-9f19-7841dd841ca9) | 選択 / 58 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 48006：コンピュータ入門［1］［表計算］（冬期スクーリング）

- offeringId: `e463ceca-79be-4ec4-8a29-da4cfeca5433`
- classCode / subjectCode: `48006` / `PRI200TF`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `b9f5f378-0985-40ad-918e-32f6f6ae5818`
- proposed category / field / scope: 専門教育 / null / 経済学部 / 経済学科（3641eb3c-91bd-4094-a56e-6e0f0da660f5）
- selected/common scope: 共通候補なし。候補所属は 経済学部 / 経済学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2624799&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| b9f5f378-0985-40ad-918e-32f6f6ae5818 | コンピュータ入門 | 専門教育 / null | 経済学部 / 経済学科 (3641eb3c-91bd-4094-a56e-6e0f0da660f5) | 選択 / 56 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 48008：情報学入門［2］［データ演習］（冬期スクーリング）

- offeringId: `17931cc6-1840-4c99-b8ec-124f1ee3b875`
- classCode / subjectCode: `48008` / `PRI200TG`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `ee06b350-5b46-4398-aff8-c187161defba`, `1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d`, `cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2`, `431409fd-5e1e-4272-aa03-36e0e5a27968`, `4eec8986-f2ec-4b6c-9292-3ee4dcd078f0`, `5736899c-eb14-4e2a-8328-f482291833ca`, `eae25b18-9c9f-410e-84fa-907103fdc9af`
- proposed category / field / scope: 専門教育 / null / 法学部 / 法律学科（e31201f3-4f1d-432a-906e-6af94af294c9）; 専門教育 / null / 文学部 / 日本文学科 / 文学コース（d242111d-f0c1-420b-a41f-a33a14d15909）; 専門教育 / null / 文学部 / 日本文学科 / 言語コース（74e81655-5390-4980-984d-e4580f28594d）; 専門教育 / null / 文学部 / 日本文学科 / 芸能文化コース（aafa0eb9-e158-461c-9b15-83e41da1830d）; 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）; 専門教育 / null / 文学部 / 地理学科（4d450b06-fb99-4bf2-a769-fe5f68dd337a）; 専門教育 / null / 経済学部 / 商業学科（6609ce7c-3d7a-423e-9f19-7841dd841ca9）
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科、文学部 / 日本文学科 / 文学コース、文学部 / 日本文学科 / 言語コース、文学部 / 日本文学科 / 芸能文化コース、文学部 / 史学科、文学部 / 地理学科、経済学部 / 商業学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2624801&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| ee06b350-5b46-4398-aff8-c187161defba | 情報学入門 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |
| 1cc20b2e-9f40-4cf9-9d7c-f3897e6ab88d | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 文学コース (d242111d-f0c1-420b-a41f-a33a14d15909) | 選択 / 49 |
| cdd097de-6ebb-4b7d-88b4-d0e9e636a0d2 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 言語コース (74e81655-5390-4980-984d-e4580f28594d) | 選択 / 50 |
| 431409fd-5e1e-4272-aa03-36e0e5a27968 | 情報学入門 | 専門教育 / null | 文学部 / 日本文学科 / 芸能文化コース (aafa0eb9-e158-461c-9b15-83e41da1830d) | 選択 / 51 |
| 4eec8986-f2ec-4b6c-9292-3ee4dcd078f0 | 情報学入門 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 5736899c-eb14-4e2a-8328-f482291833ca | 情報学入門 | 専門教育 / null | 文学部 / 地理学科 (4d450b06-fb99-4bf2-a769-fe5f68dd337a) | 選択 / 54 |
| eae25b18-9c9f-410e-84fa-907103fdc9af | 情報学入門 | 専門教育 / null | 経済学部 / 商業学科 (6609ce7c-3d7a-423e-9f19-7841dd841ca9) | 選択 / 58 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 48009：コンピュータ入門［2］［データ演習］（冬期スクーリング）

- offeringId: `2490f18a-b529-48fe-8c2e-bb7b99087542`
- classCode / subjectCode: `48009` / `PRI200TF`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `b9f5f378-0985-40ad-918e-32f6f6ae5818`
- proposed category / field / scope: 専門教育 / null / 経済学部 / 経済学科（3641eb3c-91bd-4094-a56e-6e0f0da660f5）
- selected/common scope: 共通候補なし。候補所属は 経済学部 / 経済学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: 利用者確認済みの角括弧ラベルは授業内容であり別offeringを示す。元名称・授業方法schooling・2単位をcatalogで確認し、mapping表の同名スクーリング専用・専門教育・選択・2単位と整合する。科目同定や内容の同一性ではなく、当該offeringのカリキュラム算入先のみ手動で対応付ける。subjectCodeは識別情報として記録するだけで判定根拠にしない。情報学基礎・データサイエンス等への置換はしない。
- evidence type: catalog, mapping table, user-confirmed naming semantics
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2624802&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| b9f5f378-0985-40ad-918e-32f6f6ae5818 | コンピュータ入門 | 専門教育 / null | 経済学部 / 経済学科 (3641eb3c-91bd-4094-a56e-6e0f0da660f5) | 選択 / 56 |

根拠: 専門教育の選択科目、スクーリング専用、2単位の掲載を目視確認。角括弧ラベルの解釈は利用者確認に基づく手動判断であり公式照合済みとはしない。

## 15005：史学演習（東洋）（春期スクーリング）

- offeringId: `c27e0fbe-e69c-46f4-9b81-f1a022127a35`
- classCode / subjectCode: `15005` / `HIS300TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。確定までは全所属で確認中を維持。
- reason: しおりp.53 e/fで日本・東洋・西洋は史学演習の授業分野、1〜4は授業内容によらず修得順に付番と確認。1/2はスクーリング選択必修、3/4は選択であり、個人の修得順なしに固定mappingを決められない。候補4件を監査に保持するが、同時に4件へ該当する証拠ではないためruntime mappingIdsには追加しない。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602785&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| fd8444c0-f3a4-4c63-ab3d-bc01648591ac | 史学演習1 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 93c3a614-fa42-4769-857d-87e1c0aef9f5 | 史学演習2 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 82c422e1-c31f-49a8-807c-a71172134f30 | 史学演習3 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 1136d814-21b1-43a1-a632-ac395d34dfca | 史学演習4 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.53 e/f: 史学演習の数字は修得順。日本・東洋・西洋の分野を区別する。

## 25003：史学演習（日本）（秋期スクーリング）

- offeringId: `6426c6a9-e2fc-43ff-969c-9c6dfca18c36`
- classCode / subjectCode: `25003` / `HIS300TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。確定までは全所属で確認中を維持。
- reason: しおりp.53 e/fで日本・東洋・西洋は史学演習の授業分野、1〜4は授業内容によらず修得順に付番と確認。1/2はスクーリング選択必修、3/4は選択であり、個人の修得順なしに固定mappingを決められない。候補4件を監査に保持するが、同時に4件へ該当する証拠ではないためruntime mappingIdsには追加しない。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602828&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| fd8444c0-f3a4-4c63-ab3d-bc01648591ac | 史学演習1 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 93c3a614-fa42-4769-857d-87e1c0aef9f5 | 史学演習2 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 82c422e1-c31f-49a8-807c-a71172134f30 | 史学演習3 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 1136d814-21b1-43a1-a632-ac395d34dfca | 史学演習4 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.53 e/f: 史学演習の数字は修得順。日本・東洋・西洋の分野を区別する。

## 25004：史学演習（西洋）（秋期スクーリング）

- offeringId: `44b0cfb1-f909-4351-8f42-fc5b6d21347f`
- classCode / subjectCode: `25004` / `HIS300TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。確定までは全所属で確認中を維持。
- reason: しおりp.53 e/fで日本・東洋・西洋は史学演習の授業分野、1〜4は授業内容によらず修得順に付番と確認。1/2はスクーリング選択必修、3/4は選択であり、個人の修得順なしに固定mappingを決められない。候補4件を監査に保持するが、同時に4件へ該当する証拠ではないためruntime mappingIdsには追加しない。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602829&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| fd8444c0-f3a4-4c63-ab3d-bc01648591ac | 史学演習1 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 93c3a614-fa42-4769-857d-87e1c0aef9f5 | 史学演習2 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 82c422e1-c31f-49a8-807c-a71172134f30 | 史学演習3 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 1136d814-21b1-43a1-a632-ac395d34dfca | 史学演習4 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.53 e/f: 史学演習の数字は修得順。日本・東洋・西洋の分野を区別する。

## 35002：史学演習（西洋）（夏期スクーリング）

- offeringId: `51eb3800-24bc-471f-9604-1bbbd6fb5ed5`
- classCode / subjectCode: `35002` / `HIS300TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。確定までは全所属で確認中を維持。
- reason: しおりp.53 e/fで日本・東洋・西洋は史学演習の授業分野、1〜4は授業内容によらず修得順に付番と確認。1/2はスクーリング選択必修、3/4は選択であり、個人の修得順なしに固定mappingを決められない。候補4件を監査に保持するが、同時に4件へ該当する証拠ではないためruntime mappingIdsには追加しない。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602692&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| fd8444c0-f3a4-4c63-ab3d-bc01648591ac | 史学演習1 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 93c3a614-fa42-4769-857d-87e1c0aef9f5 | 史学演習2 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 82c422e1-c31f-49a8-807c-a71172134f30 | 史学演習3 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 1136d814-21b1-43a1-a632-ac395d34dfca | 史学演習4 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.53 e/f: 史学演習の数字は修得順。日本・東洋・西洋の分野を区別する。

## 35003：史学演習（日本）（夏期スクーリング）

- offeringId: `0f10a231-5c5a-450e-bb57-6c8a023d4cfa`
- classCode / subjectCode: `35003` / `HIS300TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。確定までは全所属で確認中を維持。
- reason: しおりp.53 e/fで日本・東洋・西洋は史学演習の授業分野、1〜4は授業内容によらず修得順に付番と確認。1/2はスクーリング選択必修、3/4は選択であり、個人の修得順なしに固定mappingを決められない。候補4件を監査に保持するが、同時に4件へ該当する証拠ではないためruntime mappingIdsには追加しない。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602693&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| fd8444c0-f3a4-4c63-ab3d-bc01648591ac | 史学演習1 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 93c3a614-fa42-4769-857d-87e1c0aef9f5 | 史学演習2 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 82c422e1-c31f-49a8-807c-a71172134f30 | 史学演習3 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 1136d814-21b1-43a1-a632-ac395d34dfca | 史学演習4 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.53 e/f: 史学演習の数字は修得順。日本・東洋・西洋の分野を区別する。

## 35007：史学演習（日本）（夏期スクーリング）

- offeringId: `0201ec18-e72a-426b-99af-40e8c93243b1`
- classCode / subjectCode: `35007` / `HIS300TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。確定までは全所属で確認中を維持。
- reason: しおりp.53 e/fで日本・東洋・西洋は史学演習の授業分野、1〜4は授業内容によらず修得順に付番と確認。1/2はスクーリング選択必修、3/4は選択であり、個人の修得順なしに固定mappingを決められない。候補4件を監査に保持するが、同時に4件へ該当する証拠ではないためruntime mappingIdsには追加しない。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602697&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| fd8444c0-f3a4-4c63-ab3d-bc01648591ac | 史学演習1 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 93c3a614-fa42-4769-857d-87e1c0aef9f5 | 史学演習2 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 82c422e1-c31f-49a8-807c-a71172134f30 | 史学演習3 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 1136d814-21b1-43a1-a632-ac395d34dfca | 史学演習4 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.53 e/f: 史学演習の数字は修得順。日本・東洋・西洋の分野を区別する。

## 35015：史学演習（東洋）（夏期スクーリング）

- offeringId: `9576f75d-0c2a-4716-976f-ac9e7047bc1a`
- classCode / subjectCode: `35015` / `HIS300TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。確定までは全所属で確認中を維持。
- reason: しおりp.53 e/fで日本・東洋・西洋は史学演習の授業分野、1〜4は授業内容によらず修得順に付番と確認。1/2はスクーリング選択必修、3/4は選択であり、個人の修得順なしに固定mappingを決められない。候補4件を監査に保持するが、同時に4件へ該当する証拠ではないためruntime mappingIdsには追加しない。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2622922&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| fd8444c0-f3a4-4c63-ab3d-bc01648591ac | 史学演習1 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 93c3a614-fa42-4769-857d-87e1c0aef9f5 | 史学演習2 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 82c422e1-c31f-49a8-807c-a71172134f30 | 史学演習3 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 1136d814-21b1-43a1-a632-ac395d34dfca | 史学演習4 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.53 e/f: 史学演習の数字は修得順。日本・東洋・西洋の分野を区別する。

## 45006：史学演習（日本）（冬期スクーリング）

- offeringId: `80c9473b-1233-4f18-9504-e44082e5e78d`
- classCode / subjectCode: `45006` / `HIS300TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。確定までは全所属で確認中を維持。
- reason: しおりp.53 e/fで日本・東洋・西洋は史学演習の授業分野、1〜4は授業内容によらず修得順に付番と確認。1/2はスクーリング選択必修、3/4は選択であり、個人の修得順なしに固定mappingを決められない。候補4件を監査に保持するが、同時に4件へ該当する証拠ではないためruntime mappingIdsには追加しない。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2624774&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| fd8444c0-f3a4-4c63-ab3d-bc01648591ac | 史学演習1 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 93c3a614-fa42-4769-857d-87e1c0aef9f5 | 史学演習2 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | スクーリング選択必修 / 52 |
| 82c422e1-c31f-49a8-807c-a71172134f30 | 史学演習3 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 1136d814-21b1-43a1-a632-ac395d34dfca | 史学演習4 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.53 e/f: 史学演習の数字は修得順。日本・東洋・西洋の分野を区別する。

## 25007：歴史資料学（日本近代）（秋期スクーリング）

- offeringId: `37d6fd84-d753-480d-a41b-c1bc961c3636`
- classCode / subjectCode: `25007` / `CUM200TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `e50dd61e-27ef-4e93-afe7-9c61624661b7`
- proposed category / field / scope: 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: しおりp.53 iで歴史資料学の1〜6は授業内容によらず修得順と確認。catalogの日本近代/日本近世はいずれもschooling・2単位で、p.52の単一の集合mapping「歴史資料学1〜6」（史学科・専門教育・選択・field null）に対応する。集合mapping内の番号は割り当てず、個別offeringも統合しない。過去matcherの候補空はこの集合mappingを拾えていなかったため補完。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602832&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| e50dd61e-27ef-4e93-afe7-9c61624661b7 | 歴史資料学1〜6 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.52に集合行「歴史資料学1〜6」、p.53 iに内容によらない修得順付番の説明。6回12単位上限の評価は今回未実装。

## 45010：歴史資料学（日本近世）（冬期スクーリング）

- offeringId: `d199f31a-469b-40d9-96a5-3be0fd67de2f`
- classCode / subjectCode: `45010` / `CUM200TD`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `safe_manual_curated`
- proposed mapping targets: `e50dd61e-27ef-4e93-afe7-9c61624661b7`
- proposed category / field / scope: 専門教育 / null / 文学部 / 史学科（118c5183-6aec-4fa1-905a-265f25d86db1）
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科。該当所属選択時は専門教育、他所属選択時は対象外。未選択時は所属選択を案内。
- reason: しおりp.53 iで歴史資料学の1〜6は授業内容によらず修得順と確認。catalogの日本近代/日本近世はいずれもschooling・2単位で、p.52の単一の集合mapping「歴史資料学1〜6」（史学科・専門教育・選択・field null）に対応する。集合mapping内の番号は割り当てず、個別offeringも統合しない。過去matcherの候補空はこの集合mappingを拾えていなかったため補完。
- evidence type: catalog, mapping table, other
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2624778&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| e50dd61e-27ef-4e93-afe7-9c61624661b7 | 歴史資料学1〜6 | 専門教育 / null | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |

根拠: p.52に集合行「歴史資料学1〜6」、p.53 iに内容によらない修得順付番の説明。6回12単位上限の評価は今回未実装。

## 35009：日本史特講（日本仏教史）（地理）（夏期スクーリング）

- offeringId: `52bd7373-7f4e-4db8-bd65-1096d8365389`
- classCode / subjectCode: `35009` / `HIS300TE`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 文学部 / 史学科、文学部 / 地理学科。確定までは全所属で確認中を維持。
- reason: 史学科（日本史の分野）と地理学科（field null）の2候補を保持する。ただし元offering末尾の（地理）が履修対象限定か表示上の注記かを確認できない。名称の類似とHIS300TEのみでscopeを除外・追加せず保留。
- evidence type: catalog, mapping table
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602699&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| 4a866661-9fe2-4a98-a02e-5eccf97ff513 | 日本史特講（日本仏教史） | 専門教育 / 日本史の分野 | 文学部 / 史学科 (118c5183-6aec-4fa1-905a-265f25d86db1) | 選択 / 52 |
| 540bd399-8d5a-4133-adf7-2668b266b2e1 | 日本史特講（日本仏教史） | 専門教育 / null | 文学部 / 地理学科 (4d450b06-fb99-4bf2-a769-fe5f68dd337a) | 選択 / 54 |

根拠: 両学科に日本史特講（日本仏教史）が存在するが、当該offeringの（地理）の意味を確定する根拠は未取得。

## 33003：【教職】政治学（夏期スクーリング）【オンライン】

- offeringId: `81911901-205b-49ff-8efc-a0440bf15309`
- classCode / subjectCode: `33003` / `POL200TB`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科。確定までは全所属で確認中を維持。
- reason: 元名称は【教職】政治学。候補は法律学科の通常の専門教育「政治学」であり、教職offeringが通常卒業区分へ算入可能という根拠は不足。教職ラベルを除去せずmanual_reviewを維持し、outside_mapping_scopeへの移動も行わない。
- evidence type: catalog, mapping table
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2604038&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| f49de1e6-82ae-4b86-8c0a-453ef41995ce | 政治学 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |

根拠: 通常カリキュラムの政治学行だけでは、教職offeringの算入可否を確定できない。

## 43006：【教職】政治学（冬期スクーリング）

- offeringId: `4bf76def-db1f-46c8-a3bc-df3f8cac1164`
- classCode / subjectCode: `43006` / `POL200TB`
- current resolutionStatus / mappingIds: `manual_review` / `[]`
- current UI classification: 全所属・未選択とも `対応情報を確認中`
- proposed decision: `remain_manual_review`
- proposed mapping targets: なし（保留）
- proposed category / field / scope: 未確定
- selected/common scope: 共通候補なし。候補所属は 法学部 / 法律学科。確定までは全所属で確認中を維持。
- reason: 元名称は【教職】政治学。候補は法律学科の通常の専門教育「政治学」であり、教職offeringが通常卒業区分へ算入可能という根拠は不足。教職ラベルを除去せずmanual_reviewを維持し、outside_mapping_scopeへの移動も行わない。
- evidence type: catalog, mapping table
- offering source: [catalog参照元シラバス](https://syllabus.hosei.ac.jp/web/preview.php?no_id=2624758&nendo=2026&gakubueng=TKS&t_mode=pc)（今回は再取得不可）

| candidate mappingId | mapping名 | category / field | scope | 要件 / 印刷p. |
|---|---|---|---|---|
| f49de1e6-82ae-4b86-8c0a-453ef41995ce | 政治学 | 専門教育 / null | 法学部 / 法律学科 (e31201f3-4f1d-432a-906e-6af94af294c9) | 選択 / 46 |

根拠: 通常カリキュラムの政治学行だけでは、教職offeringの算入可否を確定できない。

## 検証

`npm run typecheck`、`npm run lint`、`npm run test:planner`（27件）、`npm run build`は成功。buildには既存の500 kB超チャンク警告あり。

旧ledgerをfixtureとして固定し、既存matched 627件の全フィールドと全8所属・未選択でのUI分類が不変であることを検証。既存manual curated 34件のledgerエントリ、outside_mapping_scope 30件、全686件のoffering identityを比較した。同じ内容ラベルでclassCodeが違う16開講を個別に保存・再読込でき、件数が減らないことも確認した。
