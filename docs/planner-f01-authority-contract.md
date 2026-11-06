# F01 保存正本・移行接続契約

基準: dev `945657d0c85bcf1d6295c73361d2f6bbaf32afa0`、2026-11-06。
F01は隔離ABC入口の保存基盤。通常 `/planner` は旧Plannerのまま。
独立監査・通常公開受入は未実施。K1〜K6は未解決。

## 正本の決定と移行期間

新Plannerの唯一の書込み正本は既存IndexedDB
`hosei-yi06-isolated-v1 / authority / current` の **ABC AuthorityRecord**。
`raw + revision + committed + issuedIds` を同一transactionでCASする。
schema23は旧22移行由来、schema24は独立新規。両者の意味・namespace・履歴を変更しない。
G03 hostの文字列formatをこの正本へ保存・共存させない。

旧 `hosei-planner:v1` と `:recovery` は新Plannerから読取・保護だけを行う。
移行前の通常Plannerは引き続き旧22を保存する。新Plannerは旧のみの利用者に新規24を作らない。
明示移行・正式commit・完全readbackが終わった場合だけ、新側の編集を許可する。
旧rawとrecoveryを削除・更新しない。失敗・中断では元データが残る。

**この差分は旧画面を同じ正本へ接続しない。** 新旧画面間の同時編集を公開運用として承認しない。
F04は互換機能を同じ正本へ移すか、移行後の旧互換操作を読取専用にしたうえで通常入口を切り替える。
現時点の旧画面には新DBの編集権限を与えていない。旧側が変わったら新側の次の編集・保存は停止する。
保存を二つの正本へ同時に成功させる橋渡し・自動統合は実装しない。

## 読取判定と書込許可

`production/authorityAdmission.ts` は初期化・ID発行・書込みをしない。
厳密な旧22 decoderと、checkpoint・source・catalog・全操作履歴をreplayしたhandleを使用する。
`loadState` の修復表示や、rawのschema番号だけを根拠に許可しない。
返り値は説明用であり、書込みcapabilityではない。実権限・expected原文はsession内に保持する。
旧データの失敗は`legacyProblem`でJSON破損・未対応形式/版・整合性確認待ちを区別し、strict decoderの診断codeも保持する。

| ケース | 新側の動作 |
| --- | --- |
| A 旧・新なし | 明示確認で新規24。読取・previewではDBを作らない |
| B 旧22のみ | 新規24禁止。厳密decode可能なら元state/catalogが一致する明示移行のみ |
| C 新23のみ | 完全replay後に編集可。旧source・訂正・割当・retainedは保存 |
| D 新24のみ | 完全replay後に編集可 |
| E 旧22＋新23 | 旧state digestと元catalog digest一致なら編集可。差異は閲覧・保護のみ。検証済み明示訂正chainの訂正前原文と完全一致する場合も可 |
| F 旧22＋新24 | 別計画の衝突として明示。自動統合・保存禁止 |
| G 旧破損・未対応・recoveryのみ | 初期化・移行・復元禁止。既存新graphが読めれば表示可、旧原文保護可 |
| H 新DB形式・version・履歴不明 | 新規・移行・編集・復元を拒否。DBと原文を残し診断 |
| I stale・旧原文変更 | preview失効・編集権限停止。再読込でのみ再判定 |
| J 保存障害・不明結果・readback不一致 | 成功表示禁止。previewを再使用せず、保護・再読込で照合 |

空文字はデータあり。旧recoveryの存在も無視しない。
両保存先が有効でも同じ利用者の同じ計画とは推定しない。
バックアップ封筒から移行した場合、local22とはraw表現が異なり得るため、
双方を厳密decodeし、完全stateと元catalogのdigestを照合する。
新しいファイルの選択は、失敗しても旧確認画面のgenerationを失効させる。

## 保存の手順と障害境界

1. session.loadで旧primary/recoveryの原文を固定、新正本を完全replay、旧sourceとの関係を判定。
2. prepareSave/prepareMigration/prepareRestoreは書込みをせず、確認対象と保護対象を返す。
3. migrationは既存正本を置換しない。新規も既存正本があればreloadを要求する。
4. 明示saveでpreviewを消費。既存controllerの再検証・共通Web Lockを使用。
5. Lock内のstore.commit直前に旧2キーを同期で再比較し、その後IDB transaction内で正本全体をCAS。
6. 正式transaction完了後、完全replayのreadbackが実際に書いたrecord/stateと一致して初めて成功。
7. 失敗・結果不明・readback失敗ではrollbackや二重書込みを行わず権限失効。再読込して永続結果を照合。

Web Locksを使わない古い配布済みタブとの跨storage原子性は保証できない。
書込み前・readback後に旧原文を照合するが、それはlocalStorageとIDBの分散transactionではない。
F04公開受入では旧タブを閉じる導線・互換編集の制御・実機競合の確認が必要。

## 後続が使うインターフェース

`createBrowserPlannerAttemptSession()` が実際のlocalStorage readerとIndexedDBを結ぶ。
F01のDB adapterは`persistence/authorityIndexedDb.ts`。監査でbyte固定された既存`indexedDb.ts`は原版のまま保持する。
新しい画面は旧adapterや低層controllerを直接使わず、guard付きsessionを経由する。同じDB/store/keyを使用し、別の正本やnamespaceは作らない。
`createPlannerAttemptSession(store, locks, options)` もブラウザでは実originを読む。
空legacy defaultは旧storageを持たない合成memory host専用。
localStorageへアクセスできないworkerは明示readerがなければ拒否する。

