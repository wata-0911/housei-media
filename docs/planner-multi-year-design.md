# 履修プランナー multi-year foundation — Phase 1 設計・監査

設計日: 2026-10-02（Asia/Tokyo）。調査基準: `dev` commit `12d8c8452fd0628eccd1328a87a534beb2b8fcc0`（2026最終監査と放送大学認定対応のmerge後）。作業branch: `feature/planner-multi-year-foundation`。

この文書はPhase 1の設計成果物。production実装、snapshot・schema・既存テストの変更は含まない。提案する保存schemaは **v22**。将来の公式資料を取り込む前に、2027/2028以降の履修意図を保存できる基盤を定義する。

## 1. 現行コードの監査結果

| 観測事項 | 根拠 | 設計への影響 |
| --- | --- | --- |
| `Offering.academicYear`と`PlannerCatalog.academicYear`はliteral `2026`、snapshot名も固定 | `src/planner/plannerCatalog.ts`、`planner_catalog_2026.schema.json` | 型のnumber化だけでは、年度ごとのsource・identity・参照解決を管理できない |
| 209 Courseは全件`identityStatus: provisional` | `src/data/planner_catalog_2026.json` | 現在のcourseIdの存在だけでは年度横断同一性を公式確認済みと扱えない |
| 686 Offering、348件のcourseIdはnull。rawではmatched 593 / manual_review 63 / outside_mapping_scope 30 | 同snapshot | courseId必須への一括変換は既存記録を失う |
| runtime ledgerで55開講を補正し、matched 648 / manual_review 8 / outside_mapping_scope 30。補正後matchedでも310件はcourseIdがnull | `manualMappingOverrides.ts`、manual/official override JSON | curriculum mappingの確定と科目identityの確定は独立。mapping追加でcourseIdを生成しない |
| catalog singleton、全686件の件数検査、2026専用ledger | `catalog.ts`、`manualMappingOverrides.ts` | 年度別validator/adapter/manifestが必要。686件という検査は2026 adapter内に残す |
| PlannerItemはofferingId必須、同offeringはitems内で一意。plannedYearはnullまたは1000〜9999を許容 | `validation.ts`、schema | 現状でも2027という予定値は保存できるが、参照は2026開講のまま。未来開講確定の意味はない |
| searchからの追加値はplannedYear 2026。検索のtargetYearは1〜4年次 | `plannerItemState.ts`、`CourseSearch.tsx`、`yearEligibility.ts` | 暦年・開講年度・在学年次の3つをUI/APIでも区別する |
| 更新・削除・Undo・評価・通信/メディア進捗はofferingIdをキーにする | `PlannerPage.tsx`、`removeUndo.ts`、各progress module | courseへのキー移し替えを避け、未link intentを別に扱う |
| loadはv21より未来のschemaをlock。saveはraw比較。認定値の回復shadowとrecovery backupは別機構 | `storage.ts` | v22 migrationにもread-only load、競合検査、shadow保持を引き継ぐ |
| unified viewは安全なcourseIdの1対1のときだけplanner/importを表示上合流 | `unifiedCourseView.ts`、`importedAchievementIdentity.ts` | 年度をまたぐ計画が増えるとcourseIdのみの1対1は不足する |
| import候補照合は名称・方式中心で年度をfilterしない。代表候補や最初の候補を保存する箇所がある | `gradeImportApply.ts` | 複数年度catalogを単純に渡すと誤照合の危険。年度awareにしてからregistry接続する |
| import年度にはsource/inferred/manual/unknownがある。通信も日付/取得日時から年度をinferしている | `gradeImportApply.ts`、現行テスト | inferredを公式年度の証明に昇格させない。`docs/grade-import-contract.md`の「通信年度を日付で決めない」と現行実装は一致していないため、実装時に説明を現状に合わせる |
| imported集計は計算用virtual Offering/PlannerItemを生成し、一部virtualには2026 literalを入れる。同course earnedがあればimport算入を抑える | `importedAchievementCalculations.ts` | virtualを実在annual offeringと混ぜない。複数年度・repeatableで広いcourse単位抑制を再監査する |
| annual advisoryはplannedYearで集計。状態でfilterせず、単位不明はskip。49/60案内は2026資料 | `annualPlan.ts`、`AnnualCreditLimitNotice.tsx` | 未確認計画を0と見なさず件数表示。年度政策の確認状態も分ける |
| requirementsとmappingsはcatalogに同梱。卒業・史学・地理・repeatableの一部は2026専用コード | `graduationProgress.ts`、各rule module | requirement bundleとannual catalogを別管理し、将来開講から旧課程へつなぐには検証済みbridgeが必要 |
| thesis progress/guidanceはscope別でannual offeringから独立 | `thesisSelection.ts`、`thesisGuidance.ts` | この独立性を維持。未来計画で資格単位や指導状態を増やさない |
| 型に`contract.py`生成のコメントがあるが、生成工程はrepoに存在しない | `plannerCatalog.ts`、README、`docs/planner-manual-curated-mappings.md` | 2026生成ファイルを再生成しない。新schema/型は別ファイルにする |

調査時点のplanner test定義は177件。Phase 1では実行や変更を要しないが、実装PRでは既存回帰群を基準とする。raw snapshotとruntime補正後のcoverageを混同しない。

## 2. 概念と年度の定義

| 概念 | identity / 年度 | 意味 |
| --- | --- | --- |
| Course | 安定したcourseId。年度なし | 年をまたぐ同一科目。名称・科目コードだけから同一視せず、テーマ・言語番号・史学分野などのvariantを保持する |
| Annual Offering / ClassInstance | offeringId + academicYear + source revision | 特定開講年度・方式・開講時期・クラスのsource-backed実体。履修方式や単位はここに属する |
| Curriculum version / requirement rules | curriculumVersionId + scope + rule revision | 利用者に適用される卒業要件と算入policy。開講年度に従って自動で変わるものではない |
| Learner Plan / PlanIntent | intentId + courseId + targetAcademicYear | 「この科目をこの開講年度で履修したい」という希望。catalogがなくても存在できる |
| Enrollment（既存PlannerItem） | offeringIdを保持 | 開講を選んだ後の計画・履修・修得記録。今後も進捗/評価の対象となる |

`plannedYear`はユーザーの履修予定の**暦年**。`targetAcademicYear`は探す**開講年度**（4月〜翌3月）。`Offering.academicYear`は資料の年度。`studyYear`は1〜4の**在学年次**である。2027年2月に履修予定の2026年度開講では、plannedYear=2027、targetAcademicYear=2026が成立する。どちらも日付や年次から自動推定しない。

新規未来計画の「2027年度を計画」操作ではtargetAcademicYearを2027にする。plannedYearは別入力として2027を初期提案してよいが、暦年という説明と独立編集を持たせる。UIで同じ「年度」ラベルを2つの意味に使わない。既存plannedYearはmigrationで解釈変更しない。

`CurriculumApplicability = current_2026 | legacy_or_transition | unknown`は利用者の適用課程の明示選択である。2027に計画しても`current_2026`を変更しない。「2027年度catalogを選ぶ」操作も「2027年度卒業要件を適用する」操作も別。後者の公式根拠はこのPhaseでは存在せず、新enumを推測で追加しない。

## 3. モデル比較

