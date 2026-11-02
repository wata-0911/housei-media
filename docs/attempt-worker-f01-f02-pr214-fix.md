# PR214 F-01/F-02 修正記録

開始 e88dbd65249b1e9108ffdba8d397613a53022eaa、固定親51ec5140038ef177f8581862cad22bdef064db95。
原監査: audit-pr214-e88dbd6-independent-20261102。REPORT/RUN/scripts/performance/SHA256SUMSを読取、109 hash一致。
新規fix-pr214-f01-f02-20261103へ隔離clone。原監査と親checkoutは変更しない。

## F-01 実装前の責務整理

旧controller.loadはstrict authority shape/予約、strict parse、checkpoint/H1収録、旧rule1 full replay、
source/訂正/数量/Workspace全値検証を既に実施する。PR5 bridgeが同じrecordをさらに完全replayしていた。
新形式ではPR1 decoderがfull replayするが、戻り値はstateだけでWorkspace/sourceを返さない。
旧APIの資格を変えないWorker内の整理を先に行い、共通codec/decoder/controllerは変更しない。

| 操作（修正前） | backend read | preflight/authority decode | full replayの重複 | 環境 |
|---|---|---|---|---|
| start | 1 | 1/1 | authority内1 | provider1、比較snapshot保持 |
| old open | 2 | 2/2 | authority2＋controller1 | 開始/公開前2、schema23既存比較もある |
| v2 open | 2 | 2/2＋state decode1 | authority2＋state1＋表示replay1 | 開始/表示環境/公開前 |
| inspectAttempt | 2 | 入力1＋host各read/2＋state1 | state decodeと表示、rule1分析も再生 | 開始/表示環境/公開前 |
| inspectBackup v4 | 2 | 入力1＋host各read/2＋backup1 | backup decodeと表示 | 同上 |
| pure prepareMigration | 2 | host各read/2＋candidate1 | PR2の保持検証に加え表示replay | 同上 |
| prepareSave | 2 | host各read/2＋candidate1 | host2、rule2はstate decodeと表示 | 開始/公開前 |
| rule1 edit | 3 | host各read/3＋candidate1 | host同一rawを3回再生、controller dispatch/encodeは別責務 | 開始/公開前 |

hostが空ならauthority decodeはあるがstate replayは0。leafとcallerの包含時間は足し算しない。
元recordのdescriptor/closed shape検査は全readでclone前。現状はその後のdecode完了後に予約import。
controller実objectとqueue/registryの確認、各await後のcurrent/guard、最後のpublishは別の必要な検査。

## Worker側だけの限定設計

- 各executeがprivateな操作identity/id/view/sourceとsnapshot状態を持つ。終了/failure/cancelで破棄する。
- 毎backend readでdescriptor/shape/全値を再確認し、初期authorityとの差異を不可逆失効する。
- その操作で完全検証済みの同一全snapshotだけ、再read時の重複preflight/decode/replayを省く。
  raw/revision/digest単独をキーにせず、coverage/版/全配列を含む全値比較を必須とする。
- old openだけは同じprivate controller.loadへ完全検証を委譲する。
  bridgeは変換前検査/preflight/authority比較を行い、予約importを留保する。
  実loadが成功した後、その実読取snapshotに操作内の完了証拠を付け、予約を取込む。
  callerのobject/flagから証拠を作るAPIはない。再readと公開前の失効/環境/取消確認は残す。
- 外部Attempt stateは既存strict preflightと版別の共通full replayへ一度渡す。
  decodeStateJsonはその同じreplayの結果からstateだけを取り出すwrapperなので、Workerでの
  decodeStateJson→同じrawの表示replayという重複を除く。弱い代替fold/validatorは作らない。
- backup decoder/PR2内部など、凍結APIがWorkspaceを返さないため残る再生は明記する。
  必要な環境取得・全値比較、旧controllerの資格/ID発行/単一apply、外部decoderは変更しない。
- 操作を跨ぐcache、request ledgerへの検証証拠保存、保存資格への昇格は行わない。

## 同一入力の実測

