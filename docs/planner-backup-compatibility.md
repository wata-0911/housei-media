# Issue #95 バックアップ互換性・保護契約

## 版と原版保持

新規出力は `hosei-planner-backup` backupVersion **2**、state.schemaVersion **22**。形式の版・stateの版・カタログの版・互換性規則の版を分ける。v2は作成時のenriched runtimeカタログ全体を `catalog.snapshotData` に保持し、全体SHA-256と互換性規則v1のsemantic SHA-256を持つ。SHAは破損検出であり大学の署名/真正性認証ではない。

旧backupVersion **1**のdecoderを残す。v1はカタログ原版を含まないため、同一原版SHAまたはimmutable archive registryに登録済みの原版とsemantic SHAで検証する。初回#95（dev `cb70e4d9d995c58d94c65de3e70292037063b0bb`）の全体SHA/semantic SHAは固定登録し、将来のruntimeから再計算して置き換えてはならない。未知のv1原版に対し現在のカタログを推測で当てない。未知版は元ファイルを保持して、原版を明示的に登録した対応版を待つ。

## 現在の互換性規則v1

SHA完全一致を必要条件から外す代わりに、以下を**すべて**満たすことを要求する。

1. 作成時カタログの構造・全体SHA・識別情報を検証する（旧v1は同一原版または固定archive登録で代替）。
2. 作成時カタログと現在カタログのsemantic SHAが一致する。
3. 同梱原版がある場合、stateを原版に対して検証する。
4. stateを現在カタログに対しても、全参照・所有関係・既存validation・再読込時の無変化を含めて検証する。
5. 置換説明と最終確認後、排他ロック下でexpectedRaw一致を確認して主キーへ一回だけ保存する。

semantic projectionが除外するのは、Offering/Mappingの `source.url` と `source.page`、Programの `displayName` のみ。前者はruntime計算数量ではなく出典表示、後者は所属の表示ラベル。除外前の情報はsnapshotDataに残る。

単位、年度、course identity、curriculum identity、scope、Mapping edges、要件、学習形式、科目名、department/faculty、metadataの安全性フラグ、未知field、配列順序等はすべて照合対象。追加・削除・行順序変更も今回は自動許可しない。既存consumerが配列の最初の候補や順序を使う可能性を、名前や「追加だけ」という推測で安全と扱わない。

これはstateを変更しないidentity migration（22→22）だけである。変更カタログを卒業要件エンジンの正本としてインストールする機能ではない。

## 将来の互換性・migrationを追加する条件

年度非依存化やschema更新自体は今回実装しない。将来の更新側が、旧backup v1/v2・state22 decoderと原版保持を残し、移行規則を**追加**する責任を持つ。

新しい規則は、source backupVersion/state schema/カタログ原版、target schema/カタログ版、rule ID/versionを限定する。単なるSHA削除や、最新loadState/applyImportによる自動修復を移行と呼ばない。

- ID変更には監査済みの明示的1対1対応表を用い、名前一致で推測しない。衝突・削除・多対一・曖昧対応は移行不可として説明する。
- 公式原本、fingerprint、source metadata、年度根拠、null/0、公式修得単位正本、メモ/進捗/meta/設定を保存する。内訳から公式単位を再集計しない。
- 原版と元stateを保持した無副作用プレビューに、移行前後、変換規則、変更参照、保留/失敗理由を示す。未知fieldや未対応参照を捨てて成功扱いしない。
- source側検証→限定した純粋変換→target側検証→冪等性/往復/数量不変/失敗保護テスト→利用者の確認→原子的保存の順を守る。
- decoder/固定archiveを削除しない。新しいカタログに変えただけで既存ファイルの原版情報が失われることを避ける。

原版保持は将来の移行材料を確保するが、まだ存在しない2027/年度非依存モデルへの復元を現時点で保証するものではない。安全な規則が未実装なら拒否を続ける。

## 旧v22と認定shadow・正規化

正常な旧v22（optionalなinstitutional extensionが省略された成績行、旧内訳sourceCourseId省略を含む）は、既存schema/参照検証とloadState前後の無変化を満たせばそのまま扱う。欠損した必須field、未対応schema、認定shadow、loadStateが卒論/annual match等を変更する原文は、通常バックアップと通常復元では拒否する。

拒否時にも主キーと旧recoveryを変更しない。表示stateを代わりにバックアップしない。「無関係な保存をして正規化する」「nullを0にする」を復旧手順にしない。

## 保護ファイルと復旧手順

`hosei-planner-protection` protectionVersion **1**は正常バックアップと別契約。主キー原文と旧recovery原文を、空白・改行・無効JSON・9924等の無効値も含めて文字列としてそのまま保持し、それぞれのSHA、日時、作成時カタログを収録する。inspect関数は無副作用で検証するだけで、PlannerStateを返さず保存権限を与えない。

1. 拒否後は利用者の明示操作で保護ファイルを準備・保存し、保存先に存在することを確認する。自動ダウンロードや自動修復を行わない。
2. 保護が済むまで初期化・ブラウザデータ削除・修復目的の無関係な保存をしない。
3. 認定値は公式資料と照合し、既存プロフィールUIで利用者が修正対象を明示する。参照/旧v22/版の問題は元ファイルを残し、限定した復旧規則のある対応版または監査付きのオフライン修復を用いる。
4. 変更前後の差分を確認し、元ファイルを残して明示的な修正を保存した後、正常バックアップを再生成する。

保護ファイルは通常復元へ直接投入できない。任意の破損データをlocalStorageへ戻す機能は実装しない。原文に未知の個人/機密情報がある可能性を表示し、外部へ送信しない。保護ファイルは暗号化されないため保管先に注意する。

## 検証境界

互換な出典/表示更新、非互換な単位/参照/要件/年度/順序変更、同梱原版改変・未知互換性版、旧v1の固定archive、旧v22、拒否時の主キー/recovery不変、保護原文往復と通常復元拒否をテストする。Web Locksに参加しない旧版タブとの競合およびPC/iPhone Safari実機未検証という先行実装の制約は継続する。