| 観点 | A: PlannerItemをcourseId必須・offeringId nullableに拡張 | B: PlanIntentとannual PlannerItem/Enrollmentを分離 | C: 単一PlanEntryをcourse_intent / offering_enrollment / publicの判別unionにする |
| --- | --- | --- | --- |
| 型安全性 | status別unionなら安全にできるがnullable参照が多くの既存関数へ伝播 | 未確認intentとoffering必須itemを別型にできる。link整合はruntime検査 | unionは安全だが全consumerで網羅分岐が必要 |
| migration | 348 null courseIdのため必須化できない。結局legacy variantが必要 | itemsを保持し、nullable補完と空intentを追加できる | 保存配列と識別子・順序を広く変更する必要 |
| earned / in_progress | offeringを要求する分岐とlegacy例外が同居 | 開講記録側でoffering必須を維持。成績表achievementは独立 | 年度開講variantに限定できるが計算入力adapterが必要 |
| media / correspondence / evaluation | null guard、progressの生成防止をすべての呼出しで徹底 | 既存offering-keyed storageを維持し、intentには呼び出さない | 各consumerにvariant narrowingを導入 |
| imported grades | 同配列内courseIdにより誤coalescing・重複算入が起きやすい | intentは修得ではない。表示と計算を別projectionにできる | import variantも足すと関心が大きく混ざる |
| repeatable / 史学演習 | courseIdを主キーにすると別回・別クラスを潰す。itemId追加が必要 | intentIdごとに複数希望を保持し、各annual offeringを別記録にする | entryIdで扱えるがprogressキーは別に必要 |
| 公開科目 | courseId必須とcatalog非依存PublicCourseが衝突 | PublicCourseを独立で保持できる | public variantで表現できるが既存型変更が大きい |
| 実装範囲 | 見かけの変更は小さくてもほぼ全既存moduleへ波及 | additive migrationとadapterを先行できる | 長期的には統一的だが今回の安全な段階分割に不利 |

**推奨はB。** AのcourseId必須は現catalog coverageと両立しない。CのunionはUIのread modelには採用するが、保存モデル全体の置換は行わない。Bでもcourse-level intentとannual itemを同じ行に見せるためのprojection・原子的link操作は必要である。

## 4. Annual catalog architecture

`academicYear: number`への変更だけでは不十分。**CourseRegistry + 年度別AnnualCatalogBundle/index + 独立CurriculumBundle + OfferingCurriculumBridge**を導入する。

2026 JSONと2026 schemaはimmutable official-source snapshotとして保持する。ただし科目同定はprovisional、mappingには手動補正があるため、全内容を公式確認済みとは表示しない。raw snapshot、manual_curated ledger、official_source_verified ledgerをそれぞれ独立sourceとして保管する。runtime effective viewは純粋adapterで作り、rawを書き換えない。

2026 bundleのmanifestはrawのdigestと適用ledgerのdigestをpinする。以後補正を追加するときは新revisionを作り、以前のrevisionも保存済み参照の解決に残す。2027 catalogは新bundleとして追加し、2026 JSON・ID・ledgerを上書きしない。新年度の実データは公式資料公開後の別監査で作成する。

CourseRegistryは2026の209 IDsをそのまま初期収録し、identityStatusをprovisionalとして保持する。verifiedへ昇格するには、年度横断同一性のevidence/承認ledgerが必要。名称変更は同一性の根拠があれば表示履歴として保持する。split/merge・番号・テーマ・ローマ数字の違いは自動aliasにしない。null courseIdの開講を名称hashからCourseへ変換しない。catalog未存在の年度でも既知provisional Courseへの意図追加は可能だが、自動linkは停止する。

2026 offering UUIDは変更しない。2027以降のOffering IDsは新年度ごとに新規発行し、registry全体で重複を検査する。同じクラスコード/名称でも前年IDを再利用しない。source revision内の同一実体修正は同IDでも可能だが、保存済みrecordはrevisionをpinし、最新値で意味を変更しない。複数sourceが同一開講を表す場合の統合はevidence-backed ingestの仕事とし、linkerの都合で候補を合体しない。

CurriculumBundleはprograms、mappings、requirements、repeatable/特例/卒論/指導policyとprovenanceをversionごとに持つ。2026課程adapterには既存UUIDや各定数を保持する。annual OfferingからCurriculumBundleのmappingへは明示bridgeでつなぐ。keyは`curriculumVersionId + scopeId + mappingId`とし、年度catalogが付けたmappingIdをそのまま旧課程のmappingIdと同一視しない。

2027 Offeringを2026課程へ算入するには、そのCourse/方式/構成単位/対象scopeの対応が検証済みのbridgeが必要。橋がない場合、開講情報の閲覧はできても旧課程への算入・自動linkは保留。適用課程unknown/legacyの利用者にも未来intent追加は可能で、卒業計算の不明表示は維持する。2026の既存表示と計算は2026 adapterで再現し、registryの最新年度をrequirement engineに自動注入しない。

catalog completenessは「この年度の全科目が分かった」というbooleanだけでなく、sourceごとの収録範囲を持つ。あるcourseの通信/スクーリング候補をすべて確認できているかを検査できる形にする。一部sourceのみ公開された時点の1候補は、全方式で一意とはいえない。

## 5. UXとstatus semantics

計画表に2026/2027/2028…の**計画対象開講年度**selectorと、保存済み年度・年指定入力を用意する。固定の2028上限を作らない。履修予定暦年と在学年次は別欄。初期表示は既存利用者の2026 viewを維持し、null年度の記録は「未設定」groupに残す。

未来年度catalogが未収録ならCourseRegistryのcanonicalNameからintentを追加する。future PlanIntentを作成できるのは、CourseRegistry上にnonnull courseIdが存在する科目のみである。verified/provisionalのどちらでも意図の作成は可能だが、provisionalはauto-link不可。検索結果の2026参考情報は「2026年度の参考: …」として折りたたみ表示できるが、追加後の2027の方式・期・単位としてコピーしない。

`courseId=null`の2026 Offeringには「年度横断identity未確認のため未来年度計画不可」と表示し、未来年度への追加を無効にする。name / mapping / subjectCode / classCode等からCourse identityを生成しない。2026の既存PlannerItemとして選択・保存することは従来どおり可能である。identity監査で安全なCourse identityが付与され、CourseRegistryに収録された後にfuture planningを可能にする。全2026 selectable offeringが未来計画可能になることはfoundationの要件にしない。`UnresolvedPlanIntent`や自由記述future courseは今回のnon-goal。

| 表示 | 条件 | 行の内容・操作 |
| --- | --- | --- |
| 科目は計画済み / 2027開講未確認 | catalog未収録、該当候補なし、またはcoverage未確認 | 科目名・希望年度・暦年・希望時期・年次を編集。方式/単位/開講期は「未確認」。0単位や通信とは表示しない |
| 開講候補あり | 候補あり・未選択 | 年度、方式、期、単位、source、課程対応、変更warningを一覧。複数候補は利用者が選択 |
| 開講候補あり / 要確認 | identity/mapping/creditsが未確定または前年差分あり | 理由と参考sourceを表示。単位変更等は差分確認が必要。identity ambiguity/manual_reviewはlink確定させない |
| 開講確定 | このintentをplanIntentIdで参照するvalidated Enrollmentが存在する | Enrollment.offeringRefのrevisionの開講情報を表示。登録済み・履修可能・卒業算入の保証を意味しない |

希望時期（user preference）と開講期（official period）は別表示。希望方式を将来追加するとしても希望であり、複数候補からのauto-pick条件にはしない。本設計のv22では希望方式を保存しない。候補link後も希望時期/暦年/年次を保持し、開講期で上書きしない。

| record / status | offering identityの必須条件 |
| --- | --- |
| 未link PlanIntent: planned | CourseRegistryに存在するcourseId必須。対応Enrollmentなし。Offeringへのbinding fieldや修得/進捗/評価は持たない |
| 未link PlanIntent: dropped | intent取消として可能。対応Enrollmentなし。earnedOrderや成績を作らない |
| linked PlanIntent（導出状態） | Enrollment.planIntentIdから対応annual itemを導出し、表示statusはitemに従う。intent.statusは希望の存続を表すplannedのまま。linked flagや逆方向参照を保存しない |
| PlannerItem: planned | 既存互換を含めofferingId必須。未来の純粋な未確認希望はPlanIntentを使う |
| in_progress / waiting | 年度開講offeringId必須。catalog未確認intentから直接遷移不可。linked item作成後に明示変更 |
| earned / failed | 年度開講offeringId必須。earnedはlearner-enteredと公式importの根拠を区別する。component評価から自動遷移しない |
| PlannerItem: dropped | 一度選んだ開講の取りやめなのでofferingIdを保持。未選択intent取消とは区別 |
| ImportedCourseAchievement | 公式成績表row ID/fingerprint自体がachievement identity。annual offeringが不明でも事実を保存し、unsafe mappingは保留 |
| PublicCourse / thesis | catalog非依存の既存例外。未来の公開科目予定はユーザー記録であって公式未来開講ではない |

