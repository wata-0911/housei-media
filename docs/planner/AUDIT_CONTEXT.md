# 履修プランナー監査コンテキスト — 資料索引

> **区分:** 監査時の参照資料・手続の索引（新しい制度仕様や実装完了承認ではない）
> **初版:** 2026-11-07
> **配置:** `docs/planner/AUDIT_CONTEXT.md`（`wata-0911/housei-media`）
> **状態:** 監査資料索引。実装完了や監査PASSを意味しない。

## 1. 用途

F01（正本・移行・復元）、F02（履修完成・卒業算入）、および後続F03/F04の実装担当Solと独立監査担当Astraが、**同じ根拠資料**を参照するための入口である。プロジェクト外のWorkにも、毎回この索引と対象PRの**固定HEAD**、最新の独立監査報告を明示的に渡す。

このファイルは既存の仕様書・大学資料・監査証拠を複製しない。文書に古い基準commit・古い進捗が書かれている場合は、その時点の履歴とみなし、現在の実装状態を代弁させない。

## 2. 原資料と証拠の保管場所

| 役割 | 参照先 | 使い方 |
|---|---|---|
| 大学公式資料の保管フォルダ | [Google Drive「履修プランナー｜監査基準資料」](https://drive.google.com/drive/folders/1zZ-ybgdxJN5F8EYAniQlWJIM9-97Hv-b) | 制度・課程の原資料を保管する非公開フォルダ。フォルダURLだけで各PDFを読めたとみなさない |
| 2026年度『学習のしおり』PDF（Drive内の個別原資料） | [shiori2026.pdf](https://drive.google.com/file/d/1SbEuw-UqWVrldxGbVZg9tXStC_67kJkQ/view?usp=drive_link) | 2026-11-07に名称・PDF形式・14,702,159 B・上記フォルダ所属・非公開設定をDrive metadataで確認。監査時は対象冊子ページ・PDFページとの対応を既存[根拠台帳](../planner-yi-01/official-evidence.md)と照合。**Workによる本文の読取成功や大学原本とのバイト一致まで確認済みという意味ではない** |
| 大学が公開する2026年度の原本 | [2026年度『学習のしおり』公式PDF](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf) | 原本のページ画像・原文で表や注記を検証する。取得できなければ未確認とする |
| 実装・既存設計書 | [GitHub `dev/docs`](https://github.com/wata-0911/housei-media/tree/dev/docs) | 参照時は文書の基準SHA・適用範囲と、PR側の固定HEADの違いを記録する |
| 実装者・監査者の報告 | [Google Drive「成果物」](https://drive.google.com/drive/folders/1qezzbwOr-khItV4h483iKbDleGmmLc_n) | 最終報告、完全差分、独立反例、実行ログを1件のZIPまたはMarkdownに集約。公式資料のフォルダと混在させない |

**原資料の扱い:** 公式表の「科目構成単位」「卒業所要単位」「方式Ⓢ/Ⓜ」「適用課程」「年度開講」「本人の修得申告」は別概念とする。原表にない単位・開講・適用課程や本人の資格を推測で補完しない。月刊『法政通信』で個別年度の開講・日程・履修条件を確認する運用と、履修プランナーの恒久仕様とを区別する。

## 3. 既存GitHub資料の索引

### 制度・課程の共通根拠

- [YI-01公式教育課程表の根拠台帳](../planner-yi-01/official-evidence.md) — 原表、行単位の出典、構成単位と卒業所要単位の違い。
- [YI-01公式科目コード](../planner-yi-01/official-codes.md) — 採番・科目区分の既存記録。
- [2026卒業エンジン監査](../graduation-engine-audit-2026.md) — 監査時点の制度要件・計算と未解消事項。最新の承認状況は必ず別照合。
- [学科・年度非依存の基本設計](../planner-year-independent-design.md) と [課程公開方針](../planner-curriculum-release-policy.md) — 制度identity、開講・適用課程、公開の境界。
- [CurriculumCourse中心モデル](../planner-curriculum-centered-model.md) — モデルの設計経緯。**歴史的な「未実装」「次slice」の表現を現在の実装状態として再利用しない**。
- [旧Plannerのアーキテクチャ記録](architecture.md) — 旧schema22・従来UIの理解用。冒頭の基準時点を必ず読む。

### F01 — Authority・永続化・移行・復元

- [YI-06 README](../planner-yi-06/README.md)、[保存契約](../planner-yi-06/persistence-contract.md)、[新規計画](../planner-yi-06/new-plan.md)、[可搬復旧](../planner-yi-06/portable-recovery.md)、[バックアップ契約](../planner-yi-06/backup-contract.md)、[受入履歴](../planner-yi-06/acceptance-p2.md)。
- 現在の修正対象は[Draft PR #238](https://github.com/wata-0911/housei-media/pull/238)。**データ保存仕様の現在値を判断する際はPRの固定HEAD内のコード・試験・直近の独立監査**を直接照合する。上記YI-06資料だけでF01全体PASSと判断しない。
- 旧原文、既知発行ID、`schemaVersion`、異形式の保護、CAS/Web Lock、当該保存値の再読込可能性、数値字句、容量・性能は、相互に独立した安全境界である。

### F02 — 科目完成・卒業算入・課程適格性

- [YI-07 README](../planner-yi-07/README.md)、[adapter契約](../planner-yi-07/adapter-contract.md)、[consumer監査](../planner-yi-07/consumer-audit.md)、[受入履歴](../planner-yi-07/acceptance.md)。
- [外国語の既存調査](../planner-foreign-language-investigation.md)、[専用科目・特例](../planner-special-cases-2026.md)、上記の公式課程表根拠台帳を併読。
- 現在の修正対象は[Draft PR #239](https://github.com/wata-0911/housei-media/pull/239)。YI-07 READMEは初期adapter段階の記録を含むため、**PR最新固定HEADと最新独立監査を確認せず「新Attempt算入は未実装」等の歴史的記述を現在形にしない**。
- `本人原量`、`科目構成の完成`、`卒業への配分`、`確認済みS`、`予定込み`、`unknown/保留`、`公式行`を混同しない。本人の申告方式だけで制度上のS適格性を捏造せず、正規Sを別の未立証行だけで消さない。

## 4. 監査上の根拠の優先順位

1. **制度の規範** — 対象年度・対象課程の大学公式原文、確認できた公式補足・注記。ページと版を引用する。異年度の制度へ無断で一般化しない。
2. **採用済み設計・明示決定** — GitHubの設計・承認済み契約。ただし古い時点の説明・未採用案と現在の承認範囲を区別する。文書間が衝突したら「未確定」として根拠を提示する。
3. **実装の現在事実** — 対象PRの固定HEADにあるコード、テスト、データ、実際の保存・計算結果。`dev`の別SHAの結果を混在させない。
4. **独立監査の反例** — 再現入力、期待・実測、保存前後のバイト/ID/数量、影響範囲。CI GREENだけで欠陥を否定せず、監査者の主張も根拠なしに規範へ昇格させない。

根拠が不足した場合は確定単位や履修資格として表示せず、保留と不確実性を残す。法政大学の正式な卒業判定・取得年・本人の実成績をアプリの合成データから保証しない。

## 5. Workに渡す固定入力（毎回）

監査用Workを立ち上げる管理者は、次を一緒に指定する。

- この索引の**Git commit SHA**とパス（単なる`dev`参照は監査中に動く可能性がある）。
- 対象PR番号、base SHA、**固定HEADとtree**、監査時に禁止する変更範囲。
- 最新のSol成果物・前回Astra独立監査**それぞれの個別Driveリンク**。フォルダだけを渡して読めたことにはしない。
- 該当する2026年度『学習のしおり』の**[PDF個別リンク](https://drive.google.com/file/d/1SbEuw-UqWVrldxGbVZg9tXStC_67kJkQ/view?usp=drive_link)**と対象冊子ページ（F02など制度判断がある場合）。Work側のGoogle Drive権限と**実際に開けたか**を確認する。読めなければ未読と明記し、フォルダ一覧やリンク表示だけで内容を確認したと報告しない。
- 実装者Solと監査者Astraは別Workを使用。Astraは独立clone/隔離環境・合成データで読取監査を行い、製品PR・dev・mainを変更しない。
- 実行済みの確認だけを報告し、PASS/BLOCKED/INCOMPLETEを区別する。F01・F02単独PASSはF03/F04・地理K4/K5・統合・公開の承認を意味しない。

## 6. 報告・成果物の形式

最終成果物（報告、diff、RED/GREEN、ログ、残存リスク、引継ぎ）は**1つのZIPまたはMarkdownファイル**にまとめ、上記のGoogle Drive「成果物」に保存する。

完成後、指定済みのChatGPT会話「単位計画8」に、判定・対象PR・HEAD/tree・成果物ファイル名・Drive個別リンクを直接報告し、実際の到達を確認する。送信できない場合は成功扱いせず、原因を報告する。Driveの権限を無断で広げない。

## 7. 未受入の分離

F01保存正本、F02計算、F03進捗・取込、F04通常`/planner` UIとの接続、地理K4/K5、他の制度課程の境界、実機Safari/Firefox、停電・非協調writer、統合公開は各々別の受入である。**どの項目が現在PASSかはこの索引へハードコードせず、GitHubと最新の独立監査証拠から毎回確認する**。
