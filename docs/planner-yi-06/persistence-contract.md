# 永続ID・receipt・Undo・commit契約

## 信頼境界

入力state/backup JSONは信頼しない。通常再読込と可搬復旧を別の契約にする。通常再読込はhostが確定したcheckpointの照合を必須とし、原文を直接書き込んでも自動的に認めない。

可搬backup v2は、原版・全割当・操作履歴・参照・数量・全namespaceの検証後にpreviewを返すだけで、まだhost証跡にならない。利用者が選択ファイル固有の採用確認を行い、原文保護と全件置換を確認した場合のみ、Lock/CAS/単一transactionで新checkpointを確定する。SHAは破損検出であり、発行者の認証ではない。WeakSetへコピー表を再登録しない。[可搬復旧契約と脅威モデル](portable-recovery.md)を参照。

host管理recordは現raw、revision、確定checkpoint SHA集合、永久ID予約集合を持つ。record自体のimport/reset APIはない。backup v2へ出力する予約集合は再利用禁止条件であり、checkpointの自己認証には使わない。同一originの悪意あるscript、DevTools、端末侵害への暗号学的耐性は提供しない。

## 再読込の証明手順

1. host recordをread-only取得。JSON原文のparse失敗・authority破損は原文を残して停止。
2. strict parserが重複key、表現不能数、未知root field/版を拒否。確定履歴のcheckpoint照合。
3. raw6の原文SHA、固定原版、source/target両catalog、互換versionを再検証。
4. 元rawをYI-04で再decodeし、元schema/種別、原行/数量/参照閉包、元raw/state/catalog SHA・metadataを再比較。
5. tableのbinding/slot coverage/予約/全namespace衝突を構造検証。初期targetの全graph/retained/ledgerを再構成。
6. 順序付き元要求をYI-05 `applyCommand`で一件ずつ再実行。重複receiptを拒否し、既存owner・日付・数量・許可差分・transitionを検証。
7. 最終graph、削除snapshot/previousPosition/ticket、receipt順、usedTodoIds、全発行履歴、非Attempt情報、verificationを完全比較。
8. 訂正履歴があれば元rawと旧割当、訂正対象assessment/owner/原値、一fieldだけの変更、新raw chain、新割当の旧ID予約を再検証。

replay関数単体は情報の整合性検査であり保存権限を返さない。元sourceに無関係なgraphや改変された最終snapshotは全要求再実行との比較で拒否する。可搬復旧はその検証に加えて、利用者による復旧元採用を要求する。整合する別履歴の発行者まで証明するものではない。

## 再送・ID予約・逆順Undo

再読込後も元要求全体とoperationIdを保持する。同じ要求はno-op、同じIDで別内容は`operation_replay_conflict`。新しい履修回は新Attempt/operation IDが必要。

削除したTODOの元ID、削除record ID、過去のoperation/Attempt IDはreceiptとhost予約集合に残す。過去backupへ戻してもhost予約集合は縮小しないため、後で発行したIDを再利用できない。pending migrationのIDはページ内でも予約し、次の確定保存に含める。保存前にページを閉じたpreviewのIDには永続保証を主張しない（previewを無副作用にするため）。

P2以後のcommitは、再検証済み全履歴IDと、現在/全訂正前sourceのstate・旧catalog・制度catalogの全UUIDを共通の必須集合としてunionする。通常保存・可搬復旧・巻戻しで同じ規則を使い、既存予約を減らさない。reloadとbackup書出しはhostへ書き込まない。P2前の既知checkpointは従来どおり全replayでloadし、完全なv2を再書出しできるが、必須予約を欠く外部v2ファイルの復元は拒否する。[集合の定義と互換性](portable-recovery.md#p2必須予約集合)。

新規IDは同じ保存前draftのreceipt・使用済みTODO ID、旧stateの非Attempt情報、元/対応catalogのUUIDとも照合する。prefixの異なる操作IDとTODO IDでも同じUUIDの再利用は拒否する。

UndoはYI-05と同じ削除LIFO。初期targetから削除要求を再実行するので、削除snapshot・previousPosition・順序は保存ticketの自己申告を信用しない。履歴欠落、順序逆転、owner/payload/ticket改変は一致検証で拒否。detached ownerの合法な進捗編集は保持し、Undoはその時点のrecordを戻さない/消さない。

## 原子的保存

`withPlannerWriteLock(..., locks, true)`、共通`PLANNER_WRITE_LOCK=hosei-planner:v1:write`を使用。preview開始/loaded時のexpectedRawとauthority revisionを保持する。commit直前に原版・source・履歴を再検証し、Lock取得後、IDB readwrite transaction内で現raw/revision/履歴/予約集合の完全一致を確認する。

一回の`put`が新rawとhost証跡を**同じrecord、同じtransaction**へ保存する。既存DBではtransactionの`oncomplete`、初回はversionchange transactionのcommit後に発火するopenの`onsuccess`を成功条件にする。quota、SecurityError、read failure、put同期例外、transaction abortではloaded stateを更新しない。rollback目的の追加書込み、recovery上書き、localStorage複数keyへの分割はない。Lockなしはcommitを拒否する。

初回previewは`indexedDB.databases()`で有無をread-only確認し、存在しないDBを作らない。最初のcommitではschema初期化・CAS・ユーザーstateと証跡の一回putを同一versionchange transaction内で行う。inventory APIがなければ拒否する。対象のSafari実機対応はYI-08で確認する。

旧v22タブのうちWeb Lockに参加しないものへの排他保証はない。本sliceは旧localStorageへ触れず、新DBのみを使うため、その制限を回避した一般公開済みとは扱わない。

## 容量

[p2-capacity.json](p2-capacity.json)は合成mixed v22を実測。raw6は1,163,528 bytes、保存stateは3,235,432 bytes、host recordのJSON表現は3,723,487 bytes、全予約2,105件を含むbackup v2は3,317,871 bytes。P1時点の[capacity.json](capacity.json)も履歴として保持する。catalogの元版/target版を勝手に省略しない。上限はhost record JSON UTF-8で32MiB（testは注入した小上限でも拒否を検証）。IDB実ディスク使用量とは別の保守的なアプリ上限であり、ブラウザquotaの可用性保証ではない。実quota失敗はtransaction abortを正とする。

過去checkpointのSHA集合・ID予約・receipt・訂正履歴を自動削除しない。増加して上限に達した場合はfail-closed。履歴compaction/発行者認証/巨大graphでの応答改善は後続課題。
