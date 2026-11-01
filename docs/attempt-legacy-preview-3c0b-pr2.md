# 3C-0b PR2：旧形式分析と明示rule1→2 preview

固定親：PR #208 / `b0930e2a1c941ea34069bcf39ece0553a1a13fc3`。
開始時にGitHubでopen/Draft/未mergeとHEAD一致を確認した。
設計根拠：既存3C-0詳細設計DESIGN.md §4.1–4.4、凍結済み
`attempt-identity-rule2-3c0a.md`、PR1 `attempt-contracts-3c0b-pr1.md`。
PR1独立監査PASSの範囲は契約層のみ。その保存接続未承認の境界も維持する。

## APIと判定

`legacyPreview.ts`だけを追加し、既存decoder/controller/encoder/通常loadは変更しない。

- `legacyReservationAnalysis(raw)`：schema23/24を元のrule1で全値replayしてから、独立した凍結H2/R2 foldへ渡す。
  旧整合性失敗は拒否。rule2分析失敗は旧破損にせず、`rule1-validated`のままheld。
- `legalLegacyNonUuid`：旧規則で合法だった非UUIDの原文字列・role・所在。
  初期sourceからの継承と旧Commandでの新導入を含む。
- `prohibitedIntroductions`：直前Workspaceに対する導入差分のうちrule2で禁止される形。
  初期sourceの非UUID継承はこの一覧に入れない。
- `migration-candidate`：H2/R2を完全検証済み。旧予約に不足していたR2も別表示。
- `held`：新規非UUID等の禁止導入、UUID/namespace衝突、またはrule2証拠不足をblockerとして返す。
  H2/R2はnull。回収可能なUUID参照制約だけを`recoverableRestrictions`に返す。
  これは発行履歴の証明ではない。衝突を制約のtail集約で解消したとは扱わない。
- 全成功分析に`legacy-host-history-completeness-unproven`を残す。
  存在しないrollback後payloadをSHAから回収できない。現存履歴を完全検証できてもnativeへ昇格しない。

`previewLegacyRule2Migration(raw)`は明示呼出し専用。heldではcandidate/digestを返さない。
成功時も候補は通常の凍結データであり、保存候補としてcontrollerに登録しない。

## 不変条件

DESIGN §4.4の例外は追加しない。変更許可は`rule.version:1→2`と
`history.issuedIds:H1→H2`の2箇所のみ。rule.idも保持する。
`compareLegacyMigration`はこの2値だけを元へ戻したcandidateと元stateを再帰的に全値比較し、
さらにrule2で全値replayし、最終Workspaceも元rule1と比較する。
全値一致の結果、明示差分before/after、old/new canonical digestを返す。

source原文と全訂正前source、原版/catalog、assignment/訂正履歴、graph/retained/ledger、
全commands/receipt/Undo、owner/assessment/TODO/数量/参照、非Attempt情報は比較対象に含まれる。
H1の未使用予約は凍結foldのassignment制約として維持する。
元JSON原文は文字列のまま返し、通常loadのrule/raw/digestには触れない。

coverageは常に`legacy-unproven`、baselineは実際にrule1 replayした元stateのcanonical SHA。
文字列空白のdigestではない。SHAは内容束縛であり発行者認証ではない。
`assertCoverageContinuation`成功は制約の通過のみ。commit許可ではない。
preview/analysisは常に`saveAuthority:not-issued`で、private資格やcontroller WeakMap登録を作らない。

## 副作用と対象外

IDB、Web Lock、保存RPC、Worker、allocatorを呼ばない。取消APIは不要で、結果を破棄するだけ。
IDを生成しないため、3C-0a session burnへの追加経路もない。
authority v2書込、backup v4 export/復元、通常保存資格の確定、write Worker、3D UIは実装しない。
PR2完了はPR4以降の保存接続完了を意味しない。

## 検証

直接契約テスト：

```sh
node --import tsx --test --test-concurrency=1 tests/attempt-legacy-preview.test.mjs tests/attempt-legacy-preview-evidence.test.mjs tests/attempt-versioned-contracts.test.mjs
./node_modules/.bin/tsc --noEmit -p tests/types/tsconfig.legacy-preview.json
```

旧PR1 fixtureは無変更。追加の`persistence-rule1-pr1-audit.json.gz`は、PR1独立監査で
凍結親`9c0780b…`のみから生成済みだった7入力をbyte単位でコピーしたもの。
SHA-256：`65fd1f273fd1cc77175ad47a24e9002cf0a6442b7a68110a6abc63688d9d0501`。
PR2で再生成していない。監査由来fixtureの再利用は今回の独立監査の代替ではない。

全面検証は利用者へ引渡し：

```sh
npm run typecheck
npm run lint
npm run test:attempt-persistence
npm run test:attempt-replay
npm run test:attempt-controller-worker
npm run test:attempt-controller-edits
npm run build
```

Astra High独立監査推奨：旧rule1互換と不正入力、held時の非修復/候補非発行、
全値比較とH2/R2順序・未使用予約・訂正前source、legacy baseline/資格分離、
cold importを含む永続化/Lock/RPCアクセス0、既存entryへの非混入。
実機IDB/ブラウザ競合・commit/CASは本PR未実装であり承認対象に含めない。
