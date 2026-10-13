# Issue #153: 公式反復科目の証拠契約と実装範囲

対象は2026年度現行課程。開始devは `483a4ab725bb44cfd1d61f76fdc83e9582e9f642`、ブランチは `feature/153-official-repeatable-evidence`。PR #156・#157・#148は開始時点でdevへマージ済み。自己検証は独立監査ではなく、Draft PRで監査を待つ。Refs #153。

2026-10-14再開時、devは `fe47963a1273768443e8e0ecec369adef35f54b7` へ進んでいたため、通常mergeで取り込んだ（PR #158〜#161）。#159の責務別ディレクトリ変更に合わせ、新モジュールを `src/planner/graduation/`、既存モジュール参照を移動後のパスへ統合した。履歴の書換えはしていない。

## 公式根拠と既存実装

[2026年度学習のしおり](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf)を2026-10-13に再取得。SHA-256は `bb7fee419cec0f9d421b1d206947cf8fb1facb69992d685352817f756d19c4a5`。既存#133監査に使用された原版と同一。冊子ページに2を足すとPDFページになる。

| 学科 | 対象 | 上限 | 冊子ページ・注記 | 今回の扱い |
| --- | --- | --- | --- | --- |
| 法律 | 政治学 | 2回4単位 | 47 d | 証拠条件を満たす公式S2を算入 |
| 法律 | 法律学演習 | 4回8単位 | 47 e | Offering 0件でも制度科目IDで算入 |
| 法律 | 法律学特講 | 4回8単位 | 47 f | 同上 |
| 法律 | 総合特講 | 8回16単位 | 47 g | 全体S参考へ算入、法律専門S8から除外 |
| 経済 | 経済学特講・経営学特講 | 各4回8単位 | 57 d/e | 証拠条件を満たす場合のみ算入 |
| 経済 | 演習 | 2回4単位 | 57 h | 現行の正確な制度科目IDのみ |
| 商業 | 経済学特講 | 4回8単位 | 59 d | 証拠条件を満たす場合のみ算入 |
| 商業 | 経営学特講 | 8回16単位 | 59 e | 経済学科の上限と区別 |
| 商業 | 演習 | 2回4単位 | 59 h | 現行の正確な制度科目IDのみ |
| 史学 | 歴史資料学 | 6回12単位 | 53 i | 現行descriptor「歴史資料学1〜6」の正確なidentityと原行名が一致する範囲 |
| 日本文学3コース・史学・地理・経済・商業 | 総合特講 | 8回16単位 | 48 d / 53 h / 55 j / 57 f / 59 f | 既存の選択区分へ算入 |

上限は `REPEATABLE_CREDIT_RULES` を再利用し、数値の変更はしない。公式資料では旧「経済学演習」「経営学演習」を現行演習と合算する上限が示されている。しかし、これは個人の旧原行を現行制度科目へ同定する根拠とは別である。現行マスター・成績contractに安全な旧ID対応がないため、旧名称は読替しない。旧名の原行へ手動で現行IDだけを付けても、新しい証拠経路は拒否する。

参照した設計・監査: `graduation-engine-audit-2026.md`、`graduation-false-unknown-audit-2026.md`、`planner-graduation-unknown-audit.md`、`planner-year-independent-design.md`、YI-01 stable ID / YI-02 handoff、PR #156/#157の設計・回帰。#149は制度科目中心の検索・追加の別Issueであり、本変更で架空Offeringや新規計画UIを作らない。地理の段階配分は#154に残す。

## 何が確定できるか

