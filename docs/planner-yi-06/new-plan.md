# 新規sourceの実装計画・互換性分析（コード変更前）

Refs #195（親 #188）。開始時origin/dev: `7d58287976e01364848535715395bb503dfa29e1`。
#194 merged / #193 completed。#181・#183はOpen/Draftで取り込まない。

## 形式と互換性

- 既存schema23は旧v22移行専用の意味・closed shape・encode/replayを維持する。旧source originを後付けしない。
- 新規source専用schema24と`yi-new-plan:replay` v1を追加する。sourceは`origin=new-plan`、初期化規則版、CurriculumVersion、source revision/digest、固定制度masterのdigestを持つ。旧raw、旧catalog、migration assignments/ledger/correctionsは存在しない。
- decoderはschemaVersionで明示分岐する。24を23へ投影しない。旧23の暗黙更新も行わない。
- 新規backupは同formatのversion3としschema24のみ収録する。旧v2はschema23、旧v1は既存host証跡を必要とする従来契約を維持する。新旧source/backup版の取り違えと未来版を拒否する。
- 新規資料版を推測しない。現実装の固定master/CV/revision/digestに完全一致する場合だけreplayする。別版は保留・拒否し、将来別decoderを明示追加する。

## 初期化・保存

1. 正式な初期値は空AttemptGraph、空receipt/ID/TODO発行履歴。新規RetainedStateは旧PlannerStateを継承せず、公式原行・内訳の空配列、本人適用unknown、scope null、卒業評価not_evaluated、安全フラグfalseを明示する。認定・修得単位を生成しない。
2. 新規sourceを再検証して空graphからcreateWorkspace/applyCommandで全receiptを順次再実行し、graph・owner/payload・Undo・usedTodoIds・issuedIds・retainedを全field照合する。
3. YI-06 controllerのpreview/明示採用/原文保護/Lock/CAS/原子的commit/容量制限/authority/可搬復旧を共有する。新規経路はmigration環境なしでも利用可能にし、旧Offeringを要求しない。
4. 新規sourceの制度master参照と全commandのIDを予約する。既存host予約をunionし、縮小・再利用しない。未知checkpointの衝突は拒否する。
5. 開発画面に独立した新規入口を置く。初期化preview→新規状態を未保存draftとして明示採用→seed付きWorkbenchを制度検索modeで開く。編集後の保存previewで原文保護・全件置換確認を必須とする。保存成功後だけloaded stateを変更する。旧migration modeは維持する。

## 検証計画

新規初期値・source改変/欠落/版混同・ordered replay改変・検索safe/ambiguous/conflict/bucket・複数Attempt・進捗/評価/TODO・厳格Undo・ID予約・Lock/CAS/失敗保全・v3別空host復旧を局所テストする。既存YI-06 suiteで旧23/v1/v2回帰を確認する。実Chromiumで新規→検索→登録→保存→reload→backup→別空context復旧とgate/production隔離を確認する。変更箇所型/Lint/diffを確認し、全体checkは同一HEADのCIを利用する。

本番Planner/CourseSearch/schema22/Offering/公式取込/卒業engineには接続しない。#183の既存graph検証の公開blockerと#181の証拠APIは別作業のまま維持する。

## 実装された境界

`newPlan.ts`は固定の制度masterから深いfreeze済みsourceを一度だけ構築する。入力state・replay結果はcacheしない。読込/保存ごとにsource全fieldを固定値と照合し、空graphから全commandを順次実行する。初期値や数量・順序・削除ticket・owner・receipt・発行IDの自己申告を採用しない。`codec.ts`のversion dispatchが23の旧移行replayと24の新規replayを分離する。

新規`retained`は旧`migration/RetainedState`を流用しない。旧型の内部schemaVersion22は移行元メタデータであり、新規に設定すべき値ではない。新規版では公式原行/内訳の空配列、本人適用unknown、scope null、not_evaluatedと安全フラグfalseのみを正式な初期値として保持する。認定単位・公式aggregate・卒業結果を合成しない。Attemptの希望年度・方式・identityが不明のままでも既存validatorの範囲で保存できる。

controllerの旧移行環境はobjectまたは遅延providerで受け取る。新規開始/保存/再読込/backup v3/復旧ではproviderを呼ばず、旧Offering・raw6・v22 rawを必要としない。開発画面でも旧環境は移行または23読込時だけ検証する。旧画面は`legacy-migration`、新規画面は`institutional-search`を明示し、seedの有無に検索の出自を推測させない。

新規previewのhandleは未保存draftとして採用できる。確定済み`loaded`とは別に保持し、明示保存成功までDBにもloadedにも反映しない。初期空状態を明示保存する操作も可能。既存保存がある場合は原文の存在/bytesと全件置換を表示し、実commitに原文保護・確認を必須とする。取消は保存しない。再読込操作は未保存draftを破棄することをlabelで明示する。

schema24の必須予約は全receiptのAttempt/operation/record/TODO IDと制度master参照UUIDのunion。新規sourceのCV等は共有資料参照であり、新規発行された本人identityではない。hostの過去予約とページ内の移行用発行予約も次commitへunionする。v3の`reservedIds`欠落はSHAを再計算しても拒否し、既存checkpointと衝突する未知履歴は拒否する。旧v1の同一host制限、旧v2のraw6・全予約検証は変更しない。

新資料版への自動適用、履歴compaction、異なる履歴のmerge、発行者認証は追加しない。schema24→23への変換は提供しない。旧実装は新しい版を拒否し、本実装は旧23/v1/v2を読み続ける。未対応版は元rawを保持したままfail-closedとする。

検証コマンドは`npm run test:attempt-persistence`（新旧両suite）、変更TS/TSXを指定したstrict TypeScript/ESLint、`test:attempt-persistence-browser`の`new source|gate:`、本番entryの推移的import検査。全体CIはdev向けDraft PRの同一HEADで確認する。ブラウザはChromiumの独立context・別loopback originであり、Safari/iPhone/Firefox実機を検証したとは扱わない。実行結果はDraft PRへ記録する。
