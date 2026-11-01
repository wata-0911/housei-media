# 3C-0b PR1：版別の純粋な契約decoder

親はDraft PR #206、固定HEAD `9c0780b0884a582827fb0c3126a0937ab75770fa`。
設計根拠は既存3C-0詳細設計 `DESIGN.md` §4.1–4.4（2026-10-29、親81f9886基準）、
`attempt-identity-rule2-3c0a.md`、`attempt-controller-worker.md`、YI-06の保存・backup・可搬復旧契約。
詳細設計原本と凍結済み文書・コードは変更しない。

## 実装と境界

- `versionedContracts.ts`：旧型を置換せずauthority v2／backup v4／coverageと資格状態を追加。
- `contractDecoders.ts`：JSON原文入口。既存strict parserでdecoded duplicate key、unsafe integer、非有限、-0等を拒否。
  版・schema・rule ID/versionを明示dispatchし、既存rule1またはrule2の完全replayを行う。
- authority旧4 fieldは旧read契約を維持。v2はformat/version/coverageを含むclosed shape、rule2、checkpoint一致とR2完全収録を検査。
  ファイル内recordのcheckpoint照合は内部整合性の証明であり、信頼されたhost記録の読取ではない。
- backup v4はschema23/24 rule2、全予約とcoverageを必須とし、全bodyのcanonical SHA-256とR2を検証。
  v1/v2はschema23 rule1、v3はschema24 rule1。旧R1不足は拒否し、新R2不足だけで旧有効ファイルを壊れたデータと扱わない。
  v1のhost checkpoint要求を結果に残し、v2/v3/v4でも採用・保存は実行しない。
- 返却原文は入力文字列そのもの。値はfreezeし、replayで作ったsource/Workspaceやcontroller資格は返さない。
- controller、IDB、DB version、Worker RPC、通常保存・復元・exportは不変。新moduleはそれらからimportされていない。

## coverageと資格

ユーザー確認済みのPR1受理範囲：native-v2はbaseline=nullのみ。
legacy-unprovenはlowercase hex 64桁の元state canonical digest必須。
詳細設計の「nativeは通常null」に対する非nullの意味は未設計のため、このPRでは受理しない。

`assertCoverageContinuation`は純粋な制約検査。旧authority／legacyからnativeへの昇格、
legacy baselineの差替えを拒否する。移行・採用・保存は行わない。
複数legacy系統のbaseline合流は別設計とし、この関数による差替えを許可しない。

decoder結果は`verification=content-validated`かつ`saveAuthority=not-issued`。
状態は別のdiscriminantで区別する：

- 旧形式：explicit-migration-required
- coverageのないrule2 state単体：coverage-unestablished
- legacy coverage：legacy-unproven
- native coverageの宣言：native-v2-unadopted

将来のnative-v2-save-authorizedは非公開unique symbolを必須とする型のみ。
このPRに発行API・constructor・runtime token・資格WeakMap登録はない。
内容検証、rule2整合性、coverage宣言、host来歴の完全性、通常保存資格を同一視しない。

coverageをdigestの再計算なしで変更したファイルは拒否する。
内部整合性のある別のcoverageへ変更してdigestも再計算したファイルの発行者・過去来歴は認証できない。
その場合も内容検証までであり採用・通常保存資格にはならない。SHAは発行者認証ではない。

## テストと再現

```sh
node --import tsx --test --test-concurrency=1 tests/attempt-versioned-contracts.test.mjs
./node_modules/.bin/tsc --noEmit -p tests/types/tsconfig.contracts.json
```

`tests/fixtures/persistence-rule1-parent.json.gz`は、cleanな固定親checkoutから生成した
schema23/24の合成旧rule1 fixture。入れ子assessment Xが旧H1/R1に欠落する有効な旧データを含む。
元raw、canonical digest、全Workspace、R1全配列を保持する。
新decoderに合わせて期待値を再生成しない。固定親による再生成は次の明示コマンドのみ：

```sh
node --import tsx tests/helpers/make-rule1-parent-fixture.mjs /absolute/clean-parent-checkout /absolute/output.json.gz
```

generatorは親HEADとclean状態を検査し、親moduleだけをimportする。
固定乱数はtest-onlyの移行割当時のみ使用し、製品hookは追加しない。
`tests/types/versioned-contracts.ts`はdecoder結果／native宣言から保存資格を構成できないことのcompile-time負試験。

利用者へ引き渡す通常検証：

```sh
npm run typecheck
npm run lint
npm run test:attempt-persistence
npm run test:attempt-replay
npm run test:attempt-controller-worker
npm run test:attempt-controller-edits
npm run build
```

既存`verify-controller-worker-scope.mjs`は3C-0aの14パスだけを許す凍結scope契約なので変更しない。
PR1の追加パスをそこで無断許可せず、親HEADとの差分が本PRの新規契約・テスト・文書のみであることを別途照合する。
新moduleがmain/controller/preview Worker bundleへ混入しないことも契約テストで検査する。
Astra独立監査、native IDB、Safari実機、write Worker、移行実行、allocator注入は本PRの検証・完了主張に含めない。
