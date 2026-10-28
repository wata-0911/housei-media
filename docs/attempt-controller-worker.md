# Preview-only controller Worker (stage 3B1)

Base: PR #200 `1f75d6db958608dfb149d1aa0f610e3c58a21d2d`. Opt-in local API only; no production UI integration or replacement of the synchronous controller or stage2 replay Worker.

`createControllerWorkerClient()` creates one Dedicated module Worker per source/context session. Call `startSession()` once, then pass `{session, expectedView}` to `openCommitted`, `inspectLegacyRaw`, `inspectBackupRaw`, `prepareMigration`, `prepareSave`, `readPage`, and `release`. Mutating successful inspections/previews return the next `view`; use it for subsequent requests. Empty `openCommitted` returns null and preserves the current view/draft when the authority is unchanged; external erasure returns `stale_authority` and requires a fresh session. This API does not discard an unsaved migration draft just because the database is empty.

`prepareMigration` returns a draft token. `prepareSave` accepts exactly one draft token or restore preview token. It rereads the complete authority record and requires exact raw/revision/committed/issuedIds equality. Unexpected authority changes also reject inspections before ID issuance; before a mismatch is detected, explicit `openCommitted` can refresh a nonempty committed base. Once any authority mismatch is detected, the session permanently revokes draft/preview/migration eligibility, including settled request replay. Returning the DB to its previous contents cannot revive it. Only `readPage` and `release` remain available on the existing view; private Workspace, raw and generated-ID reservations remain retained. A fresh session and full revalidation are required for new candidates; `openCommitted` cannot clear this latch. It always returns `canCommit:false`. The recovery hint is non-authoritative. It neither adopts portable backups nor supplies future stage3C save credentials. Restore previews remain recovery candidates. Attempt backup v1 requires a host checkpoint; v2/v3 may be inspected as portable-unadopted.

Only actual controller-returned objects are registered. Private tokens contain 192 random bits and are bound to kind, session identity, preview-only mode, allowed operations, and a private boot/source/context/draft/authority vector. The controller still performs its original WeakMap/live-migration checks. With explicit user approval of the minimal exception to stage3A §10, the controller adds `assertPreview`: a read-only check of its existing preview WeakSet and handle WeakMap. It never creates a credential or grants commit permission. The session calls it after registry resolution and again before returning a preview. Stage3B1 never calls commit to probe qualifications. A clone or summary cannot register a new object. Each new prepared save revokes the preceding preview while preserving its underlying draft.

All controller reads/inspections/previews/pages/releases go through one queue. Requests reserve ingress order before controller awaits. Identical request IDs/payloads join the original promise/result; conflicting payloads and older IDs fail closed. The main client synchronously reserves one of eight admission slots before its first await, including transport and Worker readiness. Success, transport failure, Worker error, abort, timeout and close release each slot exactly once; late callbacks cannot release it again. The independent Worker queue also enforces eight operations. There are at most eight admitted operations, one raw operation with no waiting raw, and 1,024 ledger entries. Control frames are at most 32,768 UTF-16 units, so eight queued frames remain below 1MiB. Ledger entries retain bounded DTOs and exact bounded control keys; raw keys refer to one canonical selected raw string. Rejected/duplicate requests never allocate another whole TextEncoder/hash buffer. Session ID allocation remains in the existing controller and is not undone by a cancelled/failed preview.

Only primitive strings cross IPC. A validated control header and one separate primitive raw frame avoid escaping the entire raw into a JSON envelope. The main side checks types/length/transport bytes, with yielding for large UTF-8 scans. The Worker checks exact raw bytes before fingerprint allocation, then performs structural preflight in the queue. Source objects, context, Workspace, graph, raw archives and reservation arrays never appear in normal DTOs. Responses are exact-key validated and bounded; failures expose fixed error codes only, never arbitrary messages, stack, raw or title.

Independent state/Attempt-backup/legacy profiles use 64MiB outer UTF-8, depths 72/74/72, 500k containers, 2m values, 1.5m fields, 24MiB individual decoded string and 64MiB total strings. State/backup permit 10k Commands, 128 corrections, backup 500k reservations, and 250m heuristic work. Source/correction JSON is scanned and charged in addition to its escaped outer representation. The private scanner is mechanically derived from stage2's scanner; neither Graph nor stage2 profiles change. It rejects duplicate decoded keys, lossy numbers, invalid syntax and depth before native whole-tree parse. Preflight trees have no authority: the exact raw is still passed to the original decoder and full ordered replay. These limits are admission policy, not heap/CPU safety guarantees, and can reject otherwise valid large synchronous inputs.

`indexedDbRead.ts` mechanically preserves inventory-first reads, version=1, unexpected-upgrade abort, late blocked-success close, readonly transaction completion and versionchange close. The controller bridge preflights the same backend record that it returns to the controller. The read-only store's commit always throws `readonly_mode`; locks are undefined. There is no write adapter import, commit opcode or write-mode switch. Controller write functions remain in its import closure, but have no route through this dispatcher and adapter. The browser remains a same-origin environment, not an XSS sandbox.

Display pages contain at most 50 projected rows, opaque row/cursor tokens, excerpts of at most 64 UTF-16 units and original full lengths. Four private cursors and 512 registry entries are allowed. Row/cursor release frees references. The summary reservation count describes the state history issuance list; the full authority/recovery reservation union remains private and is preserved independently. Display data is not save authority. Unknown fields/raw are preserved in private originals; excerpts never rewrite stored values.

