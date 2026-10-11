# 年度非依存化の移行計画と受け入れ条件

設計日: 2026-10-11（Asia/Tokyo）。基準dev: `05dac8c7deb5f9abea93c9967237aacf0427863c`。**将来の実装計画。今回は移行コード・保存schema・カタログを変更しない。** [詳細設計](planner-year-independent-design.md)の参照方向、[現行backup契約](planner-backup-compatibility.md)を前提とする。

## 版と入力境界

現行PlannerStateは22、新規正常backupは`hosei-planner-backup` v2、カタログschemaは1、compatibilityVersionは1、原文保護は`hosei-planner-protection` v1。互いの版番号を同一視しない。

独立Attemptやmap参照が永続化される工程でのみstateの版を上げる。実装開始時も22なら次の候補は23だが、別PRが進んでいればその時点の次版Nを採用する。本書はv23を予約・実装しない。旧multi-year案のv21→提案v22を転用しない。

| 入力 | 現在 | 将来の移行decoder |
| --- | --- | --- |
| 正常local state22 | 既存loadState、raw比較、限定annual回復・認定shadow | 保存済み原文をsource22 decoderで検証→純粋変換。通常loadでは書かず、明示確認で保存 |
| 旧v22のinstitutional extension全省略 / 内訳sourceCourseId省略 | backup検証・再読込無変化なら許容 | 「省略」を保持。名前や候補だけで欠損親ID・identityを補完しない |
| backup v1 / state22 | 同一カタログSHAか固定LEGACY_BACKUP_CATALOGSとsemantic一致で読み込み | v1 decoderと固定hashを残す。source archiveを明示解決してruleを選択。未知原版には最新runtimeを当てない |
| backup v2 / state22 | 同梱原版・SHA/semantic検証、source/target双方state検証 | 同梱原版を保管してsource契約で検証。targetとのsemantic不一致をmigration ruleで限定的に扱う。通常復元の比較を緩めない |
| 古いstate1〜21 | local load側に既存migration。通常backup decoderの対応を意味しない | sourceの対応範囲を別途列挙。既存migrationで変わるfieldをpreviewへ示す。新しい保存モデルへ直結する無言のload/applyImportを禁止 |
| 修復が必要なv22 / 認定shadow / 破損JSON | 通常backup/restore拒否、保護原文出力 | 通常移行も成功扱いにしない。保護ファイルを維持し、別の監査済み修復規則へ分離 |
| protection v1 | 原文inspectのみ。通常復元不可 | decoder/inspectを残す。任意原文を直接storageへ戻す機能にしない |
| 未対応future schema / backup版 | 拒否、現raw不変 | 拒否継続。旧clientによるdowngrade保存をさせない |

v1固定登録はカタログのfull bytesを含むarchiveではなく、既知原版のfull/semantic hashを保持するregistryである。構造変更する将来移行には当該原版を復元できる別のimmutable archiveが必要。現在のruntimeから将来そのhashを再計算して置き換えない。

## 旧参照から新identityへの対応表

新モデル用の対応表は現`offeringRelations` / `legacyCourseRelations` / `curriculum-rows-2026.json` / `curriculum-equivalences-2026.json`を監査入力にする。現在uniqueでも、永久同一性として無条件採用しない。2026原版のSHAとmanual/official overrideの根拠をpinする。

各entryに`sourceCatalogDigest・旧参照の種類/ID・targetInstitutionalCourseId・targetPlacement候補・status(exact/ambiguous/unmatched/conflict)・evidence(資料版/頁/行/ledger)・ruleId/version・適用範囲`を持つ。実値一覧とschemaは後続Issueで確定する。

旧科目IDの付替えは監査済み一意crosswalkだけで行う。Offering→科目は多数の別開講が同じ科目を指す関係として許容するが、**履修回・source row・進捗ownerの多対一変換は行わない**。同名・同コード・単位一致は候補抽出/矛盾検査に使えても移行証明にはならない。

自動identity移行を停止する条件:

- relationが複数候補/未解決、旧参照が未知/欠落、手動選択と公式制度照合が矛盾する。
- 単一候補でも必要な旧memberが欠けている、scope/課程/単位・脚注の根拠が不一致、名前しか根拠がない。
- 新旧科目のsplit/merge、旧課程読替、番号/テーマの同一性に公式証拠がない。
- Offering.method/年度を過去原行のmethod/年度へコピーする必要がある、capturedAtで年度を補う必要がある。
- 一つのprogress/評価が複数履修回へ配布される、複数ownerが同じtargetへ衝突する、sourceCourseIdリンクを新しく推測する必要がある。
- 未知field、未対応参照、認定shadow、invalid/null/0の区別を捨てなければ変換できない。

