# CurriculumCourse progress / PlannerItem履修回 (2026)

実装起点は最新dev `81ceeb1`（CurriculumCourse foundationのPR #49 merge）。独立cloneから `feature/planner-course-attempts` を作成。旧 `feature/planner-multi-year-v22-foundation` のmerge/cherry-pick、main/devへのcommit/merge、reset/rebase/force-push/clean、他作業・stashへの操作は行っていない。

## 変更前の監査

| 対象 | 確認した現行構造・判断 |
| --- | --- |
| PlannerItem / plannerItemState | offeringIdがidentity。検索追加はplanned。異なるOffering IDは同じCourseでも保持可能。履修状態と最終評価は独立。 |
| PlannerPage追加・編集・削除 / removeUndo | 同じofferingIdだけ重複禁止。編集・削除・undoはOffering単位。削除しても進捗・評価のmapは保持し、undoで位置と全Itemを復元。 |
| CourseSearch / searchOfferings | 名称・コード・方式・期と学年でOfferingを検索。Course完成状況による除外はない。追加済みボタンは同じOfferingだけ無効。他Offeringは選択可能。 |
| PlannedCourseList / planTable / unifiedCourseView | Offering単位の行、学年別一覧、年度/時期/形態/状態編集。公式行は独立保持。一対一の旧Course identityのみ表示上coalesceする。複数Offeringは残る。今回この表示identityは変更しない。 |
| annualPlan / annual limits | 年度・形態でOfferingの履修予定単位を集計。49単位の参考表示と卒論指導の60/80/100単位資格条件はCourse completionとは独立。 |
| summarizeCredits | Offering単位のearned/in_progress/planned集計。waitingを含まない既存集計。CourseProgressではwaitingも予定に含む。画面の修得集計へは重複除外後のPlanner入力を渡す。 |
| importedCourseAchievements / gradeImportApply | 公式成績表の一行aggregateとcomponentを別保存。Course照合とOffering照合も独立。新規PlannerItemは一意なOfferingだけ自動作成。 |
| autoPlannerItemsForImport | 同じOfferingへの再生成をしない。既存項目の状態・学年・年度・時期・進捗・評価は上書きしない。sourceDuplicate時は未選択でも欠けたPlannerItemだけ補完。変更前は修得aggregateがあってもplannedだった。 |
| importedAchievementCalculations / deriveImportedAchievements | 正の公式aggregateから計算専用の仮想Offering/earned Itemを作る。componentの単位は合計しない。旧Course identityのearned Plannerがあると公式行を除外するため、新規earnedへの変更前に入力側重複除外が必要。 |
| graduationProgress | 旧Course/mappingによる構成単位完成、反復上限、学科別配分、partialを扱う既存エンジン。法律partial・史学概説/演習の特殊配分はCourseProgressへ置換しない。 |
| law / history | 法律は8完成科目/32単位条件の後、4単位科目のスクーリング部分2単位を条件付き算入。史学の同名別制度科目はfoundationのIDを維持。演習/資料学の修得順はOffering ItemのearnedOrder。 |
| mediaSchoolingProgress / share UI | Offering IDのmapが動画・テスト・試験予定のowner。shareもOffering単位。公式Media過去実績の表示と編集用進捗は別。 |
| correspondenceProgress / courseEvaluations | Offering IDのmap。リポート・試験・最終評価からPlanner earnedを自動推測しない。 |
| todos | Offering IDへの任意参照。独立todo IDを保持。今回はownerを変更しない。 |
| storage / validation / schema v22 | Offering ID重複を拒否。過去versionからv22へ既存migration。raw/backup/optimistic saveと全state取込undoを維持。 |
| CurriculumCourse / Offering relation | 321制度科目、686開講、616単一Course関係、32複数候補、38関係未解決。制度科目の構成単位とOffering単位は別。nameで結合しない。 |
| Requirements / repeatableRules | max_enrollments>1の適用scope付きルールを反復可能の根拠に使える。credits_per_courseだけでは反復可否を証明しない。既存学科別repeatable ledgerも利用。 |