既存v21のearnedに新しく証明書やfinalGradeを要求しない。既存値はlearner-enteredで保持する。公式importは別recordのまま優先表示・重複算入抑制を行い、auto-linkでearnedにしたりPlannerItemへ成績をコピーしたりしない。failedをcomponentのDから推定しない。

未link intentをキャンセルするとdroppedになる。linked itemの取りやめはitem.status=droppedとして保存し、bindingは残す。linkの正本はEnrollment.planIntentIdとEnrollment.offeringRefであり、PlanIntent自体はlink/unlinkで更新しない。明示unlinkを許すのはplanned itemで既存進捗/評価がない場合だけとし、そのEnrollmentのplanIntentIdとlinkDecisionをnullにする。annual itemとofferingRefは単独の開講記録として保持する。このintentを参照するEnrollmentがなくなるため未linkと導出され、orphan用indexの更新も不要。非plannedのitemに対するunlink・年度の付け替えは禁止し、別年度の新intentを作る。年度を変えるreplanは旧記録を残す別操作とし、自動付け替えしない。

計画行の「削除」は「取りやめ」やunlinkと別操作である。linked行を削除するとintentと対応Enrollmentを同じsaveで両方削除し、進捗・評価・todo等を保持する。削除後もそのOfferingを参照する記録が残る場合だけ、削除するEnrollment.offeringRefのrevisionをofferingCatalogRefsへ退避する。参照が残らなければ補助indexを作らない。Undoは同じintentIdとEnrollment（planIntentId/offeringRef/linkDecisionを含む）、元の配列位置を復元し、再追加済みのID/binding/revision衝突があれば復元しない。復元によりannual参照の正本がEnrollmentへ戻るので、そのOfferingの補助index entryは取り除く。未link intentの削除/UndoはintentIdのみを更新し、既存のintentなし2026 itemの削除/Undoにも同じorphan revision退避規約を適用する。

## 6. 集計・特殊科目の方針

**annual advisory:** 集計keyはplannedYear（暦年）のまま。targetAcademicYearとは別であり、2026年度開講の2027年予定と2027年度開講の2027年予定は同じ暦年行に載る。公式資料が指定する「1年間」と暦年が同じかは保証しない。UIは「履修予定暦年別の参考」であることとpolicy source年度を表示する。

未link active intentはunknownOfferingItemsとして件数を数え、既知合計へ単位を足さない。「既知合計0、未確認3科目」のように出す。link後はintentとitemを1行として扱い、二重加算しない。未来年度の49/60上限を公式2027と呼ばない。annual policy未確認なら上限判定unknown、2026参考を別枠で示す。

既存2026 advisoryは現在全statusを対象とする挙動を保持して旧viewで再現する。新future viewの負荷見込みはplanned/in_progress/waiting/earnedを含め、failed/droppedを除外する設計とする。通信の実際の修得量とスクーリング登録量の厳密な年度上限判定は、登録事実や年度policyが不足するため保証しない。このlegacy/new差はadapterの明示policyで扱い、通常のearned集計と共用しない。

**卒業・指導:** 未link intentは`calculateGraduationProgress`、`guidanceEligibilityCreditResult`の取得単位入力に入れない。linked planned itemの既知単位は参考planned欄にのみ使い、earned/達成/指導資格を増やさない。新年度から旧課程へのverified bridgeがなければ該当算入はunknown。2026 current課程を適用する明示選択と根拠がある場合にだけ2026 policyで評価する。scope別thesis/guidanceの記録はannual catalog追加・選択で変えない。

**repeatable:** courseIdは科目系列identityであり履修回identityではない。intentIdを独立キーにし、同courseを別年度・別回で計画可能にする。通常の同course/対象年度への再追加は既存intentを提示し、明示的な「別の履修回を追加」で独立intentを作る。globalなcourseId uniquenessをvalidationに入れない。同annual offeringへの2つのintentは自動合体せず衝突review。現行1 item/offeringの不変条件は維持する。別クラス・別年度のrepeatableは別offeringとして保存し、算入capは課程versionの系列全体で適用する。

**史学:** earnedOrderは利用者が確認した修得順であり、targetAcademicYear/plannedYear/array順から付与しない。史学演習と歴史資料学は別系列の順序検査を保持する。null courseId・manual_reviewでも2026に保存できる史学例外を保持し、未来auto-linkの例外にはしない。史学概説のmapping-ID fallback、5科目例外のメディア除外、歴史資料学12単位capを2026 curriculum adapterへ閉じ込める。年度追加でorderを振り直したり同courseとして潰したりしない。

**地理・共通・法律:** 地理のstaged transfer、一般教育の科目群上限、法律学演習等の回数capはcurriculum policyが指定する枠。annual yearを変えてもcapを新しくリセットしない。新年度のannual mappingIdへ2026特例IDを無条件コピーしない。対応が確認できない新科目はreview/unknownにする。

**公開科目:** `publicCourses`の個別UUID・タイトル・2単位記録・既存statusはv22で保持する。未来にも予定を置けるが「ユーザー記録 / 開講未確認」、2単位は既存recordの入力規約による参考と明示する。公式2027公開科目や方式を合成しない。卒業算入上限は明示適用課程のpolicyから取得する。将来catalogに同名開講が来ても名称だけでPublicCourseへlinkせず、既存取得単位を二重計上しない。

**import/unified view:** 成績表rowは複数年度・方式componentや追加履修を含み得る。row.academicYearだけで全rowを1つのannual enrollmentと同一視しない。新recordのcoalescingはverified courseIdに加えて対象年度の信頼できる証拠・component/attempt対応・一対一性を要求する。source/manual年度は確認材料、inferred/unknownは自動annual coalescingの証拠としない。成績rowから未来intentを完了にしたり取り除いたりしない。

単一2026利用の既存表示はcompatibility adapterで保持するが、そのname fallback/representative選択をmulti-year auto-linkへ転用しない。計算は表示coalescingから独立させ、1 source rowの集計単位を再加算しない。repeatableでは異なる実履修回をcourseIdだけで抑制しない。aggregateとcomponentの重なりを確認できない場合は両方を見せてwarning、算入は保守的に保留する。計算用virtual rowsは独立型にしてregistryへ登録せず、架空の2026/2027開講にしない。

## 7. Phase 2以降のテストマトリクス

2027 fixtureは**synthetic test-only**と明示し、公式snapshotやproduction bundleとして配信しない。次の成功・拒否・不変条件を純関数/保存統合/UIの適切な層で検証する。

