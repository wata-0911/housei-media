# YI-05 独立Attempt開発用ワークベンチ

Issue [#171](https://github.com/wata-0911/housei-media/issues/171)。開始時dev `afed0a9b6cb463fcbf7395e43fc817c6e30a18b0`、最終ベースdev `0cad72a50e7117c4c4712343f364925a9580f1ea`。独立clone、`feat/yi-05-isolated-attempt-ui`。他worktree・#145には変更なし。

本実装は開発・テスト専用。新PlannerState schema・保存・バックアップ・卒業算入・一般公開は実装しない。既存schema22、`graduationCheckComplete=false`、`sourceLinksReverified=false`、公式`earnedCreditsTotal`の正本性を維持する。[実装前計画](plan.md)、[検証結果](acceptance.md)、[後続引き継ぎ](handoff.md)、[変更ファイル一覧](files.md)を参照。

## 構成と責務

| 場所 | 責務 |
| --- | --- |
| `src/planner/attempts/workbench/operations.ts` | immutable Workspace、独立UUID発行、操作receipt、Attempt/record/TODO操作、YI-03 graph/transition検証 |
| `catalogView.ts` | Offering不要のYI-02検索、明示参照選択、候補Placement、新Attempt組立、owner/寄与/進捗view model、数値解析 |
| `migrationSession.ts` | decoder・固定割当・previewのページ内session、日付訂正提案と明示確認、元raw/発行表保持 |
| `dev/attempts/Workbench.tsx` | React adapter。最新Workspaceへの同期dispatch、成功時だけReact state更新、active/detached別表示 |
| `AttemptForm.tsx` | 制度科目・未確定科目、配置候補、希望年度/期/方式/学年/状態/寄与/根拠のdraftと確定操作 |
| `ProgressEditor.tsx` / `progressDefaults.ts` | 明示Attempt ownerのメディア・通信・評価入力。旧進捗ハンドラは呼ばない |
| `TodoPanel.tsx` | TODO本文・done・削除と、独立したowner変更操作 |
| `MigrationPanel.tsx` / `fixtures.ts` | 合成v22正常/不正日/不正月/未対応版fixture、保留・原値比較・確認・ready初期化 |
| `Fields.tsx` / `formHelpers.ts` | 明示label/id、IME Enter抑制、共通フォーム表現 |
| `gate.ts` / `vite.config.js` | serve＋非production＋プロセス環境変数の三重ゲート、無効時entry/module 404 |
| `main.tsx` / `style.css` / `tailwind.config.js` | 独立React rootと開発用CSS。production App・CSS entryに接続しない |

既存の`PlannerPage`はOffering IDで`state.items`、3進捗map、TODOを更新し、`commit()`から`savePlannerState()`へ保存する。既存backupパネルはraw/Lockを直接扱う。今回これらのPage/部品・callbackを新画面へ流用しない。制度masterと旧年間catalogを使うmigration fixtureは分離し、新規Attempt検索/操作には年間Offeringを要求しない。

## 開発用の起動と画面動線

```sh
npm ci --ignore-scripts --no-audit --no-fund
YI05_WORKBENCH=1 npm run dev -- --host 127.0.0.1 --port 4185
```

`http://127.0.0.1:4185/__dev/attempts`を開く。通常の`npm run dev`では404。`--mode production`、`NODE_ENV=production`、通常build/previewでは新entryを提供しない。URL queryやlocalStorageによる有効化はない。production Appからのリンク・importは追加しない。環境変数が1でもbuildのentryは既存indexのみ。

1. 「新しい履修回」から制度科目を検索・選択、または未確定科目名を入力する。Placementは明示した候補だけを保持し、本人適用を確定しない。
2. 希望年度・期・学年・方式・状態・本人寄与を入力して追加。同名科目も履修回ごとのIDを表示する。表示ソートはviewだけで、graph順/IDを変更しない。
3. 各行の「予定を編集」または「進捗・評価」を開く。メディア/通信/評価を明示的に開始し、draftを確定ボタンでメモリへ反映する。
4. 「計画から削除」でdetachedへ移す。「このAttemptをUndo」で復元。「別の新規履修回」は空の新規フォームを開き、旧進捗をコピーしない。
5. TODO欄でownerなし/明示Attempt/原版付き未解決旧Offeringを選ぶ。本文/完了とowner変更は別ボタン。削除済みAttemptもowner候補に残る。
6. migration欄は以下の独立フロー。readyを編集開始するには、現在の隔離編集を破棄するチェックが必要。同じ割当の再previewでは作業中のgraphを置換しない。

画面上部と反映通知に「未保存」「更新で消失」を明記。本番保存成功という表示、保存ボタン、通常backup生成はない。PC/390px幅で縦に配置し、fieldset/legend、label/htmlFor、button、details/summary、alert/statusを使用する。

## CRUDとID・owner不変条件

`Workspace`はYI-05のプロセス内controller状態であり、新保存schemaではない。graphとreceiptをdeep freezeし、入力をcloneして検証後だけ返す。失敗時に元Workspaceを変更しない。

- 新Attempt IDと作成操作IDを別々の`crypto.randomUUID()`で発行。科目・年度・方式・Offering・配列位置から導出しない。フォームは一回の追加要求に同じIDを保持する。
- `applyCommand`は操作IDで元要求を照合。完全同一再送は元Workspaceを返し、別内容の同ID再送は拒否。追加後に編集・削除しても、元追加要求の再送で増殖しない。別履修回は両IDを新規発行する。
- 同一制度科目/年度/方式/旧Offeringの別Attemptを許容。制度上の反復許可を意味しない。
- 編集可能fieldを限定し、ID・creationOperationId・membership・実績年度・原版参照・公式sourceリンクの書換えを拒否。methodを変更する場合は本人希望のみ。変更しなければ既存legacy/official provenanceをそのまま維持する。
- contribution省略/null/0を別表示。予定と実績、制度構成と本人寄与、statusと評価、earnedOrderと作成順は独立。数量・日付・状態・参照はYI-03を再利用し、不正入力を補正しない。
- payload編集はrecord IDで対象を限定し、owner/kind/他recordを変更しない。既存lesson番号・assessment ID・report番号の消失、既存書道fieldの消失を拒否する。必要リポート数を減らしても既存reportを維持する。
- mediaとcorrespondenceを同時保持できる。新規はcount null、空記録・未評価から開始し、OfferingやPlacementから必要数/grade/完成を推測しない。
- TODO IDは全体で一意。削除済みを含む使用済みTODO IDをページ内で保持し、再利用を拒否する。TODO owner変更は`assign_todo`に新ownerとexpectedOwnerを明示し、staleなら拒否。進捗のowner変更/削除は提供しない。
- 未解決旧ownerは原版refと理由のまま表示/編集する。旧参照がない空Workspaceに架空の旧ownerを生成しない。migration初期化後には実際に保持された原版refを明示選択できる。

## 削除・Undo・再履修

`remove`は元Attemptの完全snapshot、元active位置、削除操作IDを`AttemptRemoval`へ記録し、membershipだけをdetached/plan_deletedへ変更する。全record、無関係なAttempt/ticket、active相対順序は維持し、`validateAttemptPlanTransition()`で前後を検証する。

`undo`は指定した削除ticketのsnapshotを元ID・元active位置へ戻し、そのticketだけを消費する。他のactive行の順序を維持する。Undoの要求操作IDと、復元対象の削除操作IDは別。元位置が現在のactive件数を超える場合は`undo_position_conflict`として停止し、先に後続の削除をUndoする案内を出す。位置の丸めやticket書換えはしない。

削除済みAttemptの予定編集はUndoするまで禁止する。detachedの進捗・評価・TODOは明示編集でき、Undoでもその時点の全recordを維持する。旧孤立ownerは計画を捏造しないため、計画snapshotのない`legacy_orphan`にはUndoを提供しない。新規履修回は元snapshot/旧ownerから自動コピーしない。

## migration・日付訂正

隔離合成fixture→YI-04 `decodeMigrationSource`→`prepareMigrationIds`→`previewMigration`→ready graphのcloneを編集初期状態に使用する。raw6はVite raw importで原バイトを渡し、YI-04側でSHAを検証する。source/retained/元targetはsessionに残し、編集graphから上書きしない。

同rawの連続・同時inspectはsession/Promise cacheを使い、同じ発行handleを返す。再previewは同tableと同reservedIdsを使用し、乱数を再発行しない。CRUD後にはYI-04 preservation検証を適用せず、YI-05操作の許容差分とYI-03 graph/transition契約を適用する。旧projection/卒業engineは新UIから一切呼ばない。

`assessment_date` heldでは元assessment ID（slash等も保持）・旧Offering owner・原日付を表示する。実在日付または明示nullの修正案を作り、原値との差と「source digest変更・新ID割当・ID継承なし」を表示する。チェック後に発行済み提案handleだけを確認できる。未確認/偽handle/不正日付は拒否し、heldを維持する。

修正は原JSONの該当assessment.scheduledDate一箇所だけを変えた新rawを生成する。元rawは別sessionとしてそのまま保持する。新raw全体をdecode/previewし、新digestには新しい割当を発行する。以前の割当IDを予約し、訂正前後のIDを推測で継承しない。同じ提案を再確認しても新しい割当を増殖させない。他に不正日が残れば全体heldを継続する。新rawのJSON整形は変わり得るが、原rawの空白も保持し、訂正以外の全semantic field/owner不変をテストする。

保留/拒否のcandidateを直接編集して成功にする操作、本番訂正保存、一般利用者sourceの取得、ユーザーファイルの読み込みは提供しない。
