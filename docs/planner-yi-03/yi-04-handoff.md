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

## 既存v22の試験日付とtarget検証の差

PR #168独立監査フォローアップで確認した追加条件。監査対象HEADは `1320c98408c9b6c8d06afd89702cbd3e7a02bc88`。[YI-03追加検証](README.md#p2-2候補-v22との日付差分と判断)に再現方法と結果を記録する。以下は将来の移行契約であり、移行・修正UI・永続化の実装結果ではない。

**確認済みの事実:** 既存v22のmedia assessment `scheduledDate`はnullまたはYYYY-MM-DDの形式を検証する。追加の暦日検証はなく、`2027-02-30`と`2027-99-99`は現行 `validateState`で受理される。一方、YI-03はどちらも `assessment_date`で拒否する。`2027-02-28`、閏日`2028-02-29`、nullは双方が受理する。合成fixtureを両validatorへ直接渡して確認した。実利用者に該当データが存在するかは未確認であり、今回取得・調査していない。

**採用判断:** 新Attempt側で実在する暦日を要求する契約は維持する。旧v22として正常なsourceにも、targetへの変換を保留すべき日付があり得る。sourceの受理条件とtargetの受理条件を同一とみなさず、旧validatorの変更やtargetの無根拠な弱体化で解決しない。

YI-04では少なくとも次を実装・検証する必要がある。

1. source側decoderが受理した元のstate/backup原文、原版、旧Offering owner、assessment ID・label/type/completedと日付文字列を完全保持する。旧データ自体を壊れたv22と再定義しない。
2. targetが `assessment_date`を返したら、元の日付・旧owner/assessmentへの参照・問題の理由をpreviewで示し、**target全体の移行成功を保留**する。失敗を無視した一部保存・補正・null化・field/assessment削除・移行成功扱いを禁止する。
3. 利用者が原値と修正案を比較して明示確認するまではprimary/recovery/元backupへ書かない。修正が必要な場合も、原文を別に保持した明示修正と全体再preview/再検証を経る。既存の原文保護と通常復元の契約を維持する。
4. 無副作用previewの反復・取消・拒否では元日付と全payload/数量/owner/IDが一致し、primary/recoveryへの書込みが0であることを検証する。明示修正の許可は他fieldの変更許可に拡張しない。
5. 不実在日（`2027-02-30`）、不正月（`2027-99-99`）のsource受理/target保留、通常日、実在閏日、nullの成功・原値保持をtest matrixへ含める。バックアップv1/v2それぞれのsource検証・原版・数量不変・失敗保護と、明示修正後のtarget全体再検証も必要。

現在のYI-03 graphへ不実在日を通すescape fieldや新schemaは導入しない。別のlossless unresolved表現を将来選ぶ場合も、target契約・失敗保護・原値保持を別途レビューする。今回の5比較テストはこの受理差と入力非変更だけを検証しており、上記の将来のpreview/UI/書込み保護が実装済みであることは証明しない。

## active-plan順序の追加引き継ぎ

削除/Undoの提案検証では操作対象を除いたactive Attempt ID列の前後一致が必要。Undo対象はticketの元active位置へ戻す。detached owner registryの位置は表示順序ではなく、合法な並び替えで進捗/TODO/評価を失わない。独立したsource→target migrationの原順序保存比較も、この区別を明示すること。並行変更時の位置調整・ticket失効を自動実装する契約は今回追加していない。