| 対象 | fixture / 操作 | acceptance |
| --- | --- | --- |
| v21 -> v22 | 6 status、null/2027 plannedYear、非標準term、studyYear、earnedOrder、public、todo、import、認定10単位、thesis/guidanceを持つstate | 全既存値・配列順・map keyが同じ。追加fieldのみ差分。rawはloadでは未書込 |
| identity補完 | matched+course、matched+null、manual_review、outside_mapping_scope、provisional Course | 安全なcatalog参照のみ補完。unsafeはnull+理由。courseId必須で既存を失わない |
| 全2026回帰 | 全686 offerings、既存進捗/評価・orphan・Undo・import | source IDs維持、re-addで進捗復元、既存計算/表示adapterの結果維持 |
| 未来intent CRUD | courseId+2027、2028。offeringなし、希望時期あり | 保存/reload/編集/取消/Undoできる。方式・単位・期は未確認。進捗recordなし |
| 登録済みcourseId | CourseRegistryに存在するverified courseIdで未来intent追加 | future intent作成可能。PlanIntentにofferingId/catalogRef/linkDecisionを保存しない |
| provisional courseId | CourseRegistryに存在するprovisional courseIdで未来intent追加・候補評価 | intent作成・保存可能だがauto-link不可 |
| null / 未登録courseId | courseId=nullの2026 Offering、またはregistryに存在しないcourseIdで未来追加 | future intent作成不可。UIに「年度横断identity未確認のため未来年度計画不可」。2026 PlannerItemとしての利用・migrationは保持 |
| 名称のみ一致 | null identity Offeringと既存Courseのname一致、同mapping/subjectCode | Courseを生成・同定しない。UnresolvedPlanIntentも作らない。監査後のregistry収録で初めて未来追加可能 |
| 年度区別 | plannedYear=2027、targetAcademicYear=2026、studyYear=3 | 3概念が独立、課程選択不変 |
| registry | 2026+synthetic2027、重複offering ID、bad year、bad bridge、bad digest | 新bundle追加で2026 bytes不変。重複/bad参照拒否。bad新bundleは既存2026を壊さず登録停止 |
| unique auto-link | verified stable course、同対象年度1候補、全方式coverage確認、scope/課程bridge確認、baseline差分なし | Enrollmentだけをplannedで作成し、planIntentId/offeringRef/linkDecisionを保存。PlanIntent不変、新linkだけでは補助index entryなし。再実行でno-op |
| binding正本 / validation | 同じintentIdを参照する2 Enrollment、存在しないintentId、dropped intentへの参照、annual year不一致 | 不正なEnrollment参照を拒否。linked/unlinkedは対応Enrollmentの有無から導出。単独Enrollmentと未link intentはいずれも有効 |
| unlink | planned・進捗/評価なしのlinked Enrollmentから明示unlink | Enrollment.planIntentId/linkDecisionだけをnullにし、offeringRefとPlanIntentは不変。未linkを導出。非plannedは拒否 |
| delete / Undo / orphan pin | linked行削除、進捗/評価/todoあり・なし、reload、Undo/re-add | 残存参照がある時だけofferingRefを補助indexへ退避。UndoでEnrollmentへ正本を戻しindex entryを消す。intentだけの削除はindex更新なし |
| orphan pinの衝突 | orphan進捗がpinするrevisionと新link/Undo/re-add候補のrevisionが違う | 自動付け替え拒否。orphan pinからintent linkを推定しない。同revisionで復元する場合だけindexからEnrollmentへ移す |
| 複数候補 | 通信+schooling、前期+後期メディア、同コード別クラス、希望時期に1件一致 | 自動選択しない。候補選択UIを表示 |
| 部分source公開 | 1候補だが他方式coverage未確認 | 1件でもauto-link不可。資料追加で再評価 |
| 同定拒否 | provisional/ambiguous course、null courseId、manual_review、outside scope、名称/コードのみ一致 | linkしない。既存2026 selectableとは独立 |
| 単位/mapping変更 | 4→2、null→既知、所属/field/requirementType/構成単位/eligibleYears変更、橋の未確認 | warning/review。PlanIntentを書換えず、承認前は対応Enrollmentを作らない |
| revision変更 | linked後にcatalog revision/ledgerの差分 | 保存revisionは同じ。自動rebind/計算値更新なし。差分提示 |
| link衝突 | 同offeringの既存item、同course別intent、repeatable同一候補 | auto-linkせずreview。進捗/評価を合体しない |
| status遷移 | 未link planned→in_progress/waiting/earned/failed、取消、linked非plannedのunlink | 不正遷移拒否。未link取消可、annual identity必須、component成績でstatus不変 |
| import/year | 同名2026/2027、source/manual/inferred/unknown年度、複数年度component、再import | 最新/最初候補を勝手に選ばない。raw・fingerprint・manual選択保持 |
| coalescing/dedup | 2026 earned+2027 planned同course、複数年度earned、repeatable、mixed aggregate/component | 過去成績が未来intentをearnedにしない。1事実は1回、別回は潰さない。曖昧は保留 |
| 史学/地理 | 複数年に跨る修得順、null identity、史学概説メディア、地理staged allocation | 順序不変/重複拒否、既存2026特例結果保持、年度でcapリセットなし |
| 公開科目 | 未来予定、既存earned、9回目、同名新Offering | 既存記録保持、未確認label、適用課程cap、名称だけでlink/合算なし |
| 暦年annual limit | 同plannedYear・異なるtargetAcademicYear、未知3科目、link後、future status filter | 暦年group、未知件数保持、intent/item二重計上なし、49/60を未来公式と扱わない |
| graduation/guidance | 未link future100科目、linked planned、future earned bridgeなし、current2026選択 | 未取得未来計画でearned/達成/60・80・100 gate増加なし。unknownを維持、false固定 |
| storage safety | future schema23、bad v22、他tab競合、quota error、複数shadow path | lock+raw保持、保存失敗でUI/state不変。shadow無関係saveで維持。BACKUP_KEY不変 |
| export/share/handoff | 未link intent CSV/PNG、複数年度media、v1 extension payload、token失敗 | 未確認を空/labelで出す。年度でshareを分離。handoff再検証・preview先行維持 |

実装時の必要checksは`npm run typecheck`、`npm run lint`、`npm run test:planner`、`npm run test:extension`、`npm run build`。extension配布ファイルに変更がなければ`build:extension-dev`は通常不要。UIは2026既存操作とfuture追加→reload→候補選択をdesktop/mobileで確認する。既存テストの期待値を新型に合わせる場合も、保持すべき旧挙動のassertionを削らず新fixtureを加える。

## 8. Non-goals / safety

- 実際の2027開講、方式、期、単位、履修可否を推測すること。
- 2027卒業要件を推測し、2026 rulesを「公式2027」としてコピーすること。
- 新年度の卒業課程をplannedYear/admissionYearから自動選択すること。
- auth/cloud sync、大学側の履修登録、卒業可否の最終判定。
- 全null courseIdの自動解消、名称正規化による年度横断identity確定。
- `UnresolvedPlanIntent`、自由記述future course、CourseRegistryにない科目の未来計画。全2026 selectable offeringを2027/2028計画へ追加できるという保証。
- 同一annual Offeringに複数attemptを持つ進捗/評価storageへの全面移行。別クラス/別年度は既存の別offeringで扱う。
- thesisをannual Offeringへ戻すこと、`graduationCheckComplete=false`を変更すること。

以下はPhase 2実装の契約となる設計項目。

## Recommended architecture

**B: additive PlanIntent + offering必須PlannerItem（Enrollment）**を採用する。保存stateに`planIntents`を追加し、既存`items`・offering-keyed進捗/評価を保持する。PlanIntentはcourse-levelの希望だけを保存する。annual Offeringへのbindingのsingle source of truthは **Enrollment.planIntentId + Enrollment.offeringRef** とし、link decision/review evidenceもEnrollment.linkDecisionの1箇所に置く。PlanIntentにofferingId/catalogRef/linkDecision、linked flagや逆方向参照を保存しない。linked/unlinkedは対応Enrollmentの存在から導出する。

offeringCatalogRefsはlinkの正本にはしない。EnrollmentがないOfferingを参照するorphan進捗/評価/todo等のrevisionを解決する補助indexに限定し、active Enrollmentのbindingを写して保存しない。通常の新linkはEnrollmentの追加だけで成立する。既存orphan pinを利用する場合のみ、そのpinをEnrollmentへ移す。

future PlanIntentは、verified/provisionalを問わずCourseRegistryにcourseIdが存在する科目だけに作成できる。courseId=nullの2026 Offeringは「年度横断identity未確認のため未来年度計画不可」であり、2026 PlannerItemとしての従来利用は維持する。name/mapping/subjectCode等からCourseを捏造せず、identity監査後にregistryへ安全なidentityが収録されてから未来計画可能にする。全2026開講の未来計画対応やUnresolvedPlanIntentは要件に含めない。

各intentに独立intentIdを付け、一つのintentを参照できるEnrollmentは最大1件とする。UIの`PlanRow`判別unionで導出した対応を一行化し、status/単位/進捗はitemを優先する。intentだけの状態とintentなしのannual itemはどちらも有効であり、「両方bindingを持って一致必須」という不変条件を設けない。intentを計算用itemへ合成しない。既存itemにintentを強制生成せず、v21からは空planIntentsで移行する。既存2026 plannedYear=2027 recordもそのまま保存し、参照年度が2026であることを明示する。未来年度へ変換する場合はregistry courseIdの条件を満たす時だけ別の明示操作で新intentを作る。

CourseRegistryと年度bundleを年別indexで解決し、適用課程のCurriculumBundleは別resolverで解決する。auto-linkはsource-backed stable identity・年度・coverage・scope/課程bridge・単位差分の確認をすべて通過した場合のみ行う。現在全Courseがprovisionalであるため、catalog追加だけでは自動linkが始まらない。

