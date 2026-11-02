# 3C-0b PR5: read-only versioned Worker

固定親 #212 `51ec5140038ef177f8581862cad22bdef064db95`。親の独立監査範囲を子へ継承しない。
実装前の操作表（2026-11-02 JST）。全行で Worker `canCommit=false`。

| 入力 | 読取・表示・inspection | ローカル操作 | 資格 | 永続書込 |
|---|---|---|---|---|
| 旧4-field authority / schema23,24 rule1 | 既存controllerの完全replay、旧raw/digest保持 | 既存8 Commandの隔離編集、prepareSave hint | このsession限定preview、明示移行が必要 | 禁止 |
| authority v2 / schema23,24 rule2 native宣言 | PR1 strict decoder + 3C-0a full replay | 読取のみ。新形式の編集はreadonly_mode | 内容宣言のみ、host保存資格なし | 禁止 |
| authority v2 / legacy-unproven | 同上、coverage明示 | 通常編集不可。baseline保持 | 未証明のまま | 禁止 |
| backup v1 | 既存strict + 同host checkpoint必須 | 既存restore preview + 非権威hint | host witnessは保存権限でない | 禁止 |
| backup v2,v3 | 既存strict + 完全replay | 既存restore preview + 非権威hint | portable-unadopted | 禁止 |
| backup v4 / schema23,24 rule2 | PR1 envelope/digest/R2/coverage + full replay | inspection + restore preview/hintのみ | portable-unadopted、宣言から昇格なし | 禁止 |
| Attempt schema23,24 rule1原文 | 新read-only inspectAttemptRaw、PR1 + PR2分析 | ready時のみ明示rule2 preview（許可2field保持検査） | explicit-migration-required / held。保存資格なし | 禁止 |
| Attempt schema23,24 rule2原文 | 新read-only inspectAttemptRaw、PR1 + full replay | inspectionのみ | coverage-unestablished | 禁止 |
| 旧v22原文/旧planner backup | 既存inspectLegacyRawとYI-04 decoder | 既存割当・日付訂正・Attempt rule1 preview | live migration preview限定 | 禁止 |
| 不正/未知版/coverage/R2不足 | 正確な境界で拒否。旧R1は新R2不足だけで破損にしない | なし | 発行なし | 禁止 |

新しい編集権限、save/export/adopt/protect/write RPC、writer/Lock依存は追加しない。
Attempt rule1→rule2分析はv22→Attempt移行とは別経路。新形式を旧controllerへ変換しない。
同期F03救済は変更しない。Worker strict loadへ救済rawを渡さない。

## 実装接点（実装前）

Worker session、入力preflight、閉じたDTO/protocol/client/displayとread-only版別adapterに限定する。
共通decoder、fold、CAS comparator、同期controller、allocator、IDB reader/writerは親のbyteを維持する。
scopeはPR5の固定親から再検証し、過去3C-0aの14-file/hash証明を更新して合格にしない。

## 読取・失効の実装

`versionedRead.ts` は保存sessionを生成せず、元recordを共通の全値比較器で検査する。
同一参照でもdescriptor/全階層を走査し、getterを実行せずplain data、dense array、有限数を要求する。
clone/JSON化前に旧4-fieldまたはv2とcoverageのclosed shapeを確認する。
state原文preflightとhost予約/checkpoint件数上限を確認し、独立snapshotを共通strict decoderへ渡す。
その値とsnapshotを情報保存比較する。予約importとtoken登録はその後だけ。
破損metadataの通常読取からF03救済へfallbackしない。同期の救済経路は親のbyteを維持する。

各store.readはawait前に操作専用observationを捕捉する。直列queue内で検証した同じsnapshotを
controllerへ返し、その操作のexpectedに束縛する。別readの完了で共有observedを上書きしない。
同じrevisionでもraw/committed/issuedIds/format/authorityVersion/coverageの全値を比較する。
変更またはstrict read失敗を観測したsessionは不可逆に候補資格を失う。
explicit openCommittedも変更を受理するrefreshには使えない（旧Workerからの保守的な変更）。
A→B→Aやsettled request replayでも復活せず、新sessionと完全再検証が必要。
表示用private state/原文と生存burnは維持し、既存viewでreadPage/releaseを続けられる。

