# PR #183 P2-1 / P3-1 修正・最終検証

> 以下はHEAD `2a3d052`までの過去の記録です。2026-10-24再監査後の残存P2/P3対応は [残存指摘の検証記録](../residual/README.md) を参照してください。今回のローカル差分へ旧CI・旧テスト結果を流用しません。

## A. Git状態

2026-10-23のローカル修正後、2026-10-24に最終確認。開始HEAD `a8166e8bab8d988ac11213004b21e48bfc0e6b77`、PR #183はDraft/open、base dev `3eae77665711756e54785022856d5cfae3043f90`。GitHub最新情報も一致した。既存CI #92 successは旧HEADの記録であり、今回の修正のCI成功ではない。既存の未stage差分を保全して最終レビューした。

今回、ユーザーが関連変更のcommit・通常pushとPR本文更新を明示的に許可。関連ファイルを明示選択してstageし、cached差分・diff checkを確認して提出する。最終commit SHA・push結果・新規CI状態はPR本文と最終報告に記録する。Ready化・merge・Issue closeは対象外。

製品変更は `validation.ts` と `workbench/operations.ts`。追加テストは既存snapshot suiteへ5件追加。性能probe 2本と本directoryの証跡を追加。

変更ファイル一覧: `src/planner/attempts/validation.ts`、`src/planner/attempts/workbench/operations.ts`、`tests/attempt-graph-snapshot.test.mjs`、`tests/attempt-graph-performance-probe.mjs`、`tests/attempt-graph-comparison-probe.mjs`、`docs/attempt-graph-toctou/revision/*`。

## B. P2-1

旧captureは各nodeでMap/Set receiver probe（通常objectでは例外2回）、subtreeのnative cloneと全比較を行う。深さD、node数Nではsubtree走査合計O(ND)、鎖状構造では二乗。CRUDは入力と出力でこの処理を繰り返し、100件編集で4,210 native cloneとなる。

修正は非公開WeakSetによるJSON表現の生成元証明と、CRUDの変更箇所だけをコピーする処理。WeakSetに登録するのは、このmoduleで独立構築し、native clone等の検査後にfreezeした通常object/array、またはその安全なデータからnative cloneで作り再帰freezeしたnodeだけ。元入力そのもの、単にfreezeされた外部object、外部フラグ、validator成功時の可変元入力は登録しない。Proxy wrapperも異なるobjectであり登録されない。

この証明はschema/contextの正当性を証明しない。schema・意味検証は毎回実行。変更後contextでの拒否をテストした。認証済み子nodeは再帰freezeされ、外部参照からの変更・後付けProxy混入ができない。CRUDで作る新しいcontainerや変更recordは未認証であり通常captureを通す。新しいcommand由来の値も認証を省略しない。

capture内部だけで認証済みnodeを共有し、返却直前に全体をnative clone・再帰freezeする。返却snapshotは、入力が以前返却したsnapshotの場合も含めて全object参照が分離している。Workbenchは検証したsnapshotを使い、元graphの検証後cloneを廃止。外部入力がWeakSetへ直接書き込むAPIはない。

正常編集のnative cloneは10/100/500件とも8回。schema・意味検証と全体コピーは引き続きO(N)を要する（既存意味検証・履歴処理の独自計算量は別）。一般の未認証入力の初回captureは従来のguardを維持しO(ND)とreceiver例外処理が残る。workspace初期生成・外部入力を毎回再生成する呼出しは同じ高速化を得ない。ここを安全性の省略で高速化していない。

| Attempt数 | 修正前中央値 ms | 修正後中央値 ms | dev中央値 ms | native clone 前→後（dev） |
| --- | ---: | ---: | ---: | --- |
| 10 | 24.68 | 4.74 | 2.63 | 430 → 8（2） |
| 100 | 254.75 | 31.26 | 16.09 | 4210 → 8（2） |
| 500 | 1740.41 | 194.38 | 88.19 | 21010 → 8（2） |

workspace生成の単回計測（前→後／dev、ms）: 10件 38.18→37.10／4.21、100件 112.56→141.15／13.20、500件 656.54→533.56／46.17。初回captureはdevより重く、改善済みとは扱わない。

計測はNode 24.13.0、正常な異なるID、createWorkspace後にoriginalTitleのみ編集。時間の主測定はwrapperなし。clone回数は別実行でwrapperを付けて測定し、時間へ混ぜない。`before.jsonl` は修正前再現、`after.jsonl` と `comparison.jsonl` は関連試験と並行した予備測定。最終測定は `comparison-final.jsonl` を参照。固定の絶対時間をCIの合否に使用せず、追加テストは10/100件でclone回数100未満を検証する。

再測定には、監査HEADのgit archiveを隣接 `attempt-graph-revision-before`、devのarchiveを隣接 `attempt-graph-toctou-baseline` に展開し、それぞれ同一lockfileのnode_modulesを用意して、次を実行する。ブランチの切替・resetは不要。

```sh
node --import tsx tests/attempt-graph-comparison-probe.mjs
```

## C. P3-1

invalidのthrowで全走査が終了していた。入力不正は失敗sentinelとissuesで表し、兄弟のdescriptor走査を継続する。1件でも問題を見つけた後は元nodeのnative cloneを行わず、最終schema/意味検証と成功snapshot公開も行わない。getterや通常property readで追加診断しない。reflectionが例外を投げる入力では安全に中断するため、任意の敵対入力について全問題の網羅を保証しない。

不正入力のreflection例外は専用CaptureFailure、native clone不能はDataCloneErrorとして扱う。それ以外の予期しないnative cloneエラーは再throwし、不正graph診断へ隠さない。想定外例外の伝播をテストした。