Worker control cancellation is soft: it marks queued/running requests and checks again after awaits before publishing. Synchronous replay cannot process cancellation in the middle of its loop. The public client's `cancel()`, AbortSignal, timeout and `close()` use hard termination to invalidate every old credential and suppress late callbacks; this loses private unsaved drafts. The API consumer must treat those calls as deliberate session disposal. A new source/context or recovery after hard termination requires a new facade and full revalidation. No automatic restart, synchronous fallback or replay occurs.

Tests: `npm run test:attempt-controller-worker`; additional audit/ABA cases: `node --import tsx --test --test-concurrency=1 tests/attempt-controller-worker-audit-regression.test.mjs tests/attempt-controller-worker-revocation.test.mjs`; real browser: `npm run test:attempt-controller-worker-browser` with optional `PLANNER_PLAYWRIGHT_MODULE` and `PLANNER_BROWSER_EXECUTABLE`. `CONTROLLER_EVIDENCE` selects an external evidence directory. Private oracle instrumentation compares all state/Workspace/source/reservation values in a test-only Worker bundle, without a product hook or graph-returning RPC. `scripts/verify-controller-worker-scope.mjs` checks reader extraction, writer preservation and import boundaries. `scripts/benchmark-controller-worker.mjs` measures a fresh page per scenario, 100 page/release cycles and 30 start/close sessions; it requires local browser/ps access and writes raw fixtures only to the external evidence directory.

Known limits remain total replay CPU, module/environment startup cost, long-lived raw/cache/ledger memory, postMessage copies, RSS residue, worst-case OOM, and the unexplained prior 429ms Long Task. Node22, Safari, real iPhone/Android and low-memory devices remain unverified. Neither this stage nor its local tests approve PR #183's P2 closure, dev integration, public release, or stage3C writes. Stage3B2's editing/new-plan/date correction and stage3C's commit/Lock/CAS/artifact/backup export remain separate work, with independent audits required.


## 段階3B2のローカル編集境界

`prepareNewPlan` / `prepareEdits` / `proposeDate` / `confirmDate`を追加した。
保存API、DB writer、Lock request、export、portable adoption、write-mode昇格は提供しない。
controller・codec・schema・IndexedDB reader/writerは3B1から不変。

`EditIntent`は`worker/editTypes.ts`の閉じたunion。全8 Command種を扱う。
UIは用途別RowTokenを渡し、Command・operationId・恒久ID・source/context・公式証拠を渡さない。
search/attempt/record/removal/assessment/既存owner/held dateは現在のviewの実objectへ束縛する。
新規recordは空の進捗配列を作り、後続のviewで取得したtokenによる単項目patchで編集する。
TODO以外のowner=null、plan=nullへの部分plan編集、未知intent・fieldは明示拒否。
省略は元値保持、nullと0は変換しない。元official linkや進捗行/識別子はpatch中に保持する。

batchは1–50件、intent全体UTF-8 1MiB、単純文字列4096 UTF-16 units、note8192 units。
frameはparse前にdecoded duplicate key・過深・unsafe integer・-0/非有限を拒否する。
既存domain enum/range/transitionの判定は既存Command validatorへ通す。
Command/IDをWorker内で一度構築し、controllerの順序付きdispatchと候補admissionを全件成功したときだけpublishする。
失敗・取消時は元draft/viewを維持し、発行済みUUIDは生存session中の全namespaceで再利用禁止。
同requestId/同payloadはledgerにjoin。異payloadはprotocol。
別requestIdの同view/draft/intentsは、失敗後もprotocol拒否し、再UUID発行しない。
新しい操作には新viewまたは明示的に異なるintentが必要。

queueは同時受付8件、待機intent payload（他操作はcontrol）UTF-8 1MiBに加え、保持header合計4Mi UTF-16 unitsを上限とする。
後者に達したらresource_limitとして新規受付を停止し、draft/原文/既存ledgerをevictしない。
元rawは従来どおりcanonicalな1参照を共有し、このheader上限に原rawを加算しない。

日付はheld date row→controller実proposal→限定oldDate/newDate表示→`confirmed:true`でのみ訂正する。
元raw、元assignment、公式数量、訂正連鎖、旧予約はcontrollerの既存契約で保持。
元rawの再inspectは訂正後の現在の実sessionを表示し、訂正前の資格へ巻き戻さない。
訂正はsource/draft revisionを進め、旧proposal/preview/row/cursorを失効させる。
編集済みdraftの再inspectやsource選択後のopenCommittedはstale_viewで拒否し、別sessionでの再検証を要求する。

検証: `npm run test:attempt-controller-edits`、`npm run test:attempt-controller-edits-browser`。
全値観測・決定的UUID・await延期はtest-only bundle/injectionに限り、製品RPCにhookはない。
性能計測は`scripts/benchmark-controller-edits.mjs`。固定fixtureを`CONTROLLER_EVIDENCE`の
`performance-fixtures.json`へ事前配置する。schema23の過去180秒timeout/58.57秒の記録は維持し、
今回の速度差を性能改善と主張しない。自己検証は独立監査PASSではない。