新形式はPR1 decoderと3C-0aの版別replayを使用する。独自H2/R2や変換validatorはない。
rule1原文は元規則で先に検証し、PR2分析のheldを内容破損と取り違えない。
明示prepareMigrationはPR2の許可2fieldと全値比較を通るだけで、同期保存registryへ登録しない。
v4のSHA/coverage宣言も採用にならず、prepareSaveは再検証した非権威hintとcanCommit=falseだけ。
新形式のdraftはprepareSaveだけ、新形式のrowはdisplayだけに束縛し、編集はreadonly_mode。

## 環境の取得時点

session開始時の環境の全値snapshotを基準にする。各候補操作の開始時と公開直前にproviderを再取得し、
origin/target/rawFiles/catalog/legacyArchiveの全値を比較する。schema23の新読取経路はさらに
replayが再構成した環境とも比較する。mutable provider Promiseを操作間でcacheしない。
既存controllerが内部に保持する環境は正規prepareMigrationEnvironmentの実objectであり、
比較用cloneをdecoder資格として渡さない。Worker外周の毎回の再取得で古いcacheへの依存を防ぐ。
provider拒否/変化はenvironment_changedで候補資格を失効、pending中は公開しない。
取消/終了後は各awaitの後のqueue checkで結果を公開しない。

保証は各sampleの返値との一致。最後のsample後、sample間ABA、providerが返さない変化の完全検知はしない。
同一操作のsnapshot以外のtrust cacheを追加せず、環境とIDBを原子的に読めるとも主張しない。
そもそも本Workerにcommit/Lock/CASの書込経路はない。

## DTO / RPC / 入力

primitive string control + 独立raw frameを維持し、read-onlyのinspectAttemptRawのみ追加する。
既存inspectBackupRawがv4も扱い、prepareMigrationが区別されたAttempt rule1 tokenも扱う。
client/Worker双方のclosed control/result validatorを更新する。raw frameの同期受付8枠、queue順・上限、
同request/payload join、異payload拒否、ledger保持上限、hard terminateは既存実装を維持する。

新ContentDTOはrule版、origin、coverage、baseline digest、migration状態、editPreviewAllowed=false、
saveAuthority=not-issued、canCommit=falseのみ。raw、source、Workspace、予約配列、内部stackは含めない。
openCommittedのv2 resultに編集draftを返さず、旧rule1 resultは従来どおりdraftを必須とする。
新DTOが許される操作と版も閉じて検査し、旧result全般のoptional field緩和にはしない。

scannerのbyte/depth/値/field/文字列/Command/訂正/予約/work ceilingは維持する。
rule2 history.issuedIds/usedTodoIdsにも既存予約上限を適用する。escaped sourceと訂正前rawも従来どおり課金する。
preflightは資格でもreplay代替でもなく、入力は切り詰めない。
UUID/factory/Command/任意sourceやcontext/Workspace/予約集合/保存資格をcallerから受けるAPIは追加しない。

## scopeの代替と親保護

旧3C-0a scope verifierと、PR4でWorker byte不変を確認した過去テストは親sliceの証明である。
子PRの正当なWorker変更に対して、それらの固定hashや許可表を更新して合格にはしない。
新 `verify-readonly-worker-pr5-scope.mjs` が固定親からのpath/status、staged/unstaged各層、regular fileを確認し、
追加writerや許可外変更・削除・rename/type変更を拒否する。負試験でこれらの拒否も確認する。
同期controller/allocator/ticket、P/R2の共通fold、backup/adoption、F03救済、全field CAS、
IDB reader/writer、旧queue/registry/editBridgeはworking treeとindexの両方を親blobと比較する。
client bundleの入力を小さい既存control群へ限定し、production bundleへのAttempt persistence混入を拒否する。
write関数のある旧controller closureを含むことと、RPCから到達できることは別であり、native計数で後者を検証する。

既存session試験の変更は読取bridgeの同一object assertionだけ。
元recordへの参照を返す契約から、全値が等しい独立した深いfreeze snapshotへ変わったため、
notEqual/deepEqual/freeze assertionsへ置換した。その他の期待・fixture・timeout・skipは維持し、
この限定差分自体もscope verifierが親から全値照合する。

旧backup v1/v2/v3も、現在hostがv2なら共通decoderでrule1のまま検査・表示する。
v1はそのhostのcommittedに元rule1 stateのdigestがある場合だけ受理する。
v2/v3はportable-unadoptedのまま。ここでもrule2化やR2による旧R1有効性の上書きをしない。
旧backupからの移行は原文のinspectAttemptRawによる別操作で、backup inspectionから自動実行しない。

