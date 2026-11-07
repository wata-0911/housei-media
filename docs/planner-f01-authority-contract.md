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

## F01-R1: audited boundary corrections

The production session retains the exact `raw/revision/committed/issuedIds`
record returned to the historical verifier at successful load/readback. Restore
first witnesses/replays that destination, then fences every inspection read to
the same record. A previously opened session must reload after another save;
a known checkpoint does not bypass destination verification. After that reload,
explicit rollback still preserves all host reservations. Protection previews
include `previousAuthority` as well as previous/source/backup raw strings.
Backup creation fences all reads under the common writer lock and revalidates
at the end; changed revisions or rollback tombstones stop export.
Reload also rejects decreasing revision, missing observed checkpoints or missing
observed reservations; same-revision changes cannot replace the observed record.
This is session continuity protection, not authentication of an unseen host's
entire past history. No lost reservations are silently reconstructed.

The new native adapter rejects non-plain data, sparse arrays, array extensions
and unknown authority fields before cloning/comparison. CAS compares the whole
validated structure. The session supplies a synchronous third `commit` argument
which this adapter invokes immediately before `put`, inside both versionchange
and existing readwrite transactions. Host adapters must preserve this callback
when wrapping the native store. Legacy-primary/recovery mismatch aborts the
transaction and awaits its terminal event. This closes the observable pre-put
window; it does **not** make localStorage and IndexedDB one atomic transaction.
Non-cooperating legacy tabs, ABA and writes after the last check remain F04's
legacy-write-control responsibility. No normal-route coexistence is approved.

Unknown structured-clone values are left in IndexedDB. Diagnostic JSON is emitted
only for lossless plain JSON data (and the existing top-level undefined tag).
Map/Date/non-finite numbers/nested undefined/cycles/extended arrays return
`protection_unrepresentable`; this is not a portable arbitrary-value backup.

Local primary accepts bare local-v22 only, including the correction-chain path.
Backup-v1/v2 envelopes are selected files. Migration input uses its own 16 MiB
UTF-8 limit, depth64, 1,000,000 values and 100,000 values per container; primitive
edits keep their 1 Mi code-unit limit. The historical decoder, original raw,
final32 MiB record limit and byte-pinned code are unchanged. Decimal tokens must
round-trip as normalized decimal values: `4`, `4.0`, `4e0` are compatible;
`4.0000000000000001` is held instead of being silently identified with4.
This check also applies to adopted migration/correction archives.

Destination read/format/replay failures revoke proposals and editing authority.
Input syntax errors consume the input generation without pretending the host is
corrupt. File selection increments its generation before reading bytes. New
selection, input cancellation, confirmation cancellation, reload and unmount
invalidate pending reads. `invalidatePreviews()` revokes session confirmations;
only a matching final selection may create the next preview. A confirmed write
already in progress still resolves through its transaction/readback contract.

## F01-R2: verified knowledge and byte archives

Write authority and verified host knowledge have independent lifetimes. A full
readback must match the written four-field record and pass checkpoint/replay;
that verified snapshot becomes known history before subsequent legacy reads or
admission checks. Full verified loads likewise remember history before policy
checks. Failed raw reads and failed replay never add knowledge. Losing edit
permission or reloading does not clear knowledge. Missing known reservations
stop load/restore/normal backup without repair; an intact current remains usable
through explicit reload. A failed save still displays failure.

The native adapter rejects non-JSON object graphs including sibling aliases,
not just cycles. Both expected and next must have valid, unique UUID-tail
reservations. Revisions advance by one, host checkpoint/ID histories cannot
shrink, and next cannot clear raw. Both parameters are validated before cloning
and bound to frozen private snapshots before any asynchronous work. A later
caller mutation detected before the host's beforePut check cancels the write;
CAS/put only use private snapshots. The trusted synchronous beforePut remains
immediately adjacent to put. Diagnostic export refuses shared object/array
references because ordinary JSON cannot preserve them.

Selected migration files are limited to16 MiB using File.size BEFORE reading.
The returned ArrayBuffer size is checked again. UTF-8 is decoded with fatal
errors and checked by byte-for-byte re-encoding. A leading UTF-8 BOM is rejected
explicitly; it is never stripped. Interior U+FEFF and a genuinely encoded
U+FFFD remain ordinary original text. Unsupported/malformed files stay untouched
on the user's filesystem and produce no preview or put. Selection epochs cover
byte acquisition and decoding, including replacement/cancellation/unmount.

Attempt backup envelopes have a separate64 MiB UTF-8 preflight. Decimal tokens
must preserve their normalized value before the historical backup parser/digest
runs. Strings such as source.raw are skipped as quoted tokens. Legacy migration
keeps its16 MiB policy and final authority records keep their32 MiB limit.
These are resource limits, not a new portable format or permission to repair an
unknown record. Unseen past host history, non-cooperating writers after the last
synchronous check, ABA and physical power-loss recovery still need F04 acceptance.

