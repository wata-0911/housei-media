# 卒業要件エンジン監査（2026年度）

監査日: 2026-10-03。基点: `ca2aeea81c1ee692c998cd1e4399a9fafc48d23d`（dev、PR #52 merge）。作業 branch: `feature/graduation-engine-audit`。

**結論: 卒業要件エンジンは未完成。`graduationCheckComplete=false`、PlannerState schema 22、persistent shape を維持する。** 本監査は実装・正本・identity・例外・テストを別々に確認したもの。画面の `coverageStatus=supported` やテスト成功を、そのまま監査の supported に読み替えない。次の実装は **official achievement を CurriculumCourse → Mapping へ直接渡す calculation-only fact layer** の1 slice に限定する。

## 1. 判定基準と監査範囲

- **supported**: 明記した限定範囲について、実装・取得した公式根拠・入力 identity・境界条件・テストが揃う。
- **partial**: 一部の通常ケースは計算するが、official 入力、例外、重複排除、適用課程などに欠落がある。
- **unknown**: 本人の認定・修得順・公式の個別決定・資料が不足して判定を確定できない。0や不合格に置き換えない。
- **unsupported**: 公式条件は分かるが、その評価経路・必要データ契約が存在しない。

本編の completion matrix は意味単位の全ルールを網羅する。付録は **catalog 全182行（structured 142 / unsupported 40）を列挙**し、UUID・ruleId・ruleType・target・conditions・現評価と対応する意味単位を結ぶ。catalog の `status` と本監査の status は別物。catalog unsupported でも専用カードに partial 実装が存在する。

監査対象は `graduationProgress.ts`, `importedAchievementCalculations.ts`, `officialCourseCredits.ts`, `graduationSources.ts`, `plannerCatalog.ts`, `plannerHelpers.ts`, `graduationProfile.ts`, `publicCourseRules.ts`, `geographyTransferRules.ts`, `historySeminar.ts`, `repeatableRules.ts`, `thesisSelection.ts`。加えて import parser/contract/apply、Curriculum identity validation/catalog、CourseProgress、recognition、annual49、既存 tests を確認した。学籍・在学年限・卒業手続の公式完了判定はこの engine に実装されておらず、単位条件の充足だけで卒業可としない。

## 2. 公式ソースと確認範囲