## identityとschema判断

```text
CurriculumCourse = 制度上の科目
Offering = 年度ごとの具体的開講
PlannerItem / Attempt = ユーザーの1回の履修（今回: 1 Offeringに1 Item）
CourseProgress = 複数履修回と公式成績をCourse単位で集約したderived state

course completion != graduation credit count
```

同じ制度科目の夏期スクーリング2と冬期スクーリング2は、異なるOfferingなら既存v22で同時に保持できる。schemaVersionは22のまま。Attempt ID、Enrollment、新しい永続進捗state、v23 migrationは導入しない。

same Offeringの複数回履修について、今回提示された資料・利用ケースからは、同じ年度開講IDを複数保持する必要性を確定できなかった。不合格後の別日程は別Offeringで表せる。同じ2026 referenceを異年度の別履修として同時保持するケースは今後の資料・実データ調査が必要。現在の同一Offering重複制限は継続し、古い履修を削除して新規履修を作るlossy運用を解決策とはしない。

最小限の任意metadata `PlannerItem.importedSourceCourseId?: string` をv22の型/JSON Schemaへ追加した。自動作成earned項目が参照する公式行IDであり、Attempt identityではない。参照先存在をvalidationで確認する。既存v22項目はこのfieldなしで読み書きでき、過去stateを推測して関連づけたり状態を変更したりしない。保存、編集、削除undo、全state取込undoはmetadataもlosslessに保持する。旧アプリのstrict validatorはこの新しい任意fieldを知らないため、新しい保存データを旧実装へ戻して利用することは保証しない。

## 2+2 completionの設計監査と制度根拠

2026年度[学習のしおり（公式PDF）](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf)の印刷ページp.30–32を画像で確認した。依頼の `/mnt/data/shiori202629-34.pdf` はこのMacには存在しないため、既存の2026年度全体PDFの同じページを使用した。p.30は通信2/4単位とスクーリング原則2単位を区別し、p.31は4単位Courseの通信4、スクーリング2後の通信2、別日程スクーリング2+2を示す。通信2単位試験には先にスクーリング2単位の修得確定が必要で、同一内容の再受講ができない科目もある。p.32の変更条件には4単位試験合格済みの組合せ制限、受講中に通信4単位を修得した場合のスクーリング単位のみの計上もある。今回の入力は組合せの履修可否や試験条件を確定するvalidatorではない。評価・リポート状態だけでは2/4単位の履修回を識別しない。

| 対象 | 監査結果と今回の扱い |
| --- | --- |
| PlannerItem / identity | 1 Offeringに1 Itemを履修回として再利用。任意の `courseCreditContribution?: number` を追加。Attempt ID、Enrollment、v23は不要。 |
| CourseProgress | 明示値がある場合だけOffering.creditsの代わりに使う。修得済みおよびplanned/in_progress/waitingの予定込みに共通、failed/droppedは0。合計はuncapped。 |
| validation / storage | JSON Schemaで非負number、意味validationで有限かつ既知Offering.credits以下。不明単位の開講にoverrideは保存しない。Course targetを超える合計や寄与は別判断なので禁止しない。既存v22はfieldなしで従来どおり読み書きできる。 |
| progress / grades | Offering IDの評価・通信・Media進捗ownerを変更せず、合否や設題数から寄与単位を設定しない。 |
| official / graduation | 公式aggregateが正本。source-linked earnedの重複排除と卒業official-priorityを継続。metadataはCourseProgress専用で、既存卒業配分・修得概要・区分集計への入力単位を置換しない。Course completionと卒業配分は別。 |
| annual plan / limit | 登録の参考単位はOffering.creditsのまま。Courseへの寄与2を開講登録4と混同しない。 |
| UI / unified view | exactな4単位Course・4単位通信Offeringの進捗詳細に2/4単位の明示選択を出す。未設定の4単位を自動で2にしない。公式集計優先のearned項目は編集対象から除き、read-onlyで表示。曖昧identityで選択を出さない。Unified rowは元Itemを保持。 |
| share / export | CSV・画像へ明示した科目進捗寄与を別項目で出す。開講単位はそのまま。Media共有は既存のOffering進捗表示。 |
| edit / delete / undo | 行編集は元Itemをspread、削除undoは元Itemを保持、取込undoは全state snapshot。metadataをlossless保持する。設定解除は任意fieldを削除し、従来の開講単位へ戻す。 |
| repeatable / advisory | 個別Requirement、repeatableRules、Media電話確認advisoryを継続し、完成を理由とした禁止やhard blockを追加しない。 |