## State/type sketch

以下は設計用のTypeScript風sketchであり、既存型の実装変更ではない。`V21...`は保存互換の旧型、`Source`等は現行source構造を参照する。IDはstringだがruntimeでformat/registry参照を検証し、AcademicYear/CalendarYearを引数名・型aliasで区別する。

```ts
type AcademicYear = number; // integer 1000..9999, 開講年度
type CalendarYear = number; // integer 1000..9999, 希望暦年
type CurriculumVersionId = string;
type CourseId = string;
type OfferingId = string; // 2026 UUIDは変更しない
type IntentId = string;   // user UUID
type StudyYear = 1 | 2 | 3 | 4 | null;

type CatalogRef = {
  academicYear: AcademicYear;
  revisionId: string; // manifest raw + ledger digestで特定
};
type OfferingRef = CatalogRef & { offeringId: OfferingId };
type EvidenceRef = { source: Source; ledgerId: string | null };

type StableCourse = {
  id: CourseId;
  canonicalName: string;
  identityStatus: 'provisional' | 'verified' | 'ambiguous';
  evidence: EvidenceRef[];
  // rename/split/mergeは別の監査ledger。名称だけでIDを再発行しない。
};
type AnnualOffering = Omit<V21Offering, 'academicYear' | 'mappingIds'> & {
  academicYear: AcademicYear;
  // method/credits/period等は年度sourceの事実。curriculum bridgeは別。
};
type AnnualCatalogBundle = {
  bundleSchemaVersion: 1; // state v22/legacy catalog v1とは独立
  ref: CatalogRef;
  sources: EvidenceRef[];
  sourceDigests: Record<string, string>;
  offerings: AnnualOffering[];
  coverage: Array<{
    sourceId: string;
    coveredCourseIds: CourseId[];
    methods: Array<'correspondence' | 'schooling'>;
    completeWithinDeclaredScope: boolean;
  }>;
};
type CurriculumBundle = {
  id: CurriculumVersionId; // 例: current_2026用bundle
  revisionId: string;
  programs: Program[];
  mappings: Mapping[];
  requirements: Requirement[];
  policyId: string; // 2026特殊算入/卒論/指導等adapter
  evidence: EvidenceRef[];
  graduationCheckComplete: false;
};
type OfferingCurriculumBridge = {
  offering: OfferingRef;
  curriculumVersionId: CurriculumVersionId;
  curriculumRevisionId: string;
  scopeId: string;
  mappingIds: string[];
  status: 'verified' | 'manual_review' | 'outside_mapping_scope';
  evidence: EvidenceRef[];
};
type CatalogRegistry = {
  courses: Map<CourseId, StableCourse>;
  annual: Map<AcademicYear, AnnualCatalogBundle[]>;
  curricula: Map<CurriculumVersionId, CurriculumBundle[]>;
  bridges: OfferingCurriculumBridge[];
};

type PlanIntent = {
  id: IntentId;
  courseId: CourseId; // CourseRegistry参照必須。null/未登録は作成不可
  status: 'planned' | 'dropped'; // 希望の存続。linked/unlinkedは保存しない
  targetAcademicYear: AcademicYear;
  plannedYear: CalendarYear | null;
  preferredTerm: string | null; // 希望。official periodとは別
  studyYear: StudyYear;
  scopeId: string | null; // 作成/変更時の希望scope。全体設定から黙って変更しない
  curriculumVersionId: CurriculumVersionId | null; // 明示選択のcontext
  reference: { // 参考にした過去年の事実。未来属性ではない
    catalog: CatalogRef;
    offeringIds: OfferingId[]; // courseに属する参照群。一つを勝手に選ばない
  } | null;
};
type LinkDecision = {
  source: 'auto' | 'manual';
  scopeId: string; // link時に確認したscopeをpin
  curriculumRef: { id: CurriculumVersionId; revisionId: string };
  bridgeDigest: string;
  acceptedChangeCodes: string[]; // manual reviewで確認した差分
};

// 旧itemの全field/意味を維持。既存annual itemはintentなしでも有効。
type Enrollment = V21PlannerItem & {
  courseId: CourseId | null;
  courseIdentityResolution: 'catalog_provisional' | 'verified' | 'unresolved';
  planIntentId: IntentId | null; // intentとの関連を保存する唯一の参照
  offeringRef: OfferingRef; // annual bindingの正本。旧offeringIdは互換キー
  linkDecision: LinkDecision | null; // link evidenceの唯一の保存先
};
type PlannerStateV22 = Omit<V21PlannerState, 'schemaVersion' | 'items'> & {
  schemaVersion: 22;
  items: Enrollment[];
  planIntents: PlanIntent[];
  // EnrollmentのないOfferingへのorphan参照専用。intent bindingは表さない。
  offeringCatalogRefs: Record<OfferingId, CatalogRef>;
};
// mediaSchoolingProgress / correspondenceProgress / courseEvaluations は
// Record<OfferingId, 現行record>を維持。PublicCourse/import/thesisも保持。

type LinkAssessment = {
  intentId: IntentId;
  candidates: OfferingRef[]; // invalid/review候補も理由付きでUIに残す
  result: 'unconfirmed' | 'candidates' | 'review' | 'auto_linkable' | 'linked';
  reasons: string[];
}; // registry + stateから導出。候補配列をstateに二重保存しない。

type PlanRow =
  | { kind: 'course_intent'; intent: PlanIntent; assessment: LinkAssessment }
  | { kind: 'annual'; item: Enrollment; intent: PlanIntent | null }
  | { kind: 'imported'; achievement: ImportedCourseAchievement }
  | { kind: 'public'; course: PublicCourse };
```

PlanIntentはOffering bindingのfieldを持たず、courseIdは必ずCourseRegistryを参照する。provisional Courseでもintent作成は可能で、verified限定なのはauto-link条件である。courseId=nullのOfferingからPlanIntentを合成するvariantは定義しない。

同offering IDのrevision差で進捗キーを増やさない。annual参照resolverは、Enrollmentが存在すればそのofferingRefを正本として使う。Enrollmentがない場合だけofferingCatalogRefsのorphan pinを使い、indexからPlanIntentとの関連を導出しない。active EnrollmentのIDはindexに二重保存しない。削除時に残存進捗/評価/todo/import等の参照がある場合、offeringRefをindexへ退避し、復元/re-add時には同revisionをEnrollmentへ移してindex entryを除く。pinの移動は同じoptimistic save内で行う。必要bundle revisionはどちらの参照からもregistryの保持対象にする。revision変更で異なる意味のrecordが必要なら新offering IDを発行し、進捗を自動コピーしない。

既存offeringId fieldはv21の値を保つ互換キーであり、PlanIntentへの別bindingを表さない。offeringRef.offeringIdと同じ開講を指すことは検査するが、逆方向のintent bindingやactive revision indexの一致検査は設けない。

新state schemaは2026 schemaの`$defs/PlannerState`を書き換えるのではなく、`planner_state_v22.schema.json`等の独立schemaとして作る。旧catalog validatorは既存schema、旧state検査はそのv21 defsを利用する。新annual/registry/curriculum schemaも独立versionとして作る。`plannerCatalog.ts`生成物の年literalを機械置換して再利用しない。

JSON SchemaではPlanIntentのcourseId必須・planned/dropped、整数年度、required/extra property、ID formatとEnrollment側の参照/evidence形状を検証する。runtimeではPlanIntent.courseIdのregistry存在、Enrollment.planIntentIdの参照先存在・planned状態・一意性、参照intentとのcourse/targetAcademicYear一致、offeringRefのrevision存在、scope/課程bridge、offering uniqueness、史学順序、import meta参照を検証する。planIntentIdがnonnullならlinkDecision必須、nullならlinkDecisionもnullとする。未link intentとintentなしEnrollmentはそれぞれ有効で、逆方向bindingの一致や保存されたlinked flagを検査する設計にはしない。補助indexはorphan用でactive EnrollmentのIDと重複させない。

