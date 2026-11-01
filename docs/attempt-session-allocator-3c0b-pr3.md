# 3C-0b PR3 発行経路と接続範囲（実装前記録）

親#210 / d965e08ee6eb9f4c4df529b00a808aca7321b9e2。開始前GitHubでDraft/Open/未merge/HEAD一致。
根拠：DESIGN §3.2–3.5、凍結3C-0a、PR1/PR2設計対応文書。

| 経路 | 種類/namespace・現在の発行元 | 保存可能性 | session所有者・変更 |
| --- | --- | --- | --- |
| newOperationId | attempt-op / direct crypto | 保存UI・旧純constructor両方 | 保存UIはsession facadeへ。旧helperは互換専用として保持 |
| newRecordId | owned / direct crypto | 同上 | 同上 |
| newAttemptIds | attempt + attempt-op / direct crypto | 同上 | 同上 |
| catalogView.makeAttempt | defaultは上記helper | 保存UI/Worker/純constructor | 保存経路は必ず明示ID。資格済みhookで無追跡IDを拒否 |
| searchBridge.makeSearchAttempt | 同上 | 同上 | 同上（既存identity更新は元ID保持） |
| AttemptForm | mountでAttempt/op生成 | dev/persistenceから保存可能 | Workbenchと同じfacade。lazy mount発行、取消後も保持 |
| Workbench | remove/Undo/add_record op | seed+dispatchなら保存可能 | 保存session必須、standaloneは独自メモリsession |
| progressDefaults | owned / old helper | 保存UIが呼ぶ | facade必須引数、fallbackなし |
| ProgressEditor | assessment bare UUID/op | 保存UIが呼ぶ | 追加ボタンで即burn、submit不要 |
| TodoPanel | TODO bare UUID/owned/op | 保存UIが呼ぶ | 全て同じfacade、別フォームと共有 |
| prepareMigrationIds | attempt/op/owned / direct crypto+sink | 同期controller/Workerで保存候補生成 | 共通allocatorで形式/衝突確認後sink、WeakSet維持 |
| migrationWorkbench | 上記移行helper | standaloneは非保存、controllerとは別 | 失敗を含め同期sinkでpage sessionに保持 |
| Worker buildEdits | 全種 / EditIds extends共通allocator | previewのみ、将来保存接続 | 接続済み。private登録/実prestate hook/単一applyは無変更 |
| v22 production/grade import | source identity | 旧別機能 | 3D対象。変更・改名なし |

全保存UIのownerは新規syncSession factory。既存controllerが発行したhandleだけを登録し、
handleのsource/catalog/state/全訂正前source/assignment、host予約、session burn、最新Workspaceを
発行前snapshotへ収録。同期sink先は同ownerのprivate ticket台帳。
移行はcontroller既存sink→owner allocator.restrict。controllerの予約snapshotとWeakSetを維持。
standalone Workbenchは非保存だが同じfacadeを使い、snapshotは最新Workspace/context。
全経路で取消/失敗/Undoにburnを削除する操作なし。意図的な作成以外のrenderでは発行しない。

変更予定：新規syncSessionとworkbench identity facade、dev/attemptsの上記5ファイル、
dev/persistence/PersistencePage、migration/assignments、workbench/migrationSession、直接契約テスト/限定型設定。
controller.ts/sessionIds.ts/commandIdentities.ts/identityFold.ts/Workerコード/旧codec/PR1/PR2は無変更。
scope verifierの許可表やbaseline hashは変更しない。凍結scopeとは別に親との差分と
上記不変ファイルのbyte一致、既存Worker契約を代替検証する。

PR3保証は生存session同期burnのみ。全burnのauthority書込、R2 union、v2/v4、CAS、
IDB原子性、crash永続化はPR4以降。新しい保存RPC/write Worker/3D UIは追加しない。

## 実装結果と資格境界

- `workbench/sessionIdentities.ts`：UI用のoperation/Attempt/owned/TODO/assessment別facade。
  UUID取得・形式/衝突確認・allocator内部burnの後、呼出元へ返す前にprivate ticketを記録する。
  ticketはcanonical ID、role、発行前snapshot、正規handle、最初のCommand object/全payloadへ束縛。
  同じCommandのcontroller preview再実行は許可し、コピー・異payload・別handleの導入は拒否。
- `persistence/syncSession.ts`：既存controllerを内包するtrustedな同期UI owner。
  controller自身が発行したhandleだけを登録し、完全replayによる旧R1/source全epochとhost予約を制約へ追加する。
  facadeへUUID factoryや予約引数を公開しない。private hookは実prestateのidentity検査のみ。
  graph適用は既存controllerの一箇所のまま。通常controllerの保存/復元/export/資格規則は変更しない。
- 移行helperは同じallocatorクラスを使用する局所発行batch。controllerの既存即時sinkを通じて
  同期UI ownerまたはWorker EditIdsのsession poolへ返却前に反映する。局所allocatorとownerは
  同一objectではないが、発行前のsession snapshotと返却前の同期通知で同じ禁止集合を共有する。
  sink例外後もcontroller自身の既存sessionIssuedIdsが保持される。table WeakSetの登録条件は不変。