単純capを採用しない。例えばschooling2 + correspondenceの明示寄与2は4になるが、schooling2 + correspondenceの明示寄与4なら6と超過候補2を維持する。v22への任意field追加なので、既存migrationや保存キーを変更しない。旧実装のstrict validatorへの新field入りstateの戻し互換性は保証しない。

## derived CourseProgress

`deriveCurriculumCourseProgress` は、exactなOffering.curriculumCourseIdと独立exactなImportedCourseAchievement.curriculumCourseIdを使う。名前、旧Course ID、候補の先頭では結合しない。Offering未特定の公式行も制度科目exactなら利用する。

主なfield:

- curriculumCourseId / canonicalName / curriculumCredits
- earnedCredits / projectedCredits（確認済み単位の生集計、uncapped）
- remainingCredits（修得単位に不明がある場合はnull）
- completion / projectedCompletion: complete / incomplete / unknown / repeatable
- earnedExcessCredits / projectedExcessCredits
- attempts（元Item、Offering、各寄与、officialEarnedPreferred）
- officialAchievements / warnings

earnedはsafeに紐づくPlanner earnedの明示courseCreditContribution（未設定ならOffering.credits）と、公式行のearnedCreditsTotalを合計する。CourseProgress専用の `plannerItemsWithoutImportedAttemptDuplicates` は、`importedSourceCourseId` が保存済み公式行IDと一致するearned Itemだけを重複除外する。同じCurriculumCourseという理由だけでは手入力のearnedを除外しない。公式nullは推測せずknown subtotalとunknownを表示、0は0。source-linked Itemは制度科目照合が未解決・異なる場合もOffering単位を公式実績に見立てず、unknownの警告を残す。

projectedはearnedにplanned/in_progress/waitingの明示courseCreditContribution（未設定ならOffering.credits）を加えた値。failed/droppedは0。構成単位4と開講単位2を混同しない。公式2 + 別Offering planned2をearnedへ変更しても、CourseProgressは修得4/予定込み4を維持する。公式行と重複する証拠のない手入力earnedはCourseProgressに加算するが、卒業計算は公式aggregateを優先するため、正式反映には成績表の再取込を推奨する警告を表示する。旧自動planned項目を含む既存planned項目は、元sourceを推測して除外せず予定として保持する。

| 4単位科目 | earned | projected | 修得完成 / 予定込み完成 |
| --- | --- | --- | --- |
| exact公式2 + planned Offering2 | 2 | 4 | incomplete / complete |
| exact公式2 + 別Offeringのsource linkなしearned2 | 4 | 4 | complete / complete |
| 別Offering earned2 + earned2 | 4 | 4 | complete / complete |
| 通信Offering4 earned | 4 | 4 | complete / complete |
| スクーリングOffering2 earnedのみ | 2 | 2 | incomplete / incomplete |
| 公式4 + 自動earned Offering4 | 4 | 4 | complete / complete（8にしない） |
| 通常Courseでearned6 | 6 | 6 | complete、表示4/4 +2超過候補 |

超過は無効単位とは断定しない。反復可能科目は汎用完成後警告・通常超過判定を適用せず、上限の正式判定は既存卒業側または次段階validatorに委ねる。

## importと既存計算入力