link/unlink時のbinding更新対象はEnrollmentのみ。希望暦年/年次/時期のユーザー編集では、希望を保持するintentと既存UIのEnrollment側スケジュールを必要に応じて同じ操作で更新するが、これはbindingの二重保存ではなく利用者が指定した予定の更新である。link成立のためにPlanIntentへderived stateを保存しない。生のPartial patchでlink IDや開講年度を編集させない。

保存済みbindingのscope/課程検証はEnrollment.linkDecisionにpinしたcontextを基準とする。画面のselectedScopeIdや利用者の課程選択が後から変わっただけで保存stateを不正としてlockしたり、intentを新scopeへ書換えたりしない。新contextではreview表示と算入可否の再確認を行い、既存Enrollmentのbindingは保持する。未link intentの新規auto-linkだけは現在の明示contextとの一致を要求する。

## Migration v21 -> proposed version

提案保存versionは **22**。catalog bundle/schema version、curriculum revision、extension contract v1とは別versionである。

1. raw JSONとschemaVersionを検査する。v22 clientは23以上をunsupportedとしてlockする。v21 clientは22をlockする既存挙動を維持する。未知versionをv21へdowngradeして保存しない。
2. v1〜v20は既存migrationの結果をv21へ正規化してから新段階を通す。v21入力も認定domain recoveryを含め、従来安全に読めるものを同じ基準で受け入れる。現行の早期return/final wrapperに新v22段階がskipされないよう明示pipelineにする。
3. immutable2026 effective adapterで全既存offeringIdを解決する。v21-validなら2026のIDとして解決できる。欠落/重複等の構造不正は原文保持+lockし、itemをdropしない。
4. itemsの旧fieldをすべてspreadして保持し、`planIntentId=null`、`linkDecision=null`、`offeringRef={offeringId, academicYear:2026, revisionId: pinned2026Manifest}`を追加する。annual参照はEnrollment.offeringRefを正本とし、既存itemにintent bindingを作らない。参照年度はsourceの事実であり、plannedYearから作らない。
5. offeringがmatchedで、nonnull courseIdが2026 CourseRegistryに存在する場合だけそのcourseIdを補完する。全209 Courseは当初provisionalなので`catalog_provisional`とする。courseId=null、manual_review、outside_mapping_scopeは`courseId=null` / `unresolved`。元offeringに書かれたcourseId/sourceはcatalog側に残るため情報は消えない。名前・mapping・importから補完しない。後のverified ledgerによる補完は別の明示operationで行う。
6. `planIntents=[]`とschemaVersion=22を追加する。migrationで未来intentを自動生成せず、courseId=nullでも既存Enrollmentを失わない。未来plannedYearを持つ旧itemも2026参照のまま保持し、CourseRegistryにcourseIdが存在する科目だけが後の明示操作でfuture intentを作れる。null identityはUIで未来計画不可と示し、name/mapping/subjectCodeから補完しない。既存earned/in_progress等、nonstandard term、null予定、earnedOrder、配列順を保持する。
7. publicCourses、todos、mediaSchoolingProgress、courseEvaluations、correspondenceProgress、importedStudyRecords、importedCourseAchievements、importedCourseUserMeta、graduationProfile（放送大学認定含む）、thesisSelection、thesisProgressByScope、thesisGuidanceByScopeは既存field/value/keyをそのまま保持する。orphan進捗も残す。importの再repair/再matchをv21→22の副作用にしない。todos/進捗/評価/import候補・選択/認定科目の参照から、対応Enrollmentがなく、2026 catalogで解決できるIDだけを`offeringCatalogRefs`へpinする。active itemのofferingRefやintent bindingをindexへコピーしない。現行v21 validatorはimport候補・選択の全参照を強制検証していないため、既存の解決不能import IDを移行失敗や削除の理由にしない。その元値は保持してwarning対象とする。必須annual itemやprogressの壊れた参照とは区別する。
8. v22 schema/runtime検証を行う。loadでは保存しない。明示的な通常saveが成功するときだけv22をprimary keyへ書く。原子的な全stateのsaveとraw比較を維持し、失敗ならUIと保存stateを変えない。

storage keyは`hosei-planner:v1`のまま。`BACKUP_KEY`のbytesをmigrationで変更しない。recovery resetは従来の明示操作だけで、backup失敗時にprimaryを消さない。

認定shadowはload resultの`recoveredRecognitionRaw`と`invalidRecognitionPaths`を引き継ぐ。v22のintent追加・link保存でも`saveRecoveredState`相当を必ず通し、未修正pathのraw値を再埋込する。schema移行のためにshadowを正常値へ上書きしない。放送大学11単位→safe nullの回復中でも、無関係intent操作で11の原値を失わず、対応fieldを直した場合のみ解消する。

migrationのlosslessとは既存semantic fieldの保持であり、全JSON bytesがv22で同一という意味ではない。原bytesはLoadResult.rawに保持し、明示recovery時にはbackupへ保存できる。重複loadのmigrationはdeterministic、v22入力は再migrationなし。旧schemaが追加propertyを許しているgraduationProfile/recognizedCreditsの値はそのまま保持し、新schemaの導入で捨てたりlockしたりしない。旧schemaでも許されない構造不明fieldは黙って削除せずlockする。

## Auto-link algorithm

registryへ新年度bundleを登録すると、`intent.status=planned`かつそのidをplanIntentIdで参照するEnrollmentが存在しないintentだけを再評価する。linked/unlinkedはこの検索結果から導出し、保存しない。catalog追加は保存stateを書き換えない。純粋assessmentを計算し、auto_linkableなintentについてEnrollmentだけを通常の競合保護されたsaveで追加する。dropped intent、既存linked Enrollment、年度外のitem、importのmanual choiceは対象外。

1. 対象年度のbundleを検証し、どのrevisionを今回評価するかmanifestで一意に固定する。invalid bundleは未登録として警告する。年度不明時に最新年を代用しない。
2. intent.courseIdの**exact stable ID**で候補を列挙し、offering.academicYear===targetAcademicYearを必須にする。名称/subjectCode/classCode、前年方式、希望時期の近さでmatchしない。
3. CourseRegistry identityがverifiedで、年度のsourceから同IDへ対応する監査evidenceがあることを確認する。provisional/ambiguous、candidate.courseId=null、manual_reviewはlink不可。outside_mapping_scopeや対象scope矛盾もauto-link不可。manual選択でもidentity ambiguity/manual_reviewを解除する手段にはしない。
4. 全方式・時期のcoverageが対象course/年度について確認済みであることを要求する。候補0ならunconfirmed。partial sourceで1件だけでもreview/unconfirmed。候補数は安全filterで恣意的に1件へ減らさず、exact ID+yearの全distinct offeringsで判定する。無効候補が混じるならその理由をreviewする。
5. selected scopeとintent.scopeId、および明示適用課程のcontextが一致するか確認する。scope未選択、unknown/legacy課程、作成後にcontextが変わった場合は候補表示+review。current_2026でも対象年からその課程へのverified bridgeが必要。manual_curated・officialVerified=falseの対応をmatchedというだけでauto-link用verified bridgeへ昇格しない。年度横断の対応evidenceを別途承認する。common scopeはCurriculumBundleの明示common関係に従い、別学科を推測で共通扱いしない。
6. 候補が複数ならcandidates。通信/スクーリング/メディアのどれかを選ぶのは利用者。希望時期などで自動pickしない。1件に一意の場合だけ次へ進む。
7. 参考にした過去bundleとsemantic差分を比較する。offering.credits、構成単位、対象scope、category/field/requirementType、schoolingOnly/mediaOnly、eligibleYears、bridgeの意味を比較する。年度ごとのID変更そのものは意味の変更としない。比較するbaselineは同方式/同variantの参考群とし、前年の通信4単位とスクーリング2単位を同じ1値へ潰さない。一意なbaselineがない、null→既知、bridge不足でもreview。referenceがない場合も初回manual確認を要求する。
8. 単位/mapping変更ならreviewとしてwarningを提示し、対応Enrollmentを作らず未linkのまま。手動確認で変更内容を了承した時のみlink可能にし、了承codesとsource/bridge revisionをEnrollment.linkDecisionに残す。PlanIntentのcourse/year/時期や既存earnedの単位を書き換えない。method/periodの変化もcandidateの公式値を明示し、希望と衝突すればreviewする。
9. same offeringの既存item、他intentのclaim、revision違いの進捗参照を検査する。衝突があればauto-link不可。既存recordに自動mergeせず、利用者に既存行の利用または別候補を示す。
10. 全条件が通れば`auto_linkable`。Enrollmentをplannedで作り、planIntentIdとofferingRefにbindingを、linkDecisionにreview evidenceを保存する。既存PlanIntentは変更しない。plannedYear/studyYear/希望時期は初期値として引き継ぎ、評価/進捗/earnedOrderは作らない（earnedOrder=null）。通常はitems追加だけが更新対象で、offeringCatalogRefsへactive bindingを追加しない。候補の既存orphan pinがある場合のみ、同revisionであることを検査してEnrollmentへpinを移し、index entryを削除する。保存直前に再検証し、同じrawに対する一つのoptimistic saveで確定する。

