# PR #211 P1/P2修正（独立再監査待ち）

開始HEAD aa568efbef0dc0dbaea2459f6d3a4f6372992783、親#210 d965e08ee6eb9f4c4df529b00a808aca7321b9e2。
原報告：audit-pr211-aa568ef-independent-20261102-8YbuQO/REPORT.md、RUN.md。
原証拠は変更せず、再現コピーと新ログはimpl-3c0b-pr3/p1p2-fixへ分離した。

## P1

共有observedがread間で上書きされ、handleの追加replay後に別操作の予約を取り込んでいた。
共有変数を除去。readごとにstructuredCloneした不変recordを既存strict authority decoderで
全値検証し、そのreadの予約をownerへ単調追加してからcontrollerへ返す。await中の別readは
別snapshotを保持し、完了順で予約を置換しない。全操作の直列化や正常handleの拒否はしない。

取り込みは再使用禁止制約だけ。decoderのcontent-validatedを保存資格にしない。
controllerの正規handle/preview登録、source/environment検証、CAS/commitは従来どおり。
v2 authorityはこの旧controller接続で拒否する。検証済み制約は後段処理が失敗しても保守的に残す。
activeは同期mint内、checkingHandleは同期controller dispatch loop内だけで使用し、変更しない。
liveのhandle別WeakMapとticket scopeも維持する。

追加テストは実controllerの公開APIとdeferred store/digestを使用する。
A→B/B→Aで両host集合の全namespace再提示を拒否。A read開始→A digest gate→B完了→Bで発行→A完了でも
予約とburnを維持。一方の不正checkpoint拒否、clone handle拒否、load/backup inspect交錯とrecovery編集拒否も検証。
元監査I15/I21のコピーでは、欠陥を期待するoracleを「次のfresh候補を返す」へ反転してGREENを確認。
元のRED oracle/logも別名で残し、そのexit0を製品PASSとは解釈しない。

代償としてreadごとのstrict decoderによる追加full replayがある。性能最適化は混ぜておらず、
大履歴CPU/heapへの追加負担は残存リスク。既存性能課題の解消や全await順序の証明を主張しない。

## P2

旧draftにDOM編集値がなく、失敗時に古い値からassessment IDを再発行し、IDをkeyにした行の
remountでlabel/type/date/completedが初期化されていた。
assessment入力をcontrolled draftにし、UI行keyをID再発行から分離した（行は追加順、削除/並替えUIなし）。
失敗時はdraftの内容を保持して新規行だけ再発行する。submitがthrowした場合も同じ処理。
既存行IDは維持。operationは試行ごとに新規発行。古いIDはallocatorに残し、取消しても戻さない。

実Chromiumで原監査B05の不正日付反例をRED→GREEN確認。原B01–B08も実行した。
追加の直接component/identity owner試験では、複数新規行＋既存行、名前空欄、不正日付、false返却、
submit例外、再描画、修正→成功、全失敗IDのburn残存を検証。SSRを実ブラウザの代替とはしていない。
独立した全画面unmountやページ破棄後のdraft復元は追加していない。ID交換による行再描画では入力を保つ。

## 再現

```sh
node --import tsx --test --test-concurrency=1 tests/attempt-session-load-race.test.mjs tests/attempt-session-allocator.test.mjs
PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs CHROMIUM_PATH=/absolute/chromium node --import tsx --test tests/attempt-progress-draft.browser.mjs
npm run typecheck
npm run lint
git diff --check
```

Chromium testは通常のplaywright解決・標準browserをdefaultにし、環境変数で外部実行環境を指定可能。
初回は標準headless shell未インストールで起動失敗。既存Chromiumパス指定で再実行成功した。
新規製品UUID factory・RPC・保存資格APIは追加していない。

利用者へ引渡す全面回帰：

```sh
npm run test:attempt-ui
npm run test:attempt-persistence
npm run test:attempt-controller-worker
npm run test:attempt-controller-edits
npm run test:attempt-replay
npm run build
```

自己テスト成功は独立監査PASSではない。再監査はread検証中/後段失敗/多操作交錯、全namespace、
不正hostからの資格昇格拒否、DOM入力保持と失敗ID再発行、handle/Commandのscope、性能増分を重点とする。
controller/Worker/allocator/PR1/PR2/scope verifierを変更しない。authority v2、backup v4、write Worker、
全burn永続保存、3D UI、crash耐性は未接続のまま。Draftで独立再監査待ちとする。