small24 raw SHA256 `e588de77e028d59ade3d04e4dd3d390b344a216f6376839caaa4135c0d358777`、3025 bytes。
原監査benchは入力をruntime生成しrawを保存していなかったため、原監査と同一byteとは主張しない。
今回は修正前の正規generatorで一度生成し、authority/state/Workspace/environmentとhashをrepo外へ固定した。
Node24.13.0/macOS x64、同一依存symlink、1 warmup/各5測定、A/B/CとC/B/Aを交互、直列実行。
以下は中央値（min–max）であり、全生値・実行順はbench JSON/logに保存。

|revision|wall ms|CPU ms|start ms|open ms|read/provider|
|---|---|---|---|---|---|
|A 固定親|139.05 (130.95–156.55)|136.46 (130.69–167.51)|0.90 (0.80–1.95)|137.72 (130.06–154.59)|2/1|
|B 修正前|866.29 (833.13–915.84)|885.40 (862.32–1067.61)|261.14 (244.52–270.55)|615.15 (571.98–660.73)|3/3|
|C 修正後|603.17 (521.60–644.94)|627.71 (543.95–651.37)|265.86 (200.96–286.06)|323.71 (308.23–379.07)|3/3|

長履歴固定入力は各100 receipts。warmupなし、A→B→Cを各1回のみ。正常データ全件を使い、run毎のUUID再生成はしない。
通常の元100件testとは別の同一入力比較で、fixture生成/対照oracleの時間を含まない。

|入力|raw SHA256|A wall/CPU 秒|B wall/CPU 秒|C wall/CPU 秒|
|---|---|---|---|---|
|long23|`e7fa9ea4a1f15b65ef5ac7e11f3289092d1af09b89e282eefb4cb65385b34474`|12.535/12.619|71.743/68.992|37.617/36.104|
|long24|`7d7741ce19f5cad702e0bfab25679a4754a295bfae9331300a73afd2f5405674`|3.247/3.415|22.201/19.906|9.462/9.774|

小規模のwallはB→Cで約30%減ったが、Cは親より約4.34倍遅い。開始時の完全検証を保持したまま、
openのfull replayは3→1、prepareSaveは2→1、rule1 editは3→1へ削減した。
親が行わなかったstartの完全replay、操作を跨いで再生する検証、環境snapshot/全値比較、各readのdescriptor検査が残る。
backup v4 decoderはWorkspaceを返さないため、decoder内replay＋表示用replayの2回は残る。PR2内部の保持証明も残す。
この残余コストを無条件に受入済みとはせず、性能の最終受入は独立再監査へ委ねる。
計測の包含時間（decode内のreplay等）を足して総時間とはしていない。heap/RSSはcheckpointだけで、peak/leak証明ではない。
他の本作業の重いtest/benchmarkとは重ねず、他利用者processは停止していない。背景OS負荷の完全統制はない。

## 元の100 receipts通常試験

元tests/attempt-controller-worker-session.test.mjs、fixture generator/期待/assertion/180000msは無変更。
正のtest-name-patternでschema23/24の2件だけを選択し、test-only instrumentationなしで実行。
schema23 PASS 58.570秒、schema24 PASS 16.042秒。Node全体77.978秒、外部time real78.86/user72.75/sys3.96秒。
timeout/cancelledは0、同runに未実行後続caseなし（他のcaseは意図的に非選択）。
修正前の原監査通常runはschema23 timeout検知190.045秒。今回その既知timeoutを無意味に再反復せず、
新しい同一rawのA/B/C比較と元通常testのC完走を分けて確認した。診断runの完走へ置き換えていない。

## F-02 診断接続

blocker.kindのみを3つの固定code/message/pathへ写像する。内部code/stack/原文/無制限文字列を表示へ渡さない。
Diagnostic型にはseverity fieldがないため既存typeを拡張せず、そのclosed表示契約を維持する。
countとpagesは同じdiagnostics配列を使い、既存の初期offset0 cursorと50行ページ規則へ接続する。
元反例はheld/count1/page0でRED、修正後はheld/count1/total1/理由1件、移行tokenなし。
0/1/3/51/103件、順序、ページ跨ぎ、同request再送、消費済みcursor/stale view、長い非ASCII原因の非流出を検証する。
原raw/stateとheld/H2/R2/保存資格の意味は変えない。


## 操作別の実測検証回数