| API | 契約 |
| --- | --- |
| load / admission / view | 読取・完全照合。admissionは説明用。失敗後は古いhandleで編集できない |
| prepareSave / prepareMigration | 確認previewのみ。既存raw/revision・旧2キーを固定。移行元が旧localと異なれば拒否 |
| add / update / recordContribution / progress / remove / undo | 同じAttemptGraphを操作。caller graph・ID・Commandを受け取らずsessionがIDを発行 |
| save(preview, confirmed, adoptedBackupSha256?) | Lock/CAS/readback。復元で未知履歴を採用する場合はpreview.adoptionSha256への別の明示同意が必要 |
| createBackup | 未保存commandを含まない検証済み状態だけ出力。共通Lock下で最新stateとの一致を確認。v23→backup2、v24→backup3 |
| prepareRestore | backupの完全検証後にpreviewだけを返す。現在と復元後の両admissionを満たす必要あり。旧22上への新24復元は禁止 |
| protectCurrent / protectLegacyPlannerRaw | 診断用原文保護。正常backupと区別。G03文字列もそのまま保護。権限や復元可能性の証明には使わない |

現行UIには新restore/backupフォームを追加しない。F04がこの契約へ接続する。
内部 `createAttemptPersistence` / store.commit をUIから直接使用してgateを迂回してはならない。
原文保護のJSONは未知の任意IDB structured-clone値全種類の可搬backupではない。
ABC raw文字列・G03文字列と保存位置の診断を対象にする。異版DBや読取不能DBは保存を残して停止する。

## 所有先・ID・authority境界

| 機能 | 唯一の所有先と後続の接続条件 |
| --- | --- |
| 新Attempt | `graph.attempts`、乱数UUIDv4 AttemptId / creationOperationId。年・科目名・Offeringから生成しない |
| メディア動画・小テスト | `graph.ownedRecords[kind=media]`、OwnedRecordId＋Attempt owner。nested assessment新規IDの発行履歴契約はF03で実装。未対応UUID履歴は保留を維持 |
| 通信リポート・試験 | `ownedRecords[kind=correspondence]`、同一ownerの別履修回を併合しない。必要数は未確認nullを保持 |
| 通常S評価 | `ownedRecords[kind=evaluation]`。公式原行を上書きしない |
| 手動修得・不合格 | `attempt.plan.status/contribution` と本人評価record。本人入力と公式を分離、完成・卒業量はF02の別責務 |
| 公式成績・再取込 | 同じAuthorityRecord内の版付き原行・内訳・取込履歴。既存23の`source`/`retained`原行は保護。新規24は公式arrayが空のclosed schemaであり、F03で監査済みschema/command/replay拡張が必要。G03のhost formatを保存する代替策は禁止 |
| 卒論・指導・認定・公開科目 | 23のretainedにscope/独立ID/原文を保持。24に未実装のためF03/F04で明示版改訂と履歴契約を設計。Offering不存在を理由に既存記録を削除しない |
| JSON backup/restore | sessionのcreateBackup/prepareRestore/save。予約集合は単調増加、portable明示採用、旧原文・復元元を保護。host checkpoint集合はimportしない |
| CSV/PNG・年別表 | 保存済みの同じgraph/retainedからの読取projection。authority revision/checkpointを固定し、未照合・複数回・未定年を保持。旧22 exportを新Attemptの最新出力と表示しない |

原行ID・fingerprint・provenanceは取込source owner、本人進捗はAttempt owner。
同名・同年度・方式だけではassociationを確定しない。同一回が未証明なら両方を保持して関連だけを保留する。
現行23/24のclosed shapeを黙って拡張せず、必要なschema/replay変更を独立差分で監査する。

## G03衝突の判断

G03は未接続。コードの同名保存先だけを根拠に、利用者の実データ破損が起きたとは報告しない。
G03 nativeStore.initialize / portable.createRestoredHostは既存DBを作り直さず、
CASは既存値がexpectedと完全一致する文字列の場合だけ書く。ABCはobject recordなので拒否される。
ABC側はformat guardを追加し、既存DBのキー欠落・保存済みnull/undefined・文字列をempty扱いしない。
反対側の保存先をDB名変更・削除で避けない。将来の成績取込はG03の検証知見を再利用しても、
正本adapterとしてABC sessionへ接続し、別formatのhostを接続しない。

## 後続工程

- F02: K1〜K3、#154 K4/K5、K6。保存形式や原行数量を変えず参考算入の証拠境界を修正。
- F03: #235、#129。上表のownerに全進捗・本人結果・公式差分を接続。24のclosed schema拡張とnested ID契約が先行条件。
- F04: #150、新しい通常Planner、年別・CSV/PNG・backup/restore UI。同じ正本への互換操作接続と旧編集の制御が通常入口切替の前提。
- Astra: F01限定差分の独立監査。通常公開は別工程でK1〜K7・必須操作・iPhone Safari等を統合監査。

F01のテスト成功を独立監査PASS・通常Planner公開可能・上位Issueの完了とは扱わない。
