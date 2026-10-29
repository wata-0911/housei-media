# 3C-0a: identity導入・rule2・生存session予約

固定基準: 81f98862f1cd62aa4d9d9cc04d7f83864ea1858f。3C-0詳細設計の3.2–3.5を実装する。自己検証と独立監査は別であり、保存接続の承認ではない。

`analyzeCommandIdentities(beforeWorkspace, validatedCommand)` は `introduced / retained / updated / historical` を返す。各occurrenceはcanonicalId、UUID末尾（存在するとき）、role、recordId、pathを持つ。mediaの差分は同recordの直前payloadとのID比較。既存行更新・再順序化・remove/Undo snapshotは新規発行にしない。非UUIDの元assessment IDを保持し、新規非UUIDの導入はrule2で拒否する。Commandの構造・graph・transition検証は従来のapplyCommandが担当し、純粋な隔離計算からすべて成功した結果だけを返す。

`advanceCommandIdentities` が衝突検査と隔離applyを一つの順序付きstepにまとめ、Worker buildとrule2 replayで共有する。domain transitionが無効な場合は後続の有効prestateがないため、Workerは従来どおり資格済みcontrollerへ同じ失敗batchを渡して拒否させる。identity/freshnessエラーはこの委譲経路へ入れない。`foldCommandIdentities(seed, commands, structuralValues)` がH2/R2の唯一のモデル。schema23の呼出元は全訂正前source/tableを先にdecode・検証する。schema24は空のnew-plan Workspaceから開始する。導入を検査してからapplyし、receipt順に一度ずつ進める。H2は訂正順assignment制約→現assignment制約→各receiptのoperation→Attemptまたはowned→TODO/assessment配列順→未収録usedTodoIds。R2はH2→現source→訂正前source時系列→state/Workspaceの構造化UUID参照順。制約は減らさない。

`CanonicalReservations.declare` はcanonical表記・role・元行の対応を検査し、同じUUIDを異なる宣言へ割り当てる場合は拒否する。`restrict` はcanonical別名の食い違いを拒否する。`references` だけが既知の末尾参照を既存canonicalへ解決する。元source宣言と現在payloadの対応はassignment slotのsource pathへ束縛する。catalogとsourceの保守的なkey/value参照制約も保持する。`requireRule2Reservations` はcanonical一致と完全収録を検査する。旧 `unionReservations / requireReservations / newCommandIds` はrule1契約のまま。

純粋APIは `encodeStateRule2 / replayMigrationStateRule2`（schema23）、`encodeNewPlanRule2 / replayNewPlanRule2`（schema24）、`replayStateRule2`（明示dispatch）。同じschemaとrule.idでversion=2を使用し、全stateを再計算・全値比較する。旧encoder/replayとcontrollerの型・通常保存経路はrule1のまま。旧reader/controllerはrule2をunsupportedとして拒否する。rule1→2自動変換、authority v2、backup v4、明示migrationは実装していない。

`SessionIdentityAllocator` はUUID取得→形式/衝突確認→同期burn/sink→返却を契約とする。128回上限。`snapshot` は当該操作の発行前に取得する。生成後のburn全体をfresh検査から都合よく除外せず、導入occurrenceを発行前snapshotへ順に照合する。`EditIds` はこのallocatorを使用し、WorkerのbuildEditsも共通分析器で新assessmentを照合する。batch失敗・取消・後続例外はreceipt/Workspaceを戻してもburnを戻さない。移行allocatorの既存同期sink、table WeakSet、controller WeakMap/WeakSetは不変。controller/Worker間の移行予約通知も継続する。

生存sessionのburnは永続R2と別。純粋codecは失敗batchのUUIDをreceiptへ捏造しない。sessionが終了する前に成功保存されなかったburnのcrash永続保証はない。別Workerへ自動共有する保証もない。新しいRPCやcaller提供UUID/factory/資格/予約集合は追加していない。

## 3C-0b / 3Dへの接続ブロッカー

以下は未接続のままで、共通allocator契約を満たす保存可能経路として扱えない。今回production UIの接続を行わない。

| 入口 | 現状 | 必要な後続作業 |
| --- | --- | --- |
| worker buildEdits | 共通allocatorと分析器へ接続済み。通常previewはrule1 | 3C-0bのauthority/backup/migration境界の後にrule2を明示接続。失敗burnを成功authorityへ単調union |
| migration prepareMigrationIds | controller同期sinkで即時予約。既存資格を維持 | 新authorityの予約/coverageへ接続。既存tableコピーを発行資格にしない |
| workbench operationsのnewOperationId/newRecordId/newAttemptIds | sinkなしの旧helper | 保存入口ではsession allocatorを必須注入する。未dispatch/取消もburn |
| catalogView.makeAttempt / searchBridge.makeSearchAttemptの省略時default | 旧helperを生成。Workerは明示IDを渡す | 保存入口からdefault生成へ迂回させない。純粋constructorへ明示IDを渡す |
| dev/attempts/AttemptForm | mount時ID、edit opを無追跡生成 | Workbench全体で同じsession allocatorを注入し、form取消後も保持 |
| dev/attempts/Workbench / progressDefaults | remove/Undo/add_record、ownedを旧helperで生成 | 保存可能なdev/persistence seed/dispatch経路と同じallocatorで発行 |
| dev/attempts/ProgressEditor | assessmentをdirect crypto、submit opを旧helperで生成 | 追加ボタン時点でburn。submitしない取消も追跡 |
| dev/attempts/TodoPanel | TODO direct crypto、op/ownedを旧helperで生成 | TODO/assessment/operation等の全namespaceを共通burnへ |
| v22 production UI / grade import | 旧runtime ID生成（source側既存identity） | 3Dの別設計。既存sourceを自動改名しない。今回対象外 |

旧authority全期間のrollback欠損は現存stateのR2だけでは修復不能。3C-0bではlegacy-unprovenを維持する。新stateのrule2整合性はhost来歴の完全性や発行者資格を意味しない。write Worker、保存RPC、3D UI、ACK喪失復旧は今回対象外。

性能P2: Workerは全Commandを発行してburnした後、実際のCommand直前Workspaceを得るため共通stepで隔離applyする。既存controllerも資格検証の後に再生するため、build側の追加graph検証CPUがある。full replay/大履歴/heap/RSSを改善したとは主張せず、3C-0bで計測・判断が必要。
