# YI-05 / YI-06への引き継ぎ

## YI-05 UI・CRUD

- このsliceのreadyはread-only情報保存の判定。本人課程confirmed、卒業判定、書込み許可には使わない。
- `decodeMigrationSource` のraw、原版、失敗診断を保持し、表示用loadStateを入力に置き換えない。
- 一度の `prepareMigrationIds` のhandleを保持し、再previewは同handleまたはexisting引数を再利用する。新規割当と同操作再送を区別する。別の新規Attempt CRUDは未実装。
- active itemsとdetached registryの件数を区別。旧Offeringを共有する孤立記録は同detached owner。再追加/Undoで他Attemptに付替えない。
- 日付 `2027-02-30` / `2027-99-99` は旧v22正常でも全体held。元日付・assessment ID/owner/payloadと修正案を比較するUIが必要。本人の明示修正確認→原文を別保持→新sourceとして全体再検証。候補のfieldを直接変更してreadyにしない。元source SHAが変わるため旧割当bindingは失効する。訂正前後IDを継承する規則を必要とするなら、明示的な訂正履歴契約を別監査する。
- UIから呼ぶ解決/検索/owner API、feature flag、削除/Undo、修正画面は今回未実装。本番state22編集/backup動作を継続し、新UIの開発も隔離fixtureで行う。

## YI-06 保存・backup

- 新永続schema番号・backup envelopeは未確定。今回の `MigrationTarget` と `SourceArchive` をそのまま保存schemaとして扱わない。
- archiveは元raw全文、原版catalog、raw6実測SHAと原文、互換rule、source/target対応、発行済み割当履歴を保護する。全体SHA/semantic SHA/raw6 SHA/PDF SHAを取り違えない。
- 今回のhandleはin-memory限定。JSONコピーした割当表/SourceArchiveのimportは拒否する。永続化・再起動後の再開には、信頼できる発行履歴と原文・原版の再検証付きrehydrationを実装し、固定表を失った際に黙って再発行しない。
- 既存namespace予約IDは完全な集合を準備・検証へ渡す。Web Lock、expectedRaw、stale preview、rule変更失効、原子的な一回保存、quota/旧タブ/書込み失敗は今回の保証外。primary/recoveryを読む・書くAPIを追加していない。
- v1固定原版が将来runtimeから構築できなくなった場合は停止する。将来対応はraw6に対応する監査済みloader/rule・原版archiveを明示維持する。現在のcatalogへ差し替えてhashを更新しない。
- 新backup、保存/復元ブラウザ試験、PC/iPhone Safari実機は未実施。YI-06隔離保存試験とYI-08公開判断を分ける。既存v1/v2・protection契約を緩和しない。

## 独立監査重点

P1として、source原版の真正性境界（localは明示原版を渡す呼出側の責務）、raw6/full/semanticの取り違え、source/target双方参照閉包、全field/owner往復、公式aggregateの改変・二重算入、日付heldを成功へ流すconsumerがないことを確認する。

P2として、ID発行receiptのプロセス寿命・再開契約、既存namespace集合の欠落、割当表を新規要求として再発行する誤用、optionalの省略/null/0、元配列順序、同一制度の別旧Offering、unknown identity/Placementと本人適用の分離、current loaderでの原版再構成が将来fail closedを維持することを確認する。

性能は大型raw6/archiveを保持して全比較するread-only優先。ユーザーデータ量が大きい際のUI応答・メモリ上限は未測定で、YI-05/06で確認する。独立監査済みとは主張しない。

## 公式根拠の未確定

YI-01/02のsafe221と残るambiguous85/conflict6/unmatched9、Mappingのconflict6・非科目bucket9を維持。全8非共通scopeの旧出力一致は全課程の算入完成を意味しない。学科横断同名科目、史学の4＋2・修得順slot、地理配分、S必須bool、教職用途、過年度全課程・2013改正、読替・名称変更・卒論同一性は追加公式根拠が必要。新PDF・大学個別回答・年度別開講情報を今回取得したとは扱わない。historical continuityと本人適用は未確認のまま。

YI-07の新Attempt算入consumerとYI-08の公開は対象外。今回の旧projectionの一致で新Attempt算入を有効化しない。