Pass 1ではpreviewの全safe unitsを走査し、source ID（`unit.sourceExistingId ?? unit.sourceCourse.id`）ごとのdistinct Offeringと、Offeringごとのdistinct source IDを双方向に収集する。selected / sourceDuplicateでfilterせず、checkboxで非選択にしたcomponentも証拠として保持する。Pass 2ではselected || sourceDuplicateのunitsだけから、既存Offeringを除いてPlannerItemを追加する。選択解除は保存対象を変えるが、aggregateがどのOfferingに属するかの証拠を増やさない。Pass 2対象unitsのsourceが1つ、そのsourceに対応するPass 1上のdistinct safe Offeringが1つ、そのOfferingに対応するPass 1上のdistinct sourceも1つ、かつ公式earnedCreditsTotalがnullではなく正の場合のみ、新規Itemをearnedにして `importedSourceCourseId` を保存する。1つのsourceから複数Offeringが登録可能なら、個々の修得はaggregateでは証明できないため、全てplannedでsource markerなしとする。null/0または複数公式sourceの競合もplanned。A/B sourceが同じOfferingに対応する場合は、片方を非選択にしたりsourceDuplicateのbackfillだけが追加対象になったりしてもplannedでsource markerなしとする。同一sourceから同一Offeringに一致する複数component slotはdistinct source=1 / Offering=1として数える。既存Itemに対応するOfferingもsource内の候補数に含め、欠けた1件だけを補完する場合も誤ってearnedへ昇格させない。component grade / schooling grade / exam grade / report statusは根拠にしない。評価・進捗をコピーしない。sourceDuplicateの補完は既存公式行IDを使い、既存PlannerItemは上書きしない。

`plannerItemsWithoutOfficialEarned` は卒業計算と関連集計専用の保守的なofficial-priority policyであり、CourseProgressのsource-linked dedupとは別functionにする。exact公式行があるCourseのPlanner earnedを全て計算入力から除外し、deriveImportedAchievementsは従来の公式aggregate仮想Itemを生成する。Planner表示用の元Itemは削除・変更しない。卒業計算、区分集計、修得単位の概要、卒論指導条件はこの入力境界を利用する。planned/in_progress/waitingは残す。exact公式行では同名の別制度科目のearnedを理由に公式aggregateを落とさない。exactがない既存手入力・legacyの重複判定は従来どおり保守的に残す。

**CourseProgressそのものは卒業配分エンジンへ未接続。** 今回卒業側を変えたのは公式正本を守るearned入力境界だけ。法律partial、史学特殊配分、反復上限、旧Course/mapping、認定、スクーリング参考値、年度制限の全面置換はしていない。Course exact / Offering不明でもCourseProgressには算入できるが、既存卒業側の分類まで確定できない公式行は引き続き保留となる。

法律partialは典型例: CourseProgressは2/4 incompleteでも、既存の8完成科目/32単位条件を満たした後なら卒業側で条件付き2単位を算入する。2/4だけで一般科目を卒業完成扱いにはしない。

## UI / advisory

既存履修計画の近くへ「制度科目ごとの進捗」を追加。修得/予定込み、構成単位、完成状態、同名別Courseを区別する所属/区分、展開可能な履修回・公式行・警告を表示。曖昧なOfferingはPlanner/年間計画に残し、進捗へ自動統合せず「制度科目を一意に判定できません」と表示する。

検索はOfferingのまま。部分履修/完成を理由に他Offeringを消したり無効にしたりしない。通常完成後はadvisoryのみ。repeatableはscopeと既存制度科目identityで判定し、基礎特講、政治学、法律学演習・特講、総合特講、経済学・経営学特講、史学演習1〜4、歴史資料学1〜6、公開科目等を汎用完成後警告と混同しない。

同じexact Courseの他Media Offeringを追加する場合、保存済みの非dropped Media履修回があれば、検索で「大学への電話確認ではメディアの再履修は不可との案内。詳細は教務へ確認してください」と表示。不合格も対象に助言するがblockしない。根拠は依頼者提供の2026年10月電話回答で、PDF公式ルールと同じ確度に扱わない。公式行だけからMediaだったと推測はしない。

## 検証と次段階