同request/payloadのsettled joinは既存結果を返すもので、新しい候補発行や環境sampleではない。
利用操作ではhost/環境を再検証し、一度観測した失効をledger replayからも復活させない。
観測していないauthority/環境のsample間ABAまで検出する保証はない。

## コスト測定と保持

Node24.13.0/macOS x64、同じschema24/1 receipt/同じ原文のmemory storeでstart+openを3反復。
親とPR5のrule1順を反転し、他の本作業の試験・性能測定を重ねず実行した。
以下はnative IPC/heap peak/長期sessionの測定ではない。

| 経路 | wall ms (3標本) | process CPU ms (3標本) | backend read数 | result JSON bytes |
|---|---|---|---|---|
| 固定親 rule1 | 928.02 / 408.29 / 309.29 | 897.62 / 311.09 / 240.95 | 2 | 452 |
| PR5 rule1 | 1094.41 / 2880.17 / 1301.93 | 1085.71 / 1439.93 / 1197.95 | 3 | 452 |
| PR5 rule2 | 1267.20 / 1793.80 / 1402.63 | 1285.00 / 1575.87 / 1328.25 | 3 | 588 |

host rawは各3025 bytes、authority JSONは約68.5 KB。rule1 wall中央値408.29→1301.93ms、
CPU中央値311.09→1197.95ms。追加strict read/full replayのコストを隠さず、性能改善とはしない。
既存controllerへの事前graph applyを追加していないことは別のapply計数試験で確認する。
測定checkpoint全体の最大heap255.73 MiB/RSS426.06 MiBはprocess全体の値で、版別増分やpeak/leakではない。

保持の追加は初期Environmentの全値snapshot、操作内の独立authority、rule2 replay結果、
inspection原文とcandidate JSON、coverage診断。schema23のReadHandleはreplay環境/base/R2も保持する。
既存EnvironmentのJSON表現は7,261,899 bytes（rawFiles合計1,163,528 bytes）。
これは表現サイズであり実heap占有量ではない。provider再取得と多重full replayの一時allocationも増える。
control rawは既存のcanonical参照を共有し、ledgerはbounded DTO/controlを保持する。
予約/burnは縮小しない。新しいcatalog/Workspace/予約配列のIPCはなく、製品DTOは小さいまま。
PR5 client bundleは約27.8 KB、入力4 moduleのみ。productionへの新Worker入力は0。

大履歴CPU、IPC copy、raw/catalog/訂正chain/ledgerの長期保持、heap/RSS/OOM、GC、低memory端末、
旧Long Task課題は未解消。安全検証の省略やtrust cacheによる最適化は行わない。

## 設計根拠と変更ファイル

既存DESIGN.md（指定されたローカル原本）の§3.2–3.5/§4.1–4.4/§5/§9を参照。
[Worker契約](attempt-controller-worker.md)、[rule2](attempt-identity-rule2-3c0a.md)、
[PR1](attempt-contracts-3c0b-pr1.md)、[PR2](attempt-legacy-preview-3c0b-pr2.md)、
[PR3](attempt-session-allocator-3c0b-pr3.md)とそのP1/P2/F03修正文書、
[PR4](attempt-persistent-authority-3c0b-pr4.md)と[F01/F02](attempt-persistent-authority-f01-f02-fix.md)、
YI-06の[persistence](planner-yi-06/persistence-contract.md)/[backup](planner-yi-06/backup-contract.md)/
[portable recovery](planner-yi-06/portable-recovery.md)を照合した。原本・親branch・監査証拠は変更しない。