| データ | 権威と限界 |
| --- | --- |
| CurriculumCourseとMapping | 正確な制度科目identityと所属別の割当。年度Offering、表示名、legacy Courseとは別。候補先頭を選ばない |
| ImportedCourseAchievement | 公式の科目行。`earnedCreditsTotal` がその原行の正本。科目全体を無条件に合計した値でも、1回分を保証する値でもない |
| `source-v2` fingerprint | 取込当時の原行名・分類・2枠のS原文・4リポート・通信試験・同一行出現番号。取得日時・aggregateとは別の原行証拠 |
| ImportedStudyRecord | 原行に紐付く内訳。表示用の年度・期・Offeringは本人が編集できる。これらを独立回の証拠にしない |
| 同じID/slotの複数コピー | スナップショット。同じ原文・日付・単位・評価を照合できれば1回のまま。矛盾は保留 |
| 異なる原行/slot | 別回の可能性があるだけ。下記の全条件で独立性とaggregateの分割を確認できた場合に限り採用 |
| 手動PlannerItem | 本人の計画/履修管理。公式aggregateの補完材料にしない。公式IDが所有するmanual earnedは既存処理で除外 |
| UnifiedCourseRow | 表示用の統合。表示上の名称照合・年間Offering補修は算入のidentity根拠にしない |

現行contractは1公式行につきS2枠までで、永続Attempt IDを持たない。したがって1行のaggregateが6以上でも、6÷2から3回と推定しない。3回以上は、個々のaggregateが内訳に一致する複数の独立公式行が必要。再取込のrefreshは既存#129の規則をそのまま使用する。別年度の追加原行を既存行の更新と安全に識別できない再取込は、取込段階で引き続き保留される。

## 独立修得回の必要条件

1. 適用課程が `current_2026`。公式2026 CurriculumCourseの正確なIDが保存・検証され、関連Mappingが存在する。選択所属に対する全候補Mappingの配分signatureが一致する。
2. 今回の限定経路は構成2単位、専門教育・選択、fieldなし、S専用、mediaOnlyなし。同じMappingを別制度科目が所有したり、同じfamilyを複数IDが別々に所有するカタログは保留する。
3. 各原行が `hosei_import` の検証可能な `source-v2` で、同一原文の出現番号が0。正規化した原行名が現在の制度科目名と一致する。テーマ付き別名や旧名を推測しない。
4. 通信・リポート・認定免除・追加履修の混合は本経路の対象外。認定済み専門科目がある場合も、新たな重複解決をせず保留する。
5. 原行の全occupied S枠に、原行ID・slot・原文年度・原文期・実在する日付・2単位・合格評価が一致する内訳がある。既存 `isNativeComponentSnapshot` を再利用する。D、未評価、`*2`、S1、余分な旧スナップショット、内訳欠落は保留。
6. 年度は原文 `rawYear` に明記され、日付の大学年度（4月起算）と一致する。取得日時や編集済みacademicYear/term、Offering年から推定しない。
7. **制度科目内の全修得回で、原文の年度も修得日も互いに異なることを要求する。** 同一年度の別期・別日でも、現行データにより強い履修回IDがないので保留。必要条件を満たす実績だけを狭く開放する。
8. 各公式行の修得aggregateとS aggregateが、上記で個別に証明した全2単位内訳の合計と等しい。これは比較契約であり、aggregateを内訳から生成・補正する処理ではない。
9. 同一source IDの矛盾、同一record IDの競合、別slot/原行に重なる年度または日付は科目全体を保留。安全な一部だけを抜き取って矛盾を隠さない。

ここで年度・日付は、公式原行に照合した「独立した完結済みS2」の重複判定に使う。名称・単位数・取得日時だけでは採用しない。同一年度の正当な反復を落とす保守性は意図的であり、制度上の「年1回制限」を追加したものではない。

## aggregate、数量、重複、配分

