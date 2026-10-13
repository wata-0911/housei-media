# PR #157：独立監査P2 状態別参考値の修正

対象は同じ`feature/calligraphy-bulk-progress`とdev向けDraft PR #157。監査対象HEAD・今回の開始HEADは`9d21cff8ace7d425bbb8e758df17cbff641e7b4d`。作業開始時にGitHubのPR状態とfeature/devをfetchし、ローカル・リモートfeature HEADの一致、Draft状態、未コミット変更なしを確認した。

## 根本原因

旧コードは`projectedCredits - earnedCredits`をすべて`entry.planned`へ入れ、`entry.inProgress=0`にしていた。`projectedCredits`は構成単位の完成見込みで、planned / in_progress / waitingを含むため、履修状態別の数量とは一致しない。S1履修中は履修中0・計画中1と表示された。添削合格＋履修中S1では、条件成立後の構成2まで計画中へ入ってしまう。

実装変更前に監査最小再現を固定：日本文学3コースで3/3 FAIL、実測は卒業算入0・履修中0・計画中1。期待値は卒業算入0・履修中1・計画中0。同じテストを修正後に3/3 PASSとして確認した。

## 既存契約と明示的な配分

既存の`evaluateStructured`、`addOfferingTotals`、通常`professionalCards`は、`in_progress`を履修中、`planned`を計画中へ加算し、`waiting`をどちらにも加算しない。`GraduationProgress.tsx`はその二数量を「参考：履修中 … / 計画中 …」と表示する。科目一覧の予定込みは結果待ちも含む別の量である。

今回の書道の契約：

1. 完成判定・現在の構成進捗・卒業算入は、既存の添削合格＋修得済みS1、またはS1＋S1の条件を維持する。
2. `projectedCredits`は条件付きの構成完成見込み。状態別参考値へ直接割り当てない。
3. 状態別参考値は**実際のS1履修回の寄与だけ**を使う。添削一括合格は完成の前提条件であり、単独のearned / in_progress / planned単位を付与しない。
4. 修得済みの構成進捗が2単位の共通枠を先に消費する。残り枠ではwaitingを保留量として予約し、in_progress、plannedの順に配分する。一つの枠を状態ごとに2単位ずつ割り当てない。
5. waitingは派生モデルの`waitingCredits`に保持し、カードの履修中・計画中へ読み替えない。新しい永続フィールドや画面区分は追加しない。
6. 添削合格＋earned S1は構成完成2で枠を使い切る。別S1がplanned / in_progress / waitingでも保存状態を保持し、卒業カードの追加参考値は0とする。
7. 公式aggregate優先時は、手動の履修中・計画中・結果待ち参考値をすべて0とする。公式null / 明示0 / 部分値を手動で補完しない。

したがって、添削合格＋履修中S1は「現在構成0、予定込み2、卒業算入0、履修中1、計画中0」。`earned + inProgress + planned`が`projectedCredits`と一致するとは限らない。前者は状態別の実履修寄与、後者は必要条件が揃った場合の科目構成量である。

## 3コースの期待値・実測値

以下の契約は文学・言語・芸能文化で共通。計算モデルの全180ケース（各コース60ケース）の期待値と実測値は一致。実測の機械可読CSV/JSONはローカル再監査用証跡に保持する。

| ケース | 現在構成 | 予定込み | 卒業算入 | 履修中 | 計画中 | 結果待ち保留 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| S1 planned | 0 | 1 | 0 | 0 | 1 | 0 |
| S1 in_progress | 0 | 1 | 0 | 1 | 0 | 0 |
| S1 waiting | 0 | 1 | 0 | 0 | 0 | 1 |
| S1 earned | 1 | 1 | 0 | 0 | 0 | 0 |
| 添削一括合格のみ | 0 | 0 | 0 | 0 | 0 | 0 |
| 合格＋S1 planned | 0 | 2 | 0 | 0 | 1 | 0 |
| 合格＋S1 in_progress | 0 | 2 | 0 | 1 | 0 | 0 |
| 合格＋S1 waiting | 0 | 2 | 0 | 0 | 0 | 1 |
| 合格＋S1 earned | 2 | 2 | 2 | 0 | 0 | 0 |
| S1 in_progress＋S1 planned | 0 | 2 | 0 | 1 | 1 | 0 |
| S1 in_progress＋S1 waiting | 0 | 2 | 0 | 1 | 0 | 1 |
| S1 earned＋S1 planned | 1 | 2 | 0 | 0 | 1 | 0 |
| S1 earned＋S1 earned | 2 | 2 | 2 | 0 | 0 | 0 |
| 合格＋S1 earned＋S1 planned | 2 | 2 | 2 | 0 | 0 | 0 |
| 旧通信earned＋S1、添削未設定 | S1単独と同じ | S1単独と同じ | 0 | S1状態に従う | S1状態に従う | S1状態に従う |
| 公式2/S1・2/S2＋手動混在 | 2 | 2 | 2 | 0 | 0 | 0 |
| 公式null＋手動混在 | 確認済み量0 | 0 | 0 | 0 | 0 | 0 |
| 公式明示0＋手動混在 | 0 | 0 | 0 | 0 | 0 | 0 |
| 公式部分1＋手動混在 | 1 | 1 | 0 | 0 | 0 | 0 |