| 変更ファイル | 理由 |
|---|---|
| worker/versionedRead.ts（追加） | 元recordの変換前検証と共通strict decoder/replayへのread-only接点 |
| worker/session.ts | 版別読取、操作snapshot束縛、全field/環境失効、read-only token |
| worker/workerInput.ts | 既存予約ceilingを新ruleのhistoryにも適用 |
| worker/contracts.ts / protocol.ts / client.ts | inspectAttemptRaw、必要最小DTO、閉じた版別検証 |
| worker/display.ts | 新形式の投影、表示rowから編集資格を出さない |
| worker/preview.worker.ts | 新raw frame受付、固定の入力診断。write opcodeなし |
| scripts/verify-readonly-worker-pr5-scope.mjs（追加） | 固定親差分・frozen境界・実bundle入力・test hook非混入 |
| tests/attempt-worker-versioned.test.mjs（追加） | 版/資格/失効/descriptor/環境/原文/DTO契約 |
| tests/attempt-worker-versioned.browser.mjs（追加） | 実Worker/IDB、全値oracle、8禁止API個別計数 |
| tests/attempt-worker-pr5-scope.test.mjs（追加） | 許可外・削除・rename/type・各layerの拒否 |
| tests/helpers/worker-versioned-{browser,fixture}.mjs（追加） | test-only native/oracleと凍結fixture再利用 |
| tests/attempt-controller-worker-session.test.mjs | 同一参照から独立frozen snapshotへの限定assertion変更 |
| 本文書（追加） | 実装前操作表・設計・実測・未保証範囲・再現手順 |

v22の既存live migrationは旧4-field hostまたは空DBへ限定する。
v2 hostではreadonly_modeを返し、v2 authorityを4-fieldへ削って旧controllerへ渡さない。
これは新しい移行保存資格を推測しないための未接続境界であり、v2 host自体の読取拒否ではない。

## 自己検証と初回失敗

検証環境はmacOS x64 / Node24.13.0 / Chrome156.0.8078.76 / Playwright1.62.1。
node unit/public API契約、実Chromium Dedicated Worker + native IndexedDB/Lock APIの観測、
test-only全値oracleを区別する。新規UIはなく、実UIの試験成功とは数えない。

新規契約は元record descriptorをclone前に拒否するREDと、旧Workerの正常v2拒否のREDを先に固定した。
その後、版別正常系、同revision全field変更と不可逆ABA、予約/checkpoint順序、取消/待機中snapshot、
providerの全5field変更/拒否/遅延/検証途中変更、資格コピー、closed DTO、rehash済み不正v4/R2不足を検証。
元recordの不正6種はnative IDBへ直接注入し、read-backで不正key/NaN/Infinity/invalid Date/boxed型を確認した。
通常session/handleを返さずUUID0、Worker書込0、revision1不変、不正値残存をassertする。
読込後の破損もstale_authorityで不可逆失効し、元へ戻しても資格が復活しない。

実Workerは異なる15テスト（13件runと追加焦点2件）を最終期待で確認する。
全schema/rule、v4、旧backup v1/v2/v3を旧/v2 hostで検証し、v1の空host拒否も維持する。
アーカイブ済みPR1 fixtureのrule2 state/Workspace/R2と全値・配列順を照合し、
同期の完全replayとの比較ではsource、訂正2段/訂正前assignment、H2/R2、環境も一致する。
製品RPCには全値取得を加えず、test-only bundleからだけ観測した。製品bundleのhook非混入も検査する。

禁止APIのreadwrite transaction、put、add、delete、clear、deleteDatabase、createObjectStore、
navigator.locks.requestは実Workerで各0。空DBではopenも0、DB/store作成0。
fixture seed/競合注入はmain側に別計上する（不正6件は各main put1、coverage ABAはmain put3）。
inspect/prepareSave/decoder結果とそのコピーから同期hostのID/編集/backup registryへ入れないことも検証。
Worker commitを試しに呼んで資格を検査する方法は使わない。

初回の新規拒否理由oracleはbackup_reservations_missingとissuance_history_missingを取り違えて訂正した。
未知版が旧controllerのbackup_shapeへ落ちる問題は版別dispatchへ直し、unsupported_backupを確認。
既存回帰の初回50/58では環境cloneが既存WeakSet資格を失いv22移行がrejectedとなった。
比較用snapshotと実decoder用environmentを分け、該当回帰と後続の編集/日付訂正を再検証した。
これらの失敗ログを保全し、最初からすべて成功したとは扱わない。

既存100+ receipt全値oracleのschema23は、元180秒timeoutに対して約204.25秒でtimeoutした。
制限・fixture・assertionは変更せず、後続backgroundを残さないよう当該親子processを停止した。
そのrunは2件の軽いcaseのみ完了し、後続schema24等の完走を主張しない。
代わりの小さい全8 Command試験はschema23/24で全final state/Workspace/source/予約の独立oracleを比較し、
両方成功（約24.53秒/7.56秒）。これは100件試験のPASSでも、大履歴性能の改善証明でもない。
既存の失敗batch/burn/取消/ABA/日付訂正2段/clone/ledgerの選択9件、実prestate/単一applyの選択2件、
入力/client/reader48件を元の期待・timeoutのまま検証する。