|略号|公式 source|取得・確認|用途・限界|
|---|---|---|---|
|S|[2026年度 学習のしおり](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf)|2026-10-03 取得、248 PDF pages、SHA-256 `bb7fee419cec0f9d421b1d206947cf8fb1facb69992d685352817f756d19c4a5`。印刷ページ +2 = PDFページ。pp.30–32、44–61、68、135を画像確認|本文・表・脚注を正本とする。pypdf の抽出は文字化けし、Poppler は日本語font mapping不足だったため PDFium による画像で確認。全文や個人の適用課程を検証済みとはしない|
|R|[卒業に必要な要件](https://www.tsukyo.hosei.ac.jp/system/requirements/)|同日再取得、本文確認|124/128、30、科目群別要件、除外科目。ページ番号なし|
|SC|[スクーリング登録までの流れ](https://www.tsukyo.hosei.ac.jp/system/schooling-registration-flow/)|同日再取得、本文確認|30、認定上限7/15、年間登録49。卒業とannualを分離|
|T|[卒業論文について](https://www.tsukyo.hosei.ac.jp/system/graduation-thesis/)|同日再取得、本文・指導表確認|文学必修、法・経済学部選択、指導・提出・教授会判定。年度別締切の全確認ではない|
|A|[編入学者の単位認定](https://www.tsukyo.hosei.ac.jp/admission/accreditations/)|同日再取得、認定表確認|入学経路による認定と免除、前籍校による違い。個人の認定結果の代用にはならない|

S の分冊 `shiori202646-61.pdf` は再取得できなかったが、全体PDFの該当ページを確認できた。catalog 全 source URL / 686 Offering のシラバス / 公開科目の各『法政通信』は全件再検証していない。よって **sourceLinksReverified=false は正しく維持**。個別公開科目の回数制限、旧課程の全読替え（p.60が案内するログイン後資料）、成績表の欄の大学公式仕様書は **needs official verification**。

引用 metadata の欠落・ずれも残す（今回は production code を変更しない）。`curriculum(page)` にPDF URLがない。法律の＊印一覧は p.46、除外の文章は p.47。経済の表・卒論6単位は p.56（注意書き p.57）、商業は p.58（注意書き p.59）。現 `THESIS_CREDIT_METADATA_2026` の57/59、カードの57/59のみでは表の根拠が不足する。日本文学の各コース表は49/50/51、共通注意書き48。付録の sourcePage は保存値をそのまま記録し、これらの補正は本編を併読する。

## 3. 現在のデータ経路と確認した欠陥

```text
成績表 cells[5] → earnedCredits.value → ImportedCourseAchievement.earnedCreditsTotal
       cells[6] → schoolingCredits.value → schoolingCreditsTotal（別の量）
                         ↓ deriveImportedAchievements
 recordsリンク / selectedOfferingId / legacy courseId → matched Offering候補
                         ↓ 最初のtemplateをfind
 virtual Offering(id=imported:row.id, credits=公式aggregate, templateのmapping/name等)
 + virtual PlannerItem(status=earned, earnedOrder=null)
                         ↓ calculateGraduationProgress
 Mapping resolver(Offering.mappingIds) → generic requirements / 学科別cards
                         ↓ capped cards → overall reference / schooling reference
```

`ImportedStudyRecord` の `credits` は合計に加算しない。sourceRows がなければ同 sourceCourseId の component が保持する aggregate を代表行に戻す legacy fallback はあるが、component credits を足す経路ではない。`categoryItems` / `categoryOfferings` は区分表示用で、卒業の `calculationItems` に入らない。

|ID|確認事項・現挙動|影響 / 次実装で必要な修正|
|---|---|---|
|G1|`exactImportedCurriculumId` は Offeringなしでも exact を返す。しかし derive はその前に `courseIds.size===1` を要求する。exact Course-onlyでも legacy courseId がnullなら卒業へ流れない|公式aggregate4は保存・総修得表示に残るが卒業寄与0。Course→Mappingへ直接流す|
|G2|legacy courseId が一致する最初の matched Offering をtemplateにする。template credits がnullなら公式aggregateがあっても落とす|過去2020実績が2026 Offeringの存在・並び順・単位metadataに依存。年次開講をofficial factにしない|
|G3|複数Offeringが異なるMappingを持つと、最初のtemplateしか evaluatorへ届かない|exact CurriculumCourse全mappingの衝突が隠れ、配列を反転するだけで必修選択の算入先が変わる。Offering選択による曖昧さ解消は禁止|
|G4|1 Offeringに複数専門type/fieldが見える場合、professionalCardsはunknown。同じtype/fieldでもcredits/method flagsを比較せず最小mappingIdを採用する|全allocation signatureを比較すべき。equivalent edgeの扱いも共通カードと専門カードで不統一|
|G5|common+selected scopeのMappingを両方使う。共通はmappingIdごとに加算、専門は独立に加算|同一公式4が共通4+専門4=8になる合成fixtureを確認。共通に同値2edgeだけでも8。単位保存則と横断allocation ledgerが必要|
|G6|schoolingTotal===earnedTotalかつtemplate.method===schoolingのときのみ全aggregateをschooling化|mixed official4/schooling2/communication2はtotal4、schooling reference0。全schooling4でも通信templateが先なら0、schooling templateが先なら4|
|G7|未解決rowにcategoryRaw（または同カテゴリ名称候補）があればcategoryのみ生成しwarningを出さない|卒業0だが対応不明警告が消える。raw categoryをMapping根拠に格上げしない。unallocated official factとして残す|
|G8|unclassified import は importedWarnings になるだけで `hasUnresolvedEarned` の対象外|各cardはunknownではなくunsatisfied、全体referenceはpartialで0の場合がある。unknownの伝播範囲を明示する必要|
|G9|dedupは exact Courseが存在するだけで同Course Planner earnedを除く（公式値null/0でも）。source linkの一致でも除く|この公式優先policyを維持。ただしG1でofficialまで落ちると寄与が両方なくなる。nullを0に確定しない|
|G10|planned/in_progress/waitingはdedupから残る。現 evaluator がprojectionへ足すのはplanned/in_progressだけ|waiting保持とwaiting投影は別。future projectionの意味をテストで固定する|
|G11|専門認定は `RecognizedProfessionalCourse.offeringId` から仮のearned PlannerItemを作る。入力creditsを使わずOffering.creditsを使用。imported virtual idをcatalogOfferingsから引くdedupは失敗し得る|認定2がOffering4扱い、officialと認定の重複、plannedが認定を抑制する危険。正確な認定factは別sliceで設計する|
|G12|geography allocatorは「Offeringは不可分」とする。現地研究aggregate4を1行で渡すと2+2に分配できずdiscardし得る。史学のimportはearnedOrder=null|既存のattempt allocatorへofficial aggregateをそのまま渡してはいけない。repeat/sequence/transferは追加証拠がない限りunknown|
|G13|複数official rowが同exact Courseを指す場合、deriveはrow間dedupしない。source fingerprintは内容/occurrenceも含む|別修得・重複snapshotの区別が必要。Courseで無条件sumもmaxも不可。次sliceは衝突として保持|
|G14|Course identityがambiguousでも、legacy courseIdで1templateを得ると算入され、警告も出ない|Dを必ず保留する契約になっていない。公式fact入口でexact identityを必須とし、legacy経路での格上げを禁止|

これらは修正済みという意味ではない。新規 `tests/graduation-audit.test.mjs` の **GAP** テストは現在の欠陥を再現し、次sliceで期待値を正しい契約へ変更するためのcharacterization。既存テストは削除・弱体化していない。

### CourseProgress と Graduation の dedup policy

CourseProgress は official に source-linked したattemptのみ重複を抑え、別の明示earned attemptは表示・進捗に加算できる。Graduation はより保守的で、exact official Course があれば同Courseの全Planner earnedを追加加算しない。`courseCreditContribution` はCourseProgress/annual用で、現卒業allocatorではOffering.creditsを使用する。保存済みPlannerItemを削除する操作ではなく計算入力のfilterである。

### schooling の証拠契約

|量|正本 / 現契約|卒業側の扱い|
|---|---|---|
|総修得|`earnedCreditsTotal`。parser cells[5]→sourceCourseForがコピー|唯一のofficial aggregate。componentやschoolingTotalを加えて再構成しない|
|schoolingの行合計|`schoolingCreditsTotal`。parser cells[6]→コピー。nullを許す|sourceの別列の証拠。totalと同じとは限らない。p.32では通信4修得後のschooling2がschoolingだけに計上される場合もあり、常にschooling<=earnedと推測しない|
|method内訳|ImportedStudyRecord.method/credits/year/term/grade、保存された2schooling slots等|method・時期の証拠。重複component、空欄、未確定grade、不一致を診断。総単位の正本にはしない|
|手入力認定|profile.schoolingEquivalentCredits、外国語の内訳|公式認定書を根拠にした別fact。取得済みschoolingと重複しない範囲が必要。現first_yearはこの認定をreferenceへ使わない|

**official4 + schooling2 + communication2 は earned4、schooling evidence2。** 現卒業schooling0は欠陥。schooling evidence2を利用することと「卒業schoolingへ2算入できる」と確定することも分ける。取得年度、課程、教職除外、共通充足済み、repeat、認定と重複する範囲を判断する必要がある。大学公式の成績表列定義・認定/追加履修との関係は取得資料に明記されていないためunknown。parser数値validationはこの意味的整合性を証明しない。

## 4. Completion matrix（意味単位）

表の関数は特記しない限り `graduationProgress.ts`。入力 **O/M** はPlannerItem→Offering→Mapping（importも仮想O/M）、**P** はGraduationProfileの明示認定、**T** はscope別ThesisProgress、**U** はPublicCourse。UUID/ruleIdの全対応は付録。試験欄の「追加」は次実装のrequired testsであり、今回合格したと偽らない。

### 共通教育・年間・スクーリング

|ID / scope|official rule|source/page|catalog requirement ID（ruleId）|current function / identity|status|missing evidence / risk|recommended implementation / required tests|
|---|---|---|---|---|---|---|---|
|C01 共通|一般36、算入上限36、教養合計42|S44–45/R|common_general_exact_credits, common_general_max_credits, common_total_min_credits|groupedCards, countedOverallCredits / O/M|partial|G1/G5。generic exactは超過でunsatisfiedだがcardはcap後satisfied|Course単位で完成判定→cap。36/38・複数edge・no Offeringの追加テスト|
|C02 共通人文|8以上（現4単位科目なら2科目）|S44–45/R|common_general_humanities_min_credits|groupedCards / O/M|partial|Course完成はmappingId単位。認定と実修得の区別|構成単位未達2/4を除外、8境界・認定併用テスト|
|C03 共通社会|8以上|S44–45/R|common_general_social_min_credits|groupedCards / O/M|partial|same Course edge重複、旧課程|2/4単位をCourseで集約、8境界|
|C04 共通自然|8以上、種別ごと分野判定は6上限、一般総数には超過分も可|S44–45|common_general_natural_min_credits, common_natural_per_subject_kind_max_credits|groupedCards/naturalFamily / O/M+Offering名|partial|種類を最初のOffering名からregex判定。旧新同種の証拠|canonical familyと総数/分野の別allocation。数学旧4+新6→自然6/総数10の追加|
|C05 その他・基礎特講|その他に算入。基礎特講2回4上限|S44–45|common_basic_lecture_max_credits|groupedCards / O/M+名前|partial|単位capあり、official aggregateから回数が復元できない|独立した回数証拠。3回6/aggregate4/重複attempt|
|C06 外国語同一言語|英独仏の1言語4単位|S45/R|common_foreign_choose_one, common_foreign_exact_credits|groupedCards / O/M field|partial|generic conditions rejected。Offeringなし・言語認定部分と実修得の組合せ|Course fieldから言語。英2独2は不可、英4はschooling確認|
|C07 外国語schooling|同言語内schooling2以上、全4をschoolingでも可|S45/R|common_foreign_min_schooling_credits|groupedCards / O/M.method|partial|G6でmixedの2を失う。language欄の公式証拠|earnedとschooling別量。official4/schooling2・全4・null|
|C08 外国語上限・再履修|1言語のみ4上限。充足同言語の再履修禁止|S45|common_foreign_max_credits, common_foreign_reenrollment|groupedCards / O/M|partial|capはある。履修禁止は卒業計算から独立して未実装|2言語達成時4だけ、再履修advisoryは別。上限超過テスト|
|C09 保健体育|概論または総合演習の1科目2、算入2上限|S45/R|common_physical_choose_one, common_physical_exact_credits, common_physical_max_credits|groupedCards / O/M+名前|partial|generic choose_oneがoptionsを評価しない。exact Courseなしに名前依存|Course2完成/1+1の同一course/異なるcourse/両科目完成|
|C10 放送大学|認定最大10、一般その他・schooling。外国語/体育を除外|S45,135|common_open_university_max_credits（reference-only）|applyRecognition / P|partial|一般その他capはあるがschoolingへ自動反映しない。p.135の放送1/面接1/online2、期限は未評価|明示認定結果を用い重複なしのschooling証拠。first_year認定・期限・exemptとの重複テスト追加|
|C11 充足済み共通/認定|既に充足（認定/免除含む）は卒業総単位へ足さずschoolingのみ可|S45e|common_already_fulfilled|applyRecognition / O/M+P|partial|免除=earned0はある。部分/区分充足済みの履修履歴・認定との重複未統一|allocation exclusionとschooling creditを分離。認定36+再履修、外国語・体育|
|C12 共通旧課程|自然の旧新再履修と同年度media再履修制限、読替え|S45b,g/60|common_natural_legacy_reenrollment, common_legacy_rules_external|referencePrerequisiteReasonのみ / P|unsupported|旧課程はoverall unknownだがcardを全面停止しない。詳細ログイン資料未確認|課程/時点証拠がない場合unknown、年だけで決めない|
|S01 全学科|schooling計30以上（認定相当込み）|S30,68/R/SC|専用schooling-reference-progress、catalog全学30 ruleなし|countedSchoolingCredits / legacy courseId+O/M|partial|G6。複数mapping・repeatは除外しunknown。同course capでp.32追加schoolingを失い得る|method factに独立budget。mixed、schooling>total、repeat、認定7/15|
|S02 年間|49は年間スクーリング登録制限、卒業単位条件ではない|SC|なし（annual advisory）|annualCreditLimitReferences / annual Planner+Offering|supported（分離のみ）|卒業engineから呼ばないことをコード確認。履修可否や特例60の保証ではない|既存annual49境界/未来年度reference tests。独立性を維持|
|S03 実修得method|通信/スクーリング組合せ、4構成に2+2等|S30–32|course_credit_completion系列|deriveImportedAchievements, completedCurriculumCredits / O/M|partial|total4は維持、G6でmethod内訳不足。履修順・試験資格は別条件|componentからtotal再構成禁止。今回mixed test、次はmethod evidenceのconsistency|

### 専門教育（6学科、日本文学は3scope）

|ID / scope|official rule|source/page|catalog requirement ID（ruleId/系列）|current function / identity|status|missing evidence / risk|recommended implementation / required tests|
|---|---|---|---|---|---|---|---|
|L01 法律|選択必修8科目32、構成単位完成|S46–47b|law_required_elective_min_credits, _note|professionalCards / O/M mappingId|partial|legacy/template依存。必要科目数をoverflowRuleから取るためrule欠落時0へfallback|Courseでdistinct8かつ32。7科目32、8科目部分修得、no Offering|
|L02 法律|超過選択必修→選択、重複算入不可|S47b|law_required_elective_to_elective_overflow_credit_transfer|electiveOverflowRule, professionalCards / O/M|partial|threshold32は利用、generic overflow未対応。G3/G5|排他的allocation。32/36境界、scope衝突|
|L03 法律|8科目32達成後のみ4単位科目のschooling2部分修得可|S47b|law_partial_course_exception（catalog unsupported）|professionalCards.permittedPartial / O/M.method|partial|Planner例外testあり。official mixed/template法では2の証拠失う|earned2、schooling2、構成4を別判定。条件前後、通信2不可|
|L04 法律|卒論あり: 選択50（卒論4含む）/専門82、なし:54/86|S46/R|law_elective_with_thesis_min_credits, law_elective_without_thesis_min_credits, law_total_*|professionalCards / O/M+T|partial|通常閾値一致、undecided unknown。official卒論rowはTへ直結しない|4を1回だけ、選択分岐・manualとofficialの二重計上なし|
|L05 法律|専門schooling8、表の＊と公開科目を除く|S46＊/47c|law_professional_min_schooling_credits|professionalCards / O.method+legacy canonicalName|partial|13名称リストは表と一致、公開科目は別除外。ただしG6、legacy canonicalとraw名差|Course canonical+source marker+schooling evidence。全＊/非＊・mixed|
|L06 法律|政治学2回4、法律学演習4回8、法律学特講4回8、総合特講8回16|S47d–g|law_politics_max_credits, law_seminar_max_credits, law_law_lecture_max_credits, law_general_lecture_max_credits|repeatableRule / O名前・Offering回数|partial|aggregate1行は1回扱い、構成単位と繰返し上限が別|回数証拠不足unknown。上限±1回・公式累計・異なるタイトル|
|J01 日本文3scope|必修20（コース別5科目）|S49/50/51|japanese_*_required_min_credits, 個別required_course|professionalCards/evaluateStructured / O/M|partial|groupは合計20のみ、個別course条件と一体の卒業結論なし|Courseごと完成、コース変更・必修5科目・同名別Course|
|J02 日本文3scope|選択必修20以上、超過→選択24以上|S48c,49–51|japanese_*_required_elective_min_credits, _elective_min_credits, _overflow_credit_transfer|professionalCards/electiveOverflowRule / O/M|partial|通常overflow test有。G1/G3/G5|20/24境界、超過1回配分、3scope各検証|
|J03 日本文3scope|専門合計82（卒論8必修含む）。上記最小値合計だけでは不足|S48c,49–51|japanese_*_total_min_credits, _thesis_required_course|professionalCards / O/M+T|partial|現82cardあり。official卒論は認識しても別manual源|必修20+選必20+選択24+卒論8=72は未達、82境界|
|J04 日本文3scope|通常4単位科目は完成必要。書道実技2はschooling1以上を含む方法|S48a,g/31|japanese_*_course_credit_completion, _calligraphy_methods|completedCurriculumCredits / O/M.method|partial|方法の最小確認あり。課題数/3年期限/再提出未実装、mixed aggregateからschoolingを失う|方法証拠とaggregate分離。通信のみ2不可・通信1+S1・S2・期限|
|J05 日本文3scope|総合特講8回16、公開8回16|S48d–f|japanese_*_general_lecture_max_credits, _open_courses_max_credits|repeatableRule/publicCourseCard / O/M,U|partial|repeat回数証拠、公開個別上限はunknown|8/9回・official累計・個別上限|
|H01 史学|必修16、概説3科目各4+史学概論4|S52/53c|history_required_min_credits, 個別required_course|professionalCards, historyOverviewName / O/M+固定UUID/名前|partial|概説は専用分配で4構成完成チェックと超過capを一般経路と共有しない|各概説6の配分、必修2/4保留、過剰aggregate|
|H02 史学|schooling選択必修4科目8、史学演習1必須、概説3のうち少なくとも2科目は計6|S52/53c,e|history_required_elective_min_schooling_credits, history_overview_six_credits_min_courses, history_seminar_required_course|professionalCards/historySchoolingDiagnostic / O/M+earnedOrder|partial|generic combine_categories等未対応。groupは8で達成し得て必須科目条件と分離|科目数4、演習1欠如、概説6×2、5科目完成|
|H03 史学演習|1～4は内容ではなく修得順。4回8、1必須、1/2と3/4の配分|S53e,f|history_seminar_max_credits, history_seminar_prerequisite|historySeminarCards, validHistorySeminarOrders / Planner earnedOrder+O名|partial|manual順は検証。importはnull、正式番号Courseからの直接allocationなし|順不明unknown、1–4、5回目、同内容の別回、official番号|
|H04 史学5科目|全5科目完成なら演習2を選択へ移動|S53d|history_fifth_schooling_course|historySchoolingDiagnostic / O名+mapping固定ID+order|partial|現manual専用は実装。official aggregate/メディア区別の根拠不足|3概説schooling+演習1/2の境界、全体単位保存|
|H05 史学選択|50、日本/東洋/西洋から各1以上|S52/53g|history_elective_min_credits, history_*_elective_min_courses|professionalCards / O/M.field+seminar名|partial|generic target field日本史と実mapping日本史の分野の差、min_coursesがOffering数|完成Courseとfieldを確定。各1欠如・部分・演習移動|
|H06 歴史資料学|1～6は修得順、6回12まで選択。総合特講8回16|S53h,i|history_historical_sources_max_credits, history_general_lecture_max_credits|professionalCards.distribute/repeatableRule / O名|partial|配分先一定のためcapはorder不要だが正式identity/履修回数は未知|official12/14、1～6同一family、誤名マッチ禁止|
|H07 史学専門合計|16+8+50+卒論8=82|S52|history_total_min_credits, history_thesis_required_course|countedOverallCredits / capped各card+T|partial|専用totalなし、cap済card合計で超過数を失う。個別必須と整体不一致|exclusive allocationの合計、卒論1回、各field未達でもtotalを確定扱いしない|
|G01 地理必修|通常12、schooling必修6（現地研究2回2、人文/自然演習各2）|S54|geography_required_min_credits, geography_required_min_schooling_credits, 個別required_course|professionalCards/allocateGeographyTransfers / O/M|partial|schooling必修を種別で集計。method/min_enrollments generic拒否|named course・method・回数を独立検証、現地研究1/2|
|G02 地理選択必修|36以上、人文/自然各2科目8、地誌その他16|S54|geography_required_elective_min_credits, _human_, _physical_, _regional_|professionalCards / mapping field|partial|generic field表現と実fieldの差、transferの科目数=Offering数|Course countとtransfer先Courseの区別、各field境界|
|G03 地理選択/合計|選択12以上（選必36超過含む）、専門82（卒論8含む）|S54|geography_elective_min_credits, _required_elective_to_elective_overflow_credit_transfer, _total_min_credits|professionalCards / O/M+T|partial|基準値一致、G1/G5/G12|36超過排他的、12+6+36+12+8=74だけでは未達、82境界|
|G04 地理現地研究|初回2回2→schooling必修、追加2回2→地域特講、総4上限|S55d|geography_fieldwork_to_elective_overflow_credit_transfer, _fieldwork_transfer_max_credits|allocateGeographyTransfers(fieldStudy) / 不可分Offering|partial|aggregate4を分割できず消失し得る|Course aggregateのstage分配は別設計、現地1×4とofficial4を一致|
|G05 地理地誌学特講|最初2→地誌選必、以後→選択地理特講|S55g|geography_regional_lecture_to_elective_overflow_credit_transfer|allocateGeographyTransfers(chorography) / O|partial|aggregate/上限・回数の証拠不足|2/4/6の段階と単位保存|
|G06 地理人文/自然演習|各初回2→schooling必修、次2→分野選必、以後→選択|S55h|geography_seminar_three_stage_transfer（unsupported）|allocateGeographyTransfers(humanSeminar/naturalSeminar) / O|partial|generic未対応、official aggregateが不可分|各2/4/6、分野・回数・順証拠なしunknown|
|G07 地理特講合算|人文/自然地理学特講は合算4まで、片方2も可|S55i|geography_special_lectures_combined_max_credits|allocateGeographyTransfers(geographyLecture) / O名|partial|generic partial_two等拒否。旧名(S)やaggregateの同定|2+2、同科目4、6超過、旧名unknown|
|G09 地理repeat|総合特講8回16まで、公開科目は別枠8回16|S55j–l|geography_general_lecture_max_credits, geography_open_courses_max_credits|repeatableRule/publicCourseCard / O/M,U|partial|公式aggregateの回数証拠、公開の個別上限不足|総合16境界、公開との独立cap・重複テスト|
|G08 地理旧課程|2013以前地誌不足に人文/自然8超過を振替（地誌8以上必要）、旧現地1+新1など|S55b,e/61|geography_legacy_regional_transfer, _legacy_fieldwork, _legacy_rules_external|referencePrerequisiteReasonのみ / P|unsupported|本人の旧課程/時点不足。取得した公式例外でも実装なし|証拠を要求しunknown、通常ruleへ混ぜない|
|E01 経済|選択必修24、選択と合計82、必修/分野/科目数条件は表に別設定なし|S56–57|economics_required_elective_min_credits, economics_total_min_credits|professionalCards / O/M|partial|totalはあるが選択独立cardなし（表にも固定最小なし）|24/82、選必超過をtotal1回、no Offering|
|E02 経済|選必24超過→選択、任意卒論6を選択・専門合計へ1回|S56/57b,c|economics_required_elective_to_elective_overflow_credit_transfer|professionalCards+T|partial|generic overflow unknownだがtotal内では1回加算。official卒論直接入力なし|卒論ありなし、超過とmanual/official重複|
|E03 経済repeat|経済/経営特講各4回8、総合8回16、演習は旧経済学演習含め2回4|S57d–h|economics_*_max_credits|repeatableRule / O名|partial|旧演習aliasはrepeatableRuleの名前集合にない。aggregate回数不明|新旧combined cap、上限超過、Course同定|
|B01 商業|選択必修20、選択と合計82、必修/分野/科目数の別設定なし|S58–59|commerce_required_elective_min_credits, commerce_total_min_credits|professionalCards / O/M|partial|E01同様。専門合計は固定最小|20/82・no Offering・選必超過|
|B02 商業|選必20超過→選択、任意卒論6を選択・専門合計へ1回|S58/59b,c|commerce_required_elective_to_elective_overflow_credit_transfer|professionalCards+T|partial|E02と同じofficial gap|卒論ありなしと排他的配分|
|B03 商業repeat|経済特講4回8、経営特講8回16、総合8回16、演習は旧経営学演習含め2回4|S59d–h|commerce_*_max_credits|repeatableRule / O名|partial|経済と経営の上限を混同しない。旧演習alias未対応|新旧合算、8/16の学科差、aggregate回数|
|X01 全6学科|他学部他学科公開8回16、専門選択へ|S47h–i/48e–f/53j–k/55k–l/57g,j/59g,j|各_open_courses_max_credits|publicCourseLimitFor/evaluatePublicCourseLimit / U|partial|明示Uはcapされるがofficialとのdedupなし。個別開講制限資料なし|8/9回、official同科目重複、個別上限はunknown|
|X02 文学3学科|卒論含む専門80完成+4構成選択のschooling部分2は教授会による特例|S68|専用literature-professional-80-plus-partial-2、catalog専用IDなし|literaturePartialExceptionCard / O/M+T|unknown|大学の決定を機械判定できない。候補表示のみ実装|80/78/82、卒論未了、field未達では候補にしない。現round2 test維持|
|X03 全6学科卒論|文学8必修、法4/経済商業6選択。指導/提出手続は単位状態と別|S46,49–54,56,58/T|各_thesis_required_course、thesis-progress-scope|thesisPolicyForScope, thesisProgressCard / T|supported（明示Tの選択・単位表示のみ）|scope別・required強制・各単位・未来status・二重加算回避の既存testsあり。official source row連携は未対応|今回もengine全体supportedにはしない。次sliceで卒論はunknown/excluded reasonを残す|
|X04 全6学科旧課程/復籍|読替え、学習開始/完成時点、復籍後必要修得（法4/経済学部6等）|S60–61,68、各表脚注|各_legacy_rules_external、復籍後必要単位IDなし|referencePrerequisiteReason / P|unsupported|入学年度のみでは決められない。ログイン後詳細・個人適用未確認|legacy_or_transitionをunknown保持。p.60教育法/J読替え、p.61旧概論、復籍時点tests|
|X05 経済/商業transition|会計4科目は2025通信終了、2027まで経過措置、2028からmediaのみ等|S57m/59o|専用Requirementなし|futurePlanningは一般的referenceのみ|unsupported|過去officialを2026 Offeringへ写すと方法誤帰属|achievement年と履修開始/有効期限、2025–28境界。卒業算入と開講可否を区別|
|X06 全体手続|学籍・年限、論文指導順/期限・提出/面接、教授会卒業決定|S68/T、詳細未全確認|before条件、catalog外条件も存在|thesisGuidance.tsは別reference、graduationEvaluation常unknown|unknown|本人情報/最新締切/大学決定不足。全体engineにはない|単位達成から卒業可へ昇格禁止、手続と単位の別結果|

### 学科別の独立条件の有無（取りこぼし確認）

「表に独立条件なし」はその条件を推測して追加しないという意味。全学共通30schoolingや構成単位完成は別に適用する。各数値のcoverageは上表のpartialのまま。

|学科|必修 / 選択必修 / 選択 / 専門合計|専門schooling独立条件|科目数・分野|overflow / partial2|卒論算入先 / 旧課程|
|---|---|---|---|---|---|
|法律|卒論以外の必修枠なし / 32 / 50又は54 / 82又は86|＊除外8|8科目、分野条件は表に独立条件なし|32超過→選択 / L03条件付き|任意4→選択・合計 / X04|
|日本文学3scope|20 / 20 / 24 / 82|必修の独立schooling単位枠なし。書道実技を取る場合は方法条件|必修5科目はコース別、選択の独立分野条件なし|20超過→選択 / X02教授会特例のみ|必修8→専門合計 / X04|
|史学|16 / schooling選必8 / 50 / 82|4科目8・演習1必須|概説6×最低2、選択は日東西各1|一般の選必overflow枠ではなくH04移動 / X02|必修8→専門合計 / X04|
|地理|12+schooling6 / 36 / 12 / 82|現地研究2、人文/自然演習各2|人文/自然各2科目8、地誌16|36超過・特殊段階 / G07及びX02|必修8→専門合計 / G08/X04|
|経済|必修枠なし / 24 / 固定の独立最小なし / 82|専門の独立schooling最小なし|独立科目数・分野条件なし|24超過→選択 / 通常は構成単位完成、法律例外は流用不可|任意6→選択・合計 / X04/X05|
|商業|必修枠なし / 20 / 固定の独立最小なし / 82|専門の独立schooling最小なし|独立科目数・分野条件なし|20超過→選択 / 通常は構成単位完成、法律例外は流用不可|任意6→選択・合計 / X04/X05|

### 編入・認定

|ID / scope|official rule|source/page|catalog requirement ID|current function / identity|status|missing evidence / risk|recommended implementation / required tests|
|---|---|---|---|---|---|---|---|
|R01 1年次|通常124（法卒論なし128）、schooling30|S68/R|overall/schooling reference、catalog専用IDなし|referenceProgress / P+cards|partial|admissionYear未入力でも判定prerequisiteは止まらない。課程適用明示は必要|通常本人認定を0へ自動推測しない。124/128と30の独立性|
|R02 2年次編入|一般24（各8）、外国語/体育/専門個別。schooling7または前籍通信の実修得を上限7|A|なし|officialRecognitionPrefill, schoolingRecognitionCap / P|partial|出身校区分を持たず固定/上限を自動区別不可。prefillはschooling nullで安全|7は推測しない、0/null/7/超過、個別結果保存|
|R03 3年次編入|一般36（各12）、外国語/体育/専門個別。schooling15または上限15|A|なし|同上 / P|partial|同上。認定済と実修得の重複除外不足|0/null/15/超過、一般36と追加schooling|
|R04 学士|共通42は免除、schooling15認定、専門個別|A|なし|officialRecognitionPrefill/applyRecognition/referenceProgress / P|partial|免除をearnedに足さない82/86 targetは既存test。認定専門とofficialのG11|免除0、法86、schooling15、専門個別/actualとの重複|
|R05 法政内部・その他|個別認定。同学部同学科と他学部学科公開扱いで異なる|A|なし|other_transfer/hosei_internal_transfer / P|unknown|一括推定はしない。schooling cap30は入力安全上限で個人の権利ではない|公式個別結果・公開16枠・部分認定を明示|
|R06 一般認定|認定単位と免除は別。合計と内訳を重ねない|A/S45|なし|applyRecognition, recognizedCreditBreakdownTotal, unallocatedRecognizedCredits / P|partial|不足内訳unknown、合計残差あり。実修得との重複範囲の証拠不足|recognition36+earned重複、内訳>total拒否、0/null|
|R07 外国語認定|1言語4以内、schooling相当の確認が必要|A/S45|なし|applyRecognition / P|partial|4と言語と相当2で満たすが認定2+実修得2の組合せ未実装|同一言語・4/2境界、2+2、nullとnone|
|R08 体育認定|2以内、免除は修得0|A/S45|なし|applyRecognition / P|partial|認定部分と実修得の完成規則不足|2認定・免除・0/unknown・部分認定|
|R09 専門認定|公式に認められた科目・単位のみ|A|なし|calculateGraduationProgress.recognizedItems / legacy courseId+Offering|partial|G11、Offering必須、認定creditsではなくOffering値。選択済みplanが認定を抑える|Course recognition factと正確なcredits、official dedup、no Offering|
|R10 schooling相当|一般認定と別軸。2年7/3年15の条件別、個別認定もあり|A/SC|なし|schoolingRecognitionCap/referenceProgress / P|partial|schoolingだけ入力してもhasCreditBearingRecognitionがtrue。外国語内訳/OUとの重複不明|recognition証拠scopeと内訳の包含関係を検証|

## 5. Catalog / condition audit

再現コマンド: `node --import tsx scripts/audit-graduation-engine.mjs > /tmp/graduation-audit.json`。TypeScript ASTから実際の `CONDITION_ALLOWLIST` を読み、catalog全行と比較する。学科別カードによる補完はallowlist合格とは別。診断は標準出力のみで、catalog・state・schemaを変更しない。

|項目|raw JSON|runtime（manual overrides + Curriculum attach）|
|---|---:|---:|
|structuredRequirementCount|142|142|
|unsupportedRequirementCount|40|40|
|全Requirement|182|182|
|Offering|686|686|
|matched|593|648|
|manual_review|63|8（すべて史学演習）|
|outside_mapping_scope|30|30|
|unresolvedOfferingCount（mapping）|93|38|
|Mapping / edge|502 / 1115|502 / 1230|
|legacy courseId present / null|338 / 348|338 / 348|
|CurriculumCourse|attach前|321|
|OfferingのCurriculum identity未確定|attach前|70（ambiguous32 / unmatched38）|
|graduationCheckComplete|false|false|
|sourceLinksReverified|false|false|

学習者の保存データはリポジトリに含まれないため、実ユーザーのunresolved official row件数は **unknown**。70はOffering relationの件数であり、学習者row数ではない。manual_review全IDと未確定relation全件は診断JSON出力に含まれる。

ruleType件数: choose_one 2 / exact_credits 3 / max_credits 35 / min_courses 4 / min_credits 36 / min_schooling_credits 4 / overflow_credit_transfer 9 / required_course 49。

実condition key組合せは30種類。rawでallowlist拒否43行、`when` と `includes_thesis` を取り除いた後でも39行を拒否（reference-onlyやthesis分岐で実評価前にomitされるものを含む）。宣言RuleConditionsのtop-level30 keysはすべて実catalogで使用されており、未知のtop-level keyはない。**既知の型 = evaluatorが意味を実装済み、ではない。**

### evaluator が理解していない条件・意味の欠落

|condition / 組合せ|generic evaluator|専用経路 / 欠落|
|---|---|---|
|when / includes_thesis|入口で選択分岐、2keyを削除|thesisをgeneric inputに追加するわけではない。専門totalはTで補完|
|same_language / max_languages_counted+options / same_language_as_foreign_requirement|拒否|groupedCardsのみ同一言語を実装、mixed証拠は欠落|
|excluded_categories|拒否、OU ruleはreference-only|profile入力は外国語/体育を除外済みの認定という契約。生データの除外評価はしない|
|before|拒否（value null）|thesisGuidance別画面。卒業判定へ手続条件として接続していない|
|method+min_enrollments|required_courseで拒否|地理専用段階へ部分実装。method判定のコード自体はあるがallowlistでは到達不可|
|combine_categories+credits_per_course|min_coursesで拒否|史学概説6×2を独立の確定判定として表せない|
|exclude_table_marker+marker_source_page|拒否|法律専用名称リストのみ、schooling証拠G6|
|exclude_schooling_required|拒否|地理bucketを別にして補完|
|aggregate+partial_two_credits_countable|拒否|地理特講合算4の専用allocator|
|applies_to+general_total_unaffected+group_by|拒否|自然6種別capは名前regexで専用実装|
|from+to+threshold+transfer+double_count（+requires_completed_courses）|overflow全9行拒否|学科overflow/地理specialで部分実装。意味を汎用に理解していない|
|choose_count+options|**allowlist受理するがキー値を評価しない**|genericはmatching categoryの単位和。体育cardだけ2択を名前で実装|
|aggregate|max_creditsで受理するがflag値を評価しない|実際は複数nameのmatched rowsを単純sum。旧aliasのgroup capは別問題|
|min_schooling_credits + [] / min_courses|受理するがruleTypeだけではOffering.methodをfilterしない|地理/史学target mappingの偶然のmethodに依存。named schooling課程と修得methodは別|
|max_enrollments|completedMappingsの完成数を使用|同一mappingのrepeat履修回数とは一致しない|
|min_courses（ruleType）|distinct Offering.id数|Course数ではない。条件min_coursesはcompleted mapping数で不統一|
|full_course_credits_required|mappingId別合計>=構成単位で完成|重複mapping・repeat・official identityに不十分|

`targetIsClear` はcourse_name(s)/curriculum_category/field/requirement_typeのみ許可する。宣言にあるcredit_source/programは実targetを拒否する。`course_name` は **Offering.name** の一致からmapping集合を構築するため、正式CurriculumCourseが存在しても開講名不一致でunknownになる。fieldのcatalog rule「人文」「自然」「日本史」等とMappingの「人文地理の分野」「自然地理の分野」「日本史の分野」等は完全一致しない。generic要件の0と専用カードの値が一致するとは限らない。

`coverageForCard` はstatusがunknownでなければprofessional/history以外をsupportedとするだけ。`hasUnresolvedEarned` はmanual_reviewのみで、outside_mapping_scope・dropされたimportには及ばない。unknownReasons集計もrequirementsのみ（importedWarnings、reference reason、card-only gapを含まない）。従ってcoverageSummaryをcompletion matrixとして利用できない。

## 6. Offeringに依存しない A/B/C/D 分類

`exactImportedCurriculumId(row,catalog)` → `catalog.curriculum.courses` の一致 → **そのCourseのmappingIds全部**を解決 → selectedScope + commonScope で絞る。scopeIdsは整合性診断に使い、allocationの代用にしない。canonicalNameは特殊規則の明示されたfamily判定に使うが、IDを名前で上書きしない。

|分類|判定|将来の処理|
|---|---|---|
|A|exact Course、適用mappingが1つ、必要metadataあり、特別なsequence等に依存しない|単一allocation候補。構成単位・cap・課程適用を別に評価してから算入|
|B|適用mappingは複数でも、公式rule上同じallocationと証明できる|category/field/type/credits/schoolingOnly/mediaOnlyと特殊規則が一致したときのみ1つのallocation。ID順で選ばない|
|C|exactでも複数allocationが競合、またはsequence/段階配分に必要な証拠不足|unknown、全候補mappingIdsと理由を返す。Offeringを選んで解決しない|
|D|Course identity ambiguous/unmatched/invalid|unknown、aggregateはunallocatedに保持。categoryRawは表示のみ|
|対象外 / metadata不足|適用mapping0はout_of_scope（Dと違う）。構成単位不明はunknown_metadata|黙って捨てずに理由付き保持。構成単位不明でもaggregate自体は保持|

診断スクリプトのA/B/Cは **structural candidate** であり、公式ruleの適用まで完了したclassificationではない。学習者rowがなく、completion/order/認定/旧課程の証拠がないので確定A/B数は出せない。構造的には各selected scope内でB=0、競合signature C=0。多scopeを持つCourseでも選択後は1edgeに絞られるケースが中心。放送大学単位認定科目は構成単位nullのunknown_metadataが全scopeに1件。

|selected scope|structural A|B|C|unknown_metadata|適用mappingなし|
|---|---:|---:|---:|---:|---:|
|史学|90|0|0|1|230|
|経済|116|0|0|1|204|
|地理|102|0|0|1|218|
|商業|125|0|0|1|195|
|日本文言語|81|0|0|1|239|
|日本文芸能|81|0|0|1|239|
|日本文文学|81|0|0|1|239|
|法律|84|0|0|1|236|

実際のA/Bには原典の条件確認が追加で必要。史学の同名4/2や順序科目は別CurriculumCourse/candidateであり、名称統合してAにしない。Bの同値edge、Cの異なるedge、common+department衝突は合成fixtureで検証し、将来catalogが変化しても安全にunknownへ倒す設計にする。現在のcatalogに競合signatureが0だからtemplate選択が安全という結論にはならない。

## 7. 推奨 architecture と唯一の次slice

```text
ImportedCourseAchievement ─ exact identity ─ CurriculumCourse
  earnedCreditsTotal                             ↓ 全Mapping + common/selected scope
  schoolingCreditsTotal（別量）                 allocation候補 / ambiguity
ImportedStudyRecord ─ method/時点/順序証拠 ────────┘
                                                  ↓
                              calculation-only OfficialCourseFact
                                                  ↓
                              Requirement / exclusion / allocation ledger
                                                  ↓
                               earned allocation / unknown / projection
PlannerItem ─ enrollment attempt ─ Offering ─ future projection（別経路）
```

次sliceのscopeは **official inputsのfact化と通常A/Bの共通・専門基本bucketへの接続、C/Dと特殊ruleの理由付き保留**。卒業engine全面rewrite、認定モデル移行、旧課程対応、公式卒論とmanual thesisの統合、sequence自動推定は含めない。既存Planner計算を残しても、officialについてvirtual Offeringを再生成して同じtemplate欠陥へ戻してはいけない。

API案（今回typeを追加しない）:

```ts
// calculation-only、永続化しない。名称は実装sliceで確定。
deriveOfficialGraduationFacts({ achievements, records, catalog, selectedScopeId }): {
  facts: Array<{
    sourceRowIds: string[];
    curriculumCourseId: string;
    earnedCreditsTotal: number | null;
    schoolingEvidence: { credits: number | null; source: 'official_row' | 'unknown'; recordIds: string[] };
    candidateMappingIds: string[];
    allocation: { kind: 'unique' | 'equivalent'; mappingIds: string[] }
      | { kind: 'unknown' | 'out_of_scope'; reason: string };
  }>;
  unresolved: Array<{ sourceRowIds: string[]; earnedCreditsTotal: number | null; reason: string }>;
  diagnostics: Array<{ code: string; sourceRowIds: string[]; mappingIds: string[] }>;
}
```

`null`はunknown、0は確認済み0。複数source rowが同Courseならidentity確定だけでsumしない。`earnedCreditsTotal`は保持し、卒業countedCreditsは別出力にする。排他的なallocationごとに使用済みcredit budgetを持ち、commonと専門へ重ねない。schoolingは総修得とは独立した測定軸なので、総修得の使用済みbudgetに加算しない。

|項目|次sliceの具体内容|
|---|---|
|affected files|新 `src/planner/officialGraduationFacts.ts`（仮）、`graduationProgress.ts` の入口/通常bucket集計、`officialCourseCredits.ts`の共通identity利用、`importedAchievementCalculations.ts`の卒業consumer切離し、`tests/graduation-audit.test.mjs` とplanner関連tests。必要なら新allocation helper。category/media consumerの互換経路は別に維持|
|migration impact|なし。PlannerState22、import contract、storage key、永続データshape不変。migration/v23追加禁止|
|expected tests|今回18 characterization中GAPを新契約へ更新。exact Course/no Offering→通常卒業4、legacy courseIdなし4、official4/component2+2→4かつschooling evidence2、official4+earned→4、planned/in_progress projection、waiting明示、C/D warning、B1回、common+department unknown、scope違い、8program（6学科+日本文3）実catalog、入力immutable、row重複/null/0、特殊sequence/transfer保留|
|risks|公式schooling列意味未完全検証、複数公式rowの重複、CurriculumCourseのscope/構成単位、認定・manual卒論・repeatとのsource重複、既存cardとgeneric requirement結果の不一致|
|acceptance 1|official totalはOffering/legacy courseId/年度開講/array順から独立。Offering0件でもexact Courseを保持しA/B通常配分へ渡せる|
|acceptance 2|componentを総単位へ足さない。公式aggregateとcounted allocationを区別。null/0/partial/overageを失わない|
|acceptance 3|dedupはofficial優先policyを維持。futureをearned扱いしない。入力と保存stateは不変|
|acceptance 4|C/D/metadata不足/特殊rule証拠不足をunknownとして返し、値を黙って0にしない。categoryRawは正式identityにならない|
|acceptance 5|A/Bの配分は単位保存則を満たす。edgeの並べ替え・Offering追加削除で結果不変。適用外scopeは混ぜない|
|acceptance 6|既存Planner/manual-recognition/thesis経路の回帰を防ぐ。今回未対応ruleをsupportedへ昇格しない。5検証commandが成功しcomplete=false/schema22|

## 8. 検証と変更境界

変更はこの文書、監査診断script、新規characterization tests、`test:planner`のテスト対象追加のみ。production engine/catalog/schemaに変更なし。既存testsを変更しない。診断JSONは一時出力で、個人stateを読む処理はない。

今回の18追加testsはユーザー指定8シナリオをすべて含む。ただし「Offeringなしでも卒業へ算入」と「conflicting Mappingを必ず保留」は現実装では満たせず、保存aggregate保持と現在の欠陥を明示的にcharacterizeした。これを成功実装と解釈しない。

検証結果は最終節に記録する。

## 9. 全condition combination比較（30組）

raw / effective はkey集合のallowlist判定のみで、意味の実装保証ではない。行の全ruleIdは次節で完全なconditionsとともに列挙する。

|ruleType : condition keys|件数|raw|when/includes_thesis削除後|該当ruleId|
|---|---|---|---|---|
|choose_one:choose_count,options|1|True|True|common_physical_choose_one|
|choose_one:max_languages_counted,options|1|False|False|common_foreign_choose_one|
|exact_credits:|2|True|True|common_general_exact_credits<br>common_physical_exact_credits|
|exact_credits:same_language|1|False|False|common_foreign_exact_credits|
|max_credits:|2|True|True|common_general_max_credits<br>common_physical_max_credits|
|max_credits:aggregate,max_enrollments|2|True|True|commerce_seminar_max_credits<br>economics_seminar_max_credits|
|max_credits:aggregate,partial_two_credits_countable|1|False|False|geography_special_lectures_combined_max_credits|
|max_credits:applies_to,general_total_unaffected,group_by|1|False|False|common_natural_per_subject_kind_max_credits|
|max_credits:excluded_categories|1|False|False|common_open_university_max_credits|
|max_credits:max_enrollments|27|True|True|commerce_economics_lecture_max_credits<br>commerce_general_lecture_max_credits<br>commerce_management_lecture_max_credits<br>commerce_open_courses_max_credits<br>common_basic_lecture_max_credits<br>economics_economics_lecture_max_credits<br>economics_general_lecture_max_credits<br>economics_management_lecture_max_credits<br>economics_open_courses_max_credits<br>geography_fieldwork_transfer_max_credits<br>geography_general_lecture_max_credits<br>geography_open_courses_max_credits<br>history_general_lecture_max_credits<br>history_historical_sources_max_credits<br>history_open_courses_max_credits<br>history_seminar_max_credits<br>japanese_language_general_lecture_max_credits<br>japanese_language_open_courses_max_credits<br>japanese_literature_general_lecture_max_credits<br>japanese_literature_open_courses_max_credits<br>japanese_performance_general_lecture_max_credits<br>japanese_performance_open_courses_max_credits<br>law_general_lecture_max_credits<br>law_law_lecture_max_credits<br>law_open_courses_max_credits<br>law_politics_max_credits<br>law_seminar_max_credits|
|max_credits:same_language|1|False|False|common_foreign_max_credits|
|min_courses:|3|True|True|history_eastern_elective_min_courses<br>history_japanese_elective_min_courses<br>history_western_elective_min_courses|
|min_courses:combine_categories,credits_per_course|1|False|False|history_overview_six_credits_min_courses|
|min_credits:|27|True|True|commerce_required_elective_min_credits<br>commerce_total_min_credits<br>common_general_humanities_min_credits<br>common_general_natural_min_credits<br>common_general_social_min_credits<br>common_total_min_credits<br>economics_required_elective_min_credits<br>economics_total_min_credits<br>geography_elective_min_credits<br>geography_regional_required_elective_min_credits<br>geography_required_elective_min_credits<br>geography_total_min_credits<br>history_elective_min_credits<br>history_required_min_credits<br>history_total_min_credits<br>japanese_language_elective_min_credits<br>japanese_language_required_elective_min_credits<br>japanese_language_required_min_credits<br>japanese_language_total_min_credits<br>japanese_literature_elective_min_credits<br>japanese_literature_required_elective_min_credits<br>japanese_literature_required_min_credits<br>japanese_literature_total_min_credits<br>japanese_performance_elective_min_credits<br>japanese_performance_required_elective_min_credits<br>japanese_performance_required_min_credits<br>japanese_performance_total_min_credits|
|min_credits:exclude_schooling_required|1|False|False|geography_required_min_credits|
|min_credits:full_course_credits_required,min_courses|2|True|True|law_required_elective_min_credits<br>law_required_elective_min_credits_note|
|min_credits:includes_thesis,when|1|False|True|law_elective_with_thesis_min_credits|
|min_credits:min_courses|2|True|True|geography_human_required_elective_min_credits<br>geography_physical_required_elective_min_credits|
|min_credits:when|3|False|True|law_elective_without_thesis_min_credits<br>law_total_with_thesis_min_credits<br>law_total_without_thesis_min_credits|
|min_schooling_credits:|1|True|True|geography_required_min_schooling_credits|
|min_schooling_credits:exclude_table_marker,marker_source_page|1|False|False|law_professional_min_schooling_credits|
|min_schooling_credits:min_courses|1|True|True|history_required_elective_min_schooling_credits|
|min_schooling_credits:same_language_as_foreign_requirement|1|False|False|common_foreign_min_schooling_credits|
|overflow_credit_transfer:double_count,from,requires_completed_courses,threshold,to,transfer|1|False|False|law_required_elective_to_elective_overflow_credit_transfer|
|overflow_credit_transfer:double_count,from,threshold,to,transfer|8|False|False|commerce_required_elective_to_elective_overflow_credit_transfer<br>economics_required_elective_to_elective_overflow_credit_transfer<br>geography_fieldwork_to_elective_overflow_credit_transfer<br>geography_regional_lecture_to_elective_overflow_credit_transfer<br>geography_required_elective_to_elective_overflow_credit_transfer<br>japanese_language_required_elective_to_elective_overflow_credit_transfer<br>japanese_literature_required_elective_to_elective_overflow_credit_transfer<br>japanese_performance_required_elective_to_elective_overflow_credit_transfer|
|required_course:|6|True|True|geography_thesis_required_course<br>history_seminar_required_course<br>history_thesis_required_course<br>japanese_language_thesis_required_course<br>japanese_literature_thesis_required_course<br>japanese_performance_thesis_required_course|
|required_course:before|12|False|False|geography_thesis_guidance_1_required_course<br>geography_thesis_guidance_2_required_course<br>geography_thesis_guidance_3_required_course<br>history_thesis_guidance_1_required_course<br>history_thesis_guidance_2_required_course<br>history_thesis_guidance_3_required_course<br>japanese_language_thesis_guidance_1_required_course<br>japanese_language_thesis_guidance_2_required_course<br>japanese_literature_thesis_guidance_1_required_course<br>japanese_literature_thesis_guidance_2_required_course<br>japanese_performance_thesis_guidance_1_required_course<br>japanese_performance_thesis_guidance_2_required_course|
|required_course:before,when|5|False|False|commerce_thesis_interim_required_course<br>commerce_thesis_plan_required_course<br>economics_thesis_interim_required_course<br>economics_thesis_plan_required_course<br>law_thesis_guidance_required_course|
|required_course:full_course_credits_required|23|True|True|geography_human_geography_overview_1_required_course<br>geography_human_geography_research_required_course<br>geography_physical_geography_overview_1_required_course<br>geography_physical_geography_research_required_course<br>history_eastern_history_overview_required_course<br>history_historical_studies_required_course<br>history_japanese_history_overview_required_course<br>history_western_history_overview_required_course<br>japanese_language_japanese_grammar_required_course<br>japanese_language_japanese_language_history_required_course<br>japanese_language_japanese_linguistics_required_course<br>japanese_language_japanese_literary_history_i_required_course<br>japanese_language_japanese_literary_studies_required_course<br>japanese_literature_japanese_linguistics_required_course<br>japanese_literature_japanese_literary_history_i_required_course<br>japanese_literature_japanese_literary_history_ii_required_course<br>japanese_literature_japanese_literary_studies_required_course<br>japanese_literature_literature_required_course<br>japanese_performance_japanese_art_history_required_course<br>japanese_performance_japanese_linguistics_required_course<br>japanese_performance_japanese_literary_history_i_required_course<br>japanese_performance_japanese_literary_studies_required_course<br>japanese_performance_performing_arts_history_required_course|
|required_course:method,min_enrollments|3|False|False|geography_fieldwork_required_course<br>geography_human_seminar_required_course<br>geography_physical_seminar_required_course|

### 空入力でのunknown（卒論selectedで固定した再現用probe）

本人の達成率ではない。unsupported scope nullの40行は全programに残り、他学科の警告も含まれる。卒論not_selected/undecidedで件数は変わる。

|scope|evaluable|unknown|理由（件数）|
|---|---|---|---|
|文学部 / 史学科|19|55|旧課程の追加措置は正本16頁の範囲外。 (9)<br>条件または例外を安全に自動評価できません (9)<br>可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。 (9)<br>個別開講の上限値は本PDFに記載なし。 (8)<br>修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。 (4)<br>対象科目のmappingを一意に特定できません (4)<br>課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。 (3)<br>条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。 (3)<br>修得順により割当が変わるため自動評価できません (2)<br>条件付き算入許可を表すrule_typeが未定義。 (1)<br>旧新課程の同種科目同定が必要。 (1)<br>履修禁止を表すrule_typeが未定義。 (1)<br>条件付き算入除外を表すrule_typeが未定義。 (1)|
|経済学部 / 経済学科|10|54|旧課程の追加措置は正本16頁の範囲外。 (9)<br>可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。 (9)<br>個別開講の上限値は本PDFに記載なし。 (8)<br>条件または例外を安全に自動評価できません (8)<br>対象科目のmappingを一意に特定できません (6)<br>修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。 (4)<br>課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。 (3)<br>条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。 (3)<br>条件付き算入許可を表すrule_typeが未定義。 (1)<br>旧新課程の同種科目同定が必要。 (1)<br>履修禁止を表すrule_typeが未定義。 (1)<br>条件付き算入除外を表すrule_typeが未定義。 (1)|
|文学部 / 地理学科|17|62|条件または例外を安全に自動評価できません (16)<br>旧課程の追加措置は正本16頁の範囲外。 (9)<br>可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。 (9)<br>個別開講の上限値は本PDFに記載なし。 (8)<br>対象科目のmappingを一意に特定できません (6)<br>修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。 (4)<br>課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。 (3)<br>条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。 (3)<br>条件付き算入許可を表すrule_typeが未定義。 (1)<br>旧新課程の同種科目同定が必要。 (1)<br>履修禁止を表すrule_typeが未定義。 (1)<br>条件付き算入除外を表すrule_typeが未定義。 (1)|
|経済学部 / 商業学科|10|54|旧課程の追加措置は正本16頁の範囲外。 (9)<br>可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。 (9)<br>個別開講の上限値は本PDFに記載なし。 (8)<br>条件または例外を安全に自動評価できません (8)<br>対象科目のmappingを一意に特定できません (6)<br>修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。 (4)<br>課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。 (3)<br>条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。 (3)<br>条件付き算入許可を表すrule_typeが未定義。 (1)<br>旧新課程の同種科目同定が必要。 (1)<br>履修禁止を表すrule_typeが未定義。 (1)<br>条件付き算入除外を表すrule_typeが未定義。 (1)|
|文学部 / 日本文学科 / 言語コース|17|51|旧課程の追加措置は正本16頁の範囲外。 (9)<br>可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。 (9)<br>個別開講の上限値は本PDFに記載なし。 (8)<br>条件または例外を安全に自動評価できません (8)<br>修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。 (4)<br>課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。 (3)<br>条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。 (3)<br>対象科目のmappingを一意に特定できません (3)<br>条件付き算入許可を表すrule_typeが未定義。 (1)<br>旧新課程の同種科目同定が必要。 (1)<br>履修禁止を表すrule_typeが未定義。 (1)<br>条件付き算入除外を表すrule_typeが未定義。 (1)|
|文学部 / 日本文学科 / 芸能文化コース|17|51|旧課程の追加措置は正本16頁の範囲外。 (9)<br>可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。 (9)<br>個別開講の上限値は本PDFに記載なし。 (8)<br>条件または例外を安全に自動評価できません (8)<br>修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。 (4)<br>課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。 (3)<br>条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。 (3)<br>対象科目のmappingを一意に特定できません (3)<br>条件付き算入許可を表すrule_typeが未定義。 (1)<br>旧新課程の同種科目同定が必要。 (1)<br>履修禁止を表すrule_typeが未定義。 (1)<br>条件付き算入除外を表すrule_typeが未定義。 (1)|
|文学部 / 日本文学科 / 文学コース|17|51|旧課程の追加措置は正本16頁の範囲外。 (9)<br>可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。 (9)<br>個別開講の上限値は本PDFに記載なし。 (8)<br>条件または例外を安全に自動評価できません (8)<br>修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。 (4)<br>課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。 (3)<br>条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。 (3)<br>対象科目のmappingを一意に特定できません (3)<br>条件付き算入許可を表すrule_typeが未定義。 (1)<br>旧新課程の同種科目同定が必要。 (1)<br>履修禁止を表すrule_typeが未定義。 (1)<br>条件付き算入除外を表すrule_typeが未定義。 (1)|
|法学部 / 法律学科|12|54|旧課程の追加措置は正本16頁の範囲外。 (9)<br>可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。 (9)<br>個別開講の上限値は本PDFに記載なし。 (8)<br>条件または例外を安全に自動評価できません (8)<br>対象科目のmappingを一意に特定できません (6)<br>修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。 (4)<br>課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。 (3)<br>条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。 (3)<br>条件付き算入許可を表すrule_typeが未定義。 (1)<br>旧新課程の同種科目同定が必要。 (1)<br>履修禁止を表すrule_typeが未定義。 (1)<br>条件付き算入除外を表すrule_typeが未定義。 (1)|

### runtime manual_review 全8 Offering

|Offering ID|名前|Mapping|
|---|---|---|
|0201ec18-e72a-426b-99af-40e8c93243b1|史学演習（日本）（夏期スクーリング）|`[]`|
|0f10a231-5c5a-450e-bb57-6c8a023d4cfa|史学演習（日本）（夏期スクーリング）|`[]`|
|44b0cfb1-f909-4351-8f42-fc5b6d21347f|史学演習（西洋）（秋期スクーリング）|`[]`|
|51eb3800-24bc-471f-9604-1bbbd6fb5ed5|史学演習（西洋）（夏期スクーリング）|`[]`|
|6426c6a9-e2fc-43ff-969c-9c6dfca18c36|史学演習（日本）（秋期スクーリング）|`[]`|
|80c9473b-1233-4f18-9504-e44082e5e78d|史学演習（日本）（冬期スクーリング）|`[]`|
|9576f75d-0c2a-4716-976f-ac9e7047bc1a|史学演習（東洋）（夏期スクーリング）|`[]`|
|c27e0fbe-e69c-46f4-9b81-f1a022127a35|史学演習（東洋）（春期スクーリング）|`[]`|

## 10. 全182 Requirement completion台帳

UUIDとruleIdは現catalog値を省略せず掲載。official rule欄はcatalogに記録された機械表現で、正本の意味・脚注・欠落は本編IDを参照する。sourcePageは保存値のため第2節のページ補正を適用する。各行のstatusは公式入力まで含む監査判定（Tのみsupportedの限定評価はX03）。

### Catalog structured

|scope/department|本編ID|official rule / catalog表現|source|印刷page|catalog requirement ID / ruleId|current function|current identity|audit status|missing evidence / risk|現在のgeneric probe|recommended implementation|required tests（追加含む）|
|---|---|---|---|---|---|---|---|---|---|---|---|---|
|経済学部 / 商業学科|B03|max_credits 8 credits<br>target=`{"course_name":"経済学特講"}`<br>conditions=`{"max_enrollments":4}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`fc01195a-401c-47ea-8fc4-fb209072b2c5`<br>`commerce_economics_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|B03の境界・official aggregate・identity曖昧|
|経済学部 / 商業学科|B03|max_credits 16 credits<br>target=`{"course_name":"総合特講"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`b1755f0b-4eef-4889-987b-6b288af7857f`<br>`commerce_general_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|B03の境界・official aggregate・identity曖昧|
|経済学部 / 商業学科|B03|max_credits 16 credits<br>target=`{"course_name":"経営学特講"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`97d10033-d5df-4c1c-9f09-3fe35e080cb0`<br>`commerce_management_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|B03の境界・official aggregate・identity曖昧|
|経済学部 / 商業学科|X01|max_credits 16 credits<br>target=`{"course_name":"（他学部・他学科公開科目）"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`681f46a6-dadd-46e3-b875-53d7bc237256`<br>`commerce_open_courses_max_credits`|publicCourseCard / evaluatePublicCourseLimit|U|partial|official dedup・個別上限|unknown: 対象科目のmappingを一意に特定できません|確認済公開factでcap|8/9回、official重複|
|経済学部 / 商業学科|B01|min_credits 20 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=60)|58|`6df05ae6-142d-4b5b-a860-dc1af10201fa`<br>`commerce_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|B01の境界・official aggregate・identity曖昧|
|経済学部 / 商業学科|B02|overflow_credit_transfer None <br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"double_count":false,"from":{"curriculum_category":"専門教育","requirement_type":"選択必修"},"threshold":{"credits":20},"to":{"curriculum_category":"専門教育","requirement_type":"選択"},"transfer":"excess_only"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`dfaab9f6-cd6f-458e-bb15-d90f9c7ff04d`<br>`commerce_required_elective_to_elective_overflow_credit_transfer`|electiveOverflowRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|B02の境界・official aggregate・identity曖昧|
|経済学部 / 商業学科|B03|max_credits 4 credits<br>target=`{"course_names":["演習","経営学演習"]}`<br>conditions=`{"aggregate":true,"max_enrollments":2}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`e02bf292-9310-425f-b4af-efaef331fd33`<br>`commerce_seminar_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|B03の境界・official aggregate・identity曖昧|
|経済学部 / 商業学科|X06|required_course None <br>target=`{"course_name":"卒業論文中間報告書指導"}`<br>conditions=`{"before":"卒業論文","when":{"thesis_selected":true}}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`625402c5-c32a-45ef-8a93-eb7d20cb6011`<br>`commerce_thesis_interim_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|経済学部 / 商業学科|X06|required_course None <br>target=`{"course_name":"卒業論文計画書指導"}`<br>conditions=`{"before":"卒業論文","when":{"thesis_selected":true}}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`53c6573b-55e7-4269-b868-3873e2dd6d22`<br>`commerce_thesis_plan_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|経済学部 / 商業学科|B01|min_credits 82 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=60)|58|`7a7ca8c6-a99f-425c-b350-db9acc813d73`<br>`commerce_total_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|B01の境界・official aggregate・identity曖昧|
|共通|C05|max_credits 4 credits<br>target=`{"course_name":"基礎特講"}`<br>conditions=`{"max_enrollments":2}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`437596fb-daec-4a4f-8ba2-162dc71b92bc`<br>`common_basic_lecture_max_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unknown: 対象科目のmappingを一意に特定できません|Course allocationと認定の分離|C05の境界・no Offering・複数edge|
|共通|C06|choose_one 1 languages<br>target=`{"curriculum_category":"外国語"}`<br>conditions=`{"max_languages_counted":1,"options":["英語","独語","仏語"]}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`2d6c807e-e205-4fac-99e0-d12e71a83e1b`<br>`common_foreign_choose_one`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unknown: 条件または例外を安全に自動評価できません|Course allocationと認定の分離|C06の境界・no Offering・複数edge|
|共通|C06|exact_credits 4 credits<br>target=`{"curriculum_category":"外国語"}`<br>conditions=`{"same_language":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=46)|44|`8aaa4ddb-ea21-440c-ba2f-86740a9a1fd3`<br>`common_foreign_exact_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unknown: 条件または例外を安全に自動評価できません|Course allocationと認定の分離|C06の境界・no Offering・複数edge|
|共通|C08|max_credits 4 credits<br>target=`{"curriculum_category":"外国語"}`<br>conditions=`{"same_language":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`5654bd34-c642-4ffd-b8c7-7b647cde9569`<br>`common_foreign_max_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unknown: 条件または例外を安全に自動評価できません|Course allocationと認定の分離|C08の境界・no Offering・複数edge|
|共通|C07|min_schooling_credits 2 credits<br>target=`{"curriculum_category":"外国語"}`<br>conditions=`{"same_language_as_foreign_requirement":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=46)|44|`7d8e08ff-185c-486d-aa28-3c67dc9e9af9`<br>`common_foreign_min_schooling_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unknown: 条件または例外を安全に自動評価できません|Course allocationと認定の分離|C07の境界・no Offering・複数edge|
|共通|C01|exact_credits 36 credits<br>target=`{"curriculum_category":"一般教育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=46)|44|`204df79f-80a7-4b2c-87ca-2884ba6a4e4c`<br>`common_general_exact_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unsatisfied|Course allocationと認定の分離|C01の境界・no Offering・複数edge|
|共通|C02|min_credits 8 credits<br>target=`{"curriculum_category":"一般教育","curriculum_field":"人文"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=46)|44|`d0816c00-a5a1-40ae-a8eb-6f3652eea311`<br>`common_general_humanities_min_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unsatisfied|Course allocationと認定の分離|C02の境界・no Offering・複数edge|
|共通|C01|max_credits 36 credits<br>target=`{"curriculum_category":"一般教育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`a0b64bba-33d6-445d-8a0c-029ddfca0492`<br>`common_general_max_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|satisfied|Course allocationと認定の分離|C01の境界・no Offering・複数edge|
|共通|C04|min_credits 8 credits<br>target=`{"curriculum_category":"一般教育","curriculum_field":"自然"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=46)|44|`a454ab0e-27fb-4fa3-a84f-c55527f70d18`<br>`common_general_natural_min_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unsatisfied|Course allocationと認定の分離|C04の境界・no Offering・複数edge|
|共通|C03|min_credits 8 credits<br>target=`{"curriculum_category":"一般教育","curriculum_field":"社会"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=46)|44|`dc05ac67-2c72-45e1-ae1b-80e7752a11e9`<br>`common_general_social_min_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unsatisfied|Course allocationと認定の分離|C03の境界・no Offering・複数edge|
|共通|C04|max_credits 6 credits<br>target=`{"curriculum_category":"一般教育","curriculum_field":"自然"}`<br>conditions=`{"applies_to":"自然分野要件判定のみ","general_total_unaffected":true,"group_by":"授業科目種別"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`fed1ebe8-fa65-4acc-824c-9211982ddfa6`<br>`common_natural_per_subject_kind_max_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unknown: 条件または例外を安全に自動評価できません|Course allocationと認定の分離|C04の境界・no Offering・複数edge|
|共通|C10|max_credits 10 credits<br>target=`{"credit_source":"放送大学","curriculum_category":"一般教育","curriculum_field":"その他"}`<br>conditions=`{"excluded_categories":["外国語","保健体育"]}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`39dc3686-b3dd-460e-b56d-dccc6151f44e`<br>`common_open_university_max_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|omitted: reference-only overlay|Course allocationと認定の分離|C10の境界・no Offering・複数edge|
|共通|C09|choose_one 2 credits<br>target=`{"curriculum_category":"保健体育"}`<br>conditions=`{"choose_count":1,"options":["健康・スポーツ科学概論","スポーツ総合演習"]}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`d537dabd-adb4-4969-bd24-45c83f39e9a8`<br>`common_physical_choose_one`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unsatisfied|Course allocationと認定の分離|C09の境界・no Offering・複数edge|
|共通|C09|exact_credits 2 credits<br>target=`{"curriculum_category":"保健体育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=46)|44|`d387d640-b6d8-4cb4-9a1a-db98a80fdb69`<br>`common_physical_exact_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|unsatisfied|Course allocationと認定の分離|C09の境界・no Offering・複数edge|
|共通|C09|max_credits 2 credits<br>target=`{"curriculum_category":"保健体育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`1695cfc8-53b7-4d28-8c0a-570bf6cea995`<br>`common_physical_max_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|satisfied|Course allocationと認定の分離|C09の境界・no Offering・複数edge|
|共通|C01|min_credits 42 credits<br>target=`{"program":"教養課程"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=46)|44|`62f9fc30-1dae-45d0-b290-7a65b218c179`<br>`common_total_min_credits`|groupedCards / applyRecognition（genericは別）|O/M+P|partial|G1/G5/G6、generic条件評価との差|omitted: reference-only overlay|Course allocationと認定の分離|C01の境界・no Offering・複数edge|
|経済学部 / 経済学科|E03|max_credits 8 credits<br>target=`{"course_name":"経済学特講"}`<br>conditions=`{"max_enrollments":4}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`593cf0e6-6e7b-4df9-a911-d5eb12d212a9`<br>`economics_economics_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|E03の境界・official aggregate・identity曖昧|
|経済学部 / 経済学科|E03|max_credits 16 credits<br>target=`{"course_name":"総合特講"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`d59c9f1f-a34d-436e-aaa2-fddf8af7aee8`<br>`economics_general_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|E03の境界・official aggregate・identity曖昧|
|経済学部 / 経済学科|E03|max_credits 8 credits<br>target=`{"course_name":"経営学特講"}`<br>conditions=`{"max_enrollments":4}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`34dc02c9-5981-4294-932c-fdb5bb47dc17`<br>`economics_management_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|E03の境界・official aggregate・identity曖昧|
|経済学部 / 経済学科|X01|max_credits 16 credits<br>target=`{"course_name":"（他学部・他学科公開科目）"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`201211a8-5f2a-4a7c-8505-8f0b3cbedb1f`<br>`economics_open_courses_max_credits`|publicCourseCard / evaluatePublicCourseLimit|U|partial|official dedup・個別上限|unknown: 対象科目のmappingを一意に特定できません|確認済公開factでcap|8/9回、official重複|
|経済学部 / 経済学科|E01|min_credits 24 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=58)|56|`7bf5971c-413b-41ba-9ed2-0d4e95c6e9b7`<br>`economics_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|E01の境界・official aggregate・identity曖昧|
|経済学部 / 経済学科|E02|overflow_credit_transfer None <br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"double_count":false,"from":{"curriculum_category":"専門教育","requirement_type":"選択必修"},"threshold":{"credits":24},"to":{"curriculum_category":"専門教育","requirement_type":"選択"},"transfer":"excess_only"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`35bba450-8ea8-4f0c-8a31-8be112c5a3f5`<br>`economics_required_elective_to_elective_overflow_credit_transfer`|electiveOverflowRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|E02の境界・official aggregate・identity曖昧|
|経済学部 / 経済学科|E03|max_credits 4 credits<br>target=`{"course_names":["演習","経済学演習"]}`<br>conditions=`{"aggregate":true,"max_enrollments":2}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`5f206a08-4e14-47bb-bdda-caf583a16757`<br>`economics_seminar_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|E03の境界・official aggregate・identity曖昧|
|経済学部 / 経済学科|X06|required_course None <br>target=`{"course_name":"卒業論文中間報告書指導"}`<br>conditions=`{"before":"卒業論文","when":{"thesis_selected":true}}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`57e595d0-d578-4697-ab71-1e0cb40ab4b4`<br>`economics_thesis_interim_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|経済学部 / 経済学科|X06|required_course None <br>target=`{"course_name":"卒業論文計画書指導"}`<br>conditions=`{"before":"卒業論文","when":{"thesis_selected":true}}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`a7b851ed-a663-414f-b5ea-3d18ad9e730e`<br>`economics_thesis_plan_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|経済学部 / 経済学科|E01|min_credits 82 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=58)|56|`70b64039-1fee-4c15-a1e9-86382da9e5b0`<br>`economics_total_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|E01の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G03|min_credits 12 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`cad08f04-0bd3-4faf-9cc5-da70fb158522`<br>`geography_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|G03の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G04|required_course 2 credits<br>target=`{"course_name":"現地研究"}`<br>conditions=`{"method":"schooling","min_enrollments":2}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`4b840826-e038-433b-bffb-9cd1287fa969`<br>`geography_fieldwork_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|G04の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G04|overflow_credit_transfer None <br>target=`{"course_name":"地域特講（現地研究）","curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"double_count":false,"from":{"course_name":"現地研究"},"threshold":{"credits":2},"to":{"course_name":"地域特講（現地研究）","curriculum_category":"専門教育","requirement_type":"選択"},"transfer":"excess_only"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`f4a54b53-1a3b-49c4-a0e5-91c95352bcc0`<br>`geography_fieldwork_to_elective_overflow_credit_transfer`|electiveOverflowRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|G04の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G04|max_credits 2 credits<br>target=`{"course_name":"地域特講（現地研究）","curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"max_enrollments":2}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`a9952a6b-bd58-4c34-91f0-72ae75708ad4`<br>`geography_fieldwork_transfer_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|G04の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G09|max_credits 16 credits<br>target=`{"course_name":"総合特講"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`a522694c-7c3f-4291-8935-bff7e1f7202b`<br>`geography_general_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|G09の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G01|required_course 2 credits<br>target=`{"course_name":"人文地理学概論（1）"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`908e8248-6ccc-493c-87c7-35c0bd35f584`<br>`geography_human_geography_overview_1_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|G01の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G01|required_course 4 credits<br>target=`{"course_name":"地理調査法（人文編）"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`398f9ed1-2df0-4d6e-aaa5-a657fa612450`<br>`geography_human_geography_research_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|G01の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G02|min_credits 8 credits<br>target=`{"curriculum_category":"専門教育","curriculum_field":"人文","requirement_type":"選択必修"}`<br>conditions=`{"min_courses":2}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`7f6c6015-9f88-4743-8993-c9f522abce04`<br>`geography_human_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|G02の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G06|required_course 2 credits<br>target=`{"course_name":"人文地理学演習"}`<br>conditions=`{"method":"schooling","min_enrollments":1}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`a0cd117f-3c93-4b00-962f-68d25f24033e`<br>`geography_human_seminar_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|G06の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|X01|max_credits 16 credits<br>target=`{"course_name":"（他学部・他学科公開科目）"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`4f2d4a4b-0ef5-42cc-b2bf-f26a96782b87`<br>`geography_open_courses_max_credits`|publicCourseCard / evaluatePublicCourseLimit|U|partial|official dedup・個別上限|unknown: 対象科目のmappingを一意に特定できません|確認済公開factでcap|8/9回、official重複|
|文学部 / 地理学科|G01|required_course 2 credits<br>target=`{"course_name":"自然地理学概論（1）"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`4334baa0-099c-46f5-abee-0c52432721fb`<br>`geography_physical_geography_overview_1_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|G01の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G01|required_course 4 credits<br>target=`{"course_name":"地理調査法（自然編）"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`62649d70-06e2-432e-95d6-f4aa274d527e`<br>`geography_physical_geography_research_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|G01の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G02|min_credits 8 credits<br>target=`{"curriculum_category":"専門教育","curriculum_field":"自然","requirement_type":"選択必修"}`<br>conditions=`{"min_courses":2}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`e7c03938-4546-46da-af20-0743b7cc71e3`<br>`geography_physical_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|G02の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G06|required_course 2 credits<br>target=`{"course_name":"自然地理学演習"}`<br>conditions=`{"method":"schooling","min_enrollments":1}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`7a6d84e8-3fdb-488b-9878-c2ad64c50470`<br>`geography_physical_seminar_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|G06の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G05|overflow_credit_transfer None <br>target=`{"course_name":"地理特講（地誌学特講）","curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"double_count":false,"from":{"course_name":"地誌学特講"},"threshold":{"credits":2},"to":{"course_name":"地理特講（地誌学特講）","curriculum_category":"専門教育","requirement_type":"選択"},"transfer":"excess_only"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`3eb15b14-f710-43f1-a5b3-275f3a00f1dd`<br>`geography_regional_lecture_to_elective_overflow_credit_transfer`|electiveOverflowRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|G05の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G02|min_credits 16 credits<br>target=`{"curriculum_category":"専門教育","curriculum_field":"地誌・その他","requirement_type":"選択必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`7194208b-295c-4c85-89f6-9ed8a4bffae6`<br>`geography_regional_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|G02の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G02|min_credits 36 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`ac29851f-6031-4c3a-9856-2f1ce2b9cc77`<br>`geography_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|G02の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G03|overflow_credit_transfer None <br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"double_count":false,"from":{"curriculum_category":"専門教育","requirement_type":"選択必修"},"threshold":{"credits":36},"to":{"curriculum_category":"専門教育","requirement_type":"選択"},"transfer":"excess_only"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`9ee4f4e4-a21e-4ecd-a723-0e8612f6a0dc`<br>`geography_required_elective_to_elective_overflow_credit_transfer`|electiveOverflowRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|G03の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G01|min_credits 12 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"必修"}`<br>conditions=`{"exclude_schooling_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`d2ae06a8-077f-43b7-bc24-1ff7479d6e31`<br>`geography_required_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|G01の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G01|min_schooling_credits 6 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"スクーリング必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`78a4a59f-35c4-4331-a7ff-cca1d6e4329c`<br>`geography_required_min_schooling_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|G01の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|G07|max_credits 4 credits<br>target=`{"course_names":["人文地理学特講","自然地理学特講"],"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"aggregate":true,"partial_two_credits_countable":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`e3df39f1-d4eb-4437-9199-974b44ed5949`<br>`geography_special_lectures_combined_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|G07の境界・official aggregate・identity曖昧|
|文学部 / 地理学科|X06|required_course None <br>target=`{"course_name":"卒業論文第1次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`8a480f3b-ef4b-4c72-a663-1a3d8971e261`<br>`geography_thesis_guidance_1_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 地理学科|X06|required_course None <br>target=`{"course_name":"卒業論文第2次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`fc525f1a-6830-4402-af60-1bbb8a1fc8d7`<br>`geography_thesis_guidance_2_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 地理学科|X06|required_course None <br>target=`{"course_name":"卒業論文第3次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`b1375d64-4730-41f5-bb11-a293cf089a02`<br>`geography_thesis_guidance_3_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 地理学科|X03|required_course 8 credits<br>target=`{"course_name":"卒業論文"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`ad390491-e03a-4594-aba0-bd4d280c61d5`<br>`geography_thesis_required_course`|thesisProgressCard（genericから除外）|T|partial|official thesis rowの算入経路なし|omitted: thesis card or inactive thesis branch|単一正本の整合を設計|scope/単位/officialとmanual重複|
|文学部 / 地理学科|G03|min_credits 82 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54|`b4d35ef5-3a98-46c8-b4fb-194fce19ed1c`<br>`geography_total_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|G03の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H05|min_courses 1 courses<br>target=`{"curriculum_category":"専門教育","curriculum_field":"東洋史","requirement_type":"選択"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`b588eb9e-e08f-4059-8e37-d1df90165988`<br>`history_eastern_elective_min_courses`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H05の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H01|required_course 4 credits<br>target=`{"course_name":"東洋史概説"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`0e9b82d6-98e7-4c26-9ee3-7c4d67a2cca4`<br>`history_eastern_history_overview_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H01の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H05|min_credits 50 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`e1569470-7c36-4b39-801a-118e44953f2f`<br>`history_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H05の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H06|max_credits 16 credits<br>target=`{"course_name":"総合特講"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`08fc8f63-7eed-4092-8511-ad4446b7c20a`<br>`history_general_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|H06の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H06|max_credits 12 credits<br>target=`{"course_name":"歴史資料学"}`<br>conditions=`{"max_enrollments":6}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`f102810a-ec25-43ae-abcb-6d0d2426bb9d`<br>`history_historical_sources_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|H06の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H01|required_course 4 credits<br>target=`{"course_name":"史学概論"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`0f7a7982-8b3d-4d5b-886e-26d5d2d841b0`<br>`history_historical_studies_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H01の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H05|min_courses 1 courses<br>target=`{"curriculum_category":"専門教育","curriculum_field":"日本史","requirement_type":"選択"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`1b783c86-e99e-4407-906b-4fed610c3dce`<br>`history_japanese_elective_min_courses`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H05の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H01|required_course 4 credits<br>target=`{"course_name":"日本史概説"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`ee1d6de2-262f-443d-93d7-1ef8a7de030b`<br>`history_japanese_history_overview_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H01の境界・official aggregate・identity曖昧|
|文学部 / 史学科|X01|max_credits 16 credits<br>target=`{"course_name":"（他学部・他学科公開科目）"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`de1ba568-532d-4a76-8ae1-331b194abdf9`<br>`history_open_courses_max_credits`|publicCourseCard / evaluatePublicCourseLimit|U|partial|official dedup・個別上限|unknown: 対象科目のmappingを一意に特定できません|確認済公開factでcap|8/9回、official重複|
|文学部 / 史学科|H02|min_courses 2 courses<br>target=`{"course_names":["日本史概説","西洋史概説","東洋史概説"]}`<br>conditions=`{"combine_categories":["必修","スクーリング選択必修"],"credits_per_course":6}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`566e8d96-4f4e-47f9-afd0-f4df8514ce8c`<br>`history_overview_six_credits_min_courses`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|H02の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H02|min_schooling_credits 8 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"スクーリング選択必修"}`<br>conditions=`{"min_courses":4}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`16fca7a6-e4a7-4579-844a-0b825f425f33`<br>`history_required_elective_min_schooling_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H02の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H01|min_credits 16 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`7ae46682-6d87-444d-8d99-54e4724564d4`<br>`history_required_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H01の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H03|max_credits 8 credits<br>target=`{"course_name":"史学演習"}`<br>conditions=`{"max_enrollments":4}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`37c71286-0a93-4880-b2ee-e7893567808c`<br>`history_seminar_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 修得順により割当が変わるため自動評価できません|Courseを正本にし本編の例外条件を保持|H03の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H03|required_course 1 enrollments<br>target=`{"course_name":"史学演習"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`d2188d54-9294-4ae9-ae9c-349c9fa7344b`<br>`history_seminar_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 修得順により割当が変わるため自動評価できません|Courseを正本にし本編の例外条件を保持|H03の境界・official aggregate・identity曖昧|
|文学部 / 史学科|X06|required_course None <br>target=`{"course_name":"卒業論文第1次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`ca77f2ef-0e59-4ab1-8ecd-ea55c1d7ec7b`<br>`history_thesis_guidance_1_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 史学科|X06|required_course None <br>target=`{"course_name":"卒業論文第2次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`66544e51-780c-498d-a4d1-9f1ece599207`<br>`history_thesis_guidance_2_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 史学科|X06|required_course None <br>target=`{"course_name":"卒業論文第3次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`9423de04-3112-4b95-95d3-c40aa12417af`<br>`history_thesis_guidance_3_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 史学科|X03|required_course 8 credits<br>target=`{"course_name":"卒業論文"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`bc42b76d-e4e7-4629-ab17-7fe6900aee26`<br>`history_thesis_required_course`|thesisProgressCard（genericから除外）|T|partial|official thesis rowの算入経路なし|omitted: thesis card or inactive thesis branch|単一正本の整合を設計|scope/単位/officialとmanual重複|
|文学部 / 史学科|H07|min_credits 82 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`b15abf2d-e183-4d57-8837-6726b093a304`<br>`history_total_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H07の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H05|min_courses 1 courses<br>target=`{"curriculum_category":"専門教育","curriculum_field":"西洋史","requirement_type":"選択"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`d9010be2-cce5-4db6-8e7c-c8f279a3c430`<br>`history_western_elective_min_courses`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H05の境界・official aggregate・identity曖昧|
|文学部 / 史学科|H01|required_course 4 credits<br>target=`{"course_name":"西洋史概説"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52|`fd5b3387-30f8-49bd-bbe7-605ac344363d`<br>`history_western_history_overview_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|H01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|J02|min_credits 24 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`cbbdea37-04c6-462d-8247-0321f5d03afd`<br>`japanese_language_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J02の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|J05|max_credits 16 credits<br>target=`{"course_name":"総合特講"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`97fde58a-3513-4608-860e-c2e3541948b2`<br>`japanese_language_general_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|J05の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|J01|required_course 4 credits<br>target=`{"course_name":"日本文法論"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`13c7139e-10b5-4fc7-8fe4-7989c14967d8`<br>`japanese_language_japanese_grammar_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|J01|required_course 4 credits<br>target=`{"course_name":"日本言語史"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`42de4c40-e04f-4d12-8195-7d9b692e2e52`<br>`japanese_language_japanese_language_history_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|J01|required_course 4 credits<br>target=`{"course_name":"日本言語学概論"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`d6b08a03-e16b-4bb1-b9c0-31aa9c8c79b7`<br>`japanese_language_japanese_linguistics_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|J01|required_course 4 credits<br>target=`{"course_name":"日本文芸史Ⅰ"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`cfc55176-b046-4379-8d0b-c4f28b6ca5e5`<br>`japanese_language_japanese_literary_history_i_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|J01|required_course 4 credits<br>target=`{"course_name":"日本文芸学概論"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`916d45f4-fec3-44dd-b5e3-f35be5b7a610`<br>`japanese_language_japanese_literary_studies_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|X01|max_credits 16 credits<br>target=`{"course_name":"（他学部・他学科公開科目）"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`90f9fd93-bc16-4089-b9c2-91db557f9da4`<br>`japanese_language_open_courses_max_credits`|publicCourseCard / evaluatePublicCourseLimit|U|partial|official dedup・個別上限|unknown: 対象科目のmappingを一意に特定できません|確認済公開factでcap|8/9回、official重複|
|文学部 / 日本文学科 / 言語コース|J02|min_credits 20 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`820f36a3-b3b4-4a39-ac48-f4371944f920`<br>`japanese_language_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J02の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|J02|overflow_credit_transfer None <br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"double_count":false,"from":{"curriculum_category":"専門教育","requirement_type":"選択必修"},"threshold":{"credits":20},"to":{"curriculum_category":"専門教育","requirement_type":"選択"},"transfer":"excess_only"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`0bc4f7f9-f1d6-406a-839b-c508a8a4e5df`<br>`japanese_language_required_elective_to_elective_overflow_credit_transfer`|electiveOverflowRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|J02の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|J01|min_credits 20 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`9146d2f1-f4ed-4202-b4a1-32be816027c4`<br>`japanese_language_required_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 言語コース|X06|required_course None <br>target=`{"course_name":"卒業論文第1次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`b40edf9f-6fdf-4e30-9e20-9bf07d930865`<br>`japanese_language_thesis_guidance_1_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 日本文学科 / 言語コース|X06|required_course None <br>target=`{"course_name":"卒業論文第2次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`55e32f37-31e8-4aef-8a99-9f01a6fee6b5`<br>`japanese_language_thesis_guidance_2_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 日本文学科 / 言語コース|X03|required_course 8 credits<br>target=`{"course_name":"卒業論文"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`478788fe-278a-4599-99a0-38cf4c0032a8`<br>`japanese_language_thesis_required_course`|thesisProgressCard（genericから除外）|T|partial|official thesis rowの算入経路なし|omitted: thesis card or inactive thesis branch|単一正本の整合を設計|scope/単位/officialとmanual重複|
|文学部 / 日本文学科 / 言語コース|J03|min_credits 82 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=52)|50|`3895617e-9032-41bf-8b61-66a6cd755326`<br>`japanese_language_total_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J03の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|J02|min_credits 24 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`2f1b7e26-de88-4b12-8b00-acc657ac86ee`<br>`japanese_literature_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J02の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|J05|max_credits 16 credits<br>target=`{"course_name":"総合特講"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`6f94ea4c-503d-477b-9fba-48736a9ff719`<br>`japanese_literature_general_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|J05の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|J01|required_course 4 credits<br>target=`{"course_name":"日本言語学概論"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`35c08987-5373-4282-bdb8-3c2e08b2f419`<br>`japanese_literature_japanese_linguistics_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|J01|required_course 4 credits<br>target=`{"course_name":"日本文芸史Ⅰ"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`639ead9a-a694-40cb-a3c9-d126b0bca61a`<br>`japanese_literature_japanese_literary_history_i_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|J01|required_course 4 credits<br>target=`{"course_name":"日本文芸史Ⅱ"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`29a711d7-124f-4a32-b409-3e394c07ca3e`<br>`japanese_literature_japanese_literary_history_ii_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|J01|required_course 4 credits<br>target=`{"course_name":"日本文芸学概論"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`01fa8e3b-a16e-43cc-8fd2-1bfe84aa4680`<br>`japanese_literature_japanese_literary_studies_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|J01|required_course 4 credits<br>target=`{"course_name":"文学概論"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`ca7c86d3-a2af-427b-89e8-31bfc474e238`<br>`japanese_literature_literature_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|X01|max_credits 16 credits<br>target=`{"course_name":"（他学部・他学科公開科目）"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`fb384141-9c86-40d0-b8e5-5e1afa9876c3`<br>`japanese_literature_open_courses_max_credits`|publicCourseCard / evaluatePublicCourseLimit|U|partial|official dedup・個別上限|unknown: 対象科目のmappingを一意に特定できません|確認済公開factでcap|8/9回、official重複|
|文学部 / 日本文学科 / 文学コース|J02|min_credits 20 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`32a86efc-4b8d-4227-9c23-3d155fd888cf`<br>`japanese_literature_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J02の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|J02|overflow_credit_transfer None <br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"double_count":false,"from":{"curriculum_category":"専門教育","requirement_type":"選択必修"},"threshold":{"credits":20},"to":{"curriculum_category":"専門教育","requirement_type":"選択"},"transfer":"excess_only"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`9e00cf4c-6037-47ae-9457-6af2d988bd0d`<br>`japanese_literature_required_elective_to_elective_overflow_credit_transfer`|electiveOverflowRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|J02の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|J01|min_credits 20 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`4b95d431-08ba-4995-80fa-c22bdefe13e9`<br>`japanese_literature_required_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 文学コース|X06|required_course None <br>target=`{"course_name":"卒業論文第1次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`b563ac0e-7f65-4af1-ba76-b807a619ce92`<br>`japanese_literature_thesis_guidance_1_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 日本文学科 / 文学コース|X06|required_course None <br>target=`{"course_name":"卒業論文第2次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`befb42ce-3884-40d9-b444-1d514930c361`<br>`japanese_literature_thesis_guidance_2_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 日本文学科 / 文学コース|X03|required_course 8 credits<br>target=`{"course_name":"卒業論文"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`fbb2a97f-9447-4bfc-a95a-bfb1aa088663`<br>`japanese_literature_thesis_required_course`|thesisProgressCard（genericから除外）|T|partial|official thesis rowの算入経路なし|omitted: thesis card or inactive thesis branch|単一正本の整合を設計|scope/単位/officialとmanual重複|
|文学部 / 日本文学科 / 文学コース|J03|min_credits 82 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=51)|49|`1a1ea312-05ac-4fb8-9247-8132f7e77477`<br>`japanese_literature_total_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J03の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|J02|min_credits 24 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`4d7b1739-bbe5-47fd-ae75-52797d053bca`<br>`japanese_performance_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J02の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|J05|max_credits 16 credits<br>target=`{"course_name":"総合特講"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`80eeaeb7-b1a9-4a20-8041-37abf8604142`<br>`japanese_performance_general_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|J05の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|J01|required_course 4 credits<br>target=`{"course_name":"日本美術史"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`438b83ed-3af8-488b-8ae5-a48975104faa`<br>`japanese_performance_japanese_art_history_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|J01|required_course 4 credits<br>target=`{"course_name":"日本言語学概論"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`7ac81a6f-66fb-4442-a056-691c912927c6`<br>`japanese_performance_japanese_linguistics_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|J01|required_course 4 credits<br>target=`{"course_name":"日本文芸史Ⅰ"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`943c6eaa-9b19-471e-9ed5-15f0b82189d2`<br>`japanese_performance_japanese_literary_history_i_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|J01|required_course 4 credits<br>target=`{"course_name":"日本文芸学概論"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`b4e8f364-c39d-4d8b-b663-c2181e38f04d`<br>`japanese_performance_japanese_literary_studies_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|X01|max_credits 16 credits<br>target=`{"course_name":"（他学部・他学科公開科目）"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`8b941bb5-586f-4568-bcae-e889448ae07b`<br>`japanese_performance_open_courses_max_credits`|publicCourseCard / evaluatePublicCourseLimit|U|partial|official dedup・個別上限|unknown: 対象科目のmappingを一意に特定できません|確認済公開factでcap|8/9回、official重複|
|文学部 / 日本文学科 / 芸能文化コース|J01|required_course 4 credits<br>target=`{"course_name":"日本芸能史"}`<br>conditions=`{"full_course_credits_required":true}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`fba637a4-47f1-4593-a7ff-7ae5c70ead89`<br>`japanese_performance_performing_arts_history_required_course`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|J02|min_credits 20 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`f1859e4f-1999-47e4-9544-86597d50a976`<br>`japanese_performance_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J02の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|J02|overflow_credit_transfer None <br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"double_count":false,"from":{"curriculum_category":"専門教育","requirement_type":"選択必修"},"threshold":{"credits":20},"to":{"curriculum_category":"専門教育","requirement_type":"選択"},"transfer":"excess_only"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`04a14582-3e76-4c6c-aa16-abda4256cd18`<br>`japanese_performance_required_elective_to_elective_overflow_credit_transfer`|electiveOverflowRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|J02の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|J01|min_credits 20 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"必修"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`6206c5e5-83fc-46a9-98ac-1a76ea99bdcd`<br>`japanese_performance_required_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J01の境界・official aggregate・identity曖昧|
|文学部 / 日本文学科 / 芸能文化コース|X06|required_course None <br>target=`{"course_name":"卒業論文第1次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`2b007e69-2e74-4f1b-84be-6bcdb2958851`<br>`japanese_performance_thesis_guidance_1_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 日本文学科 / 芸能文化コース|X06|required_course None <br>target=`{"course_name":"卒業論文第2次指導"}`<br>conditions=`{"before":"卒業論文"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`5f255864-576f-4a55-8d22-6d6f9b3026fe`<br>`japanese_performance_thesis_guidance_2_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|文学部 / 日本文学科 / 芸能文化コース|X03|required_course 8 credits<br>target=`{"course_name":"卒業論文"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`e1691c7e-447f-41ad-ae5e-48c38d70aabb`<br>`japanese_performance_thesis_required_course`|thesisProgressCard（genericから除外）|T|partial|official thesis rowの算入経路なし|omitted: thesis card or inactive thesis branch|単一正本の整合を設計|scope/単位/officialとmanual重複|
|文学部 / 日本文学科 / 芸能文化コース|J03|min_credits 82 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`null`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=53)|51|`06769b1e-ba33-4b10-9404-a66a88e03009`<br>`japanese_performance_total_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|J03の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L04|min_credits 50 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"includes_thesis":true,"when":{"thesis_selected":true}}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=48)|46|`8e08d5c3-a3ab-47e9-81c8-c9a3f8426a67`<br>`law_elective_with_thesis_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|L04の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L04|min_credits 54 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"when":{"thesis_selected":false}}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=48)|46|`ef19cce0-2441-42dc-aedd-9c8e91c2bd9e`<br>`law_elective_without_thesis_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|omitted: thesis card or inactive thesis branch|Courseを正本にし本編の例外条件を保持|L04の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L06|max_credits 16 credits<br>target=`{"course_name":"総合特講"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`eb3c7d93-9b31-4c2b-a088-184734c475bc`<br>`law_general_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|L06の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L06|max_credits 8 credits<br>target=`{"course_name":"法律学特講"}`<br>conditions=`{"max_enrollments":4}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`30b676ea-5a32-47a6-b242-422cf3409c15`<br>`law_law_lecture_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|L06の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|X01|max_credits 16 credits<br>target=`{"course_name":"（他学部・他学科公開科目）"}`<br>conditions=`{"max_enrollments":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`15aba6e3-c2ea-4ad2-8ba9-104b2e42ed58`<br>`law_open_courses_max_credits`|publicCourseCard / evaluatePublicCourseLimit|U|partial|official dedup・個別上限|unknown: 対象科目のmappingを一意に特定できません|確認済公開factでcap|8/9回、official重複|
|法学部 / 法律学科|L06|max_credits 4 credits<br>target=`{"course_name":"政治学"}`<br>conditions=`{"max_enrollments":2}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`4eb9070d-96ed-4606-ba3d-5b5817f56875`<br>`law_politics_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|L06の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L05|min_schooling_credits 8 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`{"exclude_table_marker":"＊","marker_source_page":46}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`d0197015-22a5-4fcc-ba1e-1eca087cef61`<br>`law_professional_min_schooling_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|L05の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L01|min_credits 32 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択必修"}`<br>conditions=`{"full_course_credits_required":true,"min_courses":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=48)|46|`060c4fe0-af29-4339-8177-6cd017e2fdf4`<br>`law_required_elective_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|L01の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L01|min_credits 32 credits<br>target=`{"curriculum_category":"専門教育","requirement_type":"選択必修"}`<br>conditions=`{"full_course_credits_required":true,"min_courses":8}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`21b5b3ba-1096-4d43-a9d1-1eee72c393a8`<br>`law_required_elective_min_credits_note`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|L01の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L02|overflow_credit_transfer None <br>target=`{"curriculum_category":"専門教育","requirement_type":"選択"}`<br>conditions=`{"double_count":false,"from":{"curriculum_category":"専門教育","requirement_type":"選択必修"},"requires_completed_courses":8,"threshold":{"credits":32},"to":{"curriculum_category":"専門教育","requirement_type":"選択"},"transfer":"excess_only"}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`b60d98ff-db82-4794-bc80-09721f321ef1`<br>`law_required_elective_to_elective_overflow_credit_transfer`|electiveOverflowRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 条件または例外を安全に自動評価できません|Courseを正本にし本編の例外条件を保持|L02の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L06|max_credits 8 credits<br>target=`{"course_name":"法律学演習"}`<br>conditions=`{"max_enrollments":4}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`c46a6621-68fe-48b5-bed2-20683c5b2848`<br>`law_seminar_max_credits`|repeatableRule / professionalCards|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unknown: 対象科目のmappingを一意に特定できません|Courseを正本にし本編の例外条件を保持|L06の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|X06|required_course None <br>target=`{"course_name":"卒業論文一般指導"}`<br>conditions=`{"before":"卒業論文","when":{"thesis_selected":true}}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`d637fe94-fcb8-43a3-8705-0536fe1c9c59`<br>`law_thesis_guidance_required_course`|evaluateStructured→unknown / thesisGuidance別画面|T+本人手続|unknown|指導順/期限の卒業統合なし|unknown: 条件または例外を安全に自動評価できません|手続の証拠を別評価|未受講/期限/提出/順序|
|法学部 / 法律学科|L04|min_credits 82 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`{"when":{"thesis_selected":true}}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=48)|46|`5755e04d-5c56-4a34-a2b4-afca335676e2`<br>`law_total_with_thesis_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|unsatisfied|Courseを正本にし本編の例外条件を保持|L04の境界・official aggregate・identity曖昧|
|法学部 / 法律学科|L04|min_credits 86 credits<br>target=`{"curriculum_category":"専門教育"}`<br>conditions=`{"when":{"thesis_selected":false}}`|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=48)|46|`5e64c026-b4b7-4546-a1fc-5e9340e3b976`<br>`law_total_without_thesis_min_credits`|professionalCards / evaluateStructured|O/M（importは仮想O）|partial|G1/G3/G5/G6。generic/専用cardの差|omitted: thesis card or inactive thesis branch|Courseを正本にし本編の例外条件を保持|L04の境界・official aggregate・identity曖昧|

### Catalog unsupported

|scope/department|本編ID|official rule / catalog表現|source|印刷page|catalog requirement ID / ruleId|current function|current identity|audit status|missing evidence / risk|現在のgeneric probe|recommended implementation|required tests（追加含む）|
|---|---|---|---|---|---|---|---|---|---|---|---|---|
|commerce|S03|可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`b8dcb431-dc43-42d7-876e-a8cefd051f3f`<br>`commerce_course_credit_completion`|completedCurriculumCredits / groupedCards|O/M|partial|G1/G3/G5と構成単位例外|unknown: 可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。|Course aggregateから完成判定|2/4/超過・no Offering|
|commerce|X04|旧課程の追加措置は正本16頁の範囲外。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`dc9e518e-93fd-403c-9919-1cd6b55ae189`<br>`commerce_legacy_rules_external`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧課程の追加措置は正本16頁の範囲外。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|commerce|X01|個別開講の上限値は本PDFに記載なし。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=61)|59|`460b8af8-7d3f-44eb-8edc-9e353f518c9c`<br>`commerce_open_course_individual_limits`|publicCourseCard（個別制限なし）|U|unknown|各開講の法政通信未取得|unknown: 個別開講の上限値は本PDFに記載なし。|個別公式上限を確認しunknown保持|公開科目別回数/学年制限|
|common|C11|条件付き算入除外を表すrule_typeが未定義。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`c250af2a-6e5a-4568-a8c1-0ae2915a0815`<br>`common_already_fulfilled`|applyRecognition / groupedCards|P+O/M|partial|認定済区分とactualの排他関係|unknown: 条件付き算入除外を表すrule_typeが未定義。|認定/免除とschoolingの別allocation|認定36+実修得/免除|
|common|S03|可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`e298bb7b-9514-4feb-9eae-86334e3baf04`<br>`common_course_credit_completion`|completedCurriculumCredits / groupedCards|O/M|partial|G1/G3/G5と構成単位例外|unknown: 可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。|Course aggregateから完成判定|2/4/超過・no Offering|
|common|C08|履修禁止を表すrule_typeが未定義。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`9ded9b36-ce7a-4d82-9fe1-3b8315df142c`<br>`common_foreign_reenrollment`|なし（groupedCardsのcapとは別）|O/M|unsupported|再履修禁止validatorなし|unknown: 履修禁止を表すrule_typeが未定義。|卒業capと履修禁止を分離|同一言語の充足後再履修|
|common|C12|旧課程の追加措置は正本16頁の範囲外。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`cfbb8e4f-b4f1-4988-9dbe-40fe1fbf5936`<br>`common_legacy_rules_external`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧課程の追加措置は正本16頁の範囲外。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|common|C12|旧新課程の同種科目同定が必要。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45|`931bebb8-a653-444e-8bcd-d6437916f583`<br>`common_natural_legacy_reenrollment`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧新課程の同種科目同定が必要。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|economics|S03|可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`c52a3b22-73d0-44f2-a9f4-8ce6aa3ebd44`<br>`economics_course_credit_completion`|completedCurriculumCredits / groupedCards|O/M|partial|G1/G3/G5と構成単位例外|unknown: 可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。|Course aggregateから完成判定|2/4/超過・no Offering|
|economics|X04|旧課程の追加措置は正本16頁の範囲外。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`e0c702a6-ca85-46e8-b581-d2759f865b73`<br>`economics_legacy_rules_external`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧課程の追加措置は正本16頁の範囲外。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|economics|X01|個別開講の上限値は本PDFに記載なし。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=59)|57|`270e020e-5d96-4c94-8ce0-9d8a62b486c1`<br>`economics_open_course_individual_limits`|publicCourseCard（個別制限なし）|U|unknown|各開講の法政通信未取得|unknown: 個別開講の上限値は本PDFに記載なし。|個別公式上限を確認しunknown保持|公開科目別回数/学年制限|
|geography|S03|可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`9b84c0d6-17a5-4116-a3a0-c573c19322b9`<br>`geography_course_credit_completion`|completedCurriculumCredits / groupedCards|O/M|partial|G1/G3/G5と構成単位例外|unknown: 可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。|Course aggregateから完成判定|2/4/超過・no Offering|
|geography|G08|条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`fabb92ec-3ff0-4db3-97dc-1eff8cde084d`<br>`geography_legacy_fieldwork`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|geography|G08|条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`1c2a9ba9-b911-4299-8ddb-c6fabe2483bd`<br>`geography_legacy_regional_transfer`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|geography|G08|旧課程の追加措置は正本16頁の範囲外。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`33fe3f50-0705-4b27-ae2e-81feff2d3389`<br>`geography_legacy_rules_external`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧課程の追加措置は正本16頁の範囲外。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|geography|X01|個別開講の上限値は本PDFに記載なし。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`d04830b5-7b9e-426b-9604-c9a898de57c7`<br>`geography_open_course_individual_limits`|publicCourseCard（個別制限なし）|U|unknown|各開講の法政通信未取得|unknown: 個別開講の上限値は本PDFに記載なし。|個別公式上限を確認しunknown保持|公開科目別回数/学年制限|
|geography|G06|条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=57)|55|`2e615b52-c82a-447e-ac15-186ccb87aa9f`<br>`geography_seminar_three_stage_transfer`|allocateGeographyTransfers|O|partial|aggregate不可分G12|unknown: 条件・段階の優先順位を持つ再配分は現エンジンで未対応。無条件繰越へ単純化しない。|Course単位の段階ledger|2/4/6・method不明|
|history|S03|可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`4442e318-c718-4a8a-861c-d26b3ee64ea9`<br>`history_course_credit_completion`|completedCurriculumCredits / groupedCards|O/M|partial|G1/G3/G5と構成単位例外|unknown: 可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。|Course aggregateから完成判定|2/4/超過・no Offering|
|history|H04|修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`cbf128a3-9b1f-4705-bf47-89b5b899fea4`<br>`history_fifth_schooling_course`|historySchoolingDiagnostic|O+earnedOrder|partial|importに修得順なし|unknown: 修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。|公式順序証拠で保留/配分|5科目直前/完成/超過|
|history|X04|旧課程の追加措置は正本16頁の範囲外。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`823af8f4-56d9-4a99-9cbd-bf3626aebe0f`<br>`history_legacy_rules_external`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧課程の追加措置は正本16頁の範囲外。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|history|X01|個別開講の上限値は本PDFに記載なし。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`d1f1fd2a-f638-4762-8cff-c3dbb0b02548`<br>`history_open_course_individual_limits`|publicCourseCard（個別制限なし）|U|unknown|各開講の法政通信未取得|unknown: 個別開講の上限値は本PDFに記載なし。|個別公式上限を確認しunknown保持|公開科目別回数/学年制限|
|history|H01|修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`8f91c4f3-9a90-4001-afb4-587debe92d2f`<br>`history_overview_allocation`|professionalCards.distribute|O/M+名前|partial|G1/G6と概説完成/cap|unknown: 修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。|Course別排他的配分|schooling2+必修4・aggregate6|
|history|H03|修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`018836c4-c4be-4ac3-8987-fb9f091c7a64`<br>`history_overview_exam`|historySeminarCards（受講資格は判定外）|O+earnedOrder|unsupported|受講時点の概説修得証拠|unknown: 修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。|前提条件を別評価、unknown保持|日本/東洋/西洋の前提4と時点|
|history|H03|修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=55)|53|`aeadbf2d-0396-4b6b-91b1-9a4100563838`<br>`history_seminar_prerequisite`|historySeminarCards（受講資格は判定外）|O+earnedOrder|unsupported|受講時点の概説修得証拠|unknown: 修得順・科目指定の再配分または履修前提条件を表す専用rule_typeが未定義。|前提条件を別評価、unknown保持|日本/東洋/西洋の前提4と時点|
|japanese_language|J04|課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`0a82e6ad-9b12-4feb-90b7-4cfc5950b3b8`<br>`japanese_language_calligraphy_methods`|completedCurriculumCredits|O/M.method|partial|課題/期限/再提出とG6|unknown: 課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。|method証拠を別factにする|通信2不可/S1+通信1/S2/期限|
|japanese_language|S03|可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`889af716-523b-4f08-8e07-8298bdb0c22c`<br>`japanese_language_course_credit_completion`|completedCurriculumCredits / groupedCards|O/M|partial|G1/G3/G5と構成単位例外|unknown: 可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。|Course aggregateから完成判定|2/4/超過・no Offering|
|japanese_language|X04|旧課程の追加措置は正本16頁の範囲外。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`59d3d310-2713-462d-9dcc-1157962ab8b7`<br>`japanese_language_legacy_rules_external`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧課程の追加措置は正本16頁の範囲外。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|japanese_language|X01|個別開講の上限値は本PDFに記載なし。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`02545f6d-1c3c-448e-9868-302f54445b33`<br>`japanese_language_open_course_individual_limits`|publicCourseCard（個別制限なし）|U|unknown|各開講の法政通信未取得|unknown: 個別開講の上限値は本PDFに記載なし。|個別公式上限を確認しunknown保持|公開科目別回数/学年制限|
|japanese_literature|J04|課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`85fc90f5-a1f1-41d4-8268-db543e5f72df`<br>`japanese_literature_calligraphy_methods`|completedCurriculumCredits|O/M.method|partial|課題/期限/再提出とG6|unknown: 課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。|method証拠を別factにする|通信2不可/S1+通信1/S2/期限|
|japanese_literature|S03|可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`b1a283ef-797a-49f9-8221-8f3fc9514ba3`<br>`japanese_literature_course_credit_completion`|completedCurriculumCredits / groupedCards|O/M|partial|G1/G3/G5と構成単位例外|unknown: 可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。|Course aggregateから完成判定|2/4/超過・no Offering|
|japanese_literature|X04|旧課程の追加措置は正本16頁の範囲外。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`ac9ee37b-8546-4a5a-a812-94c67774c626`<br>`japanese_literature_legacy_rules_external`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧課程の追加措置は正本16頁の範囲外。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|japanese_literature|X01|個別開講の上限値は本PDFに記載なし。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`269728d4-4497-414f-82f2-9051e9a4c65c`<br>`japanese_literature_open_course_individual_limits`|publicCourseCard（個別制限なし）|U|unknown|各開講の法政通信未取得|unknown: 個別開講の上限値は本PDFに記載なし。|個別公式上限を確認しunknown保持|公開科目別回数/学年制限|
|japanese_performance|J04|課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`443f9f33-4804-46ed-ae0f-5ea1b52afa82`<br>`japanese_performance_calligraphy_methods`|completedCurriculumCredits|O/M.method|partial|課題/期限/再提出とG6|unknown: 課題合格・期限・再提出を伴う選択肢は現rule_typeでは完全に表現できない。|method証拠を別factにする|通信2不可/S1+通信1/S2/期限|
|japanese_performance|S03|可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`71c833eb-f444-4ed2-9e7c-be270c63ae75`<br>`japanese_performance_course_credit_completion`|completedCurriculumCredits / groupedCards|O/M|partial|G1/G3/G5と構成単位例外|unknown: 可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。|Course aggregateから完成判定|2/4/超過・no Offering|
|japanese_performance|X04|旧課程の追加措置は正本16頁の範囲外。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`3030a509-efe9-46a2-9ed5-a7ff89e2d607`<br>`japanese_performance_legacy_rules_external`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧課程の追加措置は正本16頁の範囲外。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|japanese_performance|X01|個別開講の上限値は本PDFに記載なし。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48|`d5f85532-a5df-4840-871d-e320b0933b68`<br>`japanese_performance_open_course_individual_limits`|publicCourseCard（個別制限なし）|U|unknown|各開講の法政通信未取得|unknown: 個別開講の上限値は本PDFに記載なし。|個別公式上限を確認しunknown保持|公開科目別回数/学年制限|
|law|S03|可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`caf7e126-06c1-4679-be42-453cc9faab20`<br>`law_course_credit_completion`|completedCurriculumCredits / groupedCards|O/M|partial|G1/G3/G5と構成単位例外|unknown: 可変の科目構成単位と例外を扱う専用rule_typeが未定義。単位数はmappingから補完しない。|Course aggregateから完成判定|2/4/超過・no Offering|
|law|X04|旧課程の追加措置は正本16頁の範囲外。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`227b1602-17bb-40c5-ba8c-b1e46d2f129b`<br>`law_legacy_rules_external`|referencePrerequisiteReason（計算なし）|P|unsupported|適用時点/旧課程読替え証拠|unknown: 旧課程の追加措置は正本16頁の範囲外。|旧課程専用条件、未確認はunknown|旧新課程と復籍境界|
|law|X01|個別開講の上限値は本PDFに記載なし。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`659094ed-d3b3-4c93-873b-441275326584`<br>`law_open_course_individual_limits`|publicCourseCard（個別制限なし）|U|unknown|各開講の法政通信未取得|unknown: 個別開講の上限値は本PDFに記載なし。|個別公式上限を確認しunknown保持|公開科目別回数/学年制限|
|law|L03|条件付き算入許可を表すrule_typeが未定義。<br>ruleType/target/conditions=null（本編に公式内容）|[S](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|47|`885862b3-b90c-4e83-84bc-d62eabff261d`<br>`law_partial_course_exception`|professionalCards.permittedPartial|O/M.method|partial|G6、generic未実装|unknown: 条件付き算入許可を表すrule_typeが未定義。|Course+schooling条件|8科目32の前後、通信2不可|
## 11. 最終検証結果

2026-10-03、このbranchの変更について確認した結果。卒業要件の完成を示すものではない。

|検証|結果|
|---|---|
|`npm run typecheck`|PASS|
|`npm run lint`|PASS|
|`npm run test:planner`|469 / 469 PASS（既存451 + 新規18、削除・skipなし）|
|`npm run test:extension`|19 / 19 PASS|
|`npm run build`|PASS。内包する `catalog:check` もPASS（321 CurriculumCourse / 686 Offering）。Viteの500 kB超chunk警告は残る|
|監査script / 新規test構文|`node --check` PASS|
|台帳網羅性|全182 Requirement UUIDが第10節に各1回、欠落・重複0。公式入力経路を含めた台帳判定は partial142 / unknown25 / unsupported15 / supported0。これはcatalog自身のstructured142 / unsupported40とは別の分類|
|完成flag / source検証flag|raw/runtimeとも `graduationCheckComplete=false`、`sourceLinksReverified=false`|
|永続契約|`initialState().schemaVersion === 22`。production engine・catalog・storage・import contractの変更なし、migrationなし|

意味単位の限定supported（annual49との分離、明示ThesisProgressの選択・単位表示）を、official achievementから卒業要件全体までのsupportedに拡張しない。発見した欠陥の修正は第7節の次slice以降で扱う。

## 12. Implementation note — official Course facts slice（2026-10-03）

本節は `0277edba0eed3df0d0dccfbd4783825cb9f11e98`（PR #64 merge）を基点とする後続実装。第1〜11節とG1〜G14の記述は**監査時点の事実**として変更しない。卒業要件エンジン全体の完成ではない。

### Calculation-only API と入力境界

`src/planner/officialGraduationFacts.ts`:

```ts
deriveOfficialGraduationFacts(
  rows: ImportedCourseAchievement[],
  records: ImportedStudyRecord[],
  catalog: PlannerCatalog,
  selectedScopeId: string,
  profile?: GraduationProfile,
): DerivedOfficialGraduationFacts // { facts, allocations }
```

- `OfficialGraduationFact`: `sourceRowIds`, nullable `curriculumCourseId` / `canonicalName`, 個別aggregateを保持する `sourceRows`, nullable `earnedCreditsTotal` / `compositionCredits`, `schoolingEvidence { credits, source, recordIds }`, `candidateMappingIds`, `allocation`, `diagnostics`。
- `OfficialAllocationInput`: `fact`, 同値性確認後の `mapping` descriptor, `credits`, `completedCredits`, nullable `schoolingCredits`。この中間入力をgeneric/common/professionalの集計へ直接合成する。fake Offering / PlannerItemは作らない。
- 入り口は既存 `exactImportedCurriculumId(row, catalog)`（`exact_unique` かつ `validImportedCurriculumIdentity`）。legacy courseId / rawName / categoryRaw / annual candidateで格上げしない。保存identity validationの契約は変更しない。矛盾するannual selectionを含む無効な保存identityも保留する。
- `CurriculumCourse.mappingIds` 全edgeを解決してselected/commonに限定。`scopeIds`は診断だけ。他scopeのみなら `out_of_scope`、欠落edgeは `mapping_not_found`。
- signatureはcommon/selectedのscope class・category・field・requirementType・curriculumCredits・schoolingOnly・mediaOnly。全一致だけ `equivalent`、1edgeは `unique`、差があれば `mapping_conflict`。descriptorのID sortは同値性を証明した**後**の安定した表現にのみ使用する。
- 同じexact Courseの**異なるsource row id**は、fingerprint・日時・値が同じでも `duplicate_official_rows` / `conflicting_source_rows`。merged totalはnull、全idと個別aggregateを返す。sum/max/latestを行わない。同じsource row idの再入力のみ1回にする。
- totalは公式rowの値だけ。nullはunknown、0はconfirmed zero。component creditsを加算しない。CourseとMappingの構成単位が一致し、rowに値があればそれも一致した場合のみ完成判定する。row構成単位がnullのときは一致したCourse/Mapping値を使用し、原値nullはsourceRowsに残す。
- 1factは最大1 allocation。完成単位はsource aggregate以下。共通と専門の両方には配分しない。複数cardでの参照とoverall集計を分離し、既存の排他的bucket totalを利用する。
- exact official Courseがある場合のPlanner earned除外は既存policyを維持。planned / in_progressは投影に残し、waitingは残すが加算しない。未解決official identityは無関係なPlanner earnedのownerにならない。
- `deriveImportedAchievements`の実行consumerはPlannerPageの表示・区分・Media互換として維持。卒業計算からの呼出しを除去。source rowがなくcomponentしかないlegacy入力はgraduationへ昇格せず警告する。

### Schooling と保留範囲

公式rowの `schoolingCreditsTotal` はearnedと別量として保持し、linked schooling record idsを補助証拠として残す。通常の一意allocationで値・上限・除外・認定重複が確認できる範囲だけschooling参考値へ合成する。mixed4/2はearned4・schooling2、all-schooling4はcorrespondence Offeringが先でも4。component合計では再構成しない。

null、earned/compositionを超えるschooling、法律の＊印除外、認定schoolingとの重複未確認はevidenceを残して算入保留。professional recognitionの保存契約はannual Offeringベースなので、専門認定行が存在する場合はofficial専門factとの重複をこのsliceで断定せず保留する。認定自体の既存計算・永続形状は変更しない。

repeat、旧課程、公開科目、史学演習/概説/5科目移動/歴史資料学、地理段階配分、書道実技、partial例外、公式卒論とmanual thesisの統合はunknown。通常aggregateから回数や順序を推測しない。既存Planner special allocator / manual thesis / annual49は変更しない。

保留reasonは `curriculum_identity_unresolved`, `mapping_not_found`, `mapping_conflict`, `duplicate_official_rows`, `metadata_unknown`, `special_rule_evidence_required`, `out_of_scope`。unresolved earnedがある場合、cardとoverallにunknown理由を伝播する。安全に算入済みの値はpartial下限として保持し、保留分しかないreferenceを確定0にしない。out_of_scopeは確認済みの対象外として別扱い。

### GAP の変更と残件

|GAP|このsliceの結果|
|---|---|
|G1 / G2|validな独立exact Course identityについて、Offeringなし・legacy courseIdなし・template creditsなしでも通常算入可能|
|G3 / G4|officialはCourse全Mappingのsignatureを比較。Offering配列順・first templateで配分しない。Plannerの複数edge問題は別途|
|G5|official common/professional衝突を保留、同値edgeは1回。Planner/認定を含む全面ledger完成ではない|
|G6|通常範囲でmixed/all-schoolingを保持・反映。repeat/exclusion/認定重複/追加履修は保留（partial）|
|G7 / G8|categoryRawがあってもidentity警告を維持。unresolved aggregateをunknownとして伝播|
|G9 / G10|official優先dedupとplanned/in_progress/waitingの既存意味を維持|
|G11 / G12|認定architectureと特殊sequence/transferは未解決。公式aggregateはspecial allocatorへ投入しない|
|G13|複数公式rowを衝突として保持。別修得かsnapshot重複かの解決は未実装|
|G14|ambiguous CurriculumCourseのlegacy bypassを遮断|

元のauditテスト18件は削除・skipせず正しい期待値へ更新。Offeringなし0→4、混合schooling0→2、順序による4→0変化→完全不変、common/professional8→unknown、同値edge8→4、ambiguous legacy4→unknown、categoryRawによる警告消失→警告維持、nullと0の区別をassert。Plannerテスト中のlegacy-only/構成単位矛盾fixtureもunknownをassertし、卒論dedup fixtureには独立Course identityを付与して76単位の元assertionを維持した。

検証: `test:planner` **523/523**（既存469 + 新規54）、`test:extension` **19/19**。typecheck/lint成功。build成功、内包catalog:check成功（321 Course / 686 Offering）。既存の500kB超chunk警告あり。実catalogの全8 program scopeをOfferingゼロcloneでも検証。凍結したrow/record/item/catalog/profileに対する不変性も確認。

Preview: ローカルVite起動は成功したが、in-app browserのタブ作成がtimeoutし、再確認では接続browserが0件。実ユーザーstate、UI表示、consoleの検証は未完了。API/回帰テストの結果と区別する。

`graduationCheckComplete=false` / `sourceLinksReverified=false` / schema22を維持。PlannerState・JSON Schema・migration・persistent shapeの変更なし。

### Preview 続行時の追記（2026-10-03）

ブラウザー接続回復後、終了していた開発サーバーを同じ `127.0.0.1:5178` のbuild済みPreviewへ切り替えて再確認。Plannerとプロフィールの描画、既存の計画2件（計6単位）、所属・入学情報の未入力表示、卒業可否を保証しない注意書きを確認した。成績表の修得済みは0単位、所属は未選択のため、実取込成績を使った卒業カード比較・二重加算・確認条件数の前後比較は未検証。プロフィール値や履修データは変更していない。

終了済みdevサーバーに接続していた時点ではHMR切断、遅延import失敗、Homeの外部GAS/X timeout等がconsoleに残っていた。build済みPlannerの再読込後に新たなconsole error/warningは観測されなかった。これは確認した画面・操作範囲に限る。

## Follow-up: source-owned media method / earned attribution（2026-10-04）

この節は既存監査本文の訂正・置換ではなく、remote dev `904111d8156c2a1c51f613ac23b23726786c4fae` からの追加実装記録。branch: `feature/graduation-media-method-evidence`。対象はmedia/method evidenceのみ。

### 今回再確認した公式根拠

|公式source|確認箇所|確認した文言・意味|productionへ適用する範囲|
|---|---|---|---|
|[2026年度 学習のしおり](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=135)|冊子133頁 / PDF135頁「履修・成績通知書」の基本的な見方。公式PDFを取得し、該当ページを画像でも確認|「メ＝メディア」。修得単位は修得済み単位、S単位は修得済みスクーリング単位。登録・採点中の評価には＊が付く|`method=schooling`かつsource-owned `rawTerm`のtrim/NFKC後が「メ」の場合だけmethod証拠。marker自体は単位修得を証明しない。公式earned aggregateが別途必要|
|[メディアスクーリング公式説明](https://www.tsukyo.hosei.ac.jp/system/schooling/media.html)|HTML本文（頁なし）|インターネットを使うスクーリングであり、試験合格で単位修得。所属・入学年次による条件もある|履修方法と修得の区別。科目の通常卒業算入条件や個別要件を無条件に解除する根拠にはしない|
|[公式FAQ](https://www.tsukyo.hosei.ac.jp/faq/000-2)|スクーリング受講についての回答（HTML、頁なし）|メディアで修得した単位も、卒業に必要なスクーリング単位に含む旨を明記|安全にmediaへ帰属できる公式earned aggregateを、schooling不明時の計算用補完に使用|
|[卒業必要要件](https://www.tsukyo.hosei.ac.jp/system/requirements/)|卒業所要単位・スクーリング条件（HTML、頁なし）|卒業要件にはスクーリング単位条件がある|今回の補完は参考進捗の入力であり、卒業判定の完成を意味しない|
|[2026年度 学習のしおり・法律学科](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=49)|冊子47頁 / PDF49頁、注記cと＊印|データサイエンス科目等の＊印を除く専門教育科目から、スクーリング8単位を求める|既存の法律学科schooling除外guardを維持。全体30単位と専門8単位の配分軸の分離は今回実装しない（下記制約参照）|

全source linkを再検証したわけではないため、`sourceLinksReverified=false` を維持。

### Calculation-only contract

`OfficialGraduationFact.methodEvidence` に `media: confirmed | unknown | conflict`, `allEarnedCreditsAreMedia`, `recordIds`, `rawTerms` を追加。persistent stateには保存しない。

1. 独立したexact CurriculumCourse identity、一意または同値Mapping、通常bucket、構成単位の整合性、既存special/legacy/repeatable/認定重複guardを通過してから評価する。duplicateのmethod帰属は評価・解決しない。
2. `record.source === 'hosei_import'` と `record.sourceCourseId === officialRow.id` を要求。名前、Offering、orphanから別rowに証拠を転用しない。
3. 取込パイプラインは実質的証拠のある場合だけcomponentを作る。ただし `course-only:` fingerprintの通信互換rowは実際の通信学習証拠ではない。source detail（rawYear/rawTerm/date/credits/grade/examGrade/reports）が空の互換rowだけを除外。親sourceの再取込でfingerprintが変わっても、互換rowのprefixと直接link・空のsource detailで識別する。editable termや推定年度は互換rowを履修証拠に変えない。
4. 残る直接linked source recordsが1件以上あり、すべて `method=schooling` かつ `rawTerm.normalize('NFKC').trim() === 'メ'` であればmedia confirmed。媒体名の曖昧一致・同義化は行わない。`メディア`、`MEDIA`、`前期メディア`等は不採用。
5. mediaとその他のsource component（通常スクーリング、期不明のスクーリング、実質的通信記録等）が混在すればconflict。通信の採点待ち・リポートのみでも既存 `hasCorrespondenceEvidence` の意味を尊重する。component単位をsum/max/latestで選び、混在を解決しない。
6. media confirmedと正のofficial `earnedCreditsTotal`の両方で、全official earnedをmedia-earnedへ帰属する。複数media componentでも予算は公式aggregateを一度だけ使う。component creditsは修得合計へ加算しない。
7. `mapping.mediaOnly` は制度上必要なmethodであり、履修履歴の証明ではない。mediaOnlyの正単位は上記帰属を要求。unknownは `special_rule_evidence_required / method_evidence_required`、混在は `special_rule_evidence_required / method_evidence_conflict` でallocationを保留。
8. `term`は編集可能なのでauthorityにしない。`selectedOfferingId` / `offeringId` / `Offering.deliveryCategory` / 年度別開講はhistorical methodの根拠にしない。既存identity validationは維持。

### Schooling優先順位・zero/null/positive

- 明示されたofficial `schoolingCreditsTotal`を優先し、factの`schoolingEvidence.source=official_row`と`sourceRows`に保持。
- nullの場合だけ、上記の全media-earned帰属を使って`schoolingEvidence.source=media_earned`, `credits=earnedCreditsTotal`を計算用に補完。source rowのnullを書き換えない。
- 明示0（および全media-earnedと食い違う他の明示値）は補完しない。`media_schooling_credits_conflict`と`schooling_evidence_requires_confirmation`を追加し、allocationのschoolingはnullにする。安全な通常卒業単位は算入し、既存の`schooling_confirmation`を使用する。
- 既存の上限validation、法律学科除外、認定schooling重複guardは補完後にも適用する。
- earned=0はmethod holdを要求せず、通常0 / schooling0。source evidenceは保持し、graduation warningなし。earned=nullはmetadata unknown / `credits_unknown`のままで、componentから修得単位を作らない。earned>0だけ修得帰属による補完対象。
- mediaOnly=falseにも同じschooling evidence projectionを使用する。通常Mappingをmedia必須に変えず、既知の通常スクーリング値や既存allocationを維持する。

|合成入力（他のguard通過）|従来|変更後の通常単位 / schooling単位|表示|
|---|---|---|---|
|mediaOnly, earned2, schooling2, rawTermメ|method保留|2 / 2|allocation_held解消|
|mediaOnly, earned2, schooling null, 純media|method保留|2 / 2（計算用補完）|両確認不要|
|mediaOnly, earned0, schooling null, rawTermメ|進捗0、警告なし|0 / 0|警告なしを維持|
|earned null, rawTermメ|修得不明|unknown / unknown|credits_unknown|
|mediaOnly, earned4, media2 + 夏2|method保留|unknown / unknown|allocation_held、method conflict|
|mediaOnly, earned2, schooling明示0, rawTermメ|method保留|2 / unknown（sourceは0）|schooling_confirmation|
|mediaOnly, earned4, 純media複数|method保留|4 / 4（componentの合計ではない）|両確認不要|

### 現dev catalogの代表3科目

全3科目のcurriculumCredits=2、mediaOnly=true、schoolingOnly=false。productionにこの3科目名の条件分岐は追加していない。

**データサイエンス入門A** — CurriculumCourse id: `curriculum:13f927d9-f1b4-4994-aea3-b901ea666ee9`, curriculumCredits: 2

|mappingId|scopeId / 所属|category|field|requirementType|mediaOnly|schoolingOnly|
|---|---|---|---|---|---|---|
|13f927d9-f1b4-4994-aea3-b901ea666ee9|aafa0eb9-e158-461c-9b15-83e41da1830d / 日本文学科・芸能文化コース|専門教育|null|選択|true|false|
|659dfa75-8117-4810-80b5-cec57391f534|74e81655-5390-4980-984d-e4580f28594d / 日本文学科・言語コース|専門教育|null|選択|true|false|
|75cc2f69-2eb6-4567-bad1-9790748fe613|d242111d-f0c1-420b-a41f-a33a14d15909 / 日本文学科・文学コース|専門教育|null|選択|true|false|
|83c1d404-183b-423a-b31f-844879f6c561|e31201f3-4f1d-432a-906e-6af94af294c9 / 法律学科|専門教育|null|選択|true|false|
|85928b36-0a6b-48c1-b1e9-1cf680b4b9f4|3641eb3c-91bd-4094-a56e-6e0f0da660f5 / 経済学科|専門教育|null|選択|true|false|
|8b496d30-7d56-45a3-a3d9-6d5e47545e80|6609ce7c-3d7a-423e-9f19-7841dd841ca9 / 商業学科|専門教育|null|選択|true|false|
|9733b520-7ba0-461e-b28b-760b27b3989e|118c5183-6aec-4fa1-905a-265f25d86db1 / 史学科|専門教育|null|選択|true|false|
|d4860e8c-dd77-484d-ac89-3d6e2ba23d79|4d450b06-fb99-4bf2-a769-fe5f68dd337a / 地理学科|専門教育|null|選択|true|false|

**データサイエンス応用基礎B** — CurriculumCourse id: `curriculum:0a477578-9769-4097-9107-30256649dbd1`, curriculumCredits: 2

|mappingId|scopeId / 所属|category|field|requirementType|mediaOnly|schoolingOnly|
|---|---|---|---|---|---|---|
|0a477578-9769-4097-9107-30256649dbd1|4d450b06-fb99-4bf2-a769-fe5f68dd337a / 地理学科|専門教育|null|選択|true|false|
|56d01222-3499-452b-b250-02787a8febcf|6609ce7c-3d7a-423e-9f19-7841dd841ca9 / 商業学科|専門教育|null|選択|true|false|
|7117d9d8-bcfa-4a95-8c20-83c31114d6d0|e31201f3-4f1d-432a-906e-6af94af294c9 / 法律学科|専門教育|null|選択|true|false|
|af123fa5-ef5c-40f0-85d8-e897b88518e8|aafa0eb9-e158-461c-9b15-83e41da1830d / 日本文学科・芸能文化コース|専門教育|null|選択|true|false|
|b532b2f1-947c-406f-8604-2553f82eb4cf|74e81655-5390-4980-984d-e4580f28594d / 日本文学科・言語コース|専門教育|null|選択|true|false|
|d77f69e4-f044-4d03-a889-d66f22dcd563|118c5183-6aec-4fa1-905a-265f25d86db1 / 史学科|専門教育|null|選択|true|false|
|d7c71990-717c-4d0f-b72a-2515319d3b6f|3641eb3c-91bd-4094-a56e-6e0f0da660f5 / 経済学科|専門教育|null|選択|true|false|
|ee9abba5-ad4d-4571-819e-56127326e8c8|d242111d-f0c1-420b-a41f-a33a14d15909 / 日本文学科・文学コース|専門教育|null|選択|true|false|

**生物学2** — CurriculumCourse id: `curriculum:a8eeeac4-5ecd-417d-b1fc-fb0311770703`, curriculumCredits: 2

|mappingId|scopeId / 所属|category|field|requirementType|mediaOnly|schoolingOnly|
|---|---|---|---|---|---|---|
|a8eeeac4-5ecd-417d-b1fc-fb0311770703|0aa8cc58-04cd-40c8-aad1-0975d4b55f9c / 共通|一般教育|自然|選択必修|true|false|

### 検証・制約・残件

- 新規mediaテスト50件。明示2/null/0、earned0/null、rawTermと編集termの分離、trim/NFKCと不採用marker、通常S/通信混在、実importのcourse-onlyとpending exam、wrong link/orphan、ambiguous identity、duplicate、純media複数、通常Mapping、同値/非同値Mapping、Offering順序・削除、凍結入力、既存special/legacy/repeatable/認定/除外guard、実catalog3科目×全8所属scopeを検証。
- `npm run test:planner`: **605/605 PASS**、skipなし（既存555 + 新規50）。G1/G3/G5/G6/G14、PR #66までのsource-credit semantics、warning taxonomy、UX cleanupを含む既存テストは削除・skip・期待値弱体化なし。
- `npm run test:extension`: **19/19 PASS**。`npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`: PASS。build内catalog:check成功。既存の500kB超chunk警告あり。
- Preview: in-app browserは `Browser is not available: iab`、接続一覧もapps/browsersとも0件。Planner実画面・GraduationProgress描画・ブラウザーconsoleは未検証。合成fixtureで通常参考値・schooling参考値・警告taxonomyを計算APIまで検証した結果と区別する。
- 法律学科のデータサイエンス2科目は、media method holdが解消し通常2単位となるが、既存の `LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026` guardによりschooling確認は残る。他7scopeでは純mediaで通常2 / schooling2。生物学2は全8scopeで通常2 / schooling2。冊子47頁の＊印は専門スクーリング8単位の対象制限であり、全体30単位からの一律除外を意味すると今回断定していない。既存エンジンの全体schoolingと専門schoolingの軸の分離は別sliceの残件として明示する。
- duplicate official rowsは未変更・未解決（aggregate null、allocationなし）。認定architecture、旧課程、特殊sequence、repeatable、thesis統合も未解決。
- 実ユーザー32科目のlocalStorageは保有していない。実件数・schooling参考値の増加量は推測しない。merge前に実データで対象3科目のallocation_held解消、算入可能なmediaのschooling加算、未修得非加算、duplicate継続保留、consoleを確認する。
- `graduationCheckComplete=false`, `sourceLinksReverified=false`, `schemaVersion=22`を維持。PlannerState、persistent shape、migration、bookmarklet/extension変更なし。通常commit・通常pushのみ、main/devへの直接commit・mergeなし。

## Follow-up: explicit official schooling aggregate priority（2026-10-04）

前節の履歴は保持し、このfollow-upではofficial schooling aggregateの優先順位だけを修正した。開始時remote devは `b3951395341b202ae9325afd32c50e93f676e81b`（PR #67のbookmarklet変更を含む）、remote featureは `601377f6cf26ec11d83cc0f7cd51883ec5e461c0`。featureへの第三者追加commitはなし。featureの元のbaseおよび最新devとのmerge-baseは `904111d8156c2a1c51f613ac23b23726786c4fae`。既存feature上で続行し、更新devのmerge/rebaseはしていない。

production変更は `officialGraduationFacts.ts` の `schoolingConflict` 条件と説明コメントのみ。media-earnedと公式schoolingの不一致全般を衝突にしていた条件を、`mediaEarned && row.schoolingCreditsTotal === 0` に限定した。

|official earned|official schooling|他guard通過時の通常 / schooling|schoolingEvidence.source|警告|
|---|---|---|---|---|
|2|2|2 / 2|official_row|なし|
|2|null|2 / 2|media_earned|なし、source rowはnullのまま|
|2|0|2 / null|official_row|schooling_confirmation。明示0保持、media_schooling_credits_conflictとschooling_evidence_requires_confirmation|
|2|1|2 / 1|official_row|なし。media推論で2へ上書きもnull化もしない|
|4|2|4 / 2|official_row|なし。media推論で4へ上書きしない|
|2|3|2 / null|official_row|既存上限validationによりschooling_confirmation|
|0|0|0 / 0|official_row|なし|
|null|null|unknown / unknown|unknown|credits_unknown、componentからearnedを生成しない|

有効なpositive official schoolingはmedia推論より優先し、値の不一致だけでユーザー確認を要求しない。negative/non-finite/earned・composition上限違反や既存guard違反は引き続きschoolingを保留し、nullへの置換後にmedia補完へfallbackしない。nullの公式値だけ、安全なsource-owned media methodと正のofficial earned帰属による計算用補完を許す。通常Mappingでも同じ優先順位を維持する。

rawTermのexact「メ」marker、直接sourceCourseId link、source= hosei_import、trim/NFKCのみ、editable term/Offering非authority、component非加算、duplicate保留、recognition/legacy/special/repeatable/thesis/out_of_scope/mapping等の契約は変更していない。`LAW_SCHOOLING_EXCLUDED_CANONICAL_NAMES_2026` と認定schooling overlap guardも変更なし。全体schooling30と法律専門schooling8の軸分離は別sliceのまま。

既存605ケースを削除・skipせず保持した。旧不一致テストのschooling=1は依頼された正常算入を厳密にassertするよう訂正し、0と不正値の保留assertを維持。media conflict diagnosticは0だけ、不正値は既存validation diagnosticをassertする。新規15ケースはA–H、negative/NaN/±Infinity、通常Mappingの夏/メ、positive official値に対する法律/認定guard。A–Hと不正値では凍結入力とsource rowの不変性も確認する。

`graduationCheckComplete=false`、`sourceLinksReverified=false`、`schemaVersion=22`、persistent state shapeはすべて維持。公式sourceの追加再検証、UI、extension、bookmarklet、認定architectureの変更なし。通常commit・通常pushのみ。merge・PR作成なし。

検証: `npm run test:planner` **620/620 PASS**（既存605 + 新規15、skip0）、`npm run test:extension` **19/19 PASS**。`npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check`もPASS。build内のcatalog:checkは321 Course / 686 Offeringで成功。既存の500kB超chunk警告のみ。検証対象はこのfeatureのfollow-up差分であり、更新されたdevとの統合後検証やユーザー実データのPreview確認ではない。
