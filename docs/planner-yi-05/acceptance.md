# YI-05 実施検証

検証日: 2026-10-15〜16 (JST)。過去の監査PASSの転記ではなく、この作業cloneで実行。独立監査は未実施。

## 新規検証

新規は **77件 = ドメイン・adapter 69件 + 実React Chromium 8件**。`test:planner`にも69件を含めるため、全コマンドの件数を単純合算しない。

- CRUD: UUIDv4独立発行、同じ制度科目/年度/方式/旧Offeringの別Attempt、同一操作の再送と衝突、immutable ID・実績/原版/owner、数量/状態/参照の拒否。
- payload: media/correspondence/evaluationの混在維持、番号/assessment ID/書道fieldの無断消失拒否、null/0/省略、他Attempt不変。
- TODO: 本文/done/削除、ownerなし・明示Attempt・未解決旧owner、expectedOwnerによる明示再割当、削除済みTODO IDの再利用拒否。
- remove/undo: snapshot・元位置・active相対順・全record・detached owner保護、複数削除の位置競合、別履修回には新ID・進捗なし。
- migration: raw同時再検査の発行重複防止・固定割当再preview・保留原日付2種×実在日/うるう日/null・未確認/偽提案拒否・新raw全体再検証・原文/他field/owner保持・別不正日が残るとheld。
- 編集graphはYI-04元source完全一致検証や旧projectionへ渡さず、YI-05操作とYI-03 graph/transitionを検証。
- フォーム解析: 不正数値の無断補正なし。既存の空文字とnullは、別fieldの編集では区別して維持。

## 実ブラウザで操作した範囲

Playwright + ローカルChromium headless shell (1243)、PC 1280×900・モバイル幅390×844。実際のReact entryへ遷移して入力・クリック・キーボード操作した。

1. flag既定無効・queryで有効化不可・entry/module 404・production serveはflag=1でも404・通常v22画面を表示。
2. Offeringなし2035年・unknown同名3履修回の別ID、寄与未設定/null/0、ソート、キーボードEnterで編集、再読込で隔離state消失。
3. YI-02検索・制度科目選択・Placement候補、本人適用unknownの保持。
4. 動画/テスト・中間試験名/日付/完了、2027-02-30拒否とdraft維持、2028-02-29、通信リポート番号/合格/評価/必要数0/試験/書道一括、3種科目評価。履修statusは自動変更しない。
5. 390px TODO本文/完了/明示owner変更/削除、Attempt削除でTODO保持、元位置Undo、新履修回は別ID・進捗なし、横overflowなし。
6. 2027-02-30 / 2027-99-99のheld、元assessment ID・旧owner・原raw、原値と案の比較、確認前button無効、確認後新source ready、原raw保持、ready編集後の固定表再previewで編集graph不変、未解決旧owner TODO。
7. rejectedは編集開始不可。

隔離UI各ケースでprimary `hosei-planner:v1` / recovery `hosei-planner:v1:recovery`へ識別用原バイトを先置きし、Storageのget/set/remove/clearをtrap。**読み書き0件、原バイト不変、pageerror 0件**を終了時に検証。

[PC画面](screenshots/desktop.png) / [390px画面](screenshots/mobile.png) は最終8件PASSの実行から取得し、目視確認した。画面fixtureは合成データ。画像取得の先行実行でcold navigation 30秒timeoutが1件発生したため60秒へ延長し、全8件を再実行してPASS。検証assertionを削除・skipしていない。最新ベース再実行ではHTTP検査に一時的なECONNRESETが出たため、Node fetchの接続再利用を避ける `Connection: close` を指定し、全8件を再実行してPASSした。

## 全コマンドの結果

以下は開始時dev `afed0a9` 上で実装・実行した結果。最新dev `0cad72a` で変更された範囲は下記の追加検証を行った。

| コマンド | 結果 |
| --- | --- |
| npm run test:attempt-ui | PASS 69 / fail 0 |
| npm run test:attempt-ui-browser | PASS 8 / fail 0 |
| npm run test:attempts | PASS 132 / fail 0 |
| npm run test:migration | PASS 133 / fail 0 |
| npm run test:institutional | PASS 36 / fail 0 |
| npm run test:planner | PASS 3374 / fail 0 |
| npm run test:extension | PASS 54 / fail 0 |
| npm run test:bookmarklet | PASS 168 / fail 0 |
| npm run test:planner-browser | 開始時dev基準: PASS 44 / fail 0。最新devの既知差分は下記 |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm run build | PASS (既存chunk size警告のみ) |
| git diff --check | PASS |
| python3 docs/planner-yi-01/verify.py | PASS (321科目 / 502配置 / 686開講 / 209旧科目、status固定) |

