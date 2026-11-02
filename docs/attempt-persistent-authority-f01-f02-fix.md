# PR #212 F-01 / F-02 修正

2026-11-02 JST。修正前HEAD `9c537114d00163756c296036368e0d39a02753cb`。
固定親#211 `cd4a6a4a331eb13d624b30fe7c9481e636856aba`。
同じ `feature/3c0b-pr4-persistent-authority-v2` の新規隔離checkoutで修正。
開始時GitHubで両PRのbase/head、Draft/Open/未mergeと指定HEAD一致を確認。
監査資料は読取専用。runnerは入出力/import先だけを専用コピーへ変更し、逆変換で元byte一致を確認した。
監査fixtureを再生成せずbyteコピーして主試験へ使用。既存fixture/assertion/skip/timeoutは変更していない。

## F-01：環境の取得時点

原因はcontroller寿命全体で最初のprovider Promiseを保持する `environmentTask ??=`。
full replayを反復しても、古いAとの比較では最新Bを確認できなかった。

- controller全体の環境cacheを廃止し、各環境検証でproviderを再実行する。
- schema23の全source/割当/履歴は既存codecで全値replayする。
  そのreplayが再構成したEnvironmentと、providerが返したEnvironmentを全値比較する。
  対象は `origin`（source catalog）、`target`、`rawFiles`、`catalog`、`legacyArchive`。
- commitは共通exclusive Lock取得後のhost再読取でも再取得する。
  candidateの完全検証・次authority検証・容量判定の後、`store.commit`呼出の直前にも再取得・比較する。
- 静的Environment引数は従来どおり受理する。providerのreject/変更はput前の明確な失敗。
  pending中はawaitしたままで、成功/資格/書込を先行させない。独自timeoutや新しい書込は追加しない。
- commit完了後の正規read/loadでも動的providerを再取得する。そこで失敗すれば
  `commit_outcome_unknown`。previewを消費し、自動再送・補償rollbackはしない。

保証するのは各取得で返された値との整合性、特にLock内の最後の取得・同期比較が成功してから
atomic store呼出へ進むこと。環境providerはIDB transactionのCAS対象でも共有Lockの強制参加者でもない。
最後の取得後から実際のputまでの変化、取得と取得の間のA→B→A、providerが返さない変更まで
任意の時点で完全検知する保証はない。postcommitで観測した変更は結果不明として扱う。
操作間cacheを廃止した代償としてprovider取得/全値比較回数が増える。replayや安全検証を省略しない。

## F-02：情報を失う変換より先に検査

原因は元IDB recordをstructured clone→JSON化した値だけをstrict decoderへ渡したこと。
undefinedキーの消失、NaN/Infinity/invalid Dateのnull化、boxed Stringのprimitive化を見逃した。

- read境界の値は型上もunknownとして扱う。
- clone/JSON化前に既存 `sameAuthoritySnapshot(original, original)` で全階層の値を検査する。
  元の比較器は同一objectでも省略せずdescriptorを走査し、plain object、dense array、
  enumerable data property、許可primitive/有限数を確認する。
  accessorを呼ばず、非列挙/symbol/undefined/特殊object/疎配列/循環/-0を拒否する。
- 同じ変換前にauthorityの旧4 field / v2の7 fieldとcoverageのclosed key shapeを確認する。
  state原文はstringとして保持し、内部の版/全field/完全replayは元strict decoderを使う。
- private snapshotをJSON decoderへ通した後も、snapshotとdecoded値を同じ独立全値比較で照合する。
  JSON文字列同士の比較や正規化による修復はしない。
- 検証が完了するまでowner制約import・handle登録へ進まない。救済用protectCurrentはこの経路を通らない。
  rawがprimitive stringなら破損metadata下でも既存envelopeで保護でき、boxed rawは元の型検査で拒否する。
- CAS比較器、native IDB writer/reader、共通Lock、単一put、初回原子性はbyte非変更。

## RED / GREENと実測

同じ監査schema23 fixture（約3.2 MB、revision7、空receipt）のbaselineは
`77169f60c0d9d8b837fc1a8696fda73e89bd666f0fafb5c43e2f113d874359f7`。
Chrome156.0.8078.76/macOS x64/Node24.13.0、native IDB/Web Locks。
元監査runnerのコピーにはPlaywright1.64.1、新規native suiteには1.62.1を使用。

