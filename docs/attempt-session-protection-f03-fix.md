# PR #211 F03/P2 原文保護の境界修正（独立再監査待ち）

開始HEAD: 699d7efe09b40765be6ddaf09116dc51d083e196。
親#210: d965e08ee6eb9f4c4df529b00a808aca7321b9e2。

## 原因と最小修正

P1修正のstrict store adapterを、救済用protectCurrentにも渡していた。
そのため、不正JSONの原文を保護する前にauthority decoderがrawを解釈して拒否した。

同期session内に、元store.readへ接続する独立したread-only controllerを作り、
そこから既存protectCurrent関数だけを取得する。公開wrapperのprotectCurrentのみ差し替える。
保護用adapterのcommitは常に拒否。保護用controllerのload/prepare/commitは公開しない。
既存controllerのraw型検査・format/version/currentRaw/SHA契約・例外伝播をそのまま再利用する。
資格、handle、preview、ID、予約を生成しない。原文やprimary/recoveryを修復・変更しない。

通常controllerのstrict adapter、readごとのsnapshotとdecoder、予約の単調unionはbyte不変。
共有boolean、検証の一時停止、予約の上書き/縮小/クリアは追加しない。
不正hostを救済出力できることと、hostが保存資格を持つことを区別する。

## 検証

新規tests/attempt-session-protection.test.mjsは12ケース。
正常raw、不正JSON、不正schema、null、非文字列3種、read例外、不正checkpoint、
protect/load両完了順、decoder待機中のprotect＋不正loadを検証する。
raw文字列とUTF-8 SHA-256（独立Node crypto oracle）、閉じた4 field envelope、書込0、ID発行0、
protectionのbackup読取拒否、load/prepare/偽commit資格拒否、原record不変をassertする。
並行protect後は全namespaceでhost tailを再提示し、正規handleの編集継続も確認する。

修正前はF03ケースでSyntaxErrorを再現。REDはimpl-3c0b-pr3/f03-fix/red.logに保全。
初回GREEN実行ではprotectionのbackup拒否は成立したが、新testの期待エラー名が誤っていた4件が失敗。
既存closed-shape検査の正確なbackup_shapeを期待するよう訂正し、新規12件を再実行した。
修正後の新規12件、既存並行load5件、PR3直接18件を同時suiteで実行する。
既存原文保護、不整合backup拒否、owner/TODO/Undoの限定3件も実行。
P2の製品・テストは無変更で、既存実Chromium入力保持/失敗burn回帰を再実行する。
npm run typecheck、npm run lint、git diff --checkを実行。
旧監査証拠には触れず、新ログはf03-fixへ分離する。

```sh
node --import tsx --test --test-concurrency=1 tests/attempt-session-protection.test.mjs tests/attempt-session-load-race.test.mjs tests/attempt-session-allocator.test.mjs
node --import tsx --test --test-name-pattern='corrupted current JSON|rehashed inconsistent state|owner/progress/evaluation/TODO' tests/attempt-persistence.test.mjs tests/attempt-new-plan.test.mjs
npm run typecheck
npm run lint
git diff --check
```

P2実ブラウザは既存手順のPLAYWRIGHT_MODULE/CHROMIUM_PATHを指定し、
node --import tsx --test tests/attempt-progress-draft.browser.mjsを実行する。

全面522件・native IDB競合/transaction・実機は未実行。利用者へ次を引き渡す。

```sh
npm run test:attempt-persistence
npm run test:attempt-ui
npm run test:attempt-controller-worker
npm run test:attempt-controller-edits
npm run test:attempt-replay
npm run build
```

通常readの追加full replayによる性能懸念は継続。今回検証緩和・性能最適化は行わない。
controller/Worker/PR1/PR2/scope verifierは変更しない。authority v2、backup v4、PR4保存、
新RPC/write Worker/3D UIは未接続のまま。
Astra High再監査は、救済読取と資格読取の分離、protect/load交錯、例外伝播、
rawバイトとdigest、書込/ID発行0、P1 unionとP2維持を重点とする。
自己検証成功を独立監査PASSとは宣言せず、Draft・未マージで停止する。