手動選択では複数候補の中から指定した1件を同じresolverで再評価する。全候補での一意性は不要だが、選択候補のverified identity・対象年度・scope/課程bridge・保存衝突の検査は必須。credits/mappingや希望との変更は差分を明示して了承をEnrollment.linkDecisionへ記録する。既存のintentなしplanned Enrollmentを利用する明示操作も、同じ安全検査を通してそのEnrollmentだけにplanIntentId/linkDecisionを設定する。coverage不足で他候補が未確認ならその点も明示し、選んだsource-backed開講だけが確認できたことを表示する。identity ambiguity/manual_review、verified bridge不在、競合を単なる了承で通過させない。利用者の課程設定修正やsource ledger監査で根拠が整ってからlinkする。

```text
assess(intent, registry, state) -> candidates + reasons + result
  catalogなし/候補なし              -> unconfirmed
  identity不明/coverage不足/矛盾     -> review（bindingなし）
  複数distinct offerings            -> candidates（bindingなし）
  1候補 + 差分/衝突/比較不能        -> review（bindingなし）
  1候補 + 全安全条件成立            -> auto_linkable

applyLinkDecision(state, assessedRevision, expectedRaw)
  assessment再検査 -> Enrollmentを作成（PlanIntent不変）
  -> orphan pinがあればEnrollmentへ移す -> validate -> optimistic save
```

再実行はidempotent。既存Enrollmentのbindingを最新revisionへ自動移動しない。catalog訂正や科目廃止が判明したらEnrollmentの正本を残してreview表示にする。sourceから消えたことだけでは「未来も開講しない」と断定せず、収録範囲/公式廃止evidenceを区別する。手動linkもexact identity/yearと構造整合は必須であり、選択UIで安全条件を無効化しない。

## Affected files/modules

以下はPhase 2以降の変更予定一覧。Phase 1の変更は本docのみ。新module名は提案で、既存生成物・raw snapshotを維持する境界を示す。

| files / modules | 必要な変更・保持する境界 |
| --- | --- |
| `src/planner/plannerCatalog.ts`, `planner_catalog_2026.schema.json` | 旧generated catalog型/schemaとして保持。新`plannerStateV22.ts` / `planner_state_v22.schema.json`等でEnrollment/Intentを定義し、型のimportを段階切替 |
| `src/data/planner_catalog_2026.json`, 2026 manual/official override JSON | bytes/IDs維持。manifestへsource digest登録。2027 bundleは別data pathで追加 |
| `catalog.ts`, `manualMappingOverrides.ts` | 2026専用adapter化、件数686検査とledger provenance維持。新`courseRegistry.ts`, `annualCatalogRegistry.ts`, `curriculumRegistry.ts`, `offeringCurriculumBridge.ts`で独立resolver |
| `storage.ts` | v21→22段階、version上限、safe補完、shadow/expectedRaw/backup保持。bundle未取得と壊れたstateを区別し、参照不明を削除しない |
| `validation.ts` | legacy schemaとv22 stateを分離。intentのregistry courseId、Enrollmentだけに置くbinding/evidence、参照先・一意性・course/year/revision/bridgeと既存特殊順序を検証。orphan indexとactive Enrollmentの重複禁止 |
| `plannerItemState.ts`, `removeUndo.ts` | offering item操作を保持。新`planIntentState.ts`, `planLinker.ts`でintentId CRUD、Enrollmentのみのlink/unlink、取消、削除/Undo時のorphan pin移動、衝突防止。raw Partial patchでrebindしない |
| `src/pages/PlannerPage.tsx` | catalog singleton依存をview-specific resolverへ。年度selector/未来intent CRUD/candidate review・auto-link通知。saveRecoveredState経由の保存、error lock、undoImportを維持 |
| `CourseSearch.tsx`, `PlannedCourseList.tsx` | offering検索とregistry course検索を年度別modeにする。courseId=nullは未来計画不可の明示と追加無効化。PlanRow unionとderived link表示、未確認label、希望時期/開講期・暦年/開講年度・年次の別UI。2026の追加操作を維持 |
| `planTable.ts`, `yearEligibility.ts` | offering専用form/progress helpersを維持し、intentへ呼ばない。未来eligibilityを前年から確定せず参考化。targetYear変数の年次意味を明確化 |
| `annualPlan.ts`, `calculations.ts`, `AnnualCreditLimitNotice.tsx`, `CreditSummary.tsx`, `CategorySummary.tsx` | unknown未来件数、暦年別group、linked pair一回、policy source/年度未確認を表示。2026 legacy projectionを保持 |
| `mediaSchooling.ts`, `MediaSchoolingProgress.tsx`, `MediaProgressShareModal.tsx` | offeringId progress保持、未link intent除外。registryで確認したdeliveryのみ利用し、shareは年度を混ぜず同一year+categoryへ分ける |
| `correspondenceProgress.ts`, `correspondenceRequirements.ts`, `CorrespondenceProgress.tsx` | 2026必要リポート数は2026 offeringId専用。未来にコピーしない。新年度source未確認ならrequiredReports=null |
| `courseEvaluations.ts`, `CourseEvaluations.tsx` | offering-keyed record/orphan保持。未link intentへ評価controlsを作らない。既存statusを評価から推定しない |
| `unifiedCourseView.ts`, `importedAchievementIdentity.ts` | 2026互換viewとmulti-year viewを区別。年度/attempt/component証拠による厳格coalescing。intentを成績で消さない |
| `gradeImportApply.ts`, `importedAchievementRepair.ts`, `GradeImportPanel.tsx`, `ImportedAchievements.tsx` | 年度aware候補、信頼度別source/inferred年度、manual選択保持。first/latestを自動選択しない。既存fingerprint/upsert保存契約維持 |
| `importedAchievementCalculations.ts` | virtual計算rowをannual identityから分離。aggregate/component/dedupとrepeatableを再監査。sourceを架空開講に変換しない |
| `graduationProgress.ts`, `plannerHelpers.ts`, `graduationProfile.ts`, `graduationSources.ts`, `GraduationProgress.tsx`, `GraduationProfileSettings.tsx` | requirement contextを年度catalogと分離。2026算入engineをadapterとして維持。未来intent取得単位除外、verified bridge必須、認定/免除とfalse固定 |
| `thesisSelection.ts`, `thesisGuidance.ts`, `ThesisGuidance.tsx`, `ProgramSettings.tsx` | scope独立記録を保持。指導policy resolverは課程contextに属する。future intentを資格単位へ入れない |
| `repeatableRules.ts`, `historySeminar.ts`, `geographyTransferRules.ts`, `publicCourseRules.ts` | 2026 policyとして固定。cap/order/特例を年度横断の実績へ適用する際も旧課程の意味を維持。future未確認bridgeを算入しない |
| `publicCourses.ts` | 新規予定暦年を選択contextから提案可能に。既存UUID/2単位/タイトル/status保存を維持、未来source未確認label |
| `plannerExport.ts`, `PlannerExportActions.tsx` | intent/offering/source年度・未確認状態をCSV/PNGへ。unknown単位は空欄、方式は未確認。既存2026 export順序/escapingを回帰検証 |
| `gradeImportContract.ts`, `directGradeHandoff.ts`, `extension/hosei-planner-import/*`, `scripts/planner-targets.mjs`, `build-extension-dev.mjs` | payload v1/target origin/token/preview-firstを保持。拡張はcatalog identityを送らないためwire contract変更不要。Planner内の照合先resolverのみ変更。拡張testsで回帰確認 |
| `tests/planner.test.mjs`, `extension/hosei-planner-import/tests/*`, `docs/grade-import-contract.md`, README | 実装PRで新テスト/型fixtureと説明追加。現177件の安全assertionを維持。CIは現状main向けなのでfeature pushだけで実行されるとは報告しない |