The future Attempt-restore file UI must apply the same strict byte boundary with
its64 MiB policy. F01-R2 does not add that UI or connect the normal Planner.


## F01-R3: loadability before durable commit

After the pinned controller serializes/replays a candidate and applies its32 MiB
record policy, the production boundary fixes the complete host-reservation record
in an immutable private snapshot. A separate read-only instance of the SAME
historical persistence.load parses, witnesses and replays that exact raw against
its actual checkpoint/ID envelope and migration environment. Its reconstructed
state must equal the candidate JSON. Any parser/resource/replay failure returns
`authority_unreadable_before_put` before the real store's commit/put. The same
snapshot is passed to commit; caller data cannot replace its raw after validation.
Legacy keys are rechecked after asynchronous validation and immediately before
native put, and native CAS still checks the whole expected record. A successful
preflight neither grants edit permission nor adds verified host history; only
complete actual readback does that. The historical33 files are unchanged.

The16 MiB migration input,64 MiB Attempt backup and32 MiB final-record policies
are unchanged. Being under a size policy is not proof that the historical parser
can read the serialized result. An8 MiB whitespace-padded valid22 (and16 MiB
boundary inputs) may be held with put0 even though source decoding/preview passed.
The exact original source remains in the protection download and legacy storage;
no whitespace stripping, raw normalization or partial archive is used. Supporting
such long quoted archives needs a separately versioned/audited reading path.
Existing unreadable records are not repaired or overwritten automatically.

Diagnostics first walk own data descriptors iteratively with a visited Set.
An alias/cycle is refused on its first revisit BEFORE the historical recursive
comparator, giving linear graph discovery instead of exponentially traversing
DAG paths. Accessors are rejected without invoking getters. The historical
comparator still decides JSON shape/array holes/extra properties/numeric meaning
for non-shared trees. Original IndexedDB values are never normalized or repaired.

## F01-R4: raw number lexemes and early non-JSON rejection

Every F01 authority raw is lexically checked BEFORE whole JSON.parse and the
historical load/witness/replay. This includes native read, actual/expected/next
CAS records, production reads and the immutable candidate used by R3. Lossy
decimal tokens return `authority_number_precision`; a held record never becomes
verified knowledge or edit authority. It cannot produce a normal backup or be
used as a restore destination. A later reload of the same anomaly stays held.
Valid decimal equivalents4/4.0/4e0/40e-1 and0/null remain supported. Quoted strings,
including source.raw and categoryRaw, are not rescanned as numeric JSON values.

The new lexical front end is iterative and does not replace the frozen parser or
validator. Object keys, format tags and eligible reservation strings use native
JSON string decoding; no numeric value is parsed by that operation. Byte caps remain
16 MiB legacy migration,32 MiB authority raw (inside the existing32 MiB final
record envelope),64 MiB Attempt backup. The scanner budgets depth64,1,000,000
values and100,000 children per container before whole JSON.parse. Numeric tokens
are capped at256 characters and exponent digits at16; significant exponent
magnitude beyond6 digits is held too. Such resource holds leave original data
intact, including large or unusual previously stored records; they are not repair
or blanket permission for every JSON under a byte cap. Long quoted strings are
scanned without a recursive/quoted-token regex. The R3 pinned load still decides
whether an exact serialized candidate can safely be committed.

Diagnostic protection bypasses adoption and numeric conversion deliberately.
The browser uses the existing native protectOriginal; the generic memory fallback
uses a separate read-only protection reader over an immutable lossless snapshot.
Neither updates lastRead, knownRecord, permissions or host reservations. Raw
protection remains distinct from a validated Attempt backup. It can preserve all
lexemes of a held raw; unknown structured-clone values still fail lossless export.

Before ownKeys or descriptors, each object node is checked against the SAME
prototype policy as the frozen comparator: Object.prototype/null or regular
Array.prototype only. TypedArray/DataView/ArrayBuffer/Map/Set/Date and subclasses
are rejected at that step, including nested values. Shared/cyclic plain data
retains R3's iterative first-revisit rejection; no getter is invoked and array
holes/extensions/non-enumerable/symbol properties keep their existing rejection.

The isolated page displays load/save and protection errors separately (R4 P2).
This changes diagnostic visibility only. Existing180-second reload waits in the
Japanese/16 MiB browser cases remain an unresolved flaky candidate; retries do
not establish a product fix. Main-route migration, old-writer/ABA control, future
browser/resource behavior and physical durability still require F04 acceptance.

## F01-R5: a restorable backup and permanent reservation budget

