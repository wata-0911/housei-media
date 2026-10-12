# Issue #129 — 成績行の誤更新を止めるP1修正

対象: `wata-0911/housei-media`、base `3ce5d2f1c8f94b3e12e1ab58288cccc4c629c71f`。
2026-10-12 JSTに取得した最新`origin/dev`は独立監査対象と同一だった。専用clone/featureブランチで作業し、実利用者の成績・認証情報は取得していない。検証は合成fixtureのみ。

## 根本原因と修正前の再現

`importPreview()`は、source fingerprintが一致しないと、同名・同区分の一件を更新先に採用していた。競合判定はスクーリングの明示年度に依存し、通信試験日だけが変わる入力を見落としていた。`applyImport()`も参照を再検証せず、公式aggregateを差し替えていた。

加えて、`source-v2` fingerprintは公式aggregateを含まない。従ってfingerprint一致も、それだけでは単位変更の許可にならない。カタログ上の`exact_unique`も、過去の同一成績行の証明ではない。

変更前の実装に合成の「論理学」2020-07-01/公式4単位を保存し、2021-07-01/公式2単位を渡すと、`selected=true`、既存ID採用、年度競合なしとなり、同じID・2020年度のまま4→2、内訳は2020/2021の双方となった。

`tests/grade-import-identity.test.mjs`の最初の2件を実装変更前に実行し、2件ともFAILを確認した。1件目は`2 !== 4`、2件目は日付なし・fingerprint一致で公式単位が変わり、state同一性のassertionが失敗した。修正後は双方PASS。

## 同一性・更新契約

| 入力 | 処理 |
| --- | --- |
| fingerprint完全一致、公式5値も一致、一意の保存先 | 公式原行・内訳の再保存なし。取得日時の変更も同じ扱い。安全な既存の計画補完は維持 |
| 既存・入力それぞれ同名1行、同区分、native証拠で更新を確認可能 | 明示反映時だけ更新 |
| 明示年度の追加 | 従来の限定的な年度補完契約を維持。公式5値・通信証拠・既存slotの非空欄を保持。unknown/nullの年度のみsourceへ補完し、手動・旧推定年度は保持 |
| 同名の保存行が存在し、上記を証明できない | 要確認・選択不可。更新も新しい公式行の追加もしない |
| 同名の保存行が存在しない | 従来の新規取り込みを維持。新モデルによる過年度・旧所属の制度同一性認定は行わない |

native証拠による通常更新では、構成単位・認定免除・追加履修を固定し、試験日と内訳単位、既存スクーリングslotの年度・期・日付・内訳単位、既存リポート日を保持する。実在する試験日＋数値単位、または実在するS日付＋明示年度・期・数値単位が少なくとも一つ必要。これらがある場合に、評価・同日のリポート状態・公式修得/S合計を更新できる。`*4`→`4`のpending終了は内訳の数値単位が同じものとして扱う。

非重複slotの追加は既存証拠を消さず保存する。年度追加には上記の年度補完契約を適用する。日付・内訳単位の訂正、日付のない評価/単位変更、構成単位変更、同名複数行の変更、同名別区分・別方式への置換、証拠を復元できない旧fingerprintは保留する。リポート日だけの行で更新の証拠が足りない場合も保留する。

`capturedAt`、手動年度、科目/Offering/制度科目のコード・照合、選択scope、単なるチェックボックス操作をidentityの根拠にしない。名称は衝突候補を探すためにのみ使う。scope変更によって保留を解除しない。

## 反映時の再検証

`resolveSource()`をpreview/applyで共有し、`revalidateImportIdentity()`が現在stateから再判定する。sourceグループ内の親参照・原行・aggregate・参照snapshotの不一致、存在しない/誤ったID、古いsnapshot、raw/parsed日付矛盾を拒否する。古い新規previewの再実行も二重追加・ロールバックしない。

拒否理由はpreview専用`sourceIdentityReason`で判別できる。拒否テストはこの理由とstate不変を直接assertし、保存validatorの別エラーを成功扱いしない。previewフラグを外して選択を強制した場合も、同一性を再計算して拒否する。

保留グループと同名の計画補完も停止する。競合行を除外した結果、残った行が一意に見えて誤って「修得済み」になることを防ぐ。無関係の新規行は同じpreviewから保存できる。

## 互換性・影響

- schemaは22のまま。preview専用fieldは保存しない。Attempt、migration、新TODOを導入しない。
- 公式修得の正本は`ImportedCourseAchievement.earnedCreditsTotal`。内訳の合計から補完しない。null/明示0を保持。
- 保留時は公式原行・内訳・年度/yearSource・手動照合・進捗・評価・PlannerStateを変更しない。
- 安全な更新でも既存の手動Offering/制度科目選択・年度・履修状態・進捗・評価を保持。
- 保存処理、expectedRaw比較、Web Lock、原文保護、バックアップv1/v2互換性を変更しない。
- 卒業エンジン、`graduationCheckComplete=false`、`sourceLinksReverified=false`、YI-01/02のID/crosswalk/baseline、Bookmarklet/拡張parserの境界は変更しない。