- 原行のaggregate、内訳、fingerprint、出典、userMetaは変更しない。nullは未確定、0は大学の明示0として保存する。0と合格済みS内訳が矛盾する場合は、画面・全体参考も保留し、0修得確定として扱わない。
- 単一行のFactはそのaggregateを保持する。複数行Factの `earnedCreditsTotal` は従来どおりnullで、`sourceRows` に全aggregateを残す。`repeatableEvidence.earnedTotal` は独立性と各行の整合を全て確認した後だけ、各**原行aggregate**を足した計算用修得総量。
- `attempts.length` は個々に証明した修得回数。aggregate÷2ではない。`countedCredits` は既存の単位上限・回数上限の内側、`excessCredits` は修得総量との差。
- 計算用 `OfficialAllocationInput` に上限内数量だけを渡す。professionalCardsは通常の1科目完成枠へ押し込まず、既存repeatablesのfamily枠を共有する。超過は選択必修超過や別科目、S枠へ流用しない。
- 既存の `plannerItemsWithoutOfficialEarned` がexact制度科目とsource linkのmanual earnedを除外する。planned / in_progress / waitingは記録に残り、修得量には加算しない。既存手動の参考値規則は変更しない。
- 全体S参考にも今回の上限内数量だけを入れる。法律総合特講は公式＊印除外集合によって法律専門S8へ加算しない。新たに検出したaggregate/sourceの矛盾をH19/H43 fallbackで再算入しない。
- 保留は既存 `special_rule_evidence_required` と日本語の詳細理由で示す。旧opaque fingerprintは従来の保守的経路・診断を維持する。超過には既存の通知UIを1グループ追加した。

## schema変更の要否

schemaVersion=22、backup形式、state migration、import contract v1を変更しない。追加した証拠は計算時に導出するだけで永続化しない。

同一年度の複数回を広く扱うには、大学側の履修回識別子・開講コード・取得順などと原行/内訳の結び付きを追加検証する必要がある。単にローカルUUIDを付与する永続フィールドでは独立性を証明できない。既存データにはその根拠をmigrationで埋められないため、schema拡張の効果は立証できず採用しなかった。代替は現行データだけで成立する上記の限定条件と、未確定の保持。

## 変更箇所

- `officialRepeatableEvidence.ts`: 原行・内訳証明、既存上限の参照、計算専用数量、保留理由。
- `gradeImportApply.ts`: 既存の原行decoder・native内訳照合をexport。取込・重複・refreshの挙動は変更しない。
- `officialGraduationFacts.ts`: 証明済み反復だけ専用配分へ接続、矛盾する0の保留。
- `graduationProgress.ts`: 既存反復family枠へ接続、証拠に基づく回数、法律専門S除外。
- `globalOfficialSchooling.ts` / `unresolvedSchoolingImpact.ts`: 新たに証明した矛盾をfallback算入せず、S0の矛盾も未確定として保持。
- `importedGraduationNotices.ts` / `components/planner/graduation/GraduationProgress.tsx`: 限定した日本語通知・超過表示。
- 専用fixture / `official-repeatable.test.mjs` / `planner-save-lock.browser.mjs` / `package.json`: 回帰テストと通常CIへの登録。

## 残存制約と監査候補

- P1監査観点: 独立した公式S2行の組合せとaggregateの権威、同一ID/slot/年度/日付の重複、公式manual二重算入、上限超過が他区分に入らないこと。
- P2監査観点: 法律＊印のglobal S / 専門S8、null/0の矛盾通知、保存・再取込で証拠が変わらないこと。現時点で自己検証により既知の未修正不具合を断定したものではない。
- 未対応: 同一年度内の複数修得、通信との混合、履修回の一部しか表示されないaggregate、原行と一致しない内訳、旧演習名、歴史資料学の番号別名称・旧名称の自動対応、専門認定との複合。
- #149の検索追加、#154の地理特殊配分、#155ほか無関係な判定拡張、旧課程全体、2027年度Offering/日程管理は行わない。
- `graduationCheckComplete=false` / `sourceLinksReverified=false` を維持。独立監査が完了するまでReady変更・mergeしない。

## 検証記録

最終実行結果とCI対象HEADはPR本文および本節へ記録する。既存snapshot・既存期待値は変更しない。