`undefined` と `NaN` の指定2pathはREDで1issue、GREENで2issue。既存attemptValidationResultのpath→code→messageによるsortを維持し、既存どおり重複除去は導入しない。devと正常/複数非JSON/schema違反/意味違反の戻り値全体をdeepEqual比較して一致（diagnostic-compatibility.json）。既存PRで導入済みの疎配列・-0等の拒否は維持。局所REDは2 tests / 0 PASS / 2 FAIL、同じ2 assertionを含む最終suiteは201 PASS / 0 FAIL / 0 SKIP。

## D. N2安全性

snapshot suite内の元6反例は成功、getterは全て0回。監査probe原本も3変種全拒否・getter0回（original-n2.jsonl）。Proxy、accessor、symbol、循環、疎配列、偽装Date/Map/Set/RegExp/WeakRef、Map/Set内部entry getterの既存テストを維持。新たに、外部freeze偽装、認証済みgraphのProxy wrapper、context変更時の再検証、返却snapshot間の全node参照分離、複数診断中の後発getter、予期しない例外の伝播を検証。

独立snapshotだけをadapterの計算に渡す契約を維持。任意Proxy trap自身の副作用、global intrinsic改変、任意host objectの安全証明は保証しない。信頼前提を追加していない。本作業は実装者の自己検証であり独立監査ではない。

## E. 回帰・データ保全


| 検証 | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| green | 201 | 0 | 0 |
| attempts-final | 333 | 0 | 0 |
| graduation | 414 | 0 | 0 |
| migration | 133 | 0 | 0 |
| persistence | 103 | 0 | 0 |
| workbench | 84 | 0 | 0 |
| ui-browser-configured | 9 | 0 | 0 |
| persistence-browser-configured | 17 | 0 | 0 |

Typecheck / lint: exit 0。git diff --check: 成功。新規CIはpush前のため未実施。今回のユーザー実行とproduction比較は以下を参照。

結果は [test-results.json](test-results.json)、[red-green-summary.json](red-green-summary.json)、[user-validation.json](user-validation.json) を参照。raw実行ログはローカルに保全し、一時ログはcommit対象に含めない。sandboxのlocalhost待受EPERM、既定playwright解決失敗もログを残し、成功扱いせず既存検証環境を指定して再実行した。通常Plannerブラウザの既存#145相当timeoutと今回の環境起動失敗は別件。

schema22/23、backup形式、公式authority、旧卒業engine、catalog、既存の期待値/skip/timeoutは変更しない。公式aggregate・detail重複防止、unknown/null/0/省略、held/unsupported、未完成除外、graduationCheckComplete=false、sourceLinksReverified=false、固定192ケースは既存graduation suiteで確認する。

## F. 残件・次のアクション

P2-1の同期編集でnode数比例に増えるnative cloneを解消。P3-1の複数診断を回復。P1の新規所見なし。初回未認証captureのO(ND)と反復snapshotのO(N)メモリ確保は残存性能リスクで、独立再監査で初回生成・大履歴・remove/Undo/replayも重点確認する。

2026-10-24にユーザーが同じ作業ツリーで実施済みの以下の結果を受領した。製品コード・テストのSHA-256は前回自己検証時の [code-sha256.json](code-sha256.json) と一致し、以降に変更していないため、全Plannerとbuildを無条件再実行していない。

| ユーザー実行 | 結果 |
| --- | --- |
| npm run test:planner | 4,107 PASS / 0 FAIL / 0 SKIP |
| npm run build | 成功 |
| npm run test:planner-browser | 43 PASS / 1 FAIL |
| git diff --check | 成功（実装者も再確認） |

唯一のブラウザ失敗名は `restore invalidates an unsaved media draft even when the stored value is identical`。バックアップ・復元領域のfile input探索で30秒timeoutというユーザー報告は、base保存証跡 [baseline-planner-restore.txt](../baseline-planner-restore.txt) の同一テスト・`locator.setInputFiles: Timeout 30000ms exceeded`・同region内 `input[type=file]` 待機と症状が一致する。現在のテストソースの該当locatorもbaseから未変更。今回のrawブラウザログは受領しておらず、実装者が今回全ブラウザを再実行して原因を独立再現したとは扱わない。43/1はユーザー実行の報告値であり、全ブラウザ成功とはしない。

実装者の最終確認ではsnapshot suiteを再実行し、201 PASS / 0 FAIL / 0 SKIP。元N2の6反例はgetter 0回、複数非JSON診断、偽freeze/Proxy、context変更時の意味再検証、snapshotの全node参照分離を確認した。WeakSetへの登録箇所はmodule内で生成・検査・freezeしたnodeだけであり、外部入力や可変元graphを登録する経路は見当たらない。schema/意味検証は省略せず、CRUDは返却snapshotを使う。新規P1/P2相当の問題はこの自己レビューでは見つからなかった。これは独立監査の代替ではない。

ユーザーbuild済みのdistと、既存のbase build出力をPythonで実byte比較した。base側SHA-256は前回監査のmanifestとも一致。12/12ファイルが同じ集合・同じbyte（[production-final.json](production-final.json)）。dist/node_modulesはcommitしない。

P2-1の反復CRUDとP3-1の診断欠落は修正。初回未認証captureのO(ND)と通常snapshotのO(N)コピー・割当は残存する。500件の初期生成は約534ms対dev約46msで、解消済みとは扱わない。新規P1/P2は自己レビューで観測せず、既知#145相当ブラウザ症状と初回capture性能は残件。独立再監査ではWeakSet生成元証明、外部Proxy/組込み型、複数診断後のgetter拒否、context変更、Undo/replayと初回・大履歴性能を重点確認する。PR #181のN1/F3は対象外。