従来「日付なしのaggregate/評価変更でも更新可」としていたテストは保留へ変更した。手動情報の保持を検証する正当更新fixtureには、固定の試験日を追加した。同名別区分の未保存行を再取り込む場合も、区分だけでは新規/訂正を証明できないので追加を保留する。

## 検証

2026-10-12 JST、P1修正HEAD `8b678cb138bc689b70c76d70badc26ee1d249153`での結果（P2フォローアップは後述、GitHub CIはDraft PR本文で別途記録）:

| コマンド/環境 | 結果 |
| --- | --- |
| `npm run test:planner` | PASS 2,225件、失敗/skip 0。新規identity 34件、卒業168基準出力一致を含む |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS。Viteの500 kB超chunk警告あり |
| `npm run catalog:check` | PASS、321制度科目/686開講 |
| `git diff --check` | PASS |
| `npm run test:extension` | PASS 54件 |
| `npm run test:bookmarklet` | PASS 168件 |
| `npm run test:planner-browser` | PASS 18件、ローカルheadless Chromium |
| iPhone Safari実機 | SKIP |
| 独立レビュー | 未実施、Draftで引き継ぎ |

主な検証範囲:

- `npm run test:planner`: 新規identity suite、既存年度補完、保存/再読込、旧v22、バックアップv1/v2・復元競合、卒業168出力、YI-01/02固定baseline。
- `npm run typecheck` / `npm run lint` / `npm run build` / `npm run catalog:check` / `git diff --check`。
- `npm run test:extension`: parser/handoff。
- `npm run test:bookmarklet`: parser parity/transport/privacy。
- `npm run test:planner-browser`: ローカルChromium、共有ロック・保存失敗・バックアップ復元・成績保留UI・保留行と無関係な行の混在保存・再読込。
- iPhone Safari実機は未実行（SKIP）。大学の実成績画面や実利用者データでの検証は実施しない。

## 変更ファイル

| ファイル | 変更 |
| --- | --- |
| `src/planner/gradeImportApply.ts` | 共通identity判定・apply再検証・保留時の計画追加抑止 |
| `src/components/planner/GradeImportPanel.tsx` | 保留理由・選択不可・要確認件数 |
| `tests/grade-import-identity.test.mjs` | 合成fixtureによる34ケースの新規回帰 |
| `tests/planner.test.mjs` | 根拠のない旧更新契約を保留へ変更 |
| `tests/curriculum-foundation.test.mjs` | 手動情報保持を検証する安全な更新fixture |
| `tests/course-progress.test.mjs` | 同名競合行の保留が計画補完を確定させない回帰 |
| `tests/planner-save-lock.browser.mjs` | 保留UI・原文保持・混在保存のChromium回帰 |
| `package.json` | identity suiteを`test:planner`へ追加 |
| `docs/grade-import-identity-129.md` | 契約・影響・検証・未完了範囲の記録 |

## Issue #129の残作業とレビュー引き継ぎ

これはP1の安全性補修。全面的な「新規/変更あり/変更なし/要確認」差分一覧、すべての項目の変更前→変更後表示、日付訂正/別履修を証明する手動確認ワークフローは未実装。Issue全体の受け入れ条件を完了扱いにしない。

Draft PRのまま独立レビューへ引き継ぐ。自己テストのPASSは独立監査完了を意味しない。特にnative証拠で許可する境界、年度補完、apply参照改変、同名競合時の計画補完、旧v22/backup復元を再確認する。mergeは実施しない。

## PR #148 独立監査P2フォローアップ

作業開始時にPRがDraft・未マージ、HEADが`8b678cb138bc689b70c76d70badc26ee1d249153`、最新`origin/dev`が上記baseと同一であることと、作業treeに未コミット変更がないことを確認。同じブランチ/PRへ追加commitで対応する。

### P2-1: 手動年度変更後の内訳重複

合成の論理学・2020-07-01/Aを保存し、内訳の`academicYear=2019`/`yearSource=manual`へ変更した後、同日/Sを反映すると、修正前は内訳が1→2件に増えた。元の`componentIdentity()`が利用者編集可能な`academicYear`をキーへ含め、更新候補が見つからない場合に無条件追加していたため。

修正後は、原行ID、正規化名称、方式、fingerprintで確認したS slot、原行に残る試験/S日付・内訳単位・元の年度/期から内訳identityを検証する。学習者の年度・yearSource・表示期・Offeringを証拠にしない。単なる年度キーの削除ではなく、保存済み内訳とincomingの双方を、それぞれ旧・新のnative原行証拠と照合する。

同じnative identityの保存側/入力側候補がそれぞれ一件で、元のpayloadも確認できる場合だけ、同じ内訳IDを更新する。`academicYear`、`yearSource`、`term`、`offeringId`、`match`は保存済み値を保持。異なる試験日を統合せず、原行のP1 guardも継続する。