## PR breakdown

このdoc-only Phase 1の後、**実装を4PR**に分ける。各PRは独立にtypecheck・回帰検証が通り、main/devへの直接commitを行わない。

| PR | scope | acceptance criteria |
| --- | --- | --- |
| 1. Foundation model + migration | v22 course-level intent/enrollment型・schema、Enrollment binding正本、orphan専用index、CourseRegistryとimmutable2026 manifest/adapter、storage migration、validation、derived plan read model。新年度catalog/UIはまだ追加しない | v21 field全保持、全686参照解決、全209 provisional維持、null/manual/outside保持、未来schema lock、shadow/backup/競合維持。PlanIntentにbindingなし、registry courseId必須、active参照のindex二重保存なし。既存2026動作・進捗・計算不変。provisional intent fixtureのsave/reload可 |
| 2. Future-plan CRUD / UI | 年度selector、registry course-level追加/編集/取消/Undo、未確認表示、null identityの未来計画不可表示、予定暦年/年次/希望時期、未来件数・export、公開科目参考label | 登録済みverified/provisional courseIdの2027/2028 intentを保存/reloadできる。null/未登録courseIdは未来追加不可、名前からCourseを生成しない。未来属性を前年コピーしない。invalid status不可。2026検索・table mobile/desktopの既存操作維持。未取得計画でgraduation/guidance増加なし |
| 3. Annual registry + safe linker + annual-aware import | 複数年度bundle validator/index、Course verification ledger、curriculum bridge、pure assessment、Enrollmentのみのunique auto-link/候補選択/review/unlink、削除/Undoのorphan revision移動、import/unified/計算dedupの年度対応 | synthetic2027の一意条件でEnrollmentにだけbinding/evidenceを保存しPlanIntent不変、linked状態は導出。複数/差分/曖昧/部分source/衝突は自動pickしない。provisionalはauto-link不可。2026 bytes保持、過去年importが未来計画へ誤合流しない。repeatable実績を潰さず不明は保留。実際の2027公式data追加は行わない |
| 4. Regression / hardening | 特例・repeatable・全学科graduation/指導・media share年度分離・annual policy表示・extension/export回帰、binding正本・orphan pin・null identity制約・保存失敗/競合/欠落source/Undoの統合検証、説明整理 | マトリクス全項目、177件既存回帰の安全条件、desktop/mobile導線、fake年fixture非配信、false固定。2026課程でfuture bridgeなしの算入保留、release可能な既存state互換を確認 |

PR3はcatalogを複数年度で公開できるようにする段階であり、import/identity/dedup対応が完成する前にglobal multi-year offeringsを既存importへ渡してreleaseしない。PR4は新機能の安全条件を先送りするPRではなく、PR1〜3でそれぞれ成立させた条件を横断検証する段階。

実際の2027公式catalogと、そのsource-backed identity/bridge/coverage ledgerの追加は、公開後の別data audit PRで行う。その時に2027卒業要件も新versionを作るかは、利用者に適用される公式課程根拠を別に確認する。

## Open questions

未解決の判断事項は **1件**。PR1のlossless migrationとPR2のfuture plan CRUDのblockingではない。productionでのcross-year auto-linkを有効化するPR3までに回答が必要。

1. **年度横断のcourse identityをverifiedに昇格する根拠と承認手順は何か。** 大学資料/元生成snapshotのどのstable identifierを採用し、元生成工程を入手できない場合の手動equivalence ledgerを誰がどのsourceで承認するか。現行209 provisional UUIDをそのままstable IDとして保存する設計は決定済みだが、名称一致だけでverifiedにはしない。CourseRegistryに存在するcourseIdはverifiedの根拠未確保でも計画可能・自動link停止を継続する。courseId=nullのOfferingの未来計画不可とは区別する。

同一annual offeringの複数attempt storage、auth/cloud sync、実際の2027開講/要件は本roadmapの判断待ち項目として広げず、明示non-goal/別data auditに置く。

## Risks and invariants

- **保存データ不変:** migrationは旧field/value/key/orderを失わず、loadは書かない。未来schema、壊れた参照、競合時はraw保持+変更lock。認定shadowとrecovery backupは別々に維持する。
- **年度と課程の独立:** plannedYear、targetAcademicYear、Offering.academicYear、studyYear、curriculum versionは独立。年度selectorが適用課程を変更しない。
- **source不変:** 2026 rawとledger provenanceを保持し、2027追加で上書きしない。最新revisionで過去の単位・mappingを書換えない。参照revisionを解決できなければ削除せずlock/reviewする。
- **identityの保守性:** matched mapping≠verified Course。全209 provisionalと348 null IDsを隠さない。future PlanIntentはregistryに存在するcourseIdのみで作成可能。provisionalは計画可・auto-link不可、nullは2026既存利用可・未来計画不可。name/mapping/subjectCodeからCourseを捏造せず、監査後のidentity付与/registry収録を待つ。全2026開講の未来計画対応を保証しない。
- **unknownを0としない:** 未確認単位・方式・期・availability・annual policyは未知件数/理由を出す。未確認候補を「開講確定」にしない。
- **linkの正本:** Enrollment.planIntentId + Enrollment.offeringRefだけがbindingを保存し、evidenceはEnrollment.linkDecisionに置く。PlanIntentに逆方向bindingやlinked flagを持たせず、対応Enrollmentの有無から導出する。参照先存在・一意性・course/対象年度・evidenceを検査し、未link intentとintentなしEnrollmentの両方を許容する。
- **最小の原子的更新:** 通常linkはEnrollment追加、unlinkはそのEnrollmentのplanIntentId/linkDecisionクリアだけで成立し、PlanIntentを更新しない。候補再評価は純粋で、既存link/status/評価を変えない。削除/Undoやorphan pin移動に必要な更新だけを同じoptimistic saveで確定する。
- **orphan indexの役割:** offeringCatalogRefsはEnrollmentのないOffering参照のrevision pin専用で、intent bindingを保存・推定しない。active Enrollmentの参照を二重保存しない。削除時の残存参照にだけpinを退避し、Undo/re-addでEnrollmentへ移す。
- **進捗identity維持:** media/correspondence/evaluation/todoはannual offeringのキーを維持し、courseIdへ合体しない。計画削除後のorphanとUndo/re-add復元を保持する。
- **取得事実と意図の独立:** future intentは取得単位・公式成績にならない。earned/failedはcomponent評価から推定しない。import row ID/fingerprint/raw/manual choiceを保持する。
- **重複と繰返しの両立:** 同source factは一回、異なるclass/year/確認済み履修回は保持。courseIdだけでrepeatableを統合しない。意味の異なるaggregate/componentは不明のまま保留する。
- **2026特例保持:** 史学修得順、5科目例外、地理allocation、法律/共通/repeatable cap、公開科目上限、放送大学認定は明示2026課程のpolicy。future yearごとにcapを再付与しない。
- **卒論独立:** thesis/guidanceはscopeと適用policyで管理し、annual catalog選択や未来計画だけで指導合格・資格単位を増やさない。
- **partial catalogの危険:** 1候補でも未公開方式がある限りuniqueとは断定しない。source coverageとidentity承認が揃うまでauto-link停止。
- **generated contractの危険:** 元generator不在でlegacy generated filesを再生成しない。新型/schemaは分離し、schemaとruntimeの双方で互換性を確認する。
- **移行後の旧client:** v21 clientはv22をlockする。schema downgradeや古いtabによるsaveを許可せず、利用者へreload導線を維持する。
- **最終判定の限界:** `graduationCheckComplete=false`をcatalog metadata、curriculum bundle、計算結果、UIの全経路で維持する。2027の計画/開講確認から公式2027卒業判定を主張しない。