曖昧な制度対応だけなら、正常な原記録・旧参照・候補を未解決としてtargetへ保持できる。そこからidentity確定・算入を自動実行しない。targetが未解決表現を持たない、sourceが不正、数量・参照保存を証明できない場合は移行全体を拒否する。一部だけ保存して残りを落とさない。

## 正常v22の純粋変換

1. source decoderで全field/参照/ownerを検証。原文、原版カタログ、recovery原文、source digestを保存材料として保持する。通常loadの回復表示を正本にしない。
2. `items`各行に別attemptIdを与える。旧Offeringごとに単一旧itemであることを確認し、status、plannedYear/Term、studyYear、earnedOrder、importedSourceCourseId、courseCreditContributionの値/省略をコピーする。旧Opening参照と版は残す。
3. 明示crosswalkが安全な時だけ制度科目参照を追加する。Placementの曖昧さは別stateとする。旧academicYear/yearSource/手動選択を訂正しない。
4. itemを持たないprogress/評価/TODOの旧Offering参照は同じ旧IDにつき一つのdetached ownerへ移す。数量・statusを新しく作らない。map keyと内部owner IDを同時に付け替える。
5. 公式原行/内訳はID、fingerprint、source、許可fieldの値・配列順を保持する。新associationは旧明示リンクを表現するだけ。metaはachievementId、公開科目は独立ID、卒論・profile・scopeは旧ownerを維持する。
6. sourceRef→attemptIdの対応をmigration provenanceに残す。乱数をpreview再実行のたびに発行せず、source digest＋rule＋旧キーから同じ結果になる割当表を用いる。新規追加のID発行と区別する。ID衝突は拒否する。
7. target validator、参照閉包、数量比較、全field保存比較、冪等性、旧計算adapter比較を通す。unknown fieldを捨てるためにvalidatorを緩めない。
8. UIへ移行前後の件数・参照差分・数量不変・未解決理由を表示。利用者が最終確認するまで、state/storage/recoveryへ書き込まない。

detached ownerは計画行数とは別に数える。items数の一致だけでは進捗の保存を証明できない。旧mapのentry数とpayload、TODO IDと参照先、activeとdetachedの分類、各旧owner→一つの新ownerを検証する。新しい再履修回を作る操作と旧ownerの復元を分ける。

## プレビュー・確定保存・失敗保護

現`restorePlannerBackup`はファイル原文を再検証し、共通`hosei-planner:v1:write` Web Lock内でexpectedRawを比較し、主キーへ一回setItemする。future migrationもこの書き込み境界を使う。現在の同期save primitiveや旧タブはWeb Lockに参加しないため、旧clientを閉じる案内を継続する。Web Locksがない時の復元・移行確定は拒否し、CASを二度行うだけの処理を原子的と呼ばない。

確定時はpreviewのsource text/digest・target版・rule・crosswalk/カタログdigestを再確認する。別タブ更新やrule更新時はpreviewを失効する。source→target変換を再評価して同じ結果であることを確認し、失敗したら書かない。保存成功後だけReact loaded stateを更新し、Undo/import preview/未保存入力draftを失効させる。

原文の保護ファイルは利用者の明示操作で作成・保存し、元バックアップも残す。通常復元ではrecoveryキーを触らない。migrationのためにrecoveryを上書き・初期化・自動修復しない。setItem例外後のrollback書き込みは別タブを壊すため実行しない。quota/read/security例外では成功表示せず主キー・recovery・元ファイルを保護する。UIの表示用nullへ置換された認定shadowを出力正本にしない。

外部サーバーへユーザーstateを送信せず、端末内で検証する。原文保護ファイルは未知個人情報を含み得る非暗号化ファイルで、正常backupとは別表示にする。オフライン修復の具体手順と対象規則は未実装である。

## 数量・参照不変のテスト計画

既存のplanner、catalog generation、graduation、privacy、extension/bookmarklet、保存ブラウザテストを維持する。新しいテストは実装PRで追加し、本ドキュメントPRでは追加しない。syntheticな2025/2027/改正fixtureは公式データとして配信しない。