候補の競合、旧fingerprint、元の試験日との矛盾、確認できない親参照は`unproven-component-identity`で原行グループ全体を保留する。チェックボックスで候補を減らしたり保留フラグを外してもapplyで再検証する。内訳のduplicateフラグも現在stateから再計算し、古いフラグで安全な評価更新が抑止されないようにした。

本当に未保存の方式/slotは、検証済み原行とnative payloadが一致するときに追加する。従来の限定的な明示年度補完は、旧・新の非空欄/公式値が保たれた追加であることを確認して維持する。この経路で残す日付なしSの旧/新snapshotは元データの変化を保存する履歴であり、手動年度の差による重複生成ではない。証拠なしのgrade/日付変更をこの例外で許可しない。

旧`course-progress`回帰には「曖昧な内訳を上書きせず別件追加する」assertionがあった。今回の受け入れ条件に従い、identity guardの理由と原行を含むstate不変をassertする契約へ強化した。修正前の新規2テストのFAILログを先に確認しており、問題の再現を省いて期待値を合わせたものではない。

### P2-2: 公式合計更新後の内訳snapshot表示

同じ日付/fingerprintで公式修得4→2のみ更新すると、内訳は重複として書き換えられず、`earnedCreditsTotal=4`のsnapshotが残った。これは取込時点の履歴として保持できるが、内訳編集画面がその値を現在の「成績表の科目行」と表示していた。修正前の表示テストで、現在値2の表示がなく4のみ表示されることを再現した。

| 比較した方式 | 影響/判断 |
| --- | --- |
| 公式値を全内訳のsnapshotへ同期 | 原文に対応する過去の集計を変更し、未選択/旧内訳の関連証拠も個別に検証する必要がある。履歴の意味を変えるため採用しない |
| 表示時に確定した親の現在値を参照 | 保存形式や履歴を変えず正本を表示できる。最小修正として採用 |

編集画面は、既存`sourceCourseId`で一意に見つかり、source/名称も整合する公式原行から「現在の公式集計」を表示する。内訳snapshotが異なる場合は「取込時の集計（履歴）」と明記する。親が欠落・重複・名称不整合の場合は現在値を推定せず「対応未確認」と表示する。名称やsnapshot値だけで親を接続しない。保守画面の表示絞り込みが、現在値の参照に必要な原行を落とさないよう、全原行を参照用に渡す。

試験/S固有の単位・日付・評価・リポートは公式合計から推測して変更しない。公式4→2のみの更新では内訳4は履歴のまま保持し、試験単位4も変更しない。現在の公式修得2との二重加算はしない。

影響調査:

- `ImportedSourceDetails`、科目カード、履修一覧は既に公式原行を参照。今回の誤表示は内訳編集画面で修正。
- 通常の`deriveImportedAchievements`、年度集計、卒業factは原行aggregateが正本。内訳snapshot4は現在の2を置換しないことを回帰で確認。
- 原行配列が存在しない旧互換APIのfallbackは、内訳snapshotから仮のlegacy行を作る。この経路は現在の原行値を持たないため、今回変更していない。
- `repairImportedAchievements`のsnapshot比較は親が不明な旧記録の照合制約。古いsnapshotを同期して照合を通すことはせず、保守的な未接続を維持。
- 旧版保存migrationは復元用にsnapshotを読むが、schema22の今回の更新/保存でmigrationや修復を追加していない。

### フォローアップの検証・残事項

新規の最初の2件は監査HEADの変更前にFAIL（内訳`2 !== 1`、現在値2の表示なし）、修正後にPASS。追加27回帰は手動年度/未設定年度、完全同一JSON、別試験日、S slot、候補競合、旧v22、親不明、null/0、無関係行の混在、保存→再読込→JSONバックアップ/復元を扱う。Chromiumでは実際の年度編集→評価更新→合計のみ更新→再読込を確認した。

| 最終検証 | 結果 |
| --- | --- |
| `npm run test:planner` | PASS 2,252件、fail/skip 0。identity suite 61件、卒業168出力一致 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS。既存の大きなchunk警告あり |
| `npm run catalog:check` | PASS、321制度科目/686開講 |
| `npm run test:extension` | PASS 54件 |
| `npm run test:bookmarklet` | PASS 168件 |
| `npm run test:planner-browser` | PASS 19件、ローカルheadless Chromium |
| `git diff --check` | PASS |
| iPhone Safari実機 | SKIP |
| 追加commitの独立レビュー | 未実施、Draftでレビュー待ち |

GitHub CIの結果と最終HEADはPR本文へ記録する。

フォローアップの変更ファイルは取込処理、`ImportedStudyRecordEditor.tsx`、`ImportedAchievements.tsx`、identity/course-progress/browserの3テストファイル、本書。schema22、卒業エンジン、falseフラグ、YI-01/02、parser、backup v1/v2、保存Lock/expectedRaw/原文保護、進捗ownerを変更しない。

過去に既に作られた曖昧な重複内訳を、自動削除・統合するmigrationは実施しない。確定できない更新を保留する。iPhone Safari実機は未検証。全文差分UIなどIssue #129の残作業は継続し、同じDraft PRで独立レビューを待つ。自己テストPASSを独立監査完了とは扱わない。