| 元再現の観測 | 旧HEAD RED | 修正後 GREEN |
|---|---|---|
| F-01 preview後provider呼出 | 1 | 2 |
| F-01 commit後の合計呼出 | 1 | 3（最新Bで拒否） |
| F-01 A→B commit | 成功、put1、revision7→8 | target_catalog_changed、put0、revision7不変 |
| F-02 不正record6種load | 全件native資格 | 全件authority_record_invalid |
| F-02 同load由来ID/v4 | 全件発行/export | 全件拒否、UUID0、put0、revision1不変 |
| 元runnerの140未submit burn | 生成/unique/永続すべて140 | すべて140 |

元runner内page probeのwallはF-01が22,269.643→15,480.072ms、F-02が13,540.452→8,871.379ms。
1反復の観測harness時間で、拒否地点により実行量が異なる。性能改善の比較値にはしない。
今回CPU/heap/RSS、大履歴/長期session性能は測定していない。

新規nativeは異なる23ケースを各最終期待で確認（22件run＋全環境field1件、F-02最終13件も再実行）。
F-01はA→B、Aのまま、静的A、native Lock待機中の変更、provider拒否・遅延、
candidate検証中の変更、postcommit拒否/変更、origin/rawFiles/catalog/archiveの個別変更とA復帰retry。
legacy-unproven、独立baseline、許可2field以外の全値、通常編集禁止を維持した。
F-02は実DBの不正6種の存在をread-back確認し、load/ID/export拒否、無修復、native CASの拒否を確認。
postcommitにも各6種を注入し、product put1＋試験注入put1、revision2、unknown、再送/rollback0。
正規schema24のload→tracked edit→commit→v4 exportはproduct put1で成功。
Node17件で変換前のaccessor/特殊値/closed shape拒否と旧4-field読取を確認。
既存PR4の選択8件、旧rule1/backup/コピー資格/Lockの選択4件も確認。
型負試験を含む限定tsc、変更TSのeslint、差分checkを実施。
初回型検査のrecord型が広がらないエラーはread境界をunknownへ直して解消（実行時コードは不変）。

実装差分はpersistentSession.tsのみ。他は新規回帰3ファイルと本文書。
allocator/ticket、P/R2/adopted/owner union、coverage/baseline、backup qualification/adoption/protection、
CAS、結果不明、旧controller/Worker/production/卒業engineを変更しない。
この修正の自己検証をPR4全体の独立監査PASSとはしない。Draft/Open/未mergeでAstra Highへ再監査を依頼する。

## 再現・引継ぎ

```sh
node --import tsx --test --test-concurrency=1 tests/attempt-persistent-boundary-values.test.mjs
# PR4_SCHEMA23_AUTHORITYを省略すれば本repoの正規codecで空履歴の同等schema23を作る。
PR4_SCHEMA23_AUTHORITY=/absolute/copied-schema23-authority-fixture.json PR4_BOUNDARY_EVIDENCE=/absolute/new-output PLAYWRIGHT_MODULE=/absolute/playwright/index.mjs CHROMIUM_PATH=/absolute/chromium node --import tsx --test --test-concurrency=1 tests/attempt-persistent-boundary.browser.mjs
./node_modules/.bin/tsc --noEmit -p tests/types/tsconfig.persistent-authority.json
./node_modules/.bin/eslint src/planner/attempts/persistence/persistentSession.ts
git diff --check
```

全面typecheck/lint、全PR4/browser/Worker/migration/replay/domain suite、build、実機、Safari/Firefox、
実ディスクquota、providerの永続pending/取消UX、任意時間の環境変更完全検知は未検証/未保証。
全面回帰は既存package.jsonの `typecheck`、`lint`、`test:attempt-persistence`、`test:attempt-ui`、
`test:attempt-controller-worker`、`test:attempt-controller-edits`、`test:migration`、`test:attempt-replay`、`build` を引き継ぐ。
PR5/write Worker/production形式切替/3Dへは接続しない。
