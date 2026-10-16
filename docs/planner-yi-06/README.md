# YI-06 隔離Attempt永続化・復旧基盤

Issue [#175](https://github.com/wata-0911/housei-media/issues/175)。基準は作業開始時にfetchした `origin/dev=a0fa267ca1acd4663c399da394552c46de366cbc`。専用clone・`feat/yi-06-attempt-persistence`。独立監査前のDraft。一般利用者のv22、primary/recovery、公式集計、卒業engineを切り替えない。

**実装範囲は同一ブラウザの信頼済み保存履歴が残る隔離環境。別端末・DB消失後の新backupの復元は未対応であり、YI-06の無条件な完全完了とはしない。** ファイルだけから過去の乱数発行・要求履歴の真正性を証明する方法はない。自己申告のSHAや埋込み秘密鍵で代用せず、履歴のないファイルは保護して拒否する。詳細は [保存契約](persistence-contract.md)、[backup契約](backup-contract.md)、[受入結果](acceptance.md)、[引継ぎ](handoff.md)。

## 実装の構成

| 場所 | 責務 |
| --- | --- |
| `src/planner/attempts/persistence/contracts.ts` | 明示的なschema23・source evidence・history・backup・host storage契約 |
| `codec.ts` | strict JSON、raw6再測定、原版/source再decode、固定割当の構造検証、初期target再構築、CRUD順次再実行、全field比較 |
| `controller.ts` | 生きた移行handle/確定履歴による権限境界、preview、訂正、保存、再読込、backup、CAS、永久ID予約 |
| `indexedDb.ts` | 固定の隔離DB、read-only read、Web Lock内での原子的CAS・一回put |
| `dev/persistence/` | 合成fixture/貼り付け旧原文、比較・保護ファイル・明示確認、隔離保存・再読込・ファイル復元 |
| `dev/attempts/Workbench.tsx` | optional seed/dispatchを追加して既存CRUD画面を再利用。通常YI-05のメモリ動作を維持 |
| `tests/attempt-persistence*` | 単体/統合と実Chromium。旧suiteのskip・削除なし |

YI-04のWeakSetを削除・再登録しない。`checkMigrationAssignmentStructure`を構造検証として公開しただけで、`validateMigrationAssignments`はJSONコピーを引き続き拒否する。再読込の権限は別のYI-06 controllerに閉じる。YI-05の日付訂正提案生成を純粋helperとして共有し、両controllerの発行済みproposal＋明示確認ゲートを維持する。

## 版の境界

| 対象 | この実装 |
| --- | --- |
| 通常PlannerState | schema22を継続。既存型/保存schema未変更 |
| 隔離Attempt state | `format=hosei-attempt-state`, `schemaVersion=23` |
| 旧backup | `hosei-planner-backup`, v1/v2 → YI-04の明示migrationのみ |
| 新backup | **別format** `hosei-attempt-backup`, `backupVersion=1`。旧backup v1と無関係 |
| 旧原文保護 | `hosei-planner-protection`, v1。通常復元・移行拒否 |
| 隔離原文保護 | `hosei-yi06-protection`, v1。任意原文を持つ保護専用。復元decoderなし |
| 旧catalog/互換性 | schema1 / compatibilityVersion1。原版full/semanticとraw6のSHAを別保持 |
| migration | `yi-04:state22-attempt`, version1を維持 |
| 永続replay規則 | `yi-06:replay`, version1。未知rule/版は拒否 |

新backupを旧formatのv3としなかった理由は、同一ブラウザの発行証跡を要求する独立契約を、既存の可搬v1/v2復元と混同させないため。旧decoderを緩和・置換しない。

## 保存schema23

| field | 内容・検証 |
| --- | --- |
| `format/schemaVersion/rule` | 固定値、未知field/未来版拒否 |
| `source` | 元種別、元schema22、空白込みraw、実測raw/state SHA、元catalog全文/full/semantic SHA、元catalog metadata、raw6原文と実測SHA、互換version |
| `corrections` | 訂正前raw・提案後raw・assessment ID・旧Offering・旧日付・新日付・訂正前割当。全chainを再検証 |
| `catalog/catalogSha256` | migration時の対応target catalog全文とdigest。現在の監査原版と互換再確認 |
| `binding/assignments/ledger` | source/rule binding、旧slot→独立ID、予約ID、全field pointer対応。原配列順を維持 |
| `graph` | active/detached Attempt、所有付き進捗/評価/TODO、削除snapshot/元位置/ticket |
| `retained` | 旧stateの非Attempt情報すべて。内部schemaVersion22は**元stateのメタ情報**で、新stateの版ではない |
| `history` | 元要求の順序付きreceipt、発行済みID、削除済みを含むTODO ID |
| `verification` | source完全往復済み、graph/retained/master digest。署名ではない |

単なるWorkspaceのJSON化ではない。sourceは明示evidence型へ射影し、runtime context/WeakSet capabilityを保存しない。読み込みではsourceを再decodeしてcontextを再構築する。retainedは常に元sourceと一致を要求し、公式原行・earnedCreditsTotal・年度根拠・meta・公開科目・認定・卒論は編集しない。編集graphにはYI-04の元source完全一致検証を適用せず、YI-05の許可操作を順に再実行して比較する。

## 開発用起動

```sh
YI06_PERSISTENCE=1 npm run dev -- --host 127.0.0.1 --port 4206
```

`http://127.0.0.1:4206/__dev/persistence`。通常の開発originと分ける。serve・非production・環境変数が厳密に1の場合だけ有効。query/localStorageでは有効化しない。無効時はentryと直接module（URL encoding・`/@fs`経由も含む）を拒否。通常build/flag付きbuildのentryは既存indexだけ。通常`PlannerPage.tsx`へimportなし。

画面は元raw/数量/owner件数/台帳/実測容量を示し、保護ファイルを書き出して保存先確認後に全件置換する。編集はdraftであり、保存成功後だけloaded stateを切り替える。再読込エラーでは原文を残し、検証失敗時も原文保護ファイルを書き出せる。初期化/自動修復ボタンを提供しない。全履歴の再検証は現在数秒かかるため処理中は操作を無効化する。