最終の異なる新規契約は28件（scope負試験1、両schema全8 Command2を含む）で成功。
新規native15、既存選択9＋2＋48＋3＝62件も成功。反復runを件数へ加算していない。
全src/devを含むtsc --noEmit、変更TS8ファイルのeslint、scope/bundle/差分checkを実施する。
既存session bridgeの正規clone、重複移行1回発行、cache後authority変更の3件も再確認した。
大きいschema23試験と性能測定は同時に走らせていない。

## 再現と利用者への引継ぎ

新しいPR5テストは既存npm scriptsに含まれない。次の直接コマンドを使う。
実native試験はローカルserverと新規Chromium profileで実行し、evidenceはrepo外へ指定する。

```sh
node --import tsx --test --test-concurrency=1 tests/attempt-worker-versioned.test.mjs tests/attempt-worker-pr5-scope.test.mjs
PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs CHROMIUM_PATH=/absolute/chromium PR5_EVIDENCE=/absolute/outside-repo node --import tsx --test --test-concurrency=1 tests/attempt-worker-versioned.browser.mjs
node scripts/verify-readonly-worker-pr5-scope.mjs
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/planner/attempts/persistence/worker/{session,versionedRead,protocol,contracts,client,display,preview.worker,workerInput}.ts
git diff --check
```

元の100+ receipt試験は変更せず残している。上記の小さい全8 Command試験と混同しない。
既存の焦点回帰コマンド：

```sh
node --import tsx --test --test-concurrency=1 --test-name-pattern='failed batch:|success retry|await cancel after dispatch|authority ABA during awaited edit|date proposal needs|two date corrections|portable unadopted|registry reference never|ledger retained' tests/attempt-controller-edits.test.mjs
BOUNDARY_EVIDENCE=/absolute/outside-repo node --import tsx --test --test-concurrency=1 --test-name-pattern='qualified factory hook|Worker applies each Command once' tests/attempt-identity-boundary.test.mjs
node --import tsx --test --test-concurrency=1 tests/attempt-controller-worker-input.test.mjs tests/attempt-controller-worker-client.test.mjs tests/attempt-controller-worker-reader.test.mjs
node --import tsx --test --test-concurrency=1 --test-name-pattern='read bridge|legacy duplicate request|cached migration' tests/attempt-controller-worker-session.test.mjs
```

以下は実在package script。全面lint/buildと広い回帰は今回未完走として利用者へ引き継ぐ。
typecheckは同等のtsc直接実行で確認済み。Worker/edits全面scriptには既知の重い100件試験を含む。
旧scope verifierや親sliceの「Worker byte不変」を子PR全体へ適用して合格とはしない。

```sh
npm run typecheck
npm run lint
npm run test:attempt-controller-worker
npm run test:attempt-controller-worker-browser
npm run test:attempt-controller-edits
npm run test:attempt-controller-edits-browser
npm run test:attempt-persistence
npm run test:attempt-replay
npm run test:migration
npm run build
```

Safari/Firefox/実機・実UI・低memory/長期session・実quota・巨大入力/全履歴の性能は未検証。
CI未起動/待機/Preview deploymentはテストPASSと数えない。prod保存形式/卒業engine/3D UIは変更しない。

独立監査の重点は、元record変換前拒否と予約import順、操作snapshotとA/B/ABA/取消の束縛、
旧R1有効性と新R2 heldの区別、coverage/native宣言/未採用と保存資格の分離、旧backup/v2 host、
環境sampleと実decoder資格の差、closed DTO/原文非流出、全8 API非書込、scopeの代替証明、
追加full replay/環境snapshot/保持コストと100件timeoutである。
自己検証成功をPR5独立監査PASSとは宣言せず、独立監査は今回起動しない。
後続3C write Workerは別資格発行・Lock/CAS/tx/unknownを別設計・別監査し、3B/PR5 tokenを昇格させない。
Draft/Open/未mergeのまま、保存RPC・write Worker・3D UIは後続へ分離する。

staged scopeの初回は正規の新規100644作成をmode変更と誤判定した。
許可された追加pathのcreate mode 100644だけを認め、symlink/実行mode/既存mode変更/許可外作成は
引き続き負試験で拒否するよう検査を訂正し、indexを含むscopeを再実行した。