schema24、host有無をprofile脚本で固定。包含msは各logに保存するが、表は回数のみ。
|版|操作|read/provider|preflight|authority/state/backup decode|rule1 leaf/rule2 leaf|
|---|---|---|---|---|---|
|B|startSession|1/1|1|1/0/0|1/0|
|B|openCommitted|2/2|2|2/0/0|3/0|
|B|prepareSave|2/2|3|2/0/0|2/0|
|C|startSession|1/1|1|1/0/0|1/0|
|C|openCommitted|2/2|1|0/0/0|1/0|
|C|prepareSave|2/2|2|1/0/0|1/0|
|B|inspectAttemptRaw-rule1|2/2|1|2/1/0|3/0|
|B|prepareMigration-rule2|2/2|1|2/0/0|2/3|
|B|prepareSave-rule2|2/2|0|2/1/0|0/2|
|B|inspectBackupRaw-v4|2/2|1|2/0/1|0/2|
|B|prepareEdits-rule1|3/2|4|3/0/0|3/0|
|C|inspectAttemptRaw-rule1|2/2|1|1/0/0|2/0|
|C|prepareMigration-rule2|2/2|1|1/0/0|2/3|
|C|prepareSave-rule2|2/2|1|1/0/0|0/1|
|C|inspectBackupRaw-v4|2/2|1|1/0/1|0/2|
|C|prepareEdits-rule1|3/2|2|1/0/0|1/0|

v2 openは静的call graphでhost decoder/replay2＋state decode/replay1＋表示1から、host decoder/replay1＋表示1へ整理。
入力/coverage/checkpoint/R2の共通authority検証を省略せず、Workspace非公開の凍結APIに由来する残余2再生は維持する。
予約はfull検証完了後のみ取込む。legacy loadではcontroller完了まで取込まず、各await後のcurrent/guardと
最後のauthority再read/環境sampleが通った後だけtokenをmintする。観測済み失効とcancel/closeでは公開しない。

## 変更・凍結境界と自己検証

変更はworker/session.ts、versionedRead.ts、display.ts、新diagnostics.tsと、追加の診断/操作scope回帰、
そのtest-only helper、PR5 scope許可path/試験hook混入拒否、本文書に限定する。
共通codec、PR1 decoder、PR2 analyzer、旧controller、allocator/ticket、IDB reader/writer/CAS、
同期保存/F03救済、queue/registry/editBridge、production/v22/卒業engineは親blobのまま。
凍結APIの変更は不要だった。過去の独立監査PASSやPR5 BLOCKED判定を自己判定で更新しない。

- 新規直接19件：診断8、操作証拠/失効/取消/単一replay等11。複数診断の期待code列は独立した固定列を使う。
- 既存versioned27、入力/client/reader48、編集/burn/日付/clone9、実prestate/単一apply2、元100件2を確認。
- scopeの既存負試験1と、全src/dev tsc --noEmit、変更worker TS4ファイルeslint、diff checkを確認。
- 実Chromium Worker16件（既存15＋F02実表示1）。schema23/24/訂正2段/old rule1/rule2/backup1–4の全値oracle、
  元IDB record異常6種、read後破損/ABA、token非昇格、open/create0、禁止API8種類各0を確認。
  mainのfixture seed/競合注入putは別計数。WorkerにLock依存やwrite/export/adopt RPCは加えない。

再利用の新証拠は操作closureだけにあり、RPCから渡せるvalidated flagではない。
各backend結果の変換前検査とauthority全値照合を必須とし、変化時は旧結果を使わず失効する。
異なる操作では再生し直し、同request ledger joinだけが既存結果を返す。操作終了/取消/失敗で証拠を捨てる。
full replayの後段で変更/取消した場合、provider pending中cancel/closeでも公開せず、通常の後続操作は新しく検証する。
旧rule1の隔離編集と新legacy/native宣言の保存資格を混同しない。canCommit=falseは全経路で維持する。

## 初回失敗と原監査の保全

元held再現は入力/import先だけ変更した専用コピーで実行し、期待assertionの0≠1をREDとして保存した。
原監査109 SHA256SUMS対象とREPORT/RUN/コード/生値を作業前後で照合する。原監査checkoutでは実行しない。
元benchのsmall原文は保存されていなかったため、同等generatorから一度作った入力をA/B/Cへ共通に渡す。
入力3件とenvironment、generator、全raw/authority byte hash、全測定生値はrepo外inputs/evidenceに保存する。

