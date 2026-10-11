# YI-01: stable ID規約

[PR #139設計](../planner-year-independent-design.md)を具体化する監査上の採用規約。今回のID変更・新runtime型・保存変更はない。実値は[全321台帳](curriculum-crosswalk.json)、配置判定は[502台帳](mapping-crosswalk.json)。資料版に限定したsafeと、年度横断continuityを分ける。

## namespaceと発行

| 役割 | ID | 発行・不変性 |
| --- | --- | --- |
| InstitutionalCourse（既存の限定採用） | 監査済みの`curriculum:<UUID>`をそのままpin | 今回safe221のみ。旧321 IDの意味を一律置換しない。出典・scopeに限定し、過年度のexactを追加しない |
| InstitutionalCourse（新規） | `hosei:ic:<UUIDv4>` | 公式identity根拠のレビュー後、一度だけregistryへ発行。名称・コード・単位・入学/計画/実績年度・配列位置から生成しない |
| CurriculumVersion | `hosei:cv:<UUIDv4>` | 適用課程定義＋資料revisionへ発行。表示ラベル`学習のしおり2026`は主キーでない。確認資料のdigest、変更範囲、適用条件、改正根拠を持つ |
| CurriculumPlacement | `hosei:cp:<UUIDv4>` | version内のscope・role・原行へ一度発行。科目IDや学科の名前hashにしない |
| Legacy Offering / Course / Mapping | 元UUID＋原版digest集合＋entity種別 | 互換参照。ic/cv/cpのnamespaceと区別し、再発行しない |

UUIDv4は衝突回避手段であり大学の科目コードでも真正性証明でもない。発行要求には固定`issuanceRequestId`を持たせ、再実行・並び替えでも同じregistry記録を返す。runtime loaderはIDを発行しない。今回保留100件へ新UUIDを先回りして発行していない。改正が確認されない年ごとのマスター複製も行わない。

衝突時は既存registryの全namespaceで検出して停止する。同一issuanceRequestの再送なら既存値を使い、別根拠で未公開の新規発行が偶然衝突した場合に限り再抽選。公開済みIDが衝突・誤統合だった場合は旧記録を上書きせず、quarantine＋訂正revision＋明示crosswalkをレビューする。fallbackで末尾番号を付けたり、古い利用者参照を再割当しない。

IDはscope追加・分類変更・構成単位変更・表示名修正・コード変更で変わらない。これらの変更を同じ制度科目として保持する**公式根拠**がある場合に限り定義履歴とPlacement revisionを増やす。変更理由が未確認ならcandidate/保留を保持し、自動的に同一または別科目と決めない。

## 旧321 IDの再利用条件

次のすべてが揃ったもののみ採用する。

1. 原版6ファイルのdigest集合、rule ID/version、元entity種別が一致し、旧IDを一意に参照できる。
2. 課程表の可視原行・単位・scope・分類・方式制約・脚注へ追跡できる。コードがない方式の科目は未掲載の根拠を保持する。
3. 既存IDの全Mapping memberに矛盾がなく、一つの制度identityを指す根拠がある。
4. 同名peer・異単位・課程改正・同一コードの用途差による候補が、明示根拠で解決される。名前・コード・単位一致だけを根拠にgroupへ統合しない。
5. 算入枠/修得順slotを個別科目と見なさない。未知課程や過去の原行へ「最新だから」という理由で接続しない。

今回S-ROWの221 ID（273 Mapping）は限定採用可能。他100 ID/229 MappingはadoptedStableId=null。日本文学科の複数コースに跨るsafe groupにはp.48の自由履修説明を加え、他学科へは拡張しない。その他のcross-scope group58は旧Offering edgeから同一identityを保証せず保留。同名peer22、順序slot5も保留。S必須bool問題6はPlacement修正契約が確定するまで採用禁止。公開/認定枠9は個別科目へ割当しない。

再利用できないが新しい個別identityを公式根拠で確認した場合、`hosei:ic:<UUIDv4>`を発行する。旧IDは互換aliasとして残し、crosswalkのsource側に保持する。旧ID一つ→複数科目へのsplitはsingle adoptedStableIdで表さずcandidate list＋explicit decisionにする。未確認を解消する目的で新IDを作らない。

## 同名・異単位・複数配置

`InstitutionalCourse`に単一の恒久credits/category/requirementTypeを保存しない。名称定義の履歴は資料版に結びつける。単位・分野・必選・制度方式・算入規則はPlacementに属する。同名だから共有しない、単位差があるから別identityとも決めない。

Placementの一意キーは`(curriculumVersionId, scopeId, institutionalCourseId, placementRoleKey)`。PR #139の3軸にroleを加えるのは、史学科の同名概説4単位必修と2単位S選択必修、地理の同じ演習の必修/選択必修等が同一scope/version内に共存するため。roleは公式原表の区分/算入slotへpinし、利用者のselectedScopeや修得順からmaster IDを生成しない。元の物理行locatorも保持し、一意キーのroleを変更して既存IDを再発行しない。

例:

- 史学科の概説2＋4はp.53 cの充足・算入順を別ruleとして保持。現CC二つを無根拠で統合しない。
- 史学演習1〜4・歴史資料学1〜6はp.53 e/iの修得順slotであり、授業内容・テーマの別identityではない。family identityの粒度・分野別identityは大学確認まで保留。
- 地理の演習・現地研究・地理特講への段階算入（p.55 d/g/h）はidentity relationとcredit allocation relationを分ける。
- 卒業論文の4/6/8単位・学科別指導は別Placementの候補。同名の一個icへ自動統合しない。
- 公開科目枠・放送大学認定は課程側のrule/bucket。利用者の独立科目記録をこの名前のicへ統合しない。

## 改正、名称変更、統合・分割・読替

同一性を示す公式「名称変更」はname historyと条件付きlineageの根拠になるが、昔の成績照合先を無条件に置換しない。p.47/48/53/55/59の情報科学実習→情報学入門、p.48の論文作成基礎講座Ⅰ/Ⅱ→現名称、p.55の現地研究系、p.65の商法名称変更は[補助資料](official-context.md)に記録する。今回は過年度原表が不足し、過年度alias実値の自動採用はしない。

統合・分割・廃止・読替は`same_identity`と区別したrelationを持つ。`replaced_by / merged_into / split_into / credit_transfer / name_changed`等はrelation種別・direction・条件・資料版・rule版・数量制限・大学回答根拠を保持する。`credit_transfer`は同一科目identityの証明ではない。p.60の日本文芸特殊研究から複数現科目への充当は一対一aliasにしない。

資料版digestの違いだけでは課程改正と断定しない。今回の添付Quartz版と公式配布版は別sourceRevisionとして保持し、同じ適用課程かは内容比較・適用証拠で判定する。2026という表示年が同じでも未知revisionを既知crosswalkへ通さない。資料の誤植訂正も原版と訂正版を残す。

`unknown`、`legacy_or_transition`、既存明示`current_2026`を保持。current_2026→具体cvのadapterは後続で公式対象条件をレビューした固定adapterだけを採用する。入学年・plannedYear・成績取得日時・capturedAtから適用課程を自動確定しない。

## crosswalkの論理契約

| field | 条件 |
| --- | --- |
| oldEntityKind / oldId | CurriculumCourse/Mapping/Offering/legacyCourseを分離。裸UUIDだけではresolveしない |
| legacyDigest / sourceDigests / sourceRevisionId | 元JSONバイトdigest、override等6ファイルdigest集合、原PDF digest。互換backupのenriched digestとは区別 |
| candidateStableIds / adoptedStableId | candidatesは重複なし、採用はsafeかつ候補一つのみ。保留はnullを維持 |
| status / placementStatus / historicalContinuityStatus | 今回資料版の科目確定、配置定義、歴史的連続性を別軸にする |
| evidenceIds / notes / conditions / scopeIds | ページ・表・物理行・脚注・用途を含める。教職コードを本科生根拠へ移さない |
| ruleId / ruleVersion / auditVersion | 判定規則と台帳版をpin。変更時は旧decisionを残し訂正履歴を追加 |
| relationKind / effectiveConditions | 同一性と読替を分離。多候補で先頭を自動採用しない |

現監査JSONはこの契約の資料版内slice。独立masterのcv/cp実値と歴史的relationの実値は未発行。保存モデルへこのJSONをそのまま組み込まない。

## 採用しなかった案

| 案 | 理由 |
| --- | --- |
| 全321 IDの無審査採用 | 枠・順序slot・scope差・旧group仮説・bool不整合を固定する |
| 全科目ID再発行 | safeな既存参照まで変更し、互換コストと新衝突・誤crosswalkを増やす |
| 名称/コード/単位/scopeのhash | 表記修正やPlacement変更でIDが変わる。同名異科目、科目コードの用途差・歴史条件に対応しない |
| 年度入り科目ID | 年ごとの複製となり制度identityと資料版を混同する |
| Offeringまたはlegacy Courseからicを生成 | 開講なし科目・複数候補・provisional計算identityの限界を持ち込む |
| 同名・異単位の自動merge/split | 配置差・読替・別科目を公式根拠なく決めてしまう |

追加の公式確認が必要なfamily、過年度課程、boolean意味は[引き継ぎ一覧](yi-02-handoff.md)へ残す。
