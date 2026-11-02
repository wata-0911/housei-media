# 3C-0b PR4 永続保存接続

## 実装前照合（2026-11-02 JST）

開始HEAD: `cd4a6a4a331eb13d624b30fe7c9481e636856aba`。
その直接parent: `699d7efe09b40765be6ddaf09116dc51d083e196`。
作業branch: `feature/3c0b-pr4-persistent-authority-v2`。
PR base: `feature/attempt-3c0b-session-allocator-pr3`。
GitHubで#211/#210/#208/#206の指定HEAD、Draft/Open/未mergeを確認。
既存checkoutには未追跡3ファイルがあるため使用せず、新規cloneはcleanな固定HEADから開始。

詳細設計はrepositoryには存在せず、作業環境の
`design-reports/3c0-nested-uuid-81f9886-20261029/DESIGN.md` に実在。
SHA-256: `237f8d70507a20dc78afe799b7bbfac2a93be4e4735b1a141b29601d9a28d90e`。
#210監査の `references/DESIGN.md` とbyte digest一致。§3.2–3.5、§4.1–4.4、§5、§9を照合。
PR1/2/3、P1/P2、F03文書、YI-06 persistence/backup/portable-recovery、および指定主要コードを照合した。

| 論点 | 既存保証 | PR4で接続する機能 | 変更禁止境界 |
|---|---|---|---|
| Rule2 replay | H2/R2全値検証 | host読取・保存・export/restoreを同じcodecで検証 | 純粋foldの意味・順序変更禁止 |
| Session allocator | 生存session同期burn、private ticket | ownerの全予約とhost/R2のunion | UUID→検査→burn→ticket→返却、scope維持 |
| Authority v2 | strict純粋decoder、資格なし | 専用同期controllerのprivate handle/previewとhost再読込 | content validationと資格を分離 |
| Legacy preview | rule1検証後read-only candidate、2 fieldのみ差分 | source/全host snapshotに束縛した明示migration commit | 自動昇格禁止、held拒否、通常編集資格なし |
| Backup v4 | closed shape/digest/全値replay | 確定state export、inspect、選択ファイル確認後restore | SHAを発行者認証・host証跡と扱わない |
| IDB | DB v1、共通Lock、旧4 field CAS、同record一回put | record全field CAS、Lock内strict再読取、v2一回put | store/DB version/旧形式/原子性を破壊しない |

## 実装を開始する前に固定した判断

- 専用 `persistentSession.ts` を追加する。既存rule1 controller/syncSession/Workerは変更しない。
  PR3のidentity ownerを使用し、本人の実handle・最新Workspace・Command ticketへ束縛する。
  callerのcoverage/UUID/予約配列を受ける通常保存APIを設けない。
- 新規空hostからのnew-planだけnativeを開始できる。既存legacyをnew-planで洗浄しない。
  nativeの明示初期化も既存予約/checkpointを保持する。
- legacy→rule2の明示保存は許すがcoverageは元state canonical digestに固定。
  DESIGN §4.2/§9に従いlegacy-unprovenから通常編集保存資格を出さない。
  過去履歴の完全回復、legacy baseline合流・native昇格は未設計のためブロックする。
- portable v4は完全検証＋ファイル全文固有の保護/採用確認後のみ新hostのcheckpointになる。
  ファイルのnative宣言はissuer認証ではない。legacy→native/別baselineは純粋継続制約で拒否。
  旧v1/v2/v3は旧decoder/controllerによる読取・復元を維持し、PR4では移行分析を表示する。
  旧backupからrule2への直接adoptionは旧履歴資格を拡張するため接続しない。
- DB versionは1のまま。record形状だけ拡張する。新DB/key/journalや先行予約書込を追加しない。
  schema生成と初回putは既存同一versionchange transaction。失敗補償writeなし。
  CASはkey集合・raw/revision/committed/issuedIds/format/authorityVersion/coverage全値を比較する。
- commitはLock取得後にstrict readとsnapshot比較、再検証、atomic store CAS、一回put、commit完了、
  同じLock内で正規strict再読込まで待つ。書込後の読取失敗は成功を返さず `commit_outcome_unknown`。
  自動再送/rollbackなし。UIは明示reloadを案内する。
- protectCurrentは元storeのrawだけ読む独立救済経路。strict decoder、予約import、UUID発行を通さない。
- 開発UIは既存 `YI06_PERSISTENCE=1` のみ。production/3D/新write RPCへ接続しない。

以降に変更・RED/GREEN・ブラウザ・性能・未検証と引継ぎを追記する。