| fixture / 操作 | 必須の結果 |
| --- | --- |
| 手動のみ、公式のみ、混在、各status、null/0/正値 | earnedCreditsTotal等の原行数量と手動寄与の値・省略が全field一致。source ID/fingerprint、元配列順、meta、scope/卒論/profile保持 |
| 制度4・旧Opening2、通信寄与2/未設定/0 | 構成単位・旧登録単位・手動寄与を混同しない。公式4をcomponentへ配らない。旧adapter結果一致 |
| 2025年度の原行、取得日だけ、手動年度、旧inferred | 過去年度・yearSource・capturedAt・rawYear/Term/date/examDate保持。不明はnull、既存推定を無言訂正しない |
| 開講のない2027計画、unknown identity、別課程 | 保存/reload/export/進捗編集可能。実開講・履修資格を確定せず、算入適用のみ必要な範囲で保留 |
| 同じ科目/同年度/同旧Offeringの2つの新attempt | 独立ID・状態・動画/レポート/評価を保持。操作再送のみno-op。科目IDで合体しない |
| 旧616 unique / 32 ambiguous / 38 unmatched全relation | uniqueもcrosswalk条件を検証。ambiguous/unmatchedは原記録と候補を保持、代表選択なし |
| 同名異identity、史学/反復/法律/地理例外 | 名称で合体しない。earnedOrder・cap・段階配分・official priorityを保持。新modelによる根拠のないpositive算入なし |
| detached progress、TODOだけ、削除/Undo/再追加 | payload・assessment ID・TODO IDの全件一致。消えたownerなし。Undoは同ID、別履修回へ進捗を流用しない |
| 旧v22 extension省略、v1固定原版、v2同梱原版 | source版ごとのdecoderで読める。原版digest・旧参照・省略状態保持。旧ファイルを新版へ無言上書きしない |
| 改正で構成単位/分類/名称変更 | 旧定義・適用根拠維持、最新値へ遡及変更しない。証拠なしのsplit/merge停止 |
| preview複数回、取消、反復load/restore | storage write0、入力deep equality、同じID対応、変換冪等、数量/件数の増加なし |
| stale raw / rule更新 / 別タブlock待ち / ロックなし | stale preview拒否、queued stale save拒否、現行共通lock、未保存draft失効。旧タブの保証は主張しない |
| malformed JSON/参照衝突/未来版/未知field/shadow | 拒否または明示未解決、黙って削除/正規化しない。primary/recovery原文・保護SHA一致 |
| setItem/read例外・quota / protection-only | 主キー一回保存の失敗保護、rollbackなし、recovery不変、通常復元へprotection拒否 |
| 全8非共通scope・認定/卒論選択・公式duplicate | 旧計算のordinary/S/completion/cards/requirements/unknown/診断まで比較。既知量不変、false-positiveなし |

数量比較は合計だけでなく行別null/0、source別値、ordinary/S/completion、認定と公式の分離を検証する。参照比較は旧→新edgeの台帳と逆変換可能な旧projectionを確認する。targetをschema22へdowngradeして保存する「往復」はしない。バックアップ往復・source projection往復は異なる検証である。

## 実装ロードマップIssue候補

以下は**Issue本文にできる候補**であり、GitHub Issueを新規作成した記録ではない。#95/PR #138は実装済み前提。各sliceは最新devから専用feature、通常push、dev向けDraft PR、マージは利用者が行う。