ブラウザ再現用の環境変数は既存suiteと共通の `PLANNER_PLAYWRIGHT_MODULE` / `PLANNER_BROWSER_EXECUTABLE`。既にインストールされたPlaywrightとChromiumを指定した。依存追加・lockfile変更なし。必要なら `YI05_BROWSER_PORT` でport、`YI05_SCREENSHOT_DIR` で画像出力先を指定できる。

## 本番成果物と既存データ

開始時dev `afed0a9b6cb463fcbf7395e43fc817c6e30a18b0` をgit archiveして同じ依存でbuildし、YI-05通常build・flag=1 buildと比較。12ファイルすべてpath/バイトSHA256一致を確認した。作業中にdevへ#172（#145のバックアップ欄配置変更）がマージされたため、実装を最新 `0cad72a50e7117c4c4712343f364925a9580f1ea` へfast-forwardして載せ直した。#145の3ファイルはYI-05として編集していない。最終ベースでも `YI05_WORKBENCH=1 npm run build` の全12ファイルが最新dev単体buildとpath/SHA256完全一致した。[比較データ](build-comparison.json)。

新UIはproduction entryにimportせず、dev専用Tailwind設定とCSSを持つ。既存App/PlannerPage・storage・backup・graduation・catalog・schema22・公式原行・集計正本へYI-05差分を入れない。原データを移行/保存するコードは呼ばない。

## 最新dev取り込み後の追加検証

- `npm run test:attempt-ui-browser`: **8 PASS / fail 0**。flag、実React操作、storage trapを最終差分でも確認。
- `npm run typecheck` / `npm run lint` / `YI05_WORKBENCH=1 npm run build` / `git diff --check`: **PASS**。

- `node --import tsx --test tests/planner.test.mjs tests/attempt-workbench.test.mjs`: **498 PASS / fail 0**。変更されたbackupパネル期待・旧v1/v2互換/原文保護とYI-05の69件を再検証。
- 既存ブラウザのバックアップ関連3件: **2 PASS / 1 fail**。原文保護ダウンロード、Web Lockを待つ復元はPASS。メディアdraft復元は以下の最新dev単体と同一の失敗。
- 開始時dev上の全3374件・既存ブラウザ44件の実行後、上流で変更された3ファイルに対象を絞って追加検証。未変更のmigration全matrix等を二重実行して最終ベースの全件PASSと呼ぶことはしない。

## 最新devとの既知のテスト不一致

最新dev `0cad72a` **単体（YI-05差分なし）**を別ディレクトリへgit archiveし、既存 `restore invalidates an unsaved media draft even when the stored value is identical` を再実行した。1件fail: `locator.setInputFiles: Timeout 30000ms exceeded`、既存testの315行目でバックアップregion内file inputを待機する。

原因: #172/#145がバックアップ欄を年間計画タブへ移動した一方、既存testはメディアタブ表示中に同欄を探す。開始時devでは同じtestがPASSしている。YI-05は当該Page・backupパネル・既存testを変更していない。今回この失敗を隠すskipや#145範囲の修正をしない。**最新dev全ブラウザsuiteが全PASSしたとは報告しない**。既存testの期待とタブ移動後の仕様の調整は別途必要。

## 未実施・制限

Safari/iPhone実機、Firefox、スクリーンリーダー実機、OSの日本語IME実機、全キーだけの連続操作、低速端末・大規模graph負荷は未実施。新UIではlabel参照とEnter操作をChromiumで検証し、IME中Enterはhandlerで抑制する。

既存v22のCSV/PNGダウンロード、卒論/認定入力、全backup版の全組合せを今回それぞれ手動操作したとは扱わない。各既存の関数/保存回帰suiteとproduction成果物一致を根拠とし、実ブラウザsuiteの操作範囲を区別する。本番ユーザーの実storage・実個人成績は使用しない。

永続保存、新backup、長期/複数タブ再送、Web Lock/expectedRaw、新卒業算入は対象外。[YI-06/07・監査重点](handoff.md)へ引き継ぐ。
