# YI-04への引き継ぎ

前提: [YI-03契約](README.md)、[年度非依存migration計画](../planner-year-independent-migration.md)、[backup互換](../planner-backup-compatibility.md)。YI-03は型とpure validatorのみ。次schema番号、backup envelope、新形式書込み、利用者向け公開を確定していない。

## 確定した再利用契約

- `AttemptGraph`と `validateAttemptGraph` を独立のtargetドメイン検証に使用できる。ただしPlannerState全fieldやsource decoderを網羅するvalidatorではない。
- IC確定、配置定義確定、本人適用、歴史的連続性、記録数量、算入の判断は独立。旧Offering relationや予定年度で補完しない。
- Attempt/作成操作/owned recordのIDはnamespace付き独立UUIDv4。既存assessment ID/TODO ID/公式ID/旧catalog IDはpayload/参照として別保持。
- plan未設定の孤立ownerはdetached/legacy_orphan、計画削除はdetached/plan_deleted＋元active snapshot/ticket。削除/UndoでownerのID/payloadを付け替えない。
- 未照合・ambiguous・conflict・unknownはref null＋理由・原名称・旧参照・候補。未知の原版を現在の原版へ書き換えて成功扱いしない。
- 本人contribution省略/null/0/正値を保持。構成単位・旧Offering登録単位・公式aggregate・内訳と別。旧fallbackは原版の互換projectionに限定。
- 新moduleは現在のUI、通常load/save、成績取り込み、卒業engineに接続されていない。

## YI-04で実装・検証する部分（今回は未実装）

1. 正常state22/旧backup v1/v2のsource decoder・原文・原版・全field台帳。既存の回復load/applyImportをsource正本にしない。既知v1のfull/semantic pin、v2同梱原版、旧decoderを継続する。
2. 一度発行したランダムIDを **source digest＋rule/version＋旧キーに紐づける固定割当表**。ID自体を旧Offering/年度/配列位置のhashにしない。preview再実行でIDを再抽選しない。同操作再送は同じ操作ID/Attempt ID、意図的別回は新規発行と区別する。
3. 各旧item→独立Attempt、各元進捗mapのkey/内部offeringId→同じ新owner。itemなしの旧Offering ownerは一つのdetached/legacy_orphanへ集約し、計画status/単位を生成しない。未知旧IDは保護・拒否/個別対応。payloadの省略・assessment/番号・日付/grade/null/0を比較する。
4. 旧itemsの明示sourceCourseIdは関連として保持し、公式原行/内訳/手動meta、公開科目、scope卒論/profileを無条件Attempt化しない。aggregateを分配・合算しない。公式 source ID/fingerprint/rawYear/rawTerm/年度根拠/数量/原配列順の全field不変を検証する。
5. crosswalkの資料版・全member・safeゲートを限定し、candidateを先頭選択しない。`current_2026`→具体cvの本人適用adapterは公式対象条件の別レビューが必要。documented sliceを自動的にconfirmedへしない。
6. 原版raw6ファイル・旧Offering定義/単位・旧state全fieldを復元できるarchiveを保持。YI-02 relation archiveだけで旧登録単位や旧計算を再現したと扱わない。metadataのdigest文字列だけを真正性証明にしない。
7. source側検証→無副作用変換→本validator＋target全state検証→参照閉包/件数/payload/数量/省略比較。未対応fieldは捨てず全体を保留。冪等性・原版projectionの往復・旧計算168baselineと全8scopeを比較する。新旧進捗mapを同時集計しない。

削除/Undoのvalidatorは提案前後を検証するだけ。新CRUD・再追加時の明示復元・同操作no-op handler・並行変更時の位置調整・ticketの有効期限はYI-05。YI-03のstrict transitionでは前後の他recordが変わる提案を拒否する。migrationはそのtransition関数を使ってownerの付替えを正当化せず、明示の旧→新edge台帳とsource全field比較を実装する。

Web Lock・expectedRaw・最終確認・一回保存、保存失敗/容量/旧タブ/元ファイル保護、新backup envelopeは後続YI-06の責務。YI-04/05の試験はread-only/隔離fixtureで行い、本番 `hosei-planner:v1` とrecoveryに書かない。新Attempt卒業算入はYI-07で別監査し、架空Offeringを作らない。YI-08公開ゲートを通るまでは一般利用者へ適用しない。

## 公式根拠が不足する部分

[YI-01 handoff](../planner-yi-01/yi-02-handoff.md#大学公式追加資料への確認事項)を継承する。学科横断同名科目、史学概説4＋2、史学演習/修得順slot、地理段階配分、S必須boolの原生成、教職用途、過年度全課程/2013改正、名称変更/読替、卒論同一性を自動確定しない。今回新しい公式PDF/回答原本・年度別開講情報を確認していない。

## 監査リスク

- UUID形式は乱数性/一度発行/永続不変の保証ではない。ID割当表・再送処理には別テストが必要。
- prevalidatedなcontextを信頼するAPI。外部JSONから期待registry/公式ID一覧を自動生成して検証を自己正当化しない。
- 希望方式・実績contextと公式内訳の値/方式/年度の同一性は、参照存在検証だけで確定しない。
- static graph単体では合法な別Attemptへの再割当履歴を見抜けない。削除/Undoでは前後検証し、migrationでは元edge比較を使う。
- semantic issue順序は安定だが、payload順序やUndo位置は意味を持つ。backup v2の順序契約を緩めない。
- 合成fixtureのPASSは実利用者のデータ移行・ブラウザ保存・iPhone Safari・全卒業算入のPASSではない。

`schemaVersion=22`、`graduationCheckComplete=false`、`sourceLinksReverified=false`、公式 `earnedCreditsTotal` 正本性を維持。独立監査の後に後続工程を判断する。