A normal backup is returned only after inspectAttemptBackupInput and the SAME
pinned inspectBackup/full replay succeed against a private empty read-only
recipient. That check performs no IDB open/put, legacy mutation, adoption or
permission change. The final destination/legacy checks still run after it. The
immutable before-put candidate also generates and inspects a portable backup;
a newly saved canonical authority therefore cannot cross a backup-only budget
silently. Unknown failures revoke operation rights and never return success.

The selected design is a format/path-limited budget, rather than capping new
reservations at100,000 and stranding previously writable100,001-ID authorities.
Only root reservedIds in Attempt backup v2/v3 can use a larger container budget.
The scanner binds format/version regardless of property order, accepts only a
dense array of valid reservation UUID strings, and detects duplicate UUID tails
across namespaces. This list and the authority envelope's issuedIds each have a
finite1,000,000-ID /32MiB canonical serialized ASCII-list budget. The byte budget
includes brackets, commas and quotes; it fits every formerly writable32MiB
record's reservation list. No ID is truncated, sorted, renamed or deduplicated
to fit. Complete replay and required catalog/source/history reservations remain
mandatory. The format/path exception is not authority or issuer authentication.

Unknown arrays/objects (including nested reservedIds), depth64, total1,000,000
values INCLUDING reservation entries, number precision, and separate16MiB legacy,
32MiB record/raw and64MiB backup policies keep their prior meaning. A file under
its byte cap is not automatically valid. A future candidate that cannot satisfy
all restore budgets is held before put. A previously stored anomaly is preserved
and diagnostic protection remains available; no repair is attempted.

Normal output includes all host reservations, including discarded-draft burns.
Roundtrip acceptance compares the ordered ID array and original source/state by
SHA through actual public session saves and distinct empty browser origins.
Order tampering without a new digest is rejected. A digest plus explicit adoption
still does not authenticate an external writer or unknown prior order. The pinned
union retains the host's existing prefix and adds restrictions; its semantics
are unchanged. The ordinary backup/restore UI is not connected by this work;
public-session API experiments and the existing migration UI regressions are
reported separately.

Session known-history and native expected/next subset checks now use Sets with
identical exact-string membership and required-order results. Their membership
lookups grow linearly. R5 left frozen controller/identity membership quadratic;
the explicitly authorized R6 revision below addresses those searches.
No latency ceiling is inferred from loaded-machine timings. R4 raw-number and
prototype-first protections, CAS/Web Locks, readback/history, portable consent
and source protection remain required. The180-second display-wait flaky cause
is still unconfirmed.


## R6: authorized membership-only revision

The user authorized changes to the frozen controller and related identity/history
membership searches after the sixth independent audit. Only lookup indexes change:

- controller witness indexes authority.issuedIds once after replay;
- controller portable inspection indexes expected.issuedIds only when the checkpoint
  digest is already known, preserving the unknown-checkpoint short circuit;
- controller calls requireCanonicalReservations only for its JSON/replay-derived
  arrays. It validates shape and UUID-tail aliases before the exact-string index;
  the generic requireReservations retains its original accessor/iterator behavior;
- each correction indexes its next table's reservedIds before checking original
  assignment IDs; correction order and all replay validators are unchanged;
- Undo indexes removal operation IDs for receipt filtering only for privately
  branded, internally created frozen workspaces. Unbranded/caller/Proxy workspaces
  retain the original search and observable accesses. The ordered history
  comparison, ticket identity, LIFO rule and snapshot restoration remain required.

The arrays remain authoritative. Sets never replace, sort, shorten or persist the
reservation, command, correction or deletion arrays. For valid strings Set.has has
identical membership semantics to includes, including namespace prefixes. These
checks cost O(n+m) lookup work and O(m) temporary index memory per invocation;
whole replay, serialization and per-command graph validation are not claimed
linear. Single digest/receipt lookups and small fixed allowlists are unchanged.
The generic compatibility paths may still perform quadratic work; only the
canonical persisted JSON and internally issued workspace paths are optimized.
Progress-row, catalog-mapping and G03 engines are outside this permission.

The historical-dependencies manifest advances exactly three approved persistence
hashes (controller, identity, codec); its other thirty entries remain fixed. The
workbench Undo change is also limited to membership and is not in that manifest.
The previous manifest and exact before/after hashes are sealed in R6 evidence.
No validation is removed and no test is skipped. New measured tests must fail on
sealed R5 as well as pass on R6; CI records real native Chromium input, Long Tasks,
operation counts and unchanged ordered IDs/raw. This is implementer evidence,
not independent audit approval or authority to publish.

Aggregate32MiB record closure and the Japanese/16MiB display-wait flaky remain
separate unresolved investigations. No new capacity cap or timeout relaxation
is introduced by R6. Normal /planner remains on the legacy route.
