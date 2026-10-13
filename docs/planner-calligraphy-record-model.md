# 書道実技：本人記録と完成条件（Issue #152）

対象は日本文学科3コースの2026年度現行課程のみ。卒業最終判定・旧課程・教職・他学科の配分は変更しない。

## 公式根拠

2026年度『学習のしおり』冊子p.48g（PDF第50ページ）と3コースの構成単位表p.49–51。
[大学公式PDF](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf)。

p.48gの履修方法表は、添削10課題＋スクーリング受講・試験合格1単位、またはスクーリング受講・試験合格1単位を2回としている。通信（添削）のみで2単位は修得できない。添削単独の正式1単位とは扱わない。

指定URLから今回取得したPDFと監査資料はSHA-256一致：`bb7fee419cec0f9d421b1d206947cf8fb1facb69992d685352817f756d19c4a5`。公式リンク全体の再検証完了を意味せず、`sourceLinksReverified=false`を維持する。

## 不整合の原因とデータ所有者

旧科目進捗は通信Offering2単位とS1を単純加算して3/2・超過候補1を表示した。通信単独でも2/2完成になる。一方、卒業計算だけがS>=1を必要条件としていた。通信の「earned」は添削一括合格の明示記録ではなく、学習進捗・構成単位・公式aggregateの意味が混ざっていた。

| 所有者 | 意味と変更方針 |
| --- | --- |
| Offering.credits | 元の開講単位。通信2・S1は変更しない |
| PlannerItem | 既存履修状態・年度・学年・期・明示寄与。書道添削合格へ再解釈しない |
| correspondenceProgress | Offering IDをキーに保存する本人管理記録。既存reports/requiredReports/examGradeを保持し、任意のcalligraphyBatchStatusを追加 |
| CurriculumCourseProgress | 書道では加算総量ではなく、構成2単位の条件に対する進捗。completionEvidenceで公式/本人記録/根拠なしを区別 |
| ImportedCourseAchievement | earnedCreditsTotalが正本。公式原行・数量・照合情報は変更しない |
| ImportedStudyRecord | 内訳の原記録。合算して公式aggregateを再構成しない |
| importedCourseUserMeta | 利用者の年度・期等。保持し、修得証拠へ置き換えない |
| 卒業計算 | 既存の区分配分に共通書道判定のcompletedCreditsを渡す。正式な卒業判定はしない |

`plannerItemCreditContribution`の通常科目の規則は変更しない。書道通信の寄与は構成の独立単位として加算せず、明示した一括合格を完成条件に使う。科目の完成2はattempt寄与の和ではない（添削0＋S1のattempt寄与1に対して、組み合わせの構成完成2）。

## 最小永続モデルと互換性

schemaVersionは22のまま。`CorrespondenceCourseProgress.calligraphyBatchStatus`は任意：

- `not_submitted`：未着手
- `grading`：進行中
- `passed`：10課題一括合格
- フィールドなし：未確認。旧earned・評価・リポート・試験から推測しない

このフィールドを持てるのは、2026書道実技の正確な制度科目IDに属する通信2単位Offeringだけ。通常4単位通信科目では検証で拒否する。旧v22はフィールドがなくても読込・検証・保存・バックアップ・復元できる。読込時の自動変換は追加しない。

旧通信2単位とS1はデータを保持したまま、科目進捗1/2・未完成・卒業算入0として表示し、添削一括の状態確認を促す。本人が一括合格を明示すると、S1修得との組み合わせが完成する。「未設定」に戻す操作はこの任意フィールドだけを除去し、旧記録は残す。

新フィールドを理解しない旧アプリへの逆互換は保証しない。新旧タブを混在させず、本実装でバックアップ・復元する。新データを旧版向けに自動削除・変換しない。

同一Offering IDの別年度複製、新しいattemptの自動作成、10課題の個別管理、期限や再提出管理は導入しない。既存の異なるS1開講2件を利用する。

## 共通完成判定と値

`calligraphyProgress.ts`を科目一覧と卒業計算が共有。正確な制度科目IDで対象を限定し、適用課程・科目構成・Mapping・所属を確認する。情報欠落・矛盾で通常の単純加算へ戻らない。

| 記録（現行課程確認済み） | 科目進捗 | 完成 | 卒業算入（参考） | 由来 |
| --- | --- | --- | --- | --- |
| S1修得のみ | 1/2 | 未完成 | 0 | 本人記録 |
| 異なる開講のS1＋S1修得 | 2/2 | 完成 | 2 | 本人記録による条件達成 |
| 添削一括合格のみ | 0/2 | 未完成 | 0 | 単独の正式単位なし |
| 添削進行中＋S1修得 | 1/2 | 未完成 | 0 | 本人記録 |
| 添削一括合格＋S1修得 | 2/2 | 完成 | 2 | 本人記録による条件達成 |
| 合格後にS1を計画中へ戻す | 0/2 | 未完成 | 0 | 予定込みは2/2、現在修得とは別 |
| 旧通信2 earned＋S1、添削未設定 | 1/2 | 未完成・方式確認 | 0 | 無断推測しない |
| 旧通信2 earnedのみ | 0/2 | 未完成・方式確認 | 0 | 無断推測しない |
| 安全な公式2/S1または2/S2＋手動記録 | 2/2 | 完成 | 2のみ | 公式aggregate優先 |
| 公式null／0／1、完成根拠不足 | nullは確認できた量0、0/1は公式値 | 未完成または判定保留 | 0 | 手動で補完しない |