| 候補 | 依存 | 作業範囲 / 受け入れ条件 |
| --- | --- | --- |
| YI-01 教育課程表・identity対応表の監査 | 本設計 | 原資料の版/頁/行/脚注と502 Mapping・321 IDを照合。safe/ambiguous/conflict/unmatchedを記録。読取不能を補完しない。stable IDの実値規約・未知課程の扱いを決定。src/catalogは変更しない |
| YI-02 制度マスターの独立read model | YI-01 | CurriculumVersion/Placement＋旧crosswalkをpure loaderで検証。Offering0件でも名称・構成単位・scope候補を読める。2026原版・既存adapter出力は不変。年度開講registryを追加しない |
| YI-03 独立Attempt・owner validator契約 | YI-01/02 | schema候補とID/未解決/active-detached/単位由来を確定。合成fixtureのみで複数回・null/0・参照閉包・衝突拒否を検証。runtime保存をまだ切替えない |
| YI-04 v22→N純粋migrationと旧decoder | YI-03、#95 | 全field台帳、deterministic ID割当、detached owner、source archive/ruleを実装。旧v1/v2/state22継続読込、無副作用、数量/参照/旧計算不変。read-only比較から始める |
| YI-05 新Attempt対応UI・CRUD・進捗/評価/TODO/Undo | YI-04 | 新モデル対応コードを実装するが、一般利用者の永続モデル切替・新state書込み・新形式の通常保存/復元有効化はしない。既存v22の編集・保存・再読込・backup/restore・公式成績・卒業要件計算を従来どおり維持する。新UIは明示的に無効化でき、開発/テスト用操作は本番`hosei-planner:v1`を変更しない。旧計算adapterを保持し、卒業engine変更を混ぜない |
| YI-06 新保存・backup確定導線と公開切替 | YI-04/05 | state N・新backup版、preview差分・最終確認・共通lock・一回保存を接続。v1/v2原版保持/保護v1読込を維持。quota/競合/取消/反復復元を実ブラウザ確認。移行・保存・復元・失敗保護の全契約を満たして初めて一般利用者に新モデルを有効化 |
| YI-07 新Attemptの算入consumer監査・adapter | YI-02/05、#133根拠確認 | 架空Offeringを作らず課程/scopeから各consumerを接続。8scopeと特殊family別に小PRへ分割。公式aggregate不変、unknownを無根拠解除しない。未対応は明示保留 |
| YI-08 PC/iPhone・公開案内・既存Issue調整 | YI-06、算入公開範囲の確定 | PCとiPhone Safari実機/Files共有・再読込、新モデル移行、移行前保護、開講/卒業保証なしを確認。#132/#134へ実態を反映、#137の開講時期収録要求を整理 |

### YI-05からYI-06への公開・保存境界

YI-05とYI-06は段階的にmergeできる。YI-05のmergeは一般利用者の永続形式を切り替える合図ではない。YI-05の新Attempt UIはfeature flag等の明示的制御で閉じられることを受け入れ条件とし、具体方式はYI-05実装Issueで確定する。flagを無効にした状態で旧v22の編集・通常保存・再読込・backup v2作成/復元・公式成績表示/再取込・卒業要件出力が従来どおり動く。開発・テスト用の新モデル操作は隔離fixture/storeだけを使い、実利用者のprimary/recovery localStorageを書き換えない。

YI-05で準備した新形式コードはYI-06まで利用者向け保存経路から到達できない。YI-06は、旧state22・backup v1/v2の読込、preview無副作用、移行前原文保護、参照/数量不変、明示確認、共通Web Lock下の一回保存、通常backupの作成/復元、失敗時の保護を全て満たしてから切替flagを有効にする。切替可否を判断する具体flag/rollback手順はYI-06で定める。

移行の拒否・未対応参照・競合・read/write/quota失敗時は、新primaryを書かず、primaryと既存recoveryをバイト単位で維持する。旧backup/protection原文も残す。状態を無理にnormalizeして成功扱いしない。再開は対応版の明示previewから行う。卒業算入adapterが未実装の範囲は明示的に判定保留とする。公式`earnedCreditsTotal`と従来確定済み数量を保ち、内訳・手動値・仮想科目で補完/相殺しない。

YI-04〜06は保存契約を共有し、YI-04/05はread-only比較と隔離fixtureで個別レビュー可能にする。YI-06に切替の最終受け入れ条件を置き、YI-07が未完なら新モデルで判定保留にする算入範囲を表示する。年度非依存記録と卒業engine完成は同一リリース条件にしない。

#129は現行の再取り込み差分UX・安全更新が目的で、独立して進められる。ただしowner/source identity契約変更をYI-03/04へ共有し、後で移行モデルへの統合テストを行う。#133は公式根拠調査でありH全件解消ではない。将来年度の開講・日程収録や全旧課程の自動読替は候補に含めない。

## 未確定事項の工程上の扱い

具体schema/backup envelope、stable ID一覧、公式改正読替、未知方式の単位制約、課程変更後の卒論step対応は未確定。選択肢と推奨は[詳細設計](planner-year-independent-design.md#未確定事項と推奨案)。根拠不足項目は未解決を保持できる契約を先に作り、migrationの安全性を満たせなければその入力の確定保存を停止する。