foundation後の変更前planner 247件、初期実装後272件PASS。最初のfollow-upで5件追加しplanner 277件PASS。checkbox対応のfollow-upでさらに4件追加しplanner 281件PASS、extension18件PASS。通信またはスクーリングの非選択、全件非選択のno-op、同じOfferingへ一致する2 componentの片方非選択を検証した。planned→earnedで進捗が逆戻りしないこと、公式source単位の複数Offering判定、backfill、distinct slot、手入力earnedとsource-linked earnedの保存・削除undoを追加検証した。既存8所属回帰、法律partial、史学順序/概説、正の公式2/4に新規earnedが共存する8所属のofficial-only一致、検索・状態別予定加算・曖昧identity・反復判定・source/保存/undoを確認。typecheck/lint/build/diff-checkもPASS。graduationCheckComplete=falseを型・catalog・卒業結果で維持。

逆方向evidenceのP2修正で8件追加し、planner 289件 / extension 18件PASS。2 source→同一Offeringの両方選択・A非選択・B非選択、片方または両方保存済みのsourceDuplicate/backfillでplanned / source markerなしを確認した。修正前は非選択とbackfillの4ケースでearnedへの誤昇格を再現した。既存の1 source→複数Offeringの非選択、同一sourceの複数component→同一Offeringのearned、公式2+planned2→earned2/projected4、planned2→earned2のCourseProgress4/4、source-linked重複排除、卒業official-priority、保存/再読込/削除/undoの回帰もPASS。`npm run typecheck` / `npm run lint` / `npm run test:planner` / `npm run test:extension` / `npm run build` とdiff-checkが成功。schemaVersion22とgraduationCheckComplete=falseを維持。

2+2 completion修正では15件を追加し、planner 304件 / extension 18件PASS。旧コードに先に追加した13件のうち9件で失敗を再現後、修正した。schooling2+通信寄与2、通信寄与4、独立6の超過候補、planned/in_progress/waitingからearnedへの移行、failed/dropped、明示0、非負・有限・Offering上限、Course target非cap、公式source-linked重複排除、8所属の卒業official-priority、v22保存/再読込/削除undo/全取込undo/設定解除、年間登録単位維持、unified row、CSV/画像と限定UIを検証。既存289件をすべて維持し、typecheck/lint/test:planner/test:extension/build/diff-checkもPASS。経済学の実Previewではスクーリングearned2+通信planned寄与2の修得2/予定込み4、通信earned後の修得4/予定込み4・超過なし、再読込後の2単位設定保持、通信を明示4へ変えたときの超過候補2を確認。console errorなし。schemaVersion22とgraduationCheckComplete=falseを維持。

ローカルPreviewでは日本文芸学概論の公式2 + 夏期planned2が修得2/4・予定込み4/4になること、春期Offeringが引き続き追加可能なこと、自動earned通信4が二重加算されないこと、再読込で保持されること、console errorなしを確認した。

Previewでさらに確認する項目:

1. 公式2 + 別Offering予定2の「修得済み2/4」「予定込み4/4」と、その予定をearnedへ変えた後の修得4/予定込み4、再取込を推奨する警告。
2. earned2+2 / 通信earned4の完成、earned2だけの未完成。
3. 公式4+source-linked自動earnedが4のまま。1公式行から複数Offeringを生成する場合は全てplannedで、CourseProgressの修得は公式aggregateのみ。修得概要・区分・卒業側で重複しない。
4. 別Offeringの追加・編集・削除・undo・再読込と既存進捗/評価の保持。
5. 同名別Courseの区分、曖昧Offering警告、Course exact / Offering不明の公式行。
6. 完成後も他Offeringが選択可能、repeatableに汎用警告なし、Media助言の電話確認表記。
7. スマートフォンで履修計画と進捗欄が読みやすいこと。

次段階: 実データに基づくsame Offering複数attemptの必要性、年度別開講identity、再履修・申込時点完成・超過/スクーリング算入・反復上限・学科例外のvalidator、Mediaの不合格後も含む正式範囲、史学配分を含むCourseProgress/卒業エンジン接続を調査する。必要性が確認された場合だけv23とlosslessなowner移行（進捗/評価/row edit-delete/undo/share/validation/卒業入力）を設計する。