- Workbenchの全子フォームへ同じfacadeを明示注入。dispatch付きWorkbenchにfacadeがなければ拒否。
  progressDefaultsのowned発行にdefaultなし。pure makeAttempt/searchBridgeの旧defaultは維持するが、
  そこから生成した無追跡IDは保存UI ownerのprivate hookが拒否する。
- Formはlazy mountで発行。編集mountでは既存Attempt identityを使用し、編集opだけを発行する。
  失敗後の意図的な再試行では新IDを発行し、失敗したIDは残す。既存assessmentの更新/再順序化は
  nested identityを発行しない。operationは編集要求自体の新規発行として別にburnする。

全入口の網羅は`src/`と`dev/`のrandomUUID/new*Id/makeAttempt/makeSearchAttempt/prepareMigrationIdsの
全callsite検索と逆方向のimport照合に基づく。保存UIの呼出元はPersistencePageの一箇所。
対象外のdirect cryptoは旧v22のPlannerPage、MediaSchoolingProgress、GraduationProfileSettings、
gradeImportApplyのみ（既存source側のidentity）。WorkerにはfactoryやUUIDを送る新APIはない。

## scope保護への対応

変更は既存9ファイル＋追加6ファイル。上表の実装8ファイルに、`tests/migration.test.mjs`の
旧「衝突1回で拒否」を「128回で終了・occupied通知0」へ置き換える限定変更を加えた。
これは発行契約の明示変更を検証するもので、scope保護の許可拡大・hash更新・skipではない。
凍結3C-0a scope verifierは過去の固定変更一覧を検証するため、今回stack全体への合格を主張しない。
そのファイル自体、controller baseline、Worker、sessionIds、commandIdentities、identityFold、
PR1/PR2 decoderは無変更。新test case17が親objectとのbyte一致とproduction非混入を検証する。
既存のqualified hook実prestate/単一apply/Worker失敗burn/複製handle拒否は選択実行で確認する。

## 自己検証と利用者向け再現

直接test：18 PASS（14要件を個別ケース化し、role/Command/handle束縛と実form mountを追加）。
選択既存test：Worker/資格7ケース、PR1/PR2互換・資格6ケース、移行2ケースが期待結果一致。
限定tsc（dev保存UI全依存＋型負試験）と変更TS/TSX限定eslint、diff checkを実行。

初回直接testは13 PASS/1 FAIL。testが128を超える占有列の後に成功を期待していたため、
source/catalog/assignment/hostを各1例に直した。上限自体は別case10で128回を検証。
Worker境界testの初回起動で必須BOUNDARY_EVIDENCE未指定を検出し、repo外指定で2ケース再実行成功。
初回限定tscはVite型定義がincludeに欠けていたため修正。初回lintのrender中ref捕捉警告は、
memory ownerをイベント時に更新するclosureへ変更して解消。これらを独立監査PASSとは数えない。

```sh
node --import tsx --test --test-concurrency=1 tests/attempt-session-allocator.test.mjs
./node_modules/.bin/tsc --noEmit -p tests/types/tsconfig.session-allocator.json
node --import tsx --test --test-concurrency=1 --test-name-pattern='allocator bounds source-collision|external occupied' tests/migration.test.mjs
```

既存qualified hookの選択検証はrepo外ディレクトリを指定する：

```sh
mkdir -p /tmp/housei-pr3-boundary
BOUNDARY_EVIDENCE=/tmp/housei-pr3-boundary node --import tsx --test --test-concurrency=1 --test-name-pattern='qualified factory hook|Worker applies each Command once' tests/attempt-identity-boundary.test.mjs
```

広範検証は利用者へ引渡し：

```sh
npm run typecheck
npm run lint
npm run test:attempt-persistence
npm run test:attempt-controller-worker
npm run test:attempt-controller-edits
npm run test:attempt-ui
node --import tsx --test --test-concurrency=1 tests/migration.test.mjs tests/attempt-versioned-contracts.test.mjs tests/attempt-legacy-preview.test.mjs tests/attempt-legacy-preview-evidence.test.mjs
npm run build
```

実ブラウザ入力・再描画/React StrictMode・IDB/Lock競合・巨大履歴性能・crash復旧は未検証。
Node契約とSSR mountはブラウザE2Eではない。ticketごとに発行前snapshotを保持するため、
長時間sessionのheap/CPUは独立した負荷検証が必要。既存full replay性能課題の解消は主張しない。

Astra Highは別途、未submitで全種発行→取消→同tail再試行、source/namespace/旧assignment衝突、
factory/sink/dispatch中途例外、別handle/偽facade/複製Command/default helper、既存行再順序化、
移行と複数フォームの交互操作、実UIの失敗再試行、Workerの1回apply/資格境界を重点監査する。
通常保存のauthority v2/R2/CAS/backup v4接続はPR4以降であり、このPRの完了条件ではない。