nullは元aggregateがnullのまま、完成判定はunknown。明示0は元aggregateが0のまま、incomplete。いずれも添削進捗・手動S1で公式修得へ補完しない。

最小再現の3コース実測：

| コース | 期待：算入/履修中/計画中 | 修正前 | 修正後 |
| --- | --- | --- | --- |
| 文学 | 0 / 1 / 0 | 0 / 0 / 1（FAIL） | 0 / 1 / 0（PASS） |
| 言語 | 0 / 1 / 0 | 0 / 0 / 1（FAIL） | 0 / 1 / 0（PASS） |
| 芸能文化 | 0 / 1 / 0 | 0 / 0 / 1（FAIL） | 0 / 1 / 0（PASS） |

## 変更ファイル・関数

- `src/planner/calligraphyProgress.ts`：`deriveCalligraphyProgress`がS1の寄与をearned / waiting / in_progress / plannedから個別取得。計算専用の`inProgressCredits` / `plannedCredits` / `waitingCredits`を返す。`schoolingReferences`が修得済み構成優先の共通2単位枠を配分。公式優先の早期returnでは三参考値を0にする。
- `src/planner/graduationProgress.ts`：`professionalCards`が`entry.inProgress`と`entry.planned`へ明示された参考値を接続。予定込み差分からの推測を削除。ほかの科目の経路は変更しない。
- `tests/fixtures/calligraphy-state-references.mjs`：独立した期待値の表。単独4状態、添削単独、添削＋4状態、S1＋S1全16組み合わせ、添削＋S1＋S1全16組み合わせ、旧通信4状態、公式5条件×混在3パターンで各コース60ケース。
- `tests/calligraphy-state-references.test.mjs`：最小3件、状態表180件（逆順の数量も確認）、状態変更3件、save/load/backup30件、公式nullと0の区別1件。合計217件。
- `tests/planner-save-lock.browser.mjs`：既存27件をそのまま保持。3コースの全状態表を実Chromiumのカード表示でassertする3テスト（計180ケース）、実UI状態変更・reload・JSON復元の3テストを追加。
- `package.json`：新しい状態別回帰ファイルを`test:planner`に追加。
- 本報告書。

## 不変条件と検証範囲

schemaVersion=22、graduationCheckComplete=false、sourceLinksReverified=falseを維持。構成2単位・添削単独の非単位性・完成条件・公式aggregate優先は変更しない。公式原行・内訳・source link・userMeta・保存モデル・スキーマ・バックアップ実装は変更しない。公式null / 明示0 / 部分値と手動併存で原データの往復一致を確認する。

既存テストの期待値、PR #156 P1/P2テスト、168ケースbaseline、H57公式条件は変更しない。他学科・通常科目の集計規則も変更しない。

追加の逆順テストは完成・予定込み・状態別量・卒業算入の契約を確認する。旧来の`partialCourses`明細には先頭Offeringの開講名によるラベル/表示値差があり、今回のP2状態別数量の修正対象には含めていない。別の明細表示問題として再監査時に確認が必要である。既存snapshotを更新してこの差を隠してはいない。

iPhone Safari実機は未検証。今回の画面assertはChromiumで行う。既存buildのchunk-size warningは残る。自己テスト成功は独立監査完了を意味せず、Draft PRのまま再監査・レビュー待ちにする。

## 実行結果

| 検証 | 結果 |
| --- | --- |
| 監査最小再現 | 修正前3/3 FAIL → 修正後3/3 PASS |
| 追加状態別回帰 | 217/217 PASS |
| npm run test:planner | 2668/2668 PASS、fail/skip 0 |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm run build | PASS、既存chunk-size warningのみ |
| npm run catalog:check | PASS、321制度科目/686Offering |
| npm run test:extension | 54/54 PASS、fail/skip 0 |
| npm run test:bookmarklet | 168/168 PASS、fail/skip 0 |
| npm run test:planner-browser | 33/33 PASS、fail/skip 0（3コース全180状態画面ケースを含む） |
| git diff --check | PASS |

PR #156 P1の39件・P2の72件、H57既存50件、168ケースの既存完全出力比較は期待値やsnapshotを変更せずPASS。ローカルはNode 24.13.0、既存Playwright 1.62.1 / Chromium headless shell revision1243で実行。許可されたローカル実行環境の独立contextを使用し、本番プロフィール・データを使っていない。

修正commit SHAとCIの対象HEAD・結果は、commit/push後の再監査用最終報告と同じDraft PR #157の説明に記録する。CIの既存jobはbrowser suiteを実行しないため、Chromium結果はローカル実画面検証として区別する。

## 明細表示差の後続修正

本書で記録した未完成明細の開講名依存差は、後続の残存P2修正で制度科目identityと明示的な証拠契約へ接続して解消した。[未完成明細の修正報告](planner-calligraphy-partial-details-p2.md)を参照。本書の検証件数と残存事項の記載は、ae13465時点の監査対応履歴として保持する。