初回の計測adapterに未定義openMsがあり、測定出力前に失敗した。失敗logを保存し、修正後の1 warmup/5標本を採用。
新readState helperを同期関数として書いた段階で、rejects検査と同期throwが食い違った1件が失敗した。
async入口へ揃えて再試験した。full replay/拒否を省いて成功させたものではない。

既存controller-edit-probeはrepo内に一時bundleを作るため、そのままは実行しない。
repo外adapterが出力先だけを専用evidence配下へ変え、元fixtureのimport.meta.urlを維持して相対data参照を保存する。
元test本文・assertion・generator・timeout・skipは無変更。adapter本体/diff/元helper SHAを保存する。
初回adapterは外部ESMのajv拡張子解決、その後は内側bundleのfixture相対pathで失敗し、修正した別runを保存した。
これらを製品安全性のREDやPASSへ算入しない。最終の既存27/48/9/2は各期待で成功している。
新helperは既定でOS tempへ、PR214_TEST_OUTPUT指定時は指定repo外ディレクトリへbundleを出す。
巨大fixture/生log/profile/bundle/node_modulesはcommitしない。

## 実行コマンド（本作業checkout）

以下の../inputs、../adapters、../evidenceは、この作業専用repo外成果物として引き渡す。
新規testは既存npm scriptには含まれない。重い機能試験とbenchmarkは重ねない。

```sh
PR214_TEST_OUTPUT=/absolute/repo-outside node --import tsx --test --test-concurrency=1 tests/attempt-worker-held-diagnostics.test.mjs tests/attempt-worker-operation-validation.test.mjs
node --import tsx --test --test-concurrency=1 --test-name-pattern='schema23 load and prepareSave|schema24 load and prepareSave' tests/attempt-controller-worker-session.test.mjs
PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs CHROMIUM_PATH=/absolute/chromium PR5_EVIDENCE=/absolute/repo-outside node --import tsx --test --test-concurrency=1 tests/attempt-worker-versioned.browser.mjs tests/attempt-worker-held-diagnostics.browser.mjs
node ../adapters/run-test-outside.mjs tests/attempt-worker-versioned.test.mjs
node ../adapters/run-test-outside.mjs tests/attempt-controller-edits.test.mjs --test-name-pattern='failed batch:|success retry|await cancel after dispatch|authority ABA during awaited edit|date proposal needs|two date corrections|portable unadopted|registry reference never|ledger retained'
KINDS=parent,before,repo node --import tsx ../adapters/bench-fixed.mjs
FIXTURE=long23 KINDS=parent,before,repo node --import tsx ../adapters/bench-fixed.mjs
FIXTURE=long24 KINDS=parent,before,repo node --import tsx ../adapters/bench-fixed.mjs
node scripts/verify-readonly-worker-pr5-scope.mjs
node --import tsx --test tests/attempt-worker-pr5-scope.test.mjs
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src/planner/attempts/persistence/worker/{session,versionedRead,display,diagnostics}.ts
git diff --check
```

## 残余リスクと独立再監査への引継ぎ

小規模は依然親より遅く、環境保持/比較、startの完全検証、各操作のfull replayコストは残る。
n=5の小規模とn=1の固定長履歴から、大履歴/長期session/heap/RSS/GC/OOM/実機全般へ一般化しない。
全面lint/build/domain/replay/migration、Safari/Firefox/mobile、実UI、実ディスクquotaは今回未実行。
必要に応じ既存npm run lint/build/test:attempt-persistence/test:attempt-replay/test:migrationを別途実行する。
旧Worker/edits全面scriptはrepo内出力helperを含むので、次回もadapterでrepo外化を先に確認する。

原監査の独立導入tape/H2R2 oracle新規構築、高リスクな環境・取消・後段失敗交錯の網羅不足、
完全同一長履歴親対照不足、repo外手順逸脱は、新たな確定製品バグとは扱わない。
本作業の同一入力比較と自己回帰で、それらの「独立監査不足を解消した」と数えない。
別監査担当が、証拠発行/利用の全境界、型/descriptor変異、初回/最終sample、真のCommand導入tape、
複数session/contextと高リスク交錯、残余性能と通常長履歴、repo外実行手順を独立に補う必要がある。

自己検証をPR5独立監査PASSとは宣言しない。今回独立監査を起動せず、Draft/Open/未mergeで止める。
write Worker/保存RPC/portable採用確定/実export/3D UI/production形式切替は追加しない。