## 最終の実装境界
+
+資格を発行するのは `createPersistentAttemptSession` の内部registryだけ。
+strict host readを経た実handle、同じcontrollerのpreview/inspection、実WorkspaceをWeakMapへ束縛する。
+backup decoderの結果はinspectionへ構造代入できない型brandも持ち、runtimeではWeakMap照合が必須。
+新規nativeの編集はPR3 ownerの同期ticket（role、handle、Command objectとpayload）を照合する。
+コピーCommand/handle/preview/inspection、default constructor、caller UUIDの導入を拒否。
+
+成功する全保存で `Pnext = host P ∪ R2 ∪ adopted reservations ∪ owner全予約`。
+R2は全source・訂正前source・catalog・assignment・receipt・構造化参照を既存foldが検証する。
+hostとR2のcanonical別名衝突は黙ってtail集約しない。取消/失敗/未submit/Undo後のburnも保持する。
+128件＋次handle16件の未submit IDを成功保存し、別session再読込後のnamespace再使用拒否を検証。
+未保存burnのcrash永続化・別sessionへの自動共有・journalは追加していない。
+
+legacyの元stateはrule1で検証後、既存PR2 previewでrule2へ全値replayする。
+元のrule versionとhistory.issuedIds以外は完全保持。訂正2段を含む固定監査fixtureと全state/Workspaceを比較。
+host raw/revision/checkpoints/P/版/coverage全snapshotを確認時に再検証し、元rawのpreviewを再計算。
+成功した明示migrationのbaselineは元state canonical digest。通常編集・native新規開始を拒否する。
+held/nonUUID新規導入/namespace衝突は原文を保持し書込0、UUID発行0。
+
+v4 exportはhostの既存checkpointに載る確定stateのみ。現在hostのPとcoverageを再取得し、
+全bodyをseal後、元strict decoderでも再検証する。古いloaded handleでのexportも現host予約を落とさない。
+inspectはstrict JSON/全body digest/版/closed shape/source/catalog/assignment/receipt/全field replay/R2/coverage/
+host衝突を確認するが、編集handleや保存資格は発行しない。
+restore previewも編集不可。選択原文全文の保護・raw digestに束縛した採用確認の両方が必須。
+commitでファイルを再decode、置換対象を再確認し一回put、正規再読込後だけ新host checkpointになる。
+外部native宣言の過去発行者を認証しない。採用前のhost外履歴に暗号学的証明を与えない。
+legacy→nativeと別baselineへの差替えは、再hashしたファイルでも拒否する。
+
+旧backup v1/v2/v3の読取はstrict旧rule1で維持。v1はhost checkpointなしでは拒否。
+旧形式の実復元は既存rule1 controller/隔離画面を維持する。
+PR4への旧backup直接adoption、legacyの通常編集保存、baseline合流/native昇格は未接続の明示ブロッカー。
+旧ファイルの現存H2/R2だけで、消えた過去host履歴の完全性を証明できないためである。
+
+indexedDb.tsの変更は比較関数の置換だけ（import1行＋旧4 field比較から全record比較へ）。
+共通Lock名、DB v1、store/current、inventory reader、put数、transaction完了条件、失敗時無補償は維持。
+未知DB版2をreadで拒否し版を変更しないこともnative試験で確認。
+全field CASはobject key順を問わず全キー集合と全値を比較し、array順は比較対象。
+write前Lock内readとstore transaction内CASは両方行い、待機中の変更も拒否する。
+
+原文救済はstore.readのraw型検査と既存4 field protection envelopeだけ。
+strict readと独立してUTF-8原文を保持し、Node cryptoの独立SHA oracleと照合。
+不正raw保護から保存資格を作らない。二つのstrict readと救済を両完了順で交錯しても予約を単調保持。
+通常backupへのprotection誤投入は拒否する。
+
+## 検証記録と限界
+
+新規Node契約は11種類を各最終期待で確認した（複数の狙い撃ちrunの異なるcase数、反復加算なし）。
+authority/資格、burn/R2/rollback、両schema migration、全field stale/失敗retry/結果不明、v4、F03、
+held/訂正/baseline、旧backup、ticket/累積burn、並行救済、凍結/production/Worker境界を含む。
+schema23の複数full replayが必要な訂正fixtureケースは約112秒。小規模testの速さを一般化しない。
+既存PR3直接18＋load race5＋protection12＝35 PASS。
+既存旧rule1/backup3・v1 host-only・コピー資格・Lock staleの選択4ケースもPASS。
+型負試験を含む限定tsc、変更TS/TSXのeslint、diff checkを確認する。
+
+REDはPR3旧factoryに対する有効v2 load拒否、取消burnの永続欠落、旧export version3を別々に再現。
+native CASも固定親writerの隔離コピーでcoverage-only変更を見逃しREDとなり、新比較でGREEN。
+初回の全contract adapter runは旧API signature差による失敗を含むので、このsemantic REDと分ける。
+初回GREENのテスト入力誤り（assessment field/種別、environment未指定、Nodeでimport.meta.glob使用）、
+ブラウザafter hookで先にcontextを閉じた失敗、型brand負試験、巨大fixtureのexec buffer上限は保全。
+新テストのrole負試験はbare UUIDのshape拒否を観測後、妥当prefixを持つ別role IDを入力するよう直し、
+ticketによる拒否まで確認した。既存assertion・fixture・timeout・skipは変更していない。
+
+Chromium 156.0.8078.4 / native Web Locks / 実IndexedDBを使用。
+異なる13ケースで、UI生成/編集/export/inspect/restore/reload、初回/既存quotaとabort、全field CAS、
+別tabの同revision競争（勝者1件）、Lock待機中変更、SecurityError、未知DB版、Lockなし、破損raw救済、
+UI失敗時の確定表示維持と再試行、初回読取中の操作ガード、invalid flag/production拒否、旧rule1明示migration、
+別BrowserContextの空DBへのファイル採用とburn再読込を確認する。
+quotaはIDB APIへの例外注入であり、実ディスク枯渇を起こした試験ではない。
+実ブラウザ試験前のsandbox localhost EPERMは環境失敗として保全し、許可されたlocalhost実行で再実行。
最終UI再試験の1回はChromium起動自体が180秒timeout。機能結果に加算せず、同一binary/同一ケースの再試行で4 PASS。
+保存後のstrict read失敗はNodeの注入試験。製品write WorkerのACK喪失試験ではない。
+
+追加確認で、操作開始時に旧成功文言をクリアするUI修正を行った。確定stateはcommit/reload成功後のみ更新。
初回read遅延中に操作可能だったケースも実ブラウザでREDを再現し、初回read完了まで操作を無効化する。
これにより古い初回loadが後続commitの表示を置き換える競合を防ぐ。
+scope verifierの凍結許可表/hash/skipは変更していない。旧3C-0a全stack用scopeの合格は主張しない。
+代わりに固定親との差分一覧、凍結コード/fixtureのGit blob一致、productionとpreview Workerのbundle非混入を検証。
+旧controller/syncSession/codec/contractDecoders/legacyPreview/identityFold/allocator/Worker/readerはbyte不変。
+
+## 性能と資源
+
+`tests/helpers/benchmark-persistent-authority.mjs` は同じ固定ID・全値のschema24/8 receiptを作り、
+旧PR3同期経路とPR4の新session loadを3反復、版本順を反転して比較する。
+Node24.13.0/macOS、他の本作業suiteと重ならない測定の結果：
+
+| 経路 | wall ms（3標本） | process CPU ms（3標本） |
+|---|---|---|
+| 旧rule1 | 899.29 / 926.41 / 915.46 | 888.36 / 902.22 / 888.60 |
+| PR4 v2 | 895.20 / 908.20 / 934.35 | 889.30 / 899.28 / 920.41 |
+
+wall中央値915.46→908.20ms、CPU中央値888.60→899.28ms。
+process全体のcheckpoint最大heap156.93MiB/RSS306.08MiB。peak/版別増分/leakの測定ではない。
+最初の測定は回帰suiteと重なったため比較根拠から除外し、別artifactとして保存した。
+小規模memory store loadの結果だけで、追加replayコスト・schema23/大履歴・長期session・GC/OOMや
+既存性能P2を解消したとは言わない。安全性の検査を減らす最適化は行っていない。
+
+## 再現・全面回帰の引継ぎ
+
+既存 `YI06_PERSISTENCE=1 npm run dev` で `/__dev/persistence-v2` を開く。
+既存rule1画面は `/__dev/persistence`。両方とも同じ開発専用DBなので、新版採用後に旧画面はfail-closed。
+
+```sh
+node --import tsx --test --test-concurrency=1 tests/attempt-persistent-authority.test.mjs
+./node_modules/.bin/tsc --noEmit -p tests/types/tsconfig.persistent-authority.json
+PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs CHROMIUM_PATH=/absolute/chromium node --import tsx --test --test-concurrency=1 tests/attempt-persistent-authority.browser.mjs
+node --import tsx tests/helpers/benchmark-persistent-authority.mjs
+npm run typecheck
+npm run lint
+npm run test:attempt-persistence
+npm run test:attempt-ui
+npm run test:attempt-controller-worker
+npm run test:attempt-controller-edits
+npm run test:migration
+npm run test:attempt-replay
+npm run build
+git diff --check
+```
+
+上記npm script名はpackage.jsonの実在を確認済み。全面suite/buildは利用者へ引継ぐ。
+Safari/Firefox/実機、実ディスクquota、巨大入力/32MiB近傍、長時間leak、全面domain回帰は未検証。
+PR5用write Worker/RPC、ACK不明transport、production PlannerPage形式切替、一般利用者向け3D UIは未実装。
+独立監査で重点確認するのは、native開始/portable採用とlegacy停止の資格差、全field Lock/CAS、
+baseline差替え、未adopt inspectionの無資格、burnとrollback予約、初回失敗、原文救済交錯、CPU/heap。
+本作業の自己検証を独立監査PASSとは数えず、Draft/Open/未mergeでAstra Highへ引き継ぐ。
