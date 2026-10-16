# 永続ID・receipt・Undo・commit契約

## 信頼境界

入力state/backup JSONは信頼しない。発行表・receiptのclosed shapeやSHA一致だけでは保存/復元権限にならない。

隔離IndexedDB `hosei-yi06-isolated-v1` のhost管理recordは、現raw、単調なrevision、過去に確定保存したstateのcanonical SHA集合、全確定履歴の発行済みID集合を持つ。これらは**外部ファイルへexport/importする形式ではない**。controllerは、YI-04のlive発行handleからの移行か、既にhostが確定したcheckpointに由来するYI-05操作だけをcommitできる。生のJSONからcontrollerのhandle/previewを作るAPIはない。

再読込・新backup復元では、保存済みcheckpointのSHAがhostの確定履歴に存在することを先に確認する。SHAはこのhost記録との照合キーであり、ファイルの真正性を単独で証明するものではない。ファイルに正しいSHAを付け直してもhost履歴がないため拒否する。YI-04発行表コピーはそのままYI-04へ渡すと今も`unverified_assignment_history`になる。

この境界は、通常のアプリ保存領域を信頼する**同一ブラウザ・同一originの継続性**である。host DBそのものを操作できる同一originの悪意あるscript、DevTools、端末侵害、ブラウザprofile全体の改ざんを検出する暗号学的認証ではない。依存注入する`AtomicAttemptStore`もアプリ所有の信頼済みcapabilityに限る。検証対象ファイルからstore/証跡を構成してはならない。ブラウザ内の秘密鍵・署名・大学認証を主張しない。

DB消失・別端末のファイルは証跡がなく拒否。別端末復旧を完了させるには、独立監査可能な外部発行authority/可搬信頼根などの別設計が必要。この制約を「ファイルのshapeが正しいから」で解除しない。

## 再読込の証明手順

1. host recordをread-only取得。JSON原文のparse失敗・authority破損は原文を残して停止。
2. strict parserが重複key、表現不能数、未知root field/版を拒否。確定履歴のcheckpoint照合。
3. raw6の原文SHA、固定原版、source/target両catalog、互換versionを再検証。
4. 元rawをYI-04で再decodeし、元schema/種別、原行/数量/参照閉包、元raw/state/catalog SHA・metadataを再比較。
5. tableのbinding/slot coverage/予約/全namespace衝突を構造検証。初期targetの全graph/retained/ledgerを再構成。
6. 順序付き元要求をYI-05 `applyCommand`で一件ずつ再実行。重複receiptを拒否し、既存owner・日付・数量・許可差分・transitionを検証。
7. 最終graph、削除snapshot/previousPosition/ticket、receipt順、usedTodoIds、全発行履歴、非Attempt情報、verificationを完全比較。
8. 訂正履歴があれば元rawと旧割当、訂正対象assessment/owner/原値、一fieldだけの変更、新raw chain、新割当の旧ID予約を再検証。

replay関数単体は情報の整合性検査にすぎない。controllerの発行済みhandleや保存権限は返さない。元sourceに無関係な合法graphを持ち込んでも、checkpoint/操作再実行比較で拒否する。

## 再送・ID予約・逆順Undo

再読込後も元要求全体とoperationIdを保持する。同じ要求はno-op、同じIDで別内容は`operation_replay_conflict`。新しい履修回は新Attempt/operation IDが必要。

削除したTODOの元ID、削除record ID、過去のoperation/Attempt IDはreceiptとhost予約集合に残す。過去backupへ戻してもhost予約集合は縮小しないため、後で発行したIDを再利用できない。pending migrationのIDはページ内でも予約し、次の確定保存に含める。保存前にページを閉じたpreviewのIDには永続保証を主張しない（previewを無副作用にするため）。

新規IDは同じ保存前draftのreceipt・使用済みTODO ID、旧stateの非Attempt情報、元/対応catalogのUUIDとも照合する。prefixの異なる操作IDとTODO IDでも同じUUIDの再利用は拒否する。

UndoはYI-05と同じ削除LIFO。初期targetから削除要求を再実行するので、削除snapshot・previousPosition・順序は保存ticketの自己申告を信用しない。履歴欠落、順序逆転、owner/payload/ticket改変は一致検証で拒否。detached ownerの合法な進捗編集は保持し、Undoはその時点のrecordを戻さない/消さない。

## 原子的保存

`withPlannerWriteLock(..., locks, true)`、共通`PLANNER_WRITE_LOCK=hosei-planner:v1:write`を使用。preview開始/loaded時のexpectedRawとauthority revisionを保持する。commit直前に原版・source・履歴を再検証し、Lock取得後、IDB readwrite transaction内で現raw/revision/履歴/予約集合の完全一致を確認する。

一回の`put`が新rawとhost証跡を**同じrecord、同じtransaction**へ保存する。`oncomplete`だけ成功。quota、SecurityError、read failure、put同期例外、transaction abortではloaded stateを更新しない。rollback目的の追加書込み、recovery上書き、localStorage複数keyへの分割はない。Lockなしはcommitを拒否する。

初回previewは`indexedDB.databases()`で有無をread-only確認し、存在しないDBを作らない。DB作成は最初のcommit時のschema初期化だけで、ユーザーstateと証跡は一回put。inventory APIがなければ拒否する。対象のSafari実機対応はYI-08で確認する。

旧v22タブのうちWeb Lockに参加しないものへの排他保証はない。本sliceは旧localStorageへ触れず、新DBのみを使うため、その制限を回避した一般公開済みとは扱わない。

## 容量

[capacity.json](capacity.json)は合成mixed v22を実測。raw6は1,163,528 bytes、保存stateは約3.24MB、host recordのJSON表現は約3.64MB。catalogの元版/target版を勝手に省略しない。上限はhost record JSON UTF-8で32MiB（testは注入した小上限でも拒否を検証）。IDB実ディスク使用量とは別の保守的なアプリ上限であり、ブラウザquotaの可用性保証ではない。実quota失敗はtransaction abortを正とする。

過去checkpointのSHA集合・ID予約・receipt・訂正履歴を自動削除しない。増加して上限に達した場合はfail-closed。履歴compaction/可搬authority/巨大graphでの応答改善は後続課題。
