# Attempt graph: descriptor captureと検証のTOCTOU修正

Issue [#182](https://github.com/wata-0911/housei-media/issues/182)。PR #181独立再監査N2（P2）の既存dev由来問題を単独で扱う。起点は最新origin/dev `3eae77665711756e54785022856d5cfae3043f90`、専用ブランチは `fix/attempt-graph-snapshot-toctou`。#181の証拠API・ブランチには変更を加えない。

## 原因とN2反例

旧validatorは元graphをdescriptor走査した後、同じ元graphをAJVと意味検証が通常のproperty readで再走査した。adapterはさらに元graphをstructuredCloneし、元graphとcloneの同値を比較した。検査対象と計算対象が固定されていなかった。

独立監査の攻撃構造を [回帰テスト](../../tests/attempt-graph-snapshot.test.mjs) に固定した。正当なAttemptを先に配置し、後から走査されるownedRecordsを空配列のProxyにする。ownKeys trapでAttempt.originalTitle（負の寄与版はactualYear）をgetterに変更し、元graph.ownedRecordsを通常配列に戻す。getterの2回目の読込で検査済みIDをinvalid-graph-id、または寄与を-100へ変更し、getter自身を通常のdata propertyへ戻す。単純getter版では1回目で戻す。

独立監査時の [graph probe原本](audit-n2-probe.mjs) もbyte不変で保存し、引数のcheckoutだけを変えてdev/修正版へ実行した。結果は `audit-n2-probe-base.txt` / `audit-n2-probe-feature.txt`。

同じfixtureを毎回新規構築してvalidatorとadapterに渡した。旧devでは6件すべてFAIL。getter版は1回、不正ID/負寄与版は2回getterを実行し、validatorはvalid=true、adapterは不正ID/負寄与を含むadaptedを返した。これは通常のJSON.parseだけで生成される攻撃オブジェクトではない。また、負の記録値が返ることを卒業単位の正値算入解放と混同しない。

## 修正契約

`validation.ts` の `snapshotAttemptGraph(value, trustedContext)` は、own data descriptorの値をその場で再帰的にコピーする。元入力の通常property read、length read、iterator、toJSONをアプリ側では使わない。各コピーをfreezeし、元入力をfreeze・変更しない。循環検出は現在の祖先経路を使うため、循環しない共有参照は各出現箇所の独立データとして保存する。

配列はownKeysとlengthのdata descriptor、連続したindexの数・範囲を検査し、穴をnullへ埋めない。巨大な疎配列でもlength回の走査やlength分の事前割当を行わない。non-enumerable、symbol key、accessor、消えたdescriptor、例外を投げるreflection、非JSON leaf、不正prototypeを拒否する。Object.definePropertyにより__proto__をsetterとして実行せずdataとして保持し、余分なキーはschemaが拒否する。省略とnull、0と正値を変換しない。

### 子から親へのnative clone検査

既存R2の「clone時に情報が欠落する組込み型・clone不能なProxyを拒否する」契約を保持する。descriptorコピーだけではprototypeを偽装したDate/Map/Set/RegExpやProxyを通してしまうため、それだけでは完成したsnapshotとしない。

1. 子のcaptureがすべて成功した後、そのnodeをnative structuredCloneし、**descriptorからの独立コピーとnative cloneの間だけ**でdata同値を検査する。元nodeを同値比較で再走査しない。
2. Proxyはnative cloneで拒否される。参照先を元graphから取り除くtrapでも、capture中のローカル変数はそのProxyを保持しているため拒否できる。失敗時は即座に全captureを中断し、親をcloneしない。
3. したがって親のcloneへ到達した時点では、配下の全nodeが検査済みであり、後からgetterを設置する子Proxyは残っていない。現在のnode自体がProxyなら、native cloneはそのpropertyを読む前に拒否する。これによりN2の後発getterへ進まない。
4. Map/Setのnative cloneはown descriptorに出ない内部entryを走査する。その内部に未検査getterがある場合に備え、Map.prototype.has / Set.prototype.hasのreceiver検査で内部slotを持つ値を先に拒否する。これらのintrinsicは入力のpropertyを読まない。Proxyで包んだcollectionはこのreceiver検査に通らず、後段のProxy clone拒否を通る。
5. 構築・native clone検査を完了した独立snapshotだけを既存AJV schema・意味検証へ渡す。**検証後に元graphをclone・比較・計算しない。** 計算データはdescriptorコピーであり、native cloneは構築時の互換性検査に限定する。

成功結果だけがgraphを持つ判別可能なunionであり、無効な部分snapshotを計算側へ返さない。ID・寄与のschema条件、owner・操作ID・公式参照・Undoの意味検証は変更しない。

既存 `validateAttemptGraph` は同じcapture/検証経路を通し、従来どおり `{ valid, issues }` を返す。validは捕捉したデータの判定であり、呼出し後の可変元入力を認証し続けるものではない。非信頼入力から後続処理用データが必要なconsumerは `snapshotAttemptGraph` の返却graphを使用する。

`graduation/adapter.ts` はその返却graphを計算に使用する。検証後の元graphに対するstructuredClone・同値比較を削除した。retainedのsource同値検証は従来どおりで、計算用retainedは認証済みsourceから取得する。

### N2と不正入力の扱い

修正版はN2全3変種をvalidator/snapshot/adapterすべてで拒否し、getter呼出しは0回。単に不正ID/-100を見逃さないだけでなく、それを発生させるgetter自体を呼ばない。元入力にgetterを設置するtrap自体は実行され得るが、不完全なsnapshotは公開されない。後続ownKeys/getPrototypeOf/getOwnPropertyDescriptor trapが既捕捉領域のID・数量・参照を直接書き換えた場合も拒否する。

初期実装のdescriptorコピーだけでは、既存R2が1件失敗した（第1段階413 PASS / 1 FAIL、全Planner4,083 PASS / 1 FAIL）。その結果を残してnative clone検査を追加した。既存のassertionを緩めたり、skipに変更していない。最終N2の同一assertionでのRED/GREENは同directoryのログを参照。

### 限界

reflectionはProxy trapを実行し得る。trap自体が元入力や外部状態を書き換える副作用、global intrinsicの改変、任意サイズ入力に対する資源消費、任意のhost objectの網羅的な安全証明は保証しない。敵対的Proxyの原子的な瞬間像やsandboxではない。structuredClone等の組込み実装自体を攻撃者が差し替えない実行環境が前提である。

trustedContextの正本性は従来の前提。migration/workbench/persistenceのAPI全体を新しくProxy対応化したとは主張しない。既存consumerの通常のJSON・内部生成graphの回帰を確認する。PR #181のsubmittedEvidence API（別指摘N1/F3）には変更を加えない。

## 検証手順と記録

N2のRED/GREENは同一テストファイルをpristine devと修正版へ置き、各checkoutで次を実行する。baselineの既存ソースは変更しない。

```sh
node --import tsx --test --test-name-pattern='^N2 (validator|adapter):' tests/attempt-graph-snapshot.test.mjs
node --import tsx --test tests/attempt-graph-snapshot.test.mjs
node --import tsx docs/attempt-graph-toctou/audit-n2-probe.mjs ../..
npm run test:attempts
npm run test:migration
npm run test:attempt-ui
npm run test:attempt-persistence
npm run test:attempt-graduation
npm run test:planner
npm run typecheck
npm run lint
npm run build
```

追加196件はvalidator/snapshot/adapterの拒否境界、N2、後続trap、Proxyをget/set/hasなしで拒否すること、省略/null/0/2/4、組込み型偽装と内部entry getterの拒否、deep freezeと元入力の可変性、owner payload・参照・削除ticket・操作receipt・逆順Undoを含む。既存のテストassertionと固定192件のfixtureは編集しない。新テストをtest:attemptsとtest:plannerへ追加してCIでも実行する。

## 最終ローカル検証結果（2026-10-23）

Node.js 24.13.0。同一lockfileの依存環境を使用。既存テスト・fixtureのassertion、skip、timeoutは変更していない。

| 検証 | 結果 |
| --- | --- |
| N2 同一assertion：validator/adapter各3変種 | dev 0 PASS / 6 FAIL → 修正版6 PASS / 0 FAIL / 0 SKIP。getter 0回、全拒否 |
| 独立監査graph probe原本 | devでgetter1/2回・不正ID/-100受理を再現。修正版3変種全拒否・getter0回 |
| 新規snapshot suite | 196 PASS / 0 FAIL / 0 SKIP |
| 全Planner（最終コード） | 4,102 PASS / 0 FAIL / 0 SKIP |
| YI-03/04/05/06/07第1段階 | 全Plannerにそれぞれ既存132 / 133 / 84 / 103 / 414件を含み全成功。YI-03には追加196件も含む |
| 固定baseline | 全8scope・192件の完全出力/旧projection比較成功。fixtureはbyte不変 |
| YI-05 Chromium（最終コード） | 9 PASS / 0 FAIL / 0 SKIP |
| YI-06 Chromium（最終コード） | 17 PASS / 0 FAIL / 0 SKIP |
| 通常Planner Chromium | 43 PASS / 1 FAIL / 0 SKIP。以下の既存timeoutを記録 |
| Extension / Bookmarklet | 54 / 168 PASS、各FAIL 0 / SKIP 0 |
| typecheck / lint / build（最終コード） | すべてexit 0 |
| production出力 | pristine devと12/12ファイル、ファイル集合・全byte完全一致 |
| git diff --check / git diff --check origin/dev | 成功 |

公式aggregate優先、unknown保持、過去P2/R1/R2、操作履歴・Undo・owner参照・保存/再読込は既存suiteを維持して検証した。集計は [verification.json](verification.json)、production全ファイルSHAと実byte比較結果は [production-byte-comparison.json](production-byte-comparison.json)、既存ファイルの変更範囲は [scope-invariance.json](scope-invariance.json)。初期実装のR2失敗もverification.jsonに残し、最終成功で消していない。掲載ログはローカル絶対パスの置換と行末空白の除去だけを行った。

### 通常Plannerブラウザの既存失敗

`restore invalidates an unsaved media draft even when the stored value is identical` が `tests/planner-save-lock.browser.mjs:315` の旧region名 `プランナー全データのバックアップ・復元` 内file inputを待って30000ms timeout。pristine devの同じテスト・同じassertion・同じtimeoutでも0 PASS / 1 FAIL / 0 SKIPを再現した（[baseline-planner-restore.txt](baseline-planner-restore.txt)）。今回のsnapshot修正に混ぜて変更しない。初回の通常Planner全44件が成功したとは主張しない。最終修正はproductionにbyte差分を生じていない。iPhone/Safari実機は未実施。

### CIの記録

ローカル検証とGitHub CIを区別する。Draft PRの最終HEADに対応するCI run/checkを確認し、PR本文へrun URLと結果を記録する。独立監査・Ready化・mergeの代わりにはしない。



## release-blockerとの関係

Issue #182には既存管理ラベル `release-brocker`（リポジトリ上の綴り、説明「リリース前に対応」）を付与した。保存・復元・Undoが共有するgraph検証の迂回として、#95の不正入力拒否/原文保護、#175の保存境界、[YI-08公開ゲート](../planner-year-independent-migration.md#yi-05からyi-08への公開保存境界)に関連付ける。

schema22/23・backup形式・保存authority・既存卒業engine・公式catalogは変更しない。新Attemptの一般公開flagも変更しない。Draft PR作成後は独立監査とマージ/公開判断を別途行う。Ready化・merge・Issue close・release-blocker解除は行わない。