公式の完成判定は既存`deriveOfficialGraduationFacts`のH57条件をそのまま利用する。`officialGraduationFacts.ts`に変更はない。構成2・公式修得2・公式S1/S2・現行課程・認定/追加履修等の除外・正確なidentity・Mapping整合・重複行の既存ガードを維持する。

公式値がある書道では、手動earnedだけでなく将来計画を科目完成値へ重複加算しない。公式内訳を足さず、null/0を一括合格で補わない。照合未確定の候補・取込元リンクが同科目と重なる場合も完成を推測しない。照合そのものを名称で解決しない。

## 回帰検証

実装前dev `af52f37df7eaa44a1bc02c3ab7c12059fbcdce49`で基本24ケースを実行：6 PASS / 18 FAIL（3コース×6不整合）。修正後は同じ基本24ケース全件PASS。追加の公式優先・不確定値・状態変更・旧記録・schema22・バックアップ・UI/export・不正カタログの検証を含む書道74件がPASS。

H57既存50件を検証し、公式ケースの期待値は変更しない。旧手動H57テストではOfferingを1に変える手法を廃止し、通信2を保持したまま明示的な一括合格を入力する。旧Planner手動テストにも一括合格と現行課程を明示し、未設定の旧通信2は完成しないassertを追加した。

旧制度科目生成前カタログとの8学科同値テストは、今回意図的に変える書道の3Offeringだけを専用テストへ分離。ほかの科目は全状態・認定・卒論選択を含む既存比較を維持する。

PR #156の`manual-graduation-credits.test.mjs`（P1 39件）と`structured-professional-credits.test.mjs`（P2 72件）は変更せず全件PASS。168ケースの全出力比較も既存の6セル例外を増やさずPASS。

ブラウザは実Chromiumの独立contextと合成データで検証。本番プロフィール・データは使用しない。390pxでS1、S1＋S1、添削のみ、添削＋S1、旧通信2＋S1、公式取込ありを確認し、documentと科目カードの横はみ出しもassertする。一括状態変更・S1修得取消・保存・再読込・JSON復元で完成値が再計算される。画像撮影時のみsticky headerを非表示にし、長いカードへの写り込みを避ける。

自己テストPASSを独立監査完了とは扱わない。Draft PRのまま独立監査・レビュー待ち。iPhone Safari実機は今回のChromium検証に含まない。既存buildのchunk-size warningは残る。

## 最終ローカル検証（2026-10-13）

| コマンド | 結果 |
| --- | --- |
| npm run test:planner | 2451/2451 PASS、fail/skip 0（書道74、P1 39、P2 72、H57 50を含む） |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm run build | PASS（既存chunk-size warningのみ） |
| npm run catalog:check | PASS、321制度科目/686Offering |
| npm run test:extension | 54/54 PASS、fail/skip 0 |
| npm run test:bookmarklet | 168/168 PASS、fail/skip 0 |
| npm run test:planner-browser | 27/27 PASS、fail/skip 0 |
| 書道最終ブラウザ再検証 | 7/7 PASS、fail/skip 0 |
| git diff --check | PASS |

ブラウザ環境：既存Playwright 1.62.1とChromium headless shell revision1243。通常sandboxではローカルlisten EPERMのため、許可された実行環境で検証した。モジュール既定のChromiumパスは未導入だったので、既存ブラウザ実行ファイルを明示して成功を確認。実行不能のテストをPASSには含めない。

CIはdev向けDraft PRの作成後に確認し、結果・commit SHA・PR URLを最終作業報告に記録する。ブラウザsuiteは現行CIには含まれず、ローカル実Chromiumの検証結果として区別する。

変更ファイル：`calligraphyProgress.ts`（共通判定）、`curriculumCourseProgress.ts`・`graduationProgress.ts`（計算経路）、`curriculumCourseView.ts`・`PlannerPage.tsx`（保存状態の接続）、`plannerCatalog.ts`・JSON Schema・`validation.ts`・`correspondenceProgress.ts`（任意フィールドと検証）、`CorrespondenceProgress.tsx`（一括UI）、科目カード/旧進捗表示/履修子表示、`planTable.ts`・`plannerExport.ts`（進捗表示・エクスポート）、専用テスト・fixture・既存書道テスト・browser suite・package script・本書。`storage.ts`・backup実装・公式aggregate計算・カタログOfferingは変更せず、互換性は専用テストで確認。
