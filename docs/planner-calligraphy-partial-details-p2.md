# PR #157：未完成科目明細の残存P2

開始・監査対象HEAD：`ae134652ea77b0f31b6c7481e12dc2e8419be381`。
同じ`feature/calligraphy-bulk-progress`、dev向けDraft PR #157で修正。作業開始時にPR情報とfeature/devをfetchし、ローカル・リモートHEAD一致、Draft状態、未コミット変更なしを確認した。

## 修正前の実測

実カタログの夏期S1とゴールデンウィークS1を明示的に選び、日本文学科3コースで以下を固定した。各コース4ケース、計12件すべて修正前FAIL。現在構成進捗はすべて1、卒業算入はすべて0。

| 入力 | 修正前の未完成明細 | 正しい明細 |
| --- | --- | --- |
| 夏期S1 earnedのみ | 書道実技 0/2 | 書道実技 本人記録の構成進捗 1/2・卒業算入0 |
| GW S1 earnedのみ | 書道実技（ゴールデンウィークスクーリング）1/2 | 同上 |
| 夏期earned＋GW planned、夏期先頭 | 書道実技 0/2 | 同上 |
| 同じ2レコード、GW先頭 | GWの開講名 1/2 | 同上 |

原因は二つ。`isCalligraphyPracticum`が表示ラベルで書道を識別し、夏期の名前だけを除去するラベル処理でGW先頭時には判定が変わった。さらに、共通書道判定の分岐では構成進捗1を取得済みなのに、明細だけが未更新の`earnedSchooling=0`を再判定して0へ落としていた。

## identityと証拠契約

`CurriculumEntry.curriculumCourseId`に正確な制度科目identityを保持する。`completionId`は配分/group keyであり、表示ラベルもidentityではない。`isCalligraphyPracticum`は2026書道実技の正確なIDとの一致のみを使い、本人記録・公式allocationの両経路から同じidentityを渡す。特殊完成条件も同じidentityで接続する。

書道の表示ラベルは制度科目定義のcanonicalNameから取得する。夏期/GWのOffering名や入力順で変わらない。表示名を変えたOfferingでも判定・明細は同じで、逆に別identityの通常4単位科目へ「書道実技」という表示名を付けても書道ルールを適用しない。

計算専用の`calligraphyPartialProgress`は、明細に使用する構成進捗と証拠の種類を保持する。

- 本人記録：共通判定が安全にincompleteと確認し、公式優先でない場合の構成進捗を使用する。S1 earnedは1/2。添削だけは0なので明細を生成しない。完成2の場合も未完成明細を生成しない。
- 公式成績：既存`deriveOfficialGraduationFacts`が安全に配分した公式aggregateだけを使用する。現在のH57は安全な公式2/S1・2/S2を完成2として配分するため、未完成明細には入らない。
- 公式不明・明示0・部分値・identity未確定等：既存の公式優先/保留を維持。手動S1を正式修得の明細へ補完しない。保留した公式値は既存の公式通知・成績表表示に残す。
- 適用課程未確認・旧課程等：本人記録から安全な未完成/完成条件を確認できない場合は書道の本人記録明細を作らない。GWラベルを使って共通判定の保留を回避しない。

`partialCourses`に計算/表示専用の任意`evidence`を渡す。書道の本人記録では次の本文に固定し、正式修得の証拠や卒業算入と混同しない。

> 書道実技 本人記録の構成進捗 1 / 2単位（未完成・卒業算入0）

書道以外の通常明細の既存文言と集計は変更しない。添削を正式な単独1単位へ変換する表現を追加しない。

## 修正後の期待値・実測

文学・言語・芸能文化で同じ結果。最小12件は12/12 PASS。3コース×60状態/公式混在ケースでは未完成明細と卒業計算の全出力について入力順の一致も確認した。

| 記録 | 未完成明細 | 卒業算入 |
| --- | --- | ---: |
| 夏期またはGW S1 earned | 本人記録の構成進捗1/2、制度科目名「書道実技」 | 0 |
| earned S1＋未修得S1、両順序 | 同じ本人記録1/2 | 0 |
| 添削一括合格のみ | なし | 0 |
| 添削一括合格＋未修得S1 | なし（現在構成0、予定込みは従来どおり） | 0 |
| 添削一括合格＋earned S1 | なし（完成2） | 2 |
| S1 earned＋S1 earned | なし（完成2）、両順序で同一 | 2 |
| 公式2/S1・2/S2＋手動 | 本人記録明細なし、公式完成2を一度だけ算入 | 2 |
| 公式null・明示0・部分1＋手動 | 手動で補完した明細なし、既存の公式表示/保留を維持 | 0 |

構成完成条件、予定込み、履修中/計画中/結果待ちの配分契約は前回修正のまま。今回`calligraphyProgress.ts`に変更はない。

## 変更ファイルと検証

- `graduationProgress.ts`：CurriculumEntry、isCalligraphyPracticum、professionalCardsの共通判定/公式接続、partialCoursesを修正。
- `GraduationProgress.tsx`：本人記録の明細本文を証拠の由来と卒業算入0が分かる表現にする。
- `calligraphy-partial-details.test.mjs`、専用fixture：最小12件、3コース状態表180件、適用未確認/旧課程6件、表示名とidentityの独立2件、計200件。
- `planner-save-lock.browser.mjs`：既存180画面ケースにもpartialCourses本文/有無のassertを追加。夏期/GW単独・両順序12画面を3テストで追加。
- `package.json`：新回帰ファイルをplanner suiteへ追加。
- 本報告書と前回報告書の解消注記。

既存のテスト期待値とsnapshotは緩和・更新していない。PR #156 P1/P2テスト、H57公式条件コード、168ケースbaseline、保存/スキーマ/バックアップ実装を変更していない。schema22、graduationCheckComplete=false、sourceLinksReverified=falseを維持。公式原行・内訳・source link・userMetaを再構成・変更しない。

| 検証 | 結果 |
| --- | --- |
| 最小12ケース | 修正前12 FAIL → 修正後12 PASS |
| 新しい明細回帰 | 200/200 PASS |
| npm run test:planner | 2868/2868 PASS、fail/skip 0 |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm run build | PASS、既存chunk-size warningのみ |
| npm run catalog:check | PASS、321制度科目/686Offering |
| npm run test:extension | 54/54 PASS、fail/skip 0 |
| npm run test:bookmarklet | 168/168 PASS、fail/skip 0 |
| npm run test:planner-browser | 36/36 PASS、fail/skip 0（180状態本文assert＋最小12画面を含む） |
| git diff --check | PASS |

PR #156 P1 39/P2 72、H57既存50、168全出力比較も期待値とsnapshotを変更せずPASS。前回の状態別参考値回帰217件も維持する。CI対象commit、PR URL/最終HEADはcommit/push後の再監査用最終報告に記録する。Chromiumは独立contextの合成データで実行し、本番データを使わない。iPhone Safari実機は未検証、既存build chunk-size warningは残る。自己テスト成功を独立監査完了とは扱わず、Draftを維持する。
