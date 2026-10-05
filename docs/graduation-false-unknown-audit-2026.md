# Graduation false-unknown audit — 2026

## 1. Executive summary

2026-10-04、最新remote `origin/dev` **d5c28e07187787ba805da7b749ede4c140d280a9**をfetchし、新規 `audit/graduation-false-unknown` で監査した。PR #68を含むdevが基準。旧feature/integration commitを直接baseにしていない。開始時working treeはclean。

production behaviorは変更していない。本書とread-only characterization helperだけを追加する。**安全に解けるunknownを限定する監査であり、卒業可否を確定する監査ではない。**

inventoryは**66監査項目**。内訳：A **18** / B **6** / C **18** / D **7** / E **17**。P1 **29** / P2 **35** / Backlog **2**。

数え方は「原因または伝播の独立した判断単位」。同一コードの異なる原因は分割し、同じfamilyの複数学科への展開はまとめた。66はenum数、警告表示件数、独立バグ数ではない。Aの必要な防御、隣接画面の境界確認も含む。P1の29件は**保護すべき安全gateを含む優先度**で、29個の修正必須バグという意味ではない。B/EのP1候補は9件。実ユーザーの発生件数・頻度は測定していない。

最重要のfalse-unknown候補は次の5群。修正はまだ行っていない。

1. **H38/H37/H36：既知ordinaryの消失と軸混同（E/P1）**。認定外国語4がS認定nullだけでordinary表示までnullになる。一般認定の未知増分や法律の卒論選択未定も、既知の修得量まで隠す。
2. **H12：法律の公式partial2（B/P1）**。正確な別Courseで選必8科目32を満たしても、C4/O2/S2のofficial行は入口で保留。既存の下流例外へ届かない。
3. **H57/H60：単純な完成科目までspecialCourseが遮断（B/P1）**。書道実技C2/O2/S1以上、史学概論C4/O4/S0を実catalogで再現。
4. **H14：認定専門が1件あるだけで全専門officialを保留（B/P1、限定解除）**。両側identityを一意に正規化でき、非重複を証明できる科目まで止まる。曖昧な認定は引き続き保留する。
5. **H19：法律の専門S8除外を全体S30へ流用（E/P2）**。公式の＊印はS8側の条件。Fだけ解除すると下流S8に誤加算するため、両axisの同時分離が必要。

次の実装sliceは **H38だけに限定した「認定外国語のordinary4保持とS確認状態の分離」** を推奨する。既存profileを使い、S未確認を達成へ変えず、消えている既知量を表示・下限計算へ戻す小さい変更から始める。

## 2. Scope / invariants

- 読取対象：official facts、graduation progress、notices、profile/認定、import contract/apply/identity/repair/migration、Course/Mapping/Offering、catalog requirements、history/geography/repeatable/public/thesis、UI consumers、既存audit/tests。
- `OfficialUnknownReason`, `hold(`, `allocation_held`, `credits_unknown`, `schooling_confirmation`, `schooling_evidence_requires_confirmation`, `special_rule_evidence_required`, `metadata_unknown`, `mapping_conflict`, `duplicate_official_rows`, `curriculum_identity_unresolved`, `out_of_scope`, `recognized_overlap`, `method_evidence_required`, `method_evidence_conflict`をrepoで検索。別名の`unknown()`, `manual_review`, `unknownReasonCategory`, `uncertain`, `mediaPending`, `CourseCompletion`も追跡した。
- `graduationCheckComplete=false`、`sourceLinksReverified=false`、`PlannerState.schemaVersion=22`をhelperと既存testで確認。persistent state shape、src、catalog、既存tests、package scriptsは変更しない。
- official earned正本は`ImportedCourseAchievement.earnedCreditsTotal`。componentとaggregateを加算しない。Offering/編集termはhistorical method authorityではない。`Course.mappingIds`をallocation authorityとして維持。
- 入力を深いcloneで作る監査helperのみ。実ユーザー保存stateにはアクセスしない。計算前後の入力deep equalityを検証。
- 今回のhelperは**現状の欠陥を含むcharacterization**。将来の実装修正で期待値を更新する対象であり、現状保留を恒久仕様に固定するテストではない。
- catalog実数：制度Course **321**、annual Offering **686**、legacy/provisional Course **209**、Mapping **502**、requirements **182**（structured142 / unsupported40）。制度Course identityを持たないOffering70（候補あり32 / なし38）と、catalogのmapping unresolved38は別指標。
- CurriculumVersion/年度placement相当は2026 catalogとprofile applicability、source/identity relationsで表現される。学修履歴ごとの一般化された課程version台帳は存在しない。現行Course idがあるだけで旧課程の適用まで証明しない。

参照略号（行番号は監査baseのもの）：

|略号|ファイル / 主要関数|
|---|---|
|F|`src/planner/officialGraduationFacts.ts` / `deriveOfficialGraduationFacts`, `deriveMethodEvidence`, `specialCourse`, `officialFactCreditState`|
|G|`src/planner/graduationProgress.ts` / `evaluateStructured`, `professionalCards`, `groupedCards`, `applyRecognition`, `referenceProgress`, `calculateGraduationProgress`|
|I|`src/planner/curriculumIdentityValidation.ts` / `validImportedCurriculumIdentity`、`officialCourseCredits.ts` / `exactImportedCurriculumId`|
|P|`src/planner/graduationProfile.ts` / validation, prefill, recognition totals|
|N|`src/planner/importedGraduationNotices.ts` / `importedGraduationNotices`|
|G-S / G-ref|Gのschooling / reference consumer。UIはいずれも`src/components/planner/GraduationProgress.tsx`|

## 3. Hold producer inventory

`ordinary`は卒業ordinary axis、`schooling`はS axis、`both`は両方。`completion only`は達成状態・表示・手続だけ（全卒業判定のtrueを意味しない）。同じ保留で数値を残すかnullにするかは§4–5に分ける。H54など隣接画面は卒業計算へ逆流しない。

|ID|hold / diagnostic / warning code|producer（ファイル略号・関数/行）|current trigger|blocks|consumer|
|---|---|---|---|---|---|
|H01|curriculum_identity_unresolved|F130 / I|exact_uniqueの有効な制度Courseを得られない|both|N,G|
|H02|curriculum_identity_unresolved（annual依存）|I / F130|独立exact Courseがあるのに選択Offering消失・relation変更|both|N,G|
|H03|duplicate_official_rows / conflicting_source_rows|F131|同Courseに異なるsource row idが2以上|both|N,G|
|H04|mapping_not_found|F133|mappingIds空または1個でも未解決ref|both|N,G|
|H05|out_of_scope|F134|選択scope/commonへの候補なし|completion only（対象外）|N情報表示|
|H06|mapping_conflict|F136|候補signatureが2種類以上|both|N,G|
|H07|metadata_unknown：earned null|F138–142|earnedCreditsTotal=null|both|N credits_unknown,G|
|H08|metadata_unknown：composition|F138–142|Course構成値欠落/非正値、Mappingまたはrowと不一致|both|N,G|
|H09|special_rule_evidence_required / unsupported_basic_bucket|F143–150|一般field/外国語field/体育名/専門typeが許容集合外|both|N,G|
|H10|special_rule_evidence_required：specialCourse包括|F82–92,151|名称familyを一律trueにする|both|N,G|
|H11|special_rule_evidence_required：earned>composition|F152|公式earnedが構成値を超える|both|N,G|
|H12|special_rule_evidence_required：法律partial|F153 / G931|専門0<earned<compositionで入口hold|both|N,G|
|H13|special_rule_evidence_required：文学partial|F153 / G1190|日本文/史学/地理の専門partial|both|N,G|
|H14|special_rule_evidence_required / recognized_overlap|F157–159|professionalCourses.length>0で全専門hold|both|N,G|
|H15|method_evidence_required / method_evidence_conflict|F58–80,162–165|mediaOnly/Sonlyのpositive earnedで必要証拠なし/混在|both|N,G|
|H16|schooling_evidence_requires_confirmation：invalid|F172–181|Sが負/NaN/±Infinity；nullで安全mediaなし|schooling|N,G-S|
|H17|media_schooling_credits_conflict|F170–176|safe positive mediaだがofficial S=0|schooling|N,G-S|
|H18|schooling_evidence_requires_confirmation：S上限|F177|S>earnedまたはS>composition|schooling|N,G-S|
|H19|schooling_evidence_requires_confirmation：法律除外|F178 / G967|法律かつ13名称setに一致|schooling|N,G-S,外国語にも伝播|
|H20|schooling_evidence_requires_confirmation：認定一律|F179–180|非first/nonunknown routeでS相当認定!==0（null含む）|schooling|N,G-S|
|H21|special_rule_evidence_required：recognizedExemption|F151–152|row認定・免除>0|both|N,G|
|H22|profile validation error|P validation / G1026|負値/非有限/上限超/内訳>合計/矛盾する免除等|both（reference）|G-ref,設定UI|
|H23|適用課程未確認|G1027|curriculumApplicability=unknown|completion only（現在reference数もnull）|G-ref|
|H24|旧課程・経過措置|F151 / G1028 / catalog legacy|legacy_or_transitionまたは名称旧課程|both|N,G|
|H25|入学区分・認定内訳未入力|G1029–1030,applyRecognition|route unknown/transfer認定なし/外国語体育mode unknown|both（主に認定分）|G-ref/common cards|
|H26|条件または例外を安全に自動評価できません|G195 CONDITION_ALLOWLIST|effective keysが許可組合せ外|completion only / 対象axis|requirements/UI|
|H27|対象集合を一意に特定できません|G196 targetIsClear|target key/typeが未対応|both（当該rule）|requirements/UI|
|H28|修得順未確認|G197,historySeminarCards|史学演習targetまたはearnedOrder欠落/非連続|both（史学配分）|史学cards/requirements|
|H29|必要値なし / unit未対応|G198–200|value=null、ruleTypeからunitを得られない|completion only|requirements/UI|
|H30|対象科目mappingなし（annual検索）|G201–212|annual targetMappingIds空かつofficialMatched空|completion only|requirements/UI|
|H31|修得済み対応確認中の全体伝播|G225,groupedCards,professionalCards|どこかのearned Offeringがmanual_review|both（無関係bucket含む）|requirements/cards/ref|
|H32|単位数不明の開講でrule全体unknown|G226|matched.some credits=null、plannedも含む|both（earnedとprojection混在）|requirements/UI|
|H33|全単位修得条件の構成単位不明|G242|full_course条件でmapping curriculumCredits null|ordinary|requirements/UI|
|H34|professional ambiguous / incomplete / legacyRepeatable|G professionalCards baseReason|区分/field複数、構成値不明、legacy繰返し|both（professional）|professional cards/ref|
|H35|overflow / professional target metadata不明|G electiveOverflowRule,target helpers|厳格な条件metadataに一致せずnull|ordinary/completion|professional cards/ref|
|H36|reference prerequisiteの軸混同|G1024,1131|law thesis未定等でO/Sのearned,targetを同時null|both（reference）|reference UI|
|H37|一般認定unknownで既知earnedもnull|G applyRecognition一般|一分野mode unknownかつminimum未達|ordinary|common card/ref|
|H38|外国語S認定nullでordinary4もnull|G applyRecognition外国語|認定4、言語既知、S相当null|ordinary（Sも未確認）|foreign card/overall ref|
|H39|同一言語未確認|G applyRecognition外国語|認定4でlanguage unknown|ordinary/completion|foreign card/ref|
|H40|orphan credits_unknown / officialUnknown|N35 / G1246|sourceCourseIdが現official行にない全record|both|N,G全域|
|H41|officialUnknown全カード伝播|G1291–1300|1件held/orphanでthesis以外全status unknown|completion only（既知数値は通常保持）|全cards/requirements/ref|
|H42|schoolingUnknown全外国語・法律S伝播|G1300–1304 / G258|どこかのofficial S nullで両card unknown|schooling/completion|foreign/lawS/ref|
|H43|ordinary holdで既知Sもallocation消失|F continue各所 / G1308|identity既知partial等でallocation未生成|schooling（O理由を流用）|global S/ref|
|H44|schoolingUnknown冗長branch / 認定cap重複|G1301 / P validation|officialUnknownに包含されるunknown fact条件；後段の同一cap|completion only|内部状態/validation文言|
|H45|他学科unsupportedも全scope表示|plannerHelpers requirementsForScope|status unsupportedなら全採用（retain_all_warnings policy）|completion only（表示）|requirements unknownCount/UI|
|H46|generic未知と専用calculator重複|G1270 / evaluateStructured / 専用cards|generic未対応のsame-language/cap/overflow等が専用計算と併存|completion only（主に表示）|unknownReasons/coverage|
|H47|4 warning kindsの優先順位/文言|N20–35|allZero→skip、positive有無→kindを1個だけ選ぶ|completion only（通知）|importedWarnings/UI|
|H48|allZero suppression / earned0→S0|F172 / N23 / GheldFacts|全source earned=0ならhold警告抑止、正常factはS0|completion only|N,G|
|H49|graduationEvaluation unknown / complete=false|plannerHelpers, G, catalog|常に最終卒業判定を確定しない|completion only|Planner全体/UI|
|H50|公開科目limit欠落|publicCourseRules / GpublicCourseCard|該当limitなし→cardなし；guidanceではunknown|ordinary/completion|cards/guidance|
|H51|guidance資格単位legacy identity hold|thesisGuidance 50–61|exact制度Courseでもannual/legacy分類できずunknown|completion only（卒論指導資格）|guidance UI、卒業数に流れない|
|H52|guidance不整合metadata|thesisGuidance 45–64|Planner未分類/null単位、構成値矛盾、公開limit欠落|completion only（資格）|guidance UI|
|H53|guidance year/date/report unknown|thesisGuidance year/valid/guidanceSteps|在学年次null、合格日なし、地理report提出null|completion only（手続）|guidance UI|
|H54|CourseProgress等のunknown表示|curriculumCourseProgress / curriculumCourseView / importedAchievementCalculations|null/未同定/duplicate/repeatable、mediaPending|completion only（別画面）|Course/import表示；卒業allocatorへ逆流しない|
|H55|specialCourse：卒業論文|F82 / GthesisProgressCard|official卒論を一律hold、manual thesis別源|both|N,G/thesis card|
|H56|specialCourse：基礎特講|F82 / GgroupedCards|単発もfamily全体も一律hold|both|N,G|
|H57|specialCourse：書道実技|F82 / GcompletedCurriculumCredits|公式C2/O2/S1以上でも名称でhold|both|N,G|
|H58|specialCourse：公開科目|F84 / publicCourseRules|名称/requirementType公開をhold|both|N,G/publicカード別源|
|H59|specialCourse：repeatable families|F85–87 / repeatableRules|部署別16定義にfamily一致|both|N,G|
|H60|specialCourse：史学概論通常完成|F88–89|単純な必修4の史学概論もprefixでhold|both|N,G|
|H61|specialCourse：史学演習/資料/概説/考古学|F88–89 / Ghistory専用|prefix全体をhold；一部はunsupported bucketが先行|both|N,G|
|H62|specialCourse：地理特殊群|F90–91 / geographyTransferRules|現地/地誌/人文自然演習/特講prefix|both|N,G|
|H63|unknownReasonCategory文字列分類|graduationSources classifyUnknownReason|認定文字が先にあれば本人情報；他はfallback未実装|completion only（表示）|coverage/UI|
|H64|選択programなし / thesis policy不明|G1234 / thesisSelection / thesisProgressCard|scope不正/未選択は空結果；policy不明はcardなし|completion only|卒業/設定UI|
|H65|special_rule_evidence_required：additionalEnrollment|F152|追加履修>0の行を全保留|both|N,G|
|H66|metadata_unknown：invalid earned|F138–142|earned負/NaN/±Infinity|both|N,G|

`scope_ids_differ_from_mapping_scopes`は**非blocking diagnostic**。Course.scopeIdsとMapping scopeの差を記録するが、既存契約どおりMappingを使う。独立holdとして数えない。`methodEvidence.media=unknown`も通常Mappingでは独立holdではなく、method制約又はS補完の条件にのみ使う。`media_earned`と`official_row`は出所でありwarning codeではない。

## 4. Hold consumer / propagation map

```text
公式aggregate rows + direct-linked records + Course.mappingIds + profile
  → deriveOfficialGraduationFacts
       ├ sourceRows / diagnostics / methodEvidence（sourceを変更しない）
       ├ allocations（ordinary credits / completedCredits / schoolingCredits）
       │    → generic requirements / grouped cards / professional cards
       │    → recognition overlay → capped ordinary reference
       │    → global S reference（official Sを別加算）
       └ unknown facts / out_of_scope
            → importedGraduationNotices → 4区分UI
            → heldFacts + orphan → officialUnknown
                 → thesis以外の全cards/requirements.status=unknown
                 → reference.status=unknown（正の既知下限は保持、0はnull）
            → schoolingUnknown
                 → foreign/law-S cardを無条件unknown
                 → S reference unknown
```

注意すべき異なる経路：

- `unknown(requirement, reason)`はearned/inProgress/plannedをすべてnullにする。対して後段`officialUnknown`はstatusを変え、通常は既存数値を保持する。両者を「ordinary消失」と一括して報告しない。
- `professionalCards.baseReason`はprofessional数値をnullにするが`normalEarned`等の内部値は残り得る。`countedOverallCredits`はcard nullを0として合計するため、表示の保留がreference下限の過小化に直結する。
- `applyRecognition`でforeign earned=null→referenceでは0。認定合計が無く内訳だけの場合、失われた4がaggregate remainderから戻ることもない（helperで確認）。referenceがpartialのまま小さい数値を示すケースがある。
- `requirementsForScope`はunsupportedを全件残す。**unsupported40件のscopeIdはnull**で、scopeLabelが学科を示しても現行の全件保持policyを通る。他学科の条件が「確認が必要な条件」に混ざる。scopeLabelの正本確認と正規化なしに単純削除しない。
- generic `unknownCount/unknownReasons`はrequirements由来。`coverageSummary`はcards由来。専用cardsが計算している外国語/overflow等と、generic未対応一覧は一致しない。UIの「未判定件数」は未解決の個人情報件数ではない。
- `thesisGuidance`の60/80/100単位資格判定は別engine。卒業合計には加算されないが、同じimport済みCourseをannualに戻して保留するH51がある。
- `deriveImportedAchievements`の仮想Offering/mediaPending、CourseProgressのpartial/unknownは表示互換経路。official graduationはそのsynthetic earnedを入力にしない。年間49、履修学年filter、学習途中のreport状態は卒業算入holdへ直結しない。

## 5. ordinary vs schooling separation / zero-null-positive matrix

以下は**通常の有効Course・Mapping・profile・他guard通過時**のfact allocation。Oは公式earnedのallocation入力で、構成完成が必要な最終bucketでは`completedCredits`を別評価する。

|earned E|schooling S|media|現在O / S|判定|
|---|---|---|---|---|
|0|0|null/なし|0 / 0|known zero、warningなし|
|0|null|なし|0 / 0|earned0 branch。S列を保存上0へ書換えてはいない|
|0|positive|任意|0 / 0|現コードは上限validationよりzeroが先。特殊S-only/不整合の原本意味はH18；合法性を保証しない|
|null|0/null/positive|任意|allocationなし|credits_unknown。Sがpositiveでも独立allocationなし（H43）。componentsでEを復元しない|
|positive|0|safe mediaなし|E / 0|0をunknownにしない（ただし法律/認定guardでnull化する例あり）|
|positive|0|safe mediaあり|E / null|explicit-zero conflict、official_row、schooling_confirmation|
|positive|null|safe mediaあり|E / E|media_earned、source rowのSはnullのまま|
|positive|null|safe mediaなし|E / null|O保持、S確認|
|positive|valid positive ≤ E,C|safe mediaあり/なし|E / official S|positive official優先。E2/S1、E4/S2でもmismatchだけでholdしない|
|positive|negative/NaN/±Infinity|safe mediaあり/なし|E / null|fallback禁止|
|positive|S>E又はS>C|任意|E / null|現validation。source意味の追加確認が必要|

主要guardのmatrix差：

|guard|E=0|E=null|E>0 / S=0|null S|positive S|
|---|---|---|---|---|---|
|identity/duplicate/mapping|factはholdでも全zero通知・global hold抑止|credits_unknown|allocation_held（out_of_scope除く）|同左|S単独もallocationなし|
|methodOnly|positive条件なので通常zeroは通る|metadata guardが先|method証拠なければboth hold|safe media条件あり|SonlyではS=Eが証拠、mediaOnlyはrawメが必要|
|law partial|zeroはpartial条件外|nullはmetadata|O2/S0は法律S2例外不可|証拠不足|C4/O2/S2も現在hold；完成8/32時だけB|
|law excluded names|正常0/0はzero branch優先|nullはmetadata|positive OとS0でもS null化|S null|公式positiveまでS null化|
|recognition S blanket|正常0/0はzero branch優先|nullはmetadata|routeと認定S null/positiveならS0もnull化|S null|official positiveもnull化|
|recognized professional|factはholdでも全zero警告抑止|nullはmetadata|別科目の認定1件だけでもboth hold|同左|同左|
|special/earned>C|zeroで名称holdはあり得るが通知抑止|nullはmetadata|earned>0はboth hold|同左|公式Sがあっても独立算入されない|
|orphan|component0でも常にcredits_unknown|unknown|同じ通知|同じ通知|componentからS/ordinaryを卒業算入しない|

**O known/S unknown → Oまでunknownにしない**、**Oの構成未完成/S known → S eligibilityを独立監査する**、**threshold不明 → 実績値まで消さない**の3点が改善候補。真の未同定Courseや重複行ではどちらも確定できない。既知下限が閾値以上でも、排他的配分や上限・他の必須条件が未確定なら「卒業達成」へ昇格しない。

## 6. Classification A–E table

A=Safety invariant、B=existing system-owned evidenceで限定的に解決可、C=official-source/意味対応の追加検証、D=個人の追加データ、E=dead/redundant/conflated。分類は主原因に1つ付与。Bの条件を満たさない入力まで自動解決可能と主張していない。Cを利用者への質問へ転嫁しない。

|ID|classification|beta priority|required information|existing evidence|official source needed|user input needed|risk if auto-resolved|recommended next action|
|---|---|---|---|---|---|---|---|---|
|H01|A|P1|矛盾のない制度identity|row候補・Course・crosswalkはあるが曖昧な組は未解決|読替え時のみ必要|曖昧な実修得は原本の科目コード等|誤科目算入|keep|
|H02|E|P1|制度identityとannual整合を分離|rowのexact id・候補・Courseは残る|不要。矛盾する制度idはH01へ|不要|annual矛盾まで無条件無視すると誤同定|implement：annual欠落のみ切り離す|
|H03|A|P1|snapshot重複か別修得か|id/fingerprint/capturedAt/recordsはあるが恒久attempt idなし|repeat制度には必要|必要時のみ別修得の原本|sum/maxによる水増し・欠落|keep；dedupeは別slice|
|H04|A|P1|権威あるCourse→Mapping|Course.mappingIds。欠損edgeのscopeは判らない|catalog修復に必要な場合あり|原則不要|欠損が他scopeと推測して無視すると誤配分|keep / catalog修復|
|H05|A|P2|所属課程と対象範囲|Course.mappingIdsと選択scopeで確定|不要|不要|対象外の卒業加算|keep；unknownとは分離|
|H06|A|P1|同一allocation semantics|7要素のmetadataあり；本当の差は未解決|意味差の検証に必要|原則不要|共通/専門の二重加算|keep；同値edgeは既に統合|
|H07|D|P1|公式earned aggregate|componentsは存在しても代替正本ではない|一般資料では個人の値を解けない|再取込・公式成績の修得単位|nullを0/推定値にすると誤算入|user-input（再取得優先）|
|H08|C|P2|適用課程での正式構成単位|Course・Mapping・rowに別々の値；矛盾は選べない|要：科目・課程の正本|通常不要|都合のよい大きな値の採用|research；矛盾中はkeep|
|H09|C|P2|bucketの意味と専用配分|MappingにはS必修等のtypeもある|要：史学・地理等の配分|通常不要|通常bucketへ押込む誤配分|research / 専用allocator|
|H10|E|P2|familyごとに異なる条件|H55–62の情報が混在|family別|family別|一括解除でthesis/repeat二重加算|delete/consolidate：理由を分解|
|H11|C|P1|累積familyか通常科目の異常か|aggregate/records/REPEATABLE_CREDIT_RULES|要：累積列と回数の対応|原本にないattempt区別だけ必要|超過を全加算すると過大|research；通常科目はkeep|
|H12|B|P1|完成選必8科目32と当該C4/O2/S2|正確な別Courseとofficial aggregatesで条件を検証可能|確認済S47；追加不要（通常課程限定）|不要|8科目未達/通信2を許すと過大|implement：法律例外専用配分|
|H13|A|P2|構成完成または教授会の特例判断|earned/compositionは判るが承認はない|S68確認済；承認の個人事実は別|特例利用時は大学判断結果|80+2を自動82扱い|keep ordinary；候補表示とSは分離|
|H14|B|P1|当該Courseと認定科目のoverlap|認定courseId/offeringIdを一意crosswalkできる部分集合がある|非重複の単位枠は確認済；曖昧認定は保留|一意identityが既存なら不要|認定名だけで非重複扱いすると二重加算|implement：一意に非重複な科目だけ解除|
|H15|A|P1|対応する学習方法の直接証拠|source/rawTerm/link/pure records、official S=earned（Sonly）|rawTermメはS133確認済|原本に方法が欠ける時のみ必要|Offering/編集termをauthorityにすると誤算入|keep；mixed/wrong-linkを緩和しない|
|H16|A|P1|有効なS aggregate|invalidは矛盾；nullには証拠なし|個別値は原本再取得|nullならS列の再取得；invalidならparser/原本調査|invalidをmediaで上書き|keep；Oは残す|
|H17|A|P2|矛盾の解消|raw row0とmedia証拠の両方がある|列意味/原本の再検証|必要時だけ正しい原本|明示0を推論で消す|keep；Oは残す|
|H18|C|P2|S列と追加S-only単位の意味|row各列・追加履修・認定別行の証拠|要：S32,S133は一般的な単純上限制約を証明しない|制度確認後にも個別欠落があれば原本|全超過を許す/全超過を異常と断定|research；現guardは解除しない|
|H19|E|P2|全体S30と専門S8の別eligibility|Course名・Mapping・公式S、S47の印|S46–47/S68確認済|不要|入口だけ解除すると専門S8へ誤加算|implement：両consumer同時にaxis分離|
|H20|E|P2|個々のSの由来と認定overlap|profile Sと通常row、認定S専用行が別（S133）|別行仕様確認済；移行/特殊行は追加検証|既存非重複証拠が十分なら不要|認定S二重加算|implement：認定budgetと通常Sを分離|
|H21|C|P1|ordinary earnedと認定欄の独立性/overlap|row認定欄・earned・profile|S133列定義確認；実データの対応は要確認|対応不明な個人認定書のみ|認定をearnedへ再加算|research；公式earnedを再構成しない|
|H22|A|P1|整合したprofile|保存値とvalidationで検出可|不要|誤入力の修正が必要|invalid recognitionを加算|keep；既知official下限はH36|
|H23|D|P1|個人の適用課程|admissionYearだけでは復籍等を確定不可|移行ルールはH24|適用課程通知・復籍等の履歴|入学年だけで現行課程を適用|user-input；数量消失はH36|
|H24|C|Backlog|制度versionと経過措置|現catalog2026単体、profileに粗い区分|要：旧課程/読替え/再入学正本|個人への適用履歴は必要|現行Mappingへ流用|research；keep|
|H25|D|P1|入学区分と個人認定値|profile未入力はsystemにもない；routeだけでは一意でない|S30/R認定表確認済|認定通知の合計・内訳・S相当|未入力を0/一律7,15にする|user-input；既知下限は保持候補|
|H26|C|P2|条件評価器|catalog conditionsはあるが未実装；H46に専用経路あり|残余条件は要確認|原則不要；手続の事実のみH53|キーを無視して達成|research/実装；重複はH46|
|H27|C|P2|対象集合の正規化|Mapping fieldとcatalog targetは既存|意味が異なる集合は要確認|通常不要|雑な名称/field置換|research；exact metadataで解く|
|H28|D|P2|正式な修得順序|手入力orderが有効なら専用経路可；年度/termは順序authorityでない|S53確認済|履修順が原本・recordsに無い時必要|演習1必修と3/4選択の誤配分|user-input；既存順の再質問はH46|
|H29|C|P2|公式threshold/単位種別|catalogは不足または別専用rule|必要値欠落は公式確認|不要|target0扱いで達成|research / 専用ruleへ委譲|
|H30|B|P2|制度Courseとnamed requirementのexact関係|Course/Mappingはannualなしでも存在し得る|同一exact Courseなら追加不要|不要|fuzzy nameで要件対象を増やす|implement：制度catalog lookup|
|H31|E|P1|影響先の範囲|候補Mappingにより限定できる場合あり|不要；集合不明は全域hold維持|engine制約をユーザーへ聞かない|本当に候補不明まで限定するとfalse positive|implement：既知下限と影響範囲|
|H32|E|P2|earnedと将来量それぞれ|item.statusは既存|不要|手入力earned不明の時のみ必要|未知plannedをearnedへ補完|implement：軸/時点別unknown|
|H33|A|P1|構成完成に必要な正式値|Mappingはnull、official別guard|catalog欠落は要確認|原則不要|部分修得を完成扱い|keep / catalog修復|
|H34|A|P1|一意な配分・構成・repeat回数|annual mappings/orderは部分的|repeat/specialは要確認|欠ける修得順だけ必要|先頭Mapping選択・repeat過大|keep真の衝突；広域伝播はH31|
|H35|C|P2|閾値・排他的移動先・必要単位|structured ruleが正しい場合は利用済|欠損/変更時要確認|不要|超過分二重配分・target0|research；guard維持|
|H36|E|P1|未確定targetと既知修得量を分離|O/S実績・S30一定は既存|S68確認済|thesis選択はO targetのみ；Sには不要|適用課程不明まで現行目標を確定|implement：law選択未定から限定分離|
|H37|E|P1|未知認定増分と既知修得下限|official allocations・既知認定は存在|不要（下限保持のみ）|未知の認定内訳はH25|既知下限を達成確定と扱う|implement：known lower bound|
|H38|E|P1|言語ordinaryとSの別状態|認定4と言語はprofileに確定済|R/S45確認済|Sを解くには個人値；ordinaryには不要|外国語要件全体を達成にする|implement：ordinary4保持、Sはhold|
|H39|D|P2|1言語の認定内訳|credits4だけでは英独仏内訳不明|R認定表のみでは個人値なし|認定言語|英2独2を英4扱い|user-input；数量下限と要件別表示|
|H40|A|P1|元official aggregateと直接link|component/コピーaggregateは元行authorityではない|一般資料では元行を復元不可|旧成績の再取込/原本リンク|内訳を足してearned生成|keep source guard；広域表示はH41|
|H41|E|P2|どのaxis/bucketに残余budgetがあるか|exact identity/mappingを持つheldもある|不要|不要|本当に所属不明のbudgetを見落とす|implement：依存範囲限定|
|H42|E|P2|同言語・専門S8に影響するか|当該fact mappingとCourseは既知|不要|不要|S未知を0として達成確定|implement：S対象別伝播|
|H43|E|P2|global S資格とordinary完成の分離|公式Sはあってもallocationsに流れない|S31–32/68；例外ごと検証|新入力は通常不要|すべてのspecial row Sを無条件加算|implement：限定familyから別axis|
|H44|E|Backlog|同じ条件の重複除去|前段guardで既に保証|不要|不要|前段契約変更時だけ注意|delete/consolidate|
|H45|E|P2|公式資料とscopeLabelの確実な対応|unsupportedのscopeIdはnull；scopeLabel/ruleId/資料頁は既存|不要|不要|scope不明ruleまで消す|consolidate：公式scope確定後に他scope除外|
|H46|E|P2|専用実装のcoverageと残余条件|cardsは既存、全条件達成を保証するcoverage manifestなし|未対応残余はC；既存部分は不要|手続/順が欠ける場合だけ必要|cardの合計達成を全条件達成と誤同一視|consolidate：確認済coverage部分のみ|
|H47|E|P2|不明量・対象外・算入済み量の区別|fact creditState/diagnostics/actual allocation|不要|不要|partialなのに通常卒業単位算入済みと誤案内|implement：原因とaxisとamount表示|
|H48|A|P2|known zeroとunknownの区別|source値0は明示|S>0同居の特殊列意味はH18|通常不要|ゼロをunknown扱い/異常Sを見逃す|keep通常0/0；矛盾0/positiveは調査|
|H49|A|P1|全要件・手続・適用の保証|部分engineのみ|全source audit未実施|個人手続も残る|卒業可と誤保証|keep絶対invariant|
|H50|C|P2|scope別回数/単位上限|catalog structured limit|欠落時公式確認|不要|無制限加算/既知単位の無通知脱落|research / 欠落diagnostic|
|H51|B|P2|資格対象Courseと構成値|Course.mappingIds/official earnedが既存|資格除外契約は別途維持|不要|卒業allocatorをそのまま資格条件へ流用|implement：identityだけ共有|
|H52|A|P1|一意な対象単位・上限|不足/矛盾が残る|catalog修復時必要|個人不足時のみ|60/80/100を楽観達成|keep；下限表示は別|
|H53|D|P2|実在学年次・合格日・提出事実|profile/guidanceに無ければシステム不在|制度期限と本人履歴は別|在学年次・第1次等合格日・report提出|入学年から休学を無視/期限推定|user-input；既存値再利用|
|H54|A|P2|表示用completion/annual match|公式factと表示derivedOfferingsは別経路|卒業rule authorityに使わない|annual手動照合等は必要な時だけ|表示のmatchを卒業authorityへ昇格|keep境界；卒業hold数へ重複加算しない|
|H55|C|P2|official/manualの同一成果・credits・履修選択|official exact rowとmanual statusは両方存在可|要：成績確定と卒論手続の接続|成績未確定時の選択/進捗のみ|公式+manual二重算入|research：単一源統合slice|
|H56|C|P2|2回4上限と各回identity|aggregate・recordは回数保証しない|S45確認；行累計/回数仕様を追加確認|原本に回数がなければ履修回|aggregate4を1回/2回と推測|research；限定単発の安全条件|
|H57|B|P1|完成aggregateとS最低1|exact Course、official O2/S1又は2で既存方法条件充足|S48確認済；履修途中の課題期限は別|修得済みには再入力不要|S0/partialまで完成にする|implement：完成・非認定・非重複に限定|
|H58|C|P2|本人scopeへの正式公開、個別上限、同一履修|MappingとPublicCourseはあるがcross-source identity弱い|要：年度開講『法政通信』の個別上限|未取込の履修事実のみ|他学科全科目を公開として加算|research；annual公開metadataを別証拠に|
|H59|C|P2|正式な履修回・family内上限・duplicate識別|規則cap既存；date/yearだけではattempt同一性不足|要：通知書の累積表現|原本でも欠ける回順/タイトル|重複snapshotと正当repeatを混同|research：履修台帳後に実装|
|H60|B|P1|通常必修Course完成、special移動なし|exact Course/必修Mapping/C4/O4/S0|S52–53の通常必修枠を確認；限定条件で追加不要|不要|概説6や演習へ解除を拡大|implement：史学概論通常行のみ|
|H61|C|P1|修得順、概説4+2、5科目条件、分野|Course/Mapping/official S/orderは部分的|S53は確認；行番号/回対応は要確認|演習順が本当に無い場合H28|必修/選必/選択の二重配分|research→family別ledger；総解除不可|
|H62|C|P1|回数と段階移動、合計cap、課程|Mapping・現行transfer関数・aggregate|S55確認；annualからofficialへの対応検証必要|個人回履歴が欠ける場合のみ|必修6/選必36/選択の重複|research→小familyずつ移植|
|H63|E|P2|typed reasonと解決主体|公式コードはあるがreason文言で再分類|不要|不要|engine制約を本人に再入力要求|implement：typed原因→分類|
|H64|D|P2|学科コース・有効なpolicy|選択が無ければ本人情報、catalog欠損はC|policy metadata欠損時のみ|学科/日本文コース選択|空画面を全要件達成と解釈|user-input；metadata欠損はresearch|
|H65|C|P2|登録の追加欄と卒業対象性|row欄とCourse/Mapping対象scopeは既存|S133は別途登録の列；ordinaryへの影響は追加検証|必要時は履修登録の用途|教職等の追加分を卒業加算|research；値をearnedへ加えない|
|H66|A|P1|有限非負official aggregate|invalidはvalidationでも拒否するべき値|不要|原本再取得/誤データ修復|NaN等を0やcomponentsへ置換|keep|

## 7. Detailed findings

### 7.1 Mapping conflict / equivalent mapping（H04/H06/H30/H34）

signatureはscope class（common/selected）、category、field、requirementType、curriculumCredits、schoolingOnly、mediaOnly。公式allocationで実際に消費する意味を含み、同じsignatureの複数edgeは既に一回にまとめる。mappingIdやOffering順を差にしていない点は適切。commonと専門、必修と選択、Sonlyと通常の違いは残す。

eligibleYears・source URL・説明名の差はhistorical graduation配分に使っていないので、signatureに追加してfalse conflictを増やさない。逆に「fieldの空白なら同じ」などの正規化を正本なしで導入しない。最小schema変更なしの課程では十分だが、future CurriculumVersion、repeat/transfer権利をsignatureだけで保証できるわけではない。欠損edgeは外scopeと証明できないため保持。

Planner由来の`countedSchoolingCredits`（G1108–1128、H34/H43）は、earned Offering欠落/未照合/credits null、eligible Mappingなし/複数、legacy courseIdなし、repeatable family、同一Course内composition不一致を`uncertain`へ送る。そのうち**distinct mappingIdが1つ**という条件はofficial同値判定より厳しい。真の不一致はA/H34、同値edgeまで同じ扱いなのはE/H43として分ける。official側で同値と認めるedgeでもPlanner側は止まる（H34/H43に集約）。official等価判定をそのままOffering authorityへ広げず、同一Courseへの実績帰属を先に確認する。

### 7.2 Curriculum identity unresolved（H01/H02/H30/H51）

Stage Aはnormalized exact名・source category・compositionと明示catalog関係から候補を得る。fuzzy推測をしない。candidateが1つでも保存状態がambiguousなら、単に配列長だけで昇格しない。legacy courseIdも制度identityそのものではない。

v21以前のmigrationは一意legacy crosswalkやcompatibleなmanual selectionを既に利用し、矛盾するannual selectionはambiguousへ分離する。**v22は再migrationしない**。IはofferingMatch=exact_uniqueのとき現在annual Offeringの存在・relationを制度identity検証にも要求する。独立exact Courseが残っていてもannualが消えるとexact gateが失敗することをhelperで再現。保存validationも同じ関数を利用するため、次sliceではロード/保存時のrecoveryも確認が必要。今回実データ消失が起きたとは主張しない。

現在のannualを削除してもofferingMatch=unmatchedのofficial rowは計算できる既存テストと矛盾しない。問題は**既にannual exact選択済み**の行。H02はこの限定ケースであり、矛盾する制度Courseの無条件acceptではない。

### 7.3 Earned > composition（H11）

通常の非repeatable科目なら安全guard。しかし政治学/特講等の正当repeat累積が構成2に対してearned4等となる制度はある（S47等）。追加履修は別途登録欄で、単なるearnedの増分ではない。上限2にclamp、全部sum、max採用のいずれも監査では行わない。

既存recordsの年度/日付/タイトル、fingerprint、公式rowのcomposition/recognizedExemption/additionalEnrollmentは調査材料。独立したinstitutional attempt identityとsnapshot境界が無く、同名の別修得・累積family・再取込を常に区別できるわけではない。Cに留め、repeatable合法性が分かっただけでBにしない。

### 7.4 Partial professional completion（H12/H13/H43）

法律は選必8 completed Courses/32を満たした後に限り、C4のschooling2 partialを卒業ordinaryへ算入できる（S47b）。既存`professionalCards.permittedPartial`はこの条件を実装しているが、official入口のblanket guardが実績を渡さない。helperの9行（完成8+partial1）では合計32のまま。次sliceは単純に`earned<composition`を全学科で削除せず、完成8の証明・二重算入排除・当該S2を検証する。

文学部は原則構成完成が必要。80+partial2の特例は教授会判断であり、S68を確認しても自動82を許さない。現manual候補カードは正しくunknown。official partialから候補を出すことと、actual ordinaryへ加算することは別。Sの実修得をordinary未完成と一緒に消す点だけH43の分離候補。

### 7.5 Schooling > earned / composition（H18）

公式S133のS列は修得Sであり、編入S認定は専用科目名行に表示される。S32には通信4修得後、受講中S合格分をSのみ計上する例がある。したがって「Sは常にordinary completionの部分集合」という一般化はできない。

ただしS32は**同一rowのS列がE/Cを超えて表示される実例・schema契約までは示していない**。通常E2/S3がvalidと結論する根拠もない。invalid非有限/negativeはA、有限の超過はCと分ける。今回guard保持。次に原本の行集約仕様と認定専用行の型を公式説明/匿名fixtureで確認する。

## 8. 法律S30 / 専門S8監査

S46–47の表・注cは、＊科目を除く**専門教育内S8**を定める。S68/Rは全体S30を別に定める。S133はメの方法識別を示す。13名称setの除外をglobal S allocation=nullへ適用するF178はaxis conflation（H19）。

例：current law、exact対象Course、O2/S2、非認定・非重複のデータサイエンス入門A。ordinary2は有効、専門S8 contributionは0として確定できるが、全体S30側のS2を「不明」とする理由にはならない。mediaOnly Mappingなら既存rawメ/direct-link/pure条件も必要。S8対象外とS30対象外は異なる。

ただし今のG967付近はofficial professional allocationsのSをそのまま専門S8へ足す。**Fの除外guardを消すだけではfalse positiveを作る**。次sliceではglobal eligible Sとlaw professional eligible Sを計算上分け、＊/公開をS8で確実に0にする。persisted shapeを変える必要性はまだない。

全体S30への特別family（公開、repeatable、認定、S-only追加分）の算入上限・重複は別guard。法律setの分離を理由にその安全策を解除しない。期待テスト：13名称、非除外名、public、ordinary/S0/null/positive、mediaOnly guard、foreign cardへの不必要な伝播、認定併用。

## 9. Recognition関連監査

認定済みordinary、通常履修ordinary、S相当認定、通常履修S、免除（earnedではない）を分離する必要がある。

- H20はprofileのS認定が**nullでもpositiveでも**通常official Sを一律保留し、S0までnullにする。S133には編入S認定専用行があるため、通常行との区別を設ける根拠はある。全認定rowを通常rowと同じに扱ったまま解除するのは不可。
- H14は認定専門配列のlengthのみを見る。identityが既に一意で互いに異なるならその科目のordinaryまで止める必要はない。一方、認定項目はlegacy courseId/offeringIdで、名前だけ・削除annual・一対多crosswalkでは非重複と証明できない。**すべての認定項目が比較可能なケースから**始める。
- 認定のsynthetic PlannerItemはOfferingを使い、record.creditsではなくOffering creditsで計算される経路を持つ。original itemsによるdedupであり、official row全体との統一dedupではない。H14のholdを外すとき、この二重計上・値の相違を必ずテストする。認定をordinary aggregateへ足し込む新architectureは本監査の実装外。
- H38のprofile foreign recognized4/language known/S nullはO4が確定している。S不足ならearned4を残すコードがあるのに、S不明だけでearned=nullになるのはconflation。認定値合計と内訳を二重に加えず、foreign要件はunknownを維持したままO下限を保持できる。
- 一般認定内訳unknown（H37）はunknown増分と既知official量を混同している。免除はearned0を維持し、数値を認定12として加算しない。
- `admissionType`だけで7/15を必ず埋めるのは危険。R/S30には前籍が通信の場合の上限認定と、通学の場合の固定認定等の差がある。profileの既存prefillは万能な本人認定証拠ではない。真に個人値が欠ければD。

## 10. Duplicate監査

Fは同row idの再参照をMapで一つにするが、**異なるrow idが同Courseへ集まるとaggregate=null、allocationsなし**。全sourceRowsを保持する。allZeroは警告とglobal holdを抑止するが、dedupeを解決したのではない。

|候補ケース|既存evidence|現時点の結論 / 次slice|
|---|---|---|
|same id再参照|idが同一|idempotent処理済。別idのduplicate解決とは別|
|same source duplicate|fingerprint/capturedAt/raw fields/link|比較材料あり。ただしfingerprintはsource内容・occurrence由来で恒久attempt IDではない。自動sum/max不可|
|truly duplicated import|import fingerprint/occurrenceと同値source payload|完全同一snapshotの限定dedupe研究候補。異なるcaptureでも同じ成績というだけでは新規修得と区別不能|
|legitimate repeatable rows|family規則・date/year/records|制度上repeat可でも各行が累積か独立かは未証明。attempt ledger研究|
|same-name different completion|exact Course、構成、年度等|normalized nameだけでは同一/別の根拠にならない。制度idと回の証拠を追加|

分類A/P1。次sliceはまずread-only duplicate classifierと原本仕様の研究。productionでdedupe/mergeを実行していない。

## 11. specialCourse分解監査

H10の一つのbooleanに、以下の異なる理由が入っている。先にunsupported bucketが発火するfamilyもあり、`specialCourse`の削除だけでは解決しない。

|family|未確定事項|既存データだけで解除できる部分|分類 / 次の扱い|
|---|---|---|---|
|卒業論文 H55|official/manual成果の一意性と手続|official完了証拠はあるが統一源の契約未実装|C。thesis integration研究；未確定なら選択/進捗D|
|基礎特講 H56|回数2、合計4の台帳|上限rule既存、aggregateだけから回数を推測不可|C。単発/累積表現の調査|
|書道実技 H57|完成と履修途中の方法/期限を混同|非認定exact C2/O2/official S≥1は完成側の必要証拠あり|B。S0、partial、期限未達の学習中とは分ける|
|旧課程 H24|個人適用/読替え|2026 catalogだけでは不足|C/Backlog；個人適用事実はD|
|公開科目 H58|正式な公開対象・個別回数上限・cross-source同一性|PublicCourse共通8回16の計算はある|C。法政通信の年度個別開講を確認|
|repeatables H59|同一修得回・累積、cap|16定義のcapは既知|C。法律：政治学/演習/特講/総合特講、日本文・史学・地理：総合特講、史学：資料、経済/商業：経済/経営特講・総合特講・演習を別上限で扱う|
|史学概論 H60|通常必修までprefix guard|C4/O4/S0、必修Mappingを実catalogで確認|B。Sの特殊扱いや概説群まで広げない|
|史学演習 H28/H61|1–4修得順、分野、5科目完成時の移動|有効なearnedOrderは既存で再利用できる|C＋欠ける順序D。official行番号の意味を確認|
|歴史資料学 H59/H61|1–6の回identity|配分先は一定で上限12、順序より回の区別が必要|C。新しい順序入力を無条件要求しない|
|日本/東洋/西洋史概説・考古学 H61|通常4、S追加2、選必/選択移動|Course/Mapping/Sはあるが単一allocationでは不足|C。概説と考古学を同一ルールと仮定しない|
|現地研究 H62|2回必修/超過、旧制度|現行transfer関数がある|C。回数証拠・旧課程を分離|
|地誌学特講 H62|regional合計・超過先|現行Mapping/transfer条件|C。official累積対応を検証|
|人文/自然地理学演習 H62|必修→選必→選択の段階|既存transfer関数・field|C。段階間二重加算を防ぐ|
|人文/自然地理学特講 H62|combined cap、partial2|既存catalog条件|C。通常full completion guardと別扱い|

## 12. Warning taxonomy監査

|kind|現在の選択|妥当性 / 改善候補|
|---|---|---|
|allocation_held|positive sourceがありallocation unknown|identity/duplicate/mapping衝突には妥当。special/recognized等はtyped detailが必要。Sだけの問題をここに入れない|
|credits_unknown|allZeroでなくpositiveが無い、又はorphan|earned nullには妥当。out_of_scope/nullも先にここへ入り、卒業とは無関係な量の確認を要求し得る。orphanの全component個数が通知数になり同一根因を重複表示|
|schooling_confirmation|allocatedでS diagnosticあり|通常Oを保持する構造はよい。ただし「通常の卒業単位は算入済み」は未完成common Course等では`allocation.credits`と最終`completedCredits`を混同し得る|
|out_of_scope|positive・allocation対象外|情報表示でありengine全体のholdにはしない。zero対象外は通知なし。unknown earnedの対象外も数量確認と卒業上の問題を別表示できる|

positive/null混在duplicateはallocation_held一件になる（未知量が消えた訳ではなくsourceRowsに残る）。allZeroをunknownに変えない。Sだけ確定/O不明の場合は現在独立S allocationが無いのでH43として扱う。`media_schooling_credits_conflict`はfact detailに残るがUIは一般S確認文へまとめる。

`classifyUnknownReason`は日本語reasonの正規表現に依存し、enumコードだけのidentity holdは`rule_unimplemented`へ落ち得る。認定という文字を含むengine制約が`personal_information`になることもある。「誰が何を解決するか」はtyped causeで決めるのが望ましい。kindの整理と実計算の改善は別slice。

## 13. Beta blocker classification

**P1（29項目）**：H01(A), H02(E), H03(A), H04(A), H06(A), H07(D), H11(C), H12(B), H14(B), H15(A), H16(A), H21(C), H22(A), H23(D), H25(D), H31(E), H33(A), H34(A), H36(E), H37(E), H38(E), H40(A), H49(A), H52(A), H57(B), H60(B), H61(C), H62(C), H66(A)

**P2（35項目）**：H05(A), H08(C), H09(C), H10(E), H13(A), H17(A), H18(C), H19(E), H20(E), H26(C), H27(C), H28(D), H29(C), H30(B), H32(E), H35(C), H39(D), H41(E), H42(E), H43(E), H45(E), H46(E), H47(E), H48(A), H50(C), H51(B), H53(D), H54(A), H55(C), H56(C), H58(C), H59(C), H63(E), H64(D), H65(C)

**Backlog（2項目）**：H24(C), H44(E)

- **P1のAは解除しない安全gate**。false graduation creditを防ぐため、今後の変更で回帰させない対象。C/DのP1はその機能・利用者群をbeta対応範囲に含めるなら先に解決/明示すべきgap。既知の個人情報不足を隠してcomplete扱いしない。
- **B/EのP1**は実装候補。ただしH02はcatalog更新時の整合、H14は比較可能な認定に限定する。影響頻度を測っていないため、件数を利用者影響の大きさとして読まない。
- **P2**は主としてSだけの過剰hold、表示・適用範囲・隣接指導資格。一部のCはfalse positiveを避けるため現holdを保持する。
- **Backlog**は旧課程一般化と到達不能/重複条件整理。A-E分類と優先度は別軸。

## 14. Recommended implementation slices

いずれも`graduationCheckComplete=false`のまま。`sourceLinksReverified`やschema versionを変える必要はない。以下のaffected filesは次sliceの候補で、今回編集した意味ではない。F/G/P等は§2のファイルを指す。各sliceに既存audit testと今回helperから必要な期待値を移す。

|順|scope / affected files|expected behavior change|risk / required tests|source verification requirement|beta / dependency|
|---|---|---|---|---|---|
|1|**H38のみ：認定外国語O/S分離**。G applyRecognition/reference、tests/graduation-audit.test.mjs、必要時UI|言語既知の認定4/SnullでO4を保持。foreign達成とSはunknown維持|認定totalと内訳の二重計上、exempt0、language unknown、S0/1/2/null、official外国語併存、一般認定unknownでのreference合計|既にS45/R確認；追加source不要。認定scopeが曖昧な新caseは広げない|P1、独立。**次に実装すべき1つ**|
|2|H57/H60を別々の小commit/slice：完成書道実技・史学概論。F、G入力契約、tests|名称だけのholdを限定解除し既知通常creditを保つ|C2/O2/S1,2 vs0/null/partial、史学概論C4/O4/S0 vs概説/演習、別scope/duplicate/認定/旧課程、Offeringなし|S48/S52確認済；対象subset追加不要|P1、slice1に技術依存なし|
|3|H12法律partial。F/G professionalCards、tests|完成8科目32後のofficial C4/O2/S2を選択へ一度だけ配分|7/8/9完成科目、同Course重複、partial通信、Snull、Sonly、認定/公開、総計32→34・専門S条件|S47b確認済|P1、global/allocation分離が必要ならslice5の一部を先行|
|4|H02制度identityとannual欠落分離。I、officialCourseCredits、storage/validation、tests|独立exact Courseをannual欠落だけで失わない|manual/auto/unmatched、annual削除/変更/矛盾、schema22保存復元、異なる制度idは拒否|不要。既存identity契約内|P1、独立。保存recoveryの変更範囲は事前固定|
|5|H31/H36–37/H41–43：依存範囲・既知下限・O/S分離。G、factsの計算型、UI、tests|law卒論未定でもS量/30保持、既知O下限保持、無関係foreign等へ伝播しない|真に所属不明のrowは全域不確定維持、0/null、どのbucketにも入る候補、閾値達成/未達/上限、thesis独立|数量表示は追加不要；S-only allocationはfamily別S31–32検証|P1/P2、slice1の型設計を再利用。大規模rewriteにしない|
|6|H19法律S30/S8。F/G lawS/globalS、graduationSources、tests|＊科目のvalid Sを全体に保持、専門S8には0|13名称+公開+非除外、media positive/null/0、recognition overlap、falseS8防止|S46–47/S68確認済|P2、slice5のaxis表現と整合|
|7|H14/H20認定の局所overlap。F/G認定input、P、curriculum relations、tests|比較可能な非重複professional/通常Sを保持|認定なし/同一/別/identity不明、courseIdとofferingId混在、認定creditsとOffering値差、専用S認定行・null認定・再取込|S133/R確認済；実際のsource rowと認定通知対応を追加検証|P1/P2、slice5、認定synthetic source重複テストが前提|
|8|H30/H45–47/H63とH51を別slice：対象lookup/coverage/warnings、指導資格identity|不要な確認を削減、解決主体を明示；指導資格がannual不要の同定を利用|全182rule applicability、unsupported scopeLabel正規化、genericと専用の残余条件、0/outscope/orphan、資格60/80/100独立|scopeLabelと資料の対応要確認；generic残余を無条件deleteしない|P2、数量slice後。H51は卒業allocator流用しない|
|9|C研究群：S18/earned>C/認定欄/追加履修/public/repeat/history/geography/thesis|公式仕様を確定してから小familyのallocatorを追加|row累積/duplicate/回数/順序/移動/上限のfixture matrix|**要**。§16参照|P1/P2各該当群；履修台帳が必要なものは後段|
|10|旧課程version/完全なrepeat ledger/手続統合|historical適用と正当repeatを一般化|移行/復籍/複数年度、入力保存後の互換|要：旧課程正本と適用通知|Backlog。大規模rewriteを最初にしない|

## 15. Remaining genuine user inputs

B/Eを解くための再入力は要求しない。必要なのはsystemにもofficial一般資料にもない個人事実だけ。

|入力|該当|既存値があれば再質問不要 / 何が本当に必要か|
|---|---|---|
|元成績の公式aggregate/科目識別|H01/H07/H40|まず再取込とdirect link回復。componentの自己申告合計ではない|
|適用課程・復籍/転籍・入学区分|H23–25/H64|profileにあれば再利用。入学年だけから休学/移行適用を推測しない|
|個人認定通知の合計・分野/言語・S相当・科目|H25/H39|recognized4/Snullならordinary4を再質問しない。必要なのは欠けているS内訳等だけ|
|履修順/独立修得回|H28/H59/H61|source record・正式番号・有効なearnedOrderで判れば入力不要。編集termの時系列はauthorityにしない|
|卒論選択/手続/指導合格日・現学年・地理report提出|H36/H53/H55|officialearned済の通常科目を再確認する質問とは分離。S30のために卒論選択を要求しない|
|教授会判断の個別結果|H13|80+2特例の承認を本人が推測して入力する運用ではなく、正式結果が必要|

## 16. Official-source gaps / evidence register

確認日：2026-10-04。法政大学通信教育部の一次資料のみをrule authorityに使用。既存監査docのsource claimを無条件採用せず、下記の関係箇所を再読した。引用を増やさず要旨を記録。PDFのprinted pageとPDF pageは本ファイルでは**+2**の関係。法学p47はレンダリングも見て表の＊と注cの適用範囲を確認。

|source ID|資料・年度・URL|printed / PDF page|今回確認したこと / 証明していないこと|
|---|---|---|---|
|S30|[2026年度 学習のしおり](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=32)|30 / 32|入学認定区分とS相当の枠。個人の確定認定値を一律推測しない|
|S31–32|[同・単位修得方法](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=33)|31–32 / 33–34|組合せ学習、通信修得とSのみ計上の例。S列が必ずE/C以下とは証明しない|
|S45|[同・共通課程](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=47)|45 / 47|外国語ordinary4内S2、共通枠、基礎特講。認定S未知でもordinary4値の存在は別|
|S46–47|[同・法律学科](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=48)|46–47 / 48–49|＊専門S8除外、8科目32後のschooling partial2、repeat/public上限|
|S48|[同・日本文学科注意事項](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=50)|48 / 50|書道実技の完成方法と学習途中の期限、文学の構成完成原則|
|S52–53|[同・史学科](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=54)|52–53 / 54–55|史学概論通常必修、概説/演習/資料の特殊配分。import行と履修回の対応は未確定|
|S54–55|[同・地理学科](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=56)|54–55 / 56–57|現地/演習/特講の段階配分。current catalog transfer存在だけではofficial入力への移植を証明しない|
|S68|[同・卒業の諸条件](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=70)|68 / 70|global S30、124/128、文学80+2は教授会判断|
|S133|[同・履修成績通知書の見方](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf#page=135)|133 / 135|修得単位/S単位/認定免除/追加履修の列、メ、編入S認定の専用行。repeat時の累積snapshot識別は未解決|
|R|[卒業必要要件について](https://www.tsukyo.hosei.ac.jp/system/requirements/)|Web（年度明記なし、確認日現在）|global S30、ordinary124/128、外国語4/S2、対象外科目|
|R認定|[編入学者の単位認定](https://www.tsukyo.hosei.ac.jp/admission/accreditations/)|Web（年度明記なし、確認日現在）|前籍/入学区分別の個別認定とS認定、免除と修得の区別|

既存`graduationSources`の一部page表記とPDF表/注意事項のページ境界は同じではない。今回は上表のprinted/PDFを根拠とし、source metadata自体は編集していない。メディア案内Webも閲覧したが、そのページだけをschooling算入の数値規則の証明には使っていない。

残るsource researchは、(1) S>earned/compositionの公式行表現、(2)認定/追加履修欄と通常earnedの重複境界、(3)repeat/family行の累積・独立回・再取込仕様、(4)公開科目の年度個別上限、(5)史学/地理のsource番号と配分台帳、(6)旧課程・復籍経過措置、(7)official thesisと手続の単一源接続、(8)unsupported scopeLabelと正本の確実な対応。個人情報を質問する前に、一般的な制度部分を研究する。

これは部分source reviewであり**sourceLinksReverified=falseを維持**する。

## 17. Non-goals / verification

production calculation/UI、import parser/bookmarklet/extension、persistent shape、catalog定義、認定architecture、旧課程、thesis統合、repeatable/dedupを実装しない。graduation completeをtrueにしない。PR作成・merge・dev/main commit・rebase・reset・force-push・clean・cherry-pick・stash操作をしない。

|検証|結果|
|---|---|
|`npm run test:planner`|PASS **620/620**、fail/skip 0|
|`node --import tsx --test scripts/audit-graduation-false-unknown.mjs`|PASS **17/17**、fail/skip 0。現状characterization|
|`npm run typecheck`|PASS|
|`npm run lint`|PASS|
|`npm run catalog:check`|PASS、321制度Course / 686 Offering。catalog変更なし|
|`git diff --check`|PASS（commit前に新規ファイルをstageした差分も検査）|
|production差分|`src`、既存tests、package、catalogに差分なし。追加は本書とaudit helperのみ|
|環境|Node v24.13.0。CI定義はNode22。CIそのものを実行したという意味ではない|
|build / extension / bookmarklet|未実行。production非変更の監査であり、依頼された最低検証と追加helperを実施|

既存CI定義も読取確認した（mainへのpush/PRが対象、typecheck/lint/planner/extension/bookmarklet/build）。今回のaudit branch pushでCI成功を断定しない。commit後は`git diff origin/dev...HEAD -- src`が空であること、およびworking tree cleanを再確認する。

## Appendix A. Catalog requirement coverage

既存read-only `scripts/audit-graduation-engine.mjs`を再実行し、182 requirementsを列挙した。この既存scriptの`auditBase`フィールドは過去監査の固定文字列なので、**今回のGit baseには採用していない**。今回のbaseは冒頭SHA。

structured142、unsupported40、condition組合せ30。raw allowlist不一致43、`when/includes_thesis`除去後39。39にはreference-onlyとしてruntime一覧から除かれる`common_open_university_max_credits`も含むため、39をそのまま利用者のunknown件数にしない。thesis inactive/専用card除外、対象courseなし、profile/official guardでruntime件数は変化する。

下表は182件全体の索引。`structured通常`は無条件safeという意味ではなく、H01–43の入力時guardとH27–35のgeneric guardがなお適用される。unsupported/condition別の各インスタンスを、本文の原因inventoryへ対応づける。親guardと子familyを重複集計して「66個の独立バグ」と数えない。

|ruleId|catalog状態 / 主な関連inventory|
|---|---|
|commerce_course_credit_completion|unsupported：H45/H46；H11/H12/H13/H33|
|commerce_economics_lecture_max_credits|structured通常：H27–35（入力時）|
|commerce_general_lecture_max_credits|structured通常：H27–35（入力時）|
|commerce_legacy_rules_external|unsupported：H45/H46；H24|
|commerce_management_lecture_max_credits|structured通常：H27–35（入力時）|
|commerce_open_course_individual_limits|unsupported：H45/H46；H50/H58|
|commerce_open_courses_max_credits|structured通常：H27–35（入力時）；H50/H58|
|commerce_required_elective_min_credits|structured通常：H27–35（入力時）|
|commerce_required_elective_to_elective_overflow_credit_transfer|structured条件未対応：H26/H46；H35/H46|
|commerce_seminar_max_credits|structured通常：H27–35（入力時）|
|commerce_thesis_interim_required_course|structured条件未対応：H26/H46；H53/H55|
|commerce_thesis_plan_required_course|structured条件未対応：H26/H46；H53/H55|
|commerce_total_min_credits|structured通常：H27–35（入力時）|
|common_already_fulfilled|unsupported：H45/H46；H21/H37|
|common_basic_lecture_max_credits|structured通常：H27–35（入力時）|
|common_course_credit_completion|unsupported：H45/H46；H11/H12/H13/H33|
|common_foreign_choose_one|structured条件未対応：H26/H46；H38/H39|
|common_foreign_exact_credits|structured条件未対応：H26/H46；H38/H39|
|common_foreign_max_credits|structured条件未対応：H26/H46；H38/H39|
|common_foreign_min_schooling_credits|structured条件未対応：H26/H46；H38/H39, H18/H19/H20/H42|
|common_foreign_reenrollment|unsupported：H45/H46；H24, H38/H39|
|common_general_exact_credits|structured通常：H27–35（入力時）|
|common_general_humanities_min_credits|structured通常：H27–35（入力時）|
|common_general_max_credits|structured通常：H27–35（入力時）|
|common_general_natural_min_credits|structured通常：H27–35（入力時）|
|common_general_social_min_credits|structured通常：H27–35（入力時）|
|common_legacy_rules_external|unsupported：H45/H46；H24|
|common_natural_legacy_reenrollment|unsupported：H45/H46；H24, H24|
|common_natural_per_subject_kind_max_credits|structured条件未対応：H26/H46|
|common_open_university_max_credits|structured条件未対応：H26/H46；runtime省略枝あり|
|common_physical_choose_one|structured通常：H27–35（入力時）|
|common_physical_exact_credits|structured通常：H27–35（入力時）|
|common_physical_max_credits|structured通常：H27–35（入力時）|
|common_total_min_credits|structured通常：H27–35（入力時）；runtime省略枝あり|
|economics_course_credit_completion|unsupported：H45/H46；H11/H12/H13/H33|
|economics_economics_lecture_max_credits|structured通常：H27–35（入力時）|
|economics_general_lecture_max_credits|structured通常：H27–35（入力時）|
|economics_legacy_rules_external|unsupported：H45/H46；H24|
|economics_management_lecture_max_credits|structured通常：H27–35（入力時）|
|economics_open_course_individual_limits|unsupported：H45/H46；H50/H58|
|economics_open_courses_max_credits|structured通常：H27–35（入力時）；H50/H58|
|economics_required_elective_min_credits|structured通常：H27–35（入力時）|
|economics_required_elective_to_elective_overflow_credit_transfer|structured条件未対応：H26/H46；H35/H46|
|economics_seminar_max_credits|structured通常：H27–35（入力時）|
|economics_thesis_interim_required_course|structured条件未対応：H26/H46；H53/H55|
|economics_thesis_plan_required_course|structured条件未対応：H26/H46；H53/H55|
|economics_total_min_credits|structured通常：H27–35（入力時）|
|geography_course_credit_completion|unsupported：H45/H46；H11/H12/H13/H33, H62|
|geography_elective_min_credits|structured通常：H27–35（入力時）；H62|
|geography_fieldwork_required_course|structured条件未対応：H26/H46；H62|
|geography_fieldwork_to_elective_overflow_credit_transfer|structured条件未対応：H26/H46；H62, H35/H46|
|geography_fieldwork_transfer_max_credits|structured通常：H27–35（入力時）；H62|
|geography_general_lecture_max_credits|structured通常：H27–35（入力時）；H62|
|geography_human_geography_overview_1_required_course|structured通常：H27–35（入力時）；H62|
|geography_human_geography_research_required_course|structured通常：H27–35（入力時）；H62|
|geography_human_required_elective_min_credits|structured通常：H27–35（入力時）；H62|
|geography_human_seminar_required_course|structured条件未対応：H26/H46；H62|
|geography_legacy_fieldwork|unsupported：H45/H46；H24, H62|
|geography_legacy_regional_transfer|unsupported：H45/H46；H24, H62|
|geography_legacy_rules_external|unsupported：H45/H46；H24, H62|
|geography_open_course_individual_limits|unsupported：H45/H46；H50/H58, H62|
|geography_open_courses_max_credits|structured通常：H27–35（入力時）；H50/H58, H62|
|geography_physical_geography_overview_1_required_course|structured通常：H27–35（入力時）；H62|
|geography_physical_geography_research_required_course|structured通常：H27–35（入力時）；H62|
|geography_physical_required_elective_min_credits|structured通常：H27–35（入力時）；H62|
|geography_physical_seminar_required_course|structured条件未対応：H26/H46；H62|
|geography_regional_lecture_to_elective_overflow_credit_transfer|structured条件未対応：H26/H46；H62, H35/H46|
|geography_regional_required_elective_min_credits|structured通常：H27–35（入力時）；H62|
|geography_required_elective_min_credits|structured通常：H27–35（入力時）；H62|
|geography_required_elective_to_elective_overflow_credit_transfer|structured条件未対応：H26/H46；H62, H35/H46|
|geography_required_min_credits|structured条件未対応：H26/H46；H62|
|geography_required_min_schooling_credits|structured通常：H27–35（入力時）；H62, H18/H19/H20/H42|
|geography_seminar_three_stage_transfer|unsupported：H45/H46；H62|
|geography_special_lectures_combined_max_credits|structured条件未対応：H26/H46；H62|
|geography_thesis_guidance_1_required_course|structured条件未対応：H26/H46；H62, H53/H55|
|geography_thesis_guidance_2_required_course|structured条件未対応：H26/H46；H62, H53/H55|
|geography_thesis_guidance_3_required_course|structured条件未対応：H26/H46；H62, H53/H55|
|geography_thesis_required_course|structured通常：H27–35（入力時）；runtime省略枝あり；H62, H53/H55|
|geography_total_min_credits|structured通常：H27–35（入力時）；H62|
|history_course_credit_completion|unsupported：H45/H46；H11/H12/H13/H33|
|history_eastern_elective_min_courses|structured通常：H27–35（入力時）|
|history_eastern_history_overview_required_course|structured通常：H27–35（入力時）；H61|
|history_elective_min_credits|structured通常：H27–35（入力時）|
|history_fifth_schooling_course|unsupported：H45/H46；H61, H18/H19/H20/H42|
|history_general_lecture_max_credits|structured通常：H27–35（入力時）|
|history_historical_sources_max_credits|structured通常：H27–35（入力時）|
|history_historical_studies_required_course|structured通常：H27–35（入力時）|
|history_japanese_elective_min_courses|structured通常：H27–35（入力時）|
|history_japanese_history_overview_required_course|structured通常：H27–35（入力時）；H61|
|history_legacy_rules_external|unsupported：H45/H46；H24|
|history_open_course_individual_limits|unsupported：H45/H46；H50/H58|
|history_open_courses_max_credits|structured通常：H27–35（入力時）；H50/H58|
|history_overview_allocation|unsupported：H45/H46；H61|
|history_overview_exam|unsupported：H45/H46；H61|
|history_overview_six_credits_min_courses|structured条件未対応：H26/H46；H61|
|history_required_elective_min_schooling_credits|structured通常：H27–35（入力時）；H18/H19/H20/H42|
|history_required_min_credits|structured通常：H27–35（入力時）|
|history_seminar_max_credits|structured通常：H27–35（入力時）；H28/H61|
|history_seminar_prerequisite|unsupported：H45/H46；H28/H61|
|history_seminar_required_course|structured通常：H27–35（入力時）；H28/H61|
|history_thesis_guidance_1_required_course|structured条件未対応：H26/H46；H53/H55|
|history_thesis_guidance_2_required_course|structured条件未対応：H26/H46；H53/H55|
|history_thesis_guidance_3_required_course|structured条件未対応：H26/H46；H53/H55|
|history_thesis_required_course|structured通常：H27–35（入力時）；runtime省略枝あり；H53/H55|
|history_total_min_credits|structured通常：H27–35（入力時）|
|history_western_elective_min_courses|structured通常：H27–35（入力時）|
|history_western_history_overview_required_course|structured通常：H27–35（入力時）；H61|
|japanese_language_calligraphy_methods|unsupported：H45/H46；H57|
|japanese_language_course_credit_completion|unsupported：H45/H46；H11/H12/H13/H33|
|japanese_language_elective_min_credits|structured通常：H27–35（入力時）|
|japanese_language_general_lecture_max_credits|structured通常：H27–35（入力時）|
|japanese_language_japanese_grammar_required_course|structured通常：H27–35（入力時）|
|japanese_language_japanese_language_history_required_course|structured通常：H27–35（入力時）|
|japanese_language_japanese_linguistics_required_course|structured通常：H27–35（入力時）|
|japanese_language_japanese_literary_history_i_required_course|structured通常：H27–35（入力時）|
|japanese_language_japanese_literary_studies_required_course|structured通常：H27–35（入力時）|
|japanese_language_legacy_rules_external|unsupported：H45/H46；H24|
|japanese_language_open_course_individual_limits|unsupported：H45/H46；H50/H58|
|japanese_language_open_courses_max_credits|structured通常：H27–35（入力時）；H50/H58|
|japanese_language_required_elective_min_credits|structured通常：H27–35（入力時）|
|japanese_language_required_elective_to_elective_overflow_credit_transfer|structured条件未対応：H26/H46；H35/H46|
|japanese_language_required_min_credits|structured通常：H27–35（入力時）|
|japanese_language_thesis_guidance_1_required_course|structured条件未対応：H26/H46；H53/H55|
|japanese_language_thesis_guidance_2_required_course|structured条件未対応：H26/H46；H53/H55|
|japanese_language_thesis_required_course|structured通常：H27–35（入力時）；runtime省略枝あり；H53/H55|
|japanese_language_total_min_credits|structured通常：H27–35（入力時）|
|japanese_literature_calligraphy_methods|unsupported：H45/H46；H57|
|japanese_literature_course_credit_completion|unsupported：H45/H46；H11/H12/H13/H33|
|japanese_literature_elective_min_credits|structured通常：H27–35（入力時）|
|japanese_literature_general_lecture_max_credits|structured通常：H27–35（入力時）|
|japanese_literature_japanese_linguistics_required_course|structured通常：H27–35（入力時）|
|japanese_literature_japanese_literary_history_i_required_course|structured通常：H27–35（入力時）|
|japanese_literature_japanese_literary_history_ii_required_course|structured通常：H27–35（入力時）|
|japanese_literature_japanese_literary_studies_required_course|structured通常：H27–35（入力時）|
|japanese_literature_legacy_rules_external|unsupported：H45/H46；H24|
|japanese_literature_literature_required_course|structured通常：H27–35（入力時）|
|japanese_literature_open_course_individual_limits|unsupported：H45/H46；H50/H58|
|japanese_literature_open_courses_max_credits|structured通常：H27–35（入力時）；H50/H58|
|japanese_literature_required_elective_min_credits|structured通常：H27–35（入力時）|
|japanese_literature_required_elective_to_elective_overflow_credit_transfer|structured条件未対応：H26/H46；H35/H46|
|japanese_literature_required_min_credits|structured通常：H27–35（入力時）|
|japanese_literature_thesis_guidance_1_required_course|structured条件未対応：H26/H46；H53/H55|
|japanese_literature_thesis_guidance_2_required_course|structured条件未対応：H26/H46；H53/H55|
|japanese_literature_thesis_required_course|structured通常：H27–35（入力時）；runtime省略枝あり；H53/H55|
|japanese_literature_total_min_credits|structured通常：H27–35（入力時）|
|japanese_performance_calligraphy_methods|unsupported：H45/H46；H57|
|japanese_performance_course_credit_completion|unsupported：H45/H46；H11/H12/H13/H33|
|japanese_performance_elective_min_credits|structured通常：H27–35（入力時）|
|japanese_performance_general_lecture_max_credits|structured通常：H27–35（入力時）|
|japanese_performance_japanese_art_history_required_course|structured通常：H27–35（入力時）|
|japanese_performance_japanese_linguistics_required_course|structured通常：H27–35（入力時）|
|japanese_performance_japanese_literary_history_i_required_course|structured通常：H27–35（入力時）|
|japanese_performance_japanese_literary_studies_required_course|structured通常：H27–35（入力時）|
|japanese_performance_legacy_rules_external|unsupported：H45/H46；H24|
|japanese_performance_open_course_individual_limits|unsupported：H45/H46；H50/H58|
|japanese_performance_open_courses_max_credits|structured通常：H27–35（入力時）；H50/H58|
|japanese_performance_performing_arts_history_required_course|structured通常：H27–35（入力時）|
|japanese_performance_required_elective_min_credits|structured通常：H27–35（入力時）|
|japanese_performance_required_elective_to_elective_overflow_credit_transfer|structured条件未対応：H26/H46；H35/H46|
|japanese_performance_required_min_credits|structured通常：H27–35（入力時）|
|japanese_performance_thesis_guidance_1_required_course|structured条件未対応：H26/H46；H53/H55|
|japanese_performance_thesis_guidance_2_required_course|structured条件未対応：H26/H46；H53/H55|
|japanese_performance_thesis_required_course|structured通常：H27–35（入力時）；runtime省略枝あり；H53/H55|
|japanese_performance_total_min_credits|structured通常：H27–35（入力時）|
|law_course_credit_completion|unsupported：H45/H46；H11/H12/H13/H33|
|law_elective_with_thesis_min_credits|structured通常：H27–35（入力時）；H53/H55|
|law_elective_without_thesis_min_credits|structured通常：H27–35（入力時）；runtime省略枝あり；H53/H55|
|law_general_lecture_max_credits|structured通常：H27–35（入力時）|
|law_law_lecture_max_credits|structured通常：H27–35（入力時）|
|law_legacy_rules_external|unsupported：H45/H46；H24|
|law_open_course_individual_limits|unsupported：H45/H46；H50/H58|
|law_open_courses_max_credits|structured通常：H27–35（入力時）；H50/H58|
|law_partial_course_exception|unsupported：H45/H46；H12|
|law_politics_max_credits|structured通常：H27–35（入力時）|
|law_professional_min_schooling_credits|structured条件未対応：H26/H46；H18/H19/H20/H42|
|law_required_elective_min_credits|structured通常：H27–35（入力時）|
|law_required_elective_min_credits_note|structured通常：H27–35（入力時）|
|law_required_elective_to_elective_overflow_credit_transfer|structured条件未対応：H26/H46；H35/H46|
|law_seminar_max_credits|structured通常：H27–35（入力時）|
|law_thesis_guidance_required_course|structured条件未対応：H26/H46；H53/H55|
|law_total_with_thesis_min_credits|structured通常：H27–35（入力時）；H53/H55|
|law_total_without_thesis_min_credits|structured通常：H27–35（入力時）；runtime省略枝あり；H53/H55|

## H38 implementation follow-up — 2026-10-04

- 実装commit：`5017d9790bd119b39ae4d0ec6fafeedb040580c4`（`feature/graduation-h38-foreign-recognition-axis`）。baseは監査HEAD `47d8686fb4f175a66e626b5321fef7003167e2fe`。開始時remote devは`d5c28e07187787ba805da7b749ede4c140d280a9`のままで、dev統合は不要だった。
- H38のみ解決：認定外国語4・言語既知・外国語S相当認定nullでは、`group-foreign.earned=4`、`status=unknown`、schooling未確認reasonを維持する。synthetic単独caseのoverall下限は0から4へ戻る。schooling referenceのearnedはnull・status unknownのままで、ordinary4からSを推測しない。
- overlayは外国語卒業枠4を置き換える。official外国語0/2/4、認定total null/4との共存でもordinaryは4、6/8へ増えない。S=0/1はearned4・unsatisfied、S=2はearned4・satisfiedを維持。英/独/仏、language unknown、mode unknown、exempt、invalid値、frozen入力、既存UI表示を検証。
- 正式regression matrixを`tests/graduation-audit.test.mjs`へ27ケース追加。監査helperのH38だけを解決済みassertionへ更新し、他Hxx characterizationは変更していない。H37/H36/H39および他の監査findingは未解決のまま。
- 検証：planner **647/647**、audit helper **17/17**、fail/skip 0。typecheck/lint/build/diff check PASS。build内のgrade-import artifact checkとcatalog checkもPASS（Course321 / Offering686）。Viteのchunk-size警告は残るがbuild成功。
- production差分は`graduationProgress.ts`のH38分岐のみ。UI、認定architecture、persistent shape、catalog、source/Mapping authorityは不変。`graduationCheckComplete=false`、`sourceLinksReverified=false`、`schemaVersion=22`を維持。

上記は実装後の追記。本文の66件inventory・A–E/P1等の集計と旧behavior記述は、監査時点baselineとして変更していない。

## H60 implementation follow-up — 2026-10-05

- 実装commit：`fa1bff4f87e6847d9027ae7f56b5d74a9b15d7f2`。branchは`feature/graduation-h60-history-intro-completion`、base/開始時remote devは`3f99590b0cfbbc29ec9831e937c9557ca4972919`。H38 merge後の最新devから新規作成し、旧feature/auditをbaseにしていない。
- H60の安全subsetだけ解決：2026 catalog source＋profile `current_2026`、史学科、exact canonical「史学概論」、exact institutional identity、通常専門必修Mapping（field null、method-onlyなし）、公式C4/O4/S0、認定免除/追加履修0又はnull、重複/Mapping conflictなし。名称によるblanket holdだけをこの条件で除外し、後続guardを維持する。
- 実catalog Course：`curriculum:0203762e-4a77-4eca-b1e0-e361cb4b780a`、C4。史学科scope `118c5183-6aec-4fa1-905a-265f25d86db1`、Mapping `2f8f63e5-2378-4057-9643-fdf28a712eca`（専門教育/必修/field null/S-only false/media-only false）。Course.mappingIdsには地理学科の選択Mapping `0203762e-4a77-4eca-b1e0-e361cb4b780a`もあるが、史学科の算入には使わない。
- 旧：通常完成行でも`special_rule_evidence_required`、allocationなし。新：official allocation O4/completed4/S0。`professional-history-required`のearned4（16未満なのでunsatisfied）、overall参考下限4、schooling参考0、imported contribution 1。卒業達成へ昇格しない。
- partial O2、O>C、O0、S null/positive/negative/NaN/±Infinity、認定免除positive、追加履修positive、professional認定overlap、duplicate、legacy/unknown課程、future catalog source、canonical装飾/番号、public/elective/method-only Mapping、unknown composition、identity/Mapping conflictは解除しない。史学演習・歴史資料学・日本/東洋/西洋史概説・考古学もholdを維持。H57書道実技、H61および他findingは未解決のまま。
- 正式regressionを36件追加。Offering removal/order/credit metadataと同CourseのPlanner earnedで4→8等にならず、Course.mappingIdsを失うとhold。frozen row/profile/catalog/componentsは不変、component40をofficial4へ加算しない。helperはH60だけ解決済みassertionへ更新し、H57のcharacterization/期待値を維持。
- 検証：planner **683/683**、audit helper **17/17**、extension **19/19**、bookmarklet **168/168**、fail/skip 0。typecheck/lint/build/diff check PASS。build内grade-import artifact checkとcatalog check PASS（Course321 / Offering686）。Viteのchunk-size警告は残るがbuild成功。CI定義の検証commandをローカルNode24で実行し、Node22のremote CI成功とは扱わない。
- production変更は`officialGraduationFacts.ts`の小predicateとspecialCourse例外だけ。`graduationCheckComplete=false`、`sourceLinksReverified=false`、schemaVersion22、persistent shape、official aggregate正本、Course.mappingIds authorityは不変。Offeringをhistorical authorityにしていない。

本文の66件inventory、A–E/P1等の集計、監査時点behavior、H38 follow-upは変更せず保存した。次slice候補はH57の通常完成書道実技を独立して扱う限定実装。H61のfamily配分は別途公式証拠の確認を要する。

## H57 implementation follow-up — 2026-10-05

- 実装commit：`95ed8b2a4dace0115b8179d9982648c34f91ef47`。branchは`feature/graduation-h57-calligraphy-completion`。開始時remote dev/baseは`c58ceb7ca38b90adcabb63054b619545ed804c90`で、提示SHAと一致。H38/H60 merge後の最新devから新規作成した。
- 変更前の実catalog監査：exact「書道実技」はCourse `curriculum:5e8b0825-7ba9-4a53-847c-7e56283718e5`、C2。日本文学科の文学/言語/芸能文化3コースに各1 Mapping（専門教育/選択/field null/C2/method-only false、catalog source page49/50/51）。学科・コース・requirementTypeをpredicateへ新規固定せず、既存Course.mappingIds・selected scope・allocation signature検証をauthorityとして使う。
- H57安全subsetのみ解決：exact institutional identity/exact canonical、2026 official catalog source＋profile current_2026、selected scopeの通常professional bucket、Course/Mapping/row composition=2、公式O2/S1又はS2、認定免除/追加履修0又はnull、method-onlyなし。identity/duplicate/Mapping conflictは前段、professional recognition overlap等は後段のguardを維持し、名称holdだけを例外化した。
- 旧：C2/O2/S1以上でもallocationなし。新：S1→ordinary2/completed2/schooling1、S2→ordinary2/completed2/schooling2。3コースそれぞれでprofessional-electiveとprofessional-japanese-totalへ2、overall参考2、schooling参考1又は2を一度だけ反映。allocation_heldを除去し、他のunresolved warningは保持する。
- S0/null/negative/NaN/±Infinity/3/0.5、O1 partial（S0/1/null）、O>C、認定免除/追加履修positive、recognized professional overlap、duplicate、legacy/unknown課程、future catalog source、unknown composition、method-only/public/nonprofessional Mappingは救済しない。書道実技2・旧課程装飾のimportをfuzzy同定せず、既存identity holdを維持する。
- `graduationProgress.ts`/`completedCurriculumCredits()`は変更なし。既存Planner経路S0=completed0、S1/S2=completed2を確認。H20 transfer認定S guardは後続で引き続きschooling_confirmationを生成する。H12/H14/H19等の契約は未変更。
- 正式regression50件を追加し、helperはH57だけを解決済みassertionへ更新。H60/他Hxxのassertionは不変。Offering有無/順序/credits99、Planner earned重複、equivalent Mappingでもofficial2を二重加算しない。Course.mappingIds欠落はhold、component40非加算、deep-frozen入力は不変。
- 検証：planner **733/733**、audit helper **17/17**、extension **19/19**、bookmarklet **168/168**、fail/skip0。typecheck/lint/build/diff check PASS。grade-import artifact check/catalog check PASS（Course321/Offering686不変）。ローカルNode24.13.0で検証し、Node22 remote CI成功とは扱わない。既存Vite chunk-size警告は残るがbuild成功。
- production変更は`officialGraduationFacts.ts`のH57 predicateと名称hold例外のみ。`graduationCheckComplete=false`、`sourceLinksReverified=false`、schemaVersion22、persistent shape、official aggregate正本、component非加算、Course.mappingIds authorityを維持。Offeringをhistorical authorityにしていない。

本文の66件inventory/A–E/P1/P2集計、H38/H60 follow-upはbaselineとして変更せず保存した。次slice候補はH12法律partialを独立し、完成8科目32単位の公式証拠とC4/O2/S2を確認できる限定ケースから扱うこと。

## H12 implementation follow-up — 2026-10-05

- 実装commit：`6550f6d07690cc406a25dad08f050497c3442792`。branchは`feature/graduation-h12-law-partial-schooling`。開始時remote dev/baseは`46249ada46c1f303446a99f10a4268f2c08bd851`で提示SHAと一致。最新devから新規作成した。
- repo内authorityを再確認：法律scope `e31201f3-4f1d-432a-906e-6af94af294c9`。選択必修は完成8科目AND32単位（catalog p.46/47）、overflowはexcess_only/double_count=false/threshold32/requires_completed_courses8（p.47）。partialのcatalog ruleは`law_partial_course_exception`、sourcePage47、unsupported表現を保持。専用allocatorのp.47 b実装と本監査S47bをauthorityとして再利用した。Webの全source再調査は行っていない。
- 例：憲法C4/選択必修（Course `curriculum:36ad2e6f-d779-4bb1-8708-0f209b94dd61`、law Mapping `9e470186-9a37-4727-9f9d-acfa75bbd660`）、西洋法制史C4/選択（Course `curriculum:564fc155-b9aa-41f2-a9a4-0136dbf84bc8`、Mapping `564fc155-b9aa-41f2-a9a4-0136dbf84bc8`）。いずれも専門教育/field null/method-only false、sourcePage46、public/special/repeatable対象外。
- H12のみ：現行2026 official catalog＋profile current_2026、法律、exact identity、selected scopeの専門選択必修/選択、Course/Mapping/row C4、公式O2/S2、認定免除/追加履修0/null、method-onlyなしに限定してgeneric partial holdを回避。special/duplicate/Mapping/recognition guardは前後とも維持。allocationは**credits2/completedCredits0/schoolingCredits2**で、完成Courseにはしない。
- 旧：8 full＋partialでもallocation8件、total32。新：8 completed/32を専用allocatorが証明した場合だけpartial2を選択へ算入しtotal34。7/28ではtotal28、7/32・8/28でもpartial0、9/36ではoverflow4＋partial2を選択へ1回ずつ算入しtotal38。選択必修/選択partialの両方で確認し、partial自身はcompleted countへ入れない。
- 入口例外だけでは汎用law total/elective要件がofficial O2を無条件加算する経路があるため、H12 allocation存在時に限りactiveな該当4要件を専用professional allocatorの値へ整合させた。required-electiveのfull-course計算やdedicated allocator自体は変更していない。既存unknown要件は昇格しない。
- threshold未達でもvalid official S2を専門S8/全体S参考へ保持。H19除外名称は従来どおりSnull→schooling_confirmationでpartial ordinary0。H20認定S guard/H14 overlapも維持。卒論selected/not_selectedはtotal34/overall34、undecidedはprofessional既知34を保つが既存H36でoverall/S参考null、status unknownを保持。
- S0/1/null/negative/NaN/±Infinity/3、O1/3/>4、C mismatch/null、wrong type、認定/追加履修positive、legacy/unknown/future、identity/Mapping不明、public/thesis/repeatable/specialは救済しない。O0/O4は既存zero/full契約。文学部partial H13も変更しない。
- 正式test64件追加＋既存H12 characterization1件を対応する新契約へ更新（H12 matrix65件）。helperはH12だけ更新。duplicate partial/full、fullとの同Course collision、Planner/official重複、equivalent Mappingでcountを水増ししない。Offering削除/順序/credits99/method変更不変、component40非加算、rows/records/catalog/profile deep-freeze/deep-equality PASS。
- 検証：planner **797/797**、audit helper **17/17**、extension **19/19**、bookmarklet **168/168**、fail/skip0。typecheck/lint/build/diff check PASS。grade-import artifact/catalog check PASS、Course321/Offering686不変。ローカルNode24.13.0。既存Vite chunk-size警告は残るがbuild成功。
- productionは`officialGraduationFacts.ts`と`graduationProgress.ts`のみ。`graduationCheckComplete=false`、`sourceLinksReverified=false`、schemaVersion22、persistent shape、official aggregate正本、Course.mappingIds authorityを維持。H02/H14/H19/H20/H36等を修正していない。既存のpartial表示文言・証拠件数とordinary算入量の区別（H47）も今回のUI修正対象外。

本文66件inventory/A–E/P1/P2集計とH38/H60/H57 follow-upはbaselineとして変更していない。次slice候補はH02のexact制度identityとannual Offering欠落の分離（保存/復元の変更範囲を先に限定すること）。

## H02 implementation follow-up — 2026-10-05

- 実装commit：`9ccf40358ab4ad4d8a59a14a01c3af1e0343547f`。branchは`feature/graduation-h02-independent-course-identity`。開始時remote dev/baseは`762d1499bb9058a778579f53b85064f621ec5a7d`で提示SHAと一致。最新devをfetchして新規作成し、旧feature/auditをbaseにしていない。
- 根本原因：公式Course参照が、institutional fieldsだけでなくcurrent annual exact relationも検証する関数を呼んでいた。`validImportedInstitutionalIdentity()`を分離し、`exactImportedCurriculumId()`はcurrent Courseに対して整合する既存exact/singletonだけを使う。既存`validImportedCurriculumIdentity()`は両方を検証する保存gateとして維持。卒業allocatorは変更していない。
- schema22のload時、独立exact Courseが有効でselected idを持つannual exactだけを回復対象とする。Offering欠落／relation欠落／annual relationが別Course Bなら、`offeringMatch`だけを`ambiguous`へdowngradeする。Course A、candidate sets、selected id、selectionSource、legacy fields、source row id/aggregate、profile、meta、study recordsを保持。選択情報は確認用の履歴でありcurrent annual exactの証明ではない。compatibleなdirect又は正式candidate relationでは無変更。既存ambiguous/unmatchedも自動昇格しない。
- institutional矛盾、exactなのに候補0/2/別id、存在しないCourse、partial extension、annual exactなのにselected id=nullは修復しない。ambiguous institutional singletonやlegacy courseIdから制度idを再生成しない。raw stale annual exactの新規saveは引き続き拒否し、load後にannual downgradeされたstateだけ保存可能。v21→v22 migrationは変更なし。
- consumer監査：`validation`/`storage`はstrict保存＋v22 load回復、`curriculumMigration`は従来のcrosswalkとcontradiction downgrade、`curriculumImportMatch`/`gradeImportApply`/`ImportedCourseRepair`はStage A保持・Stage B選択を維持。公式fact、Course progress、official-priority Planner除外、管理projectionは独立identityを利用。既存category/Media表示用のlegacy resolverを卒業authorityへ昇格していない。UIは「制度一意一致・開講要確認／未特定」を既に表示可能で、変更不要。
- 実catalogの民法総則C4/O4/S2はannual削除前後でofficial allocation O4/completed4/S2、overall参考4を保持。Course.mappingIds欠落・Mapping descriptor削除・conflict・out_of_scopeはhold、duplicate distinct idsはaggregate null／allocationなし。Offering99・component88を公式O4へ加算せず、componentsからidentityを再構築しない。
- 正式regression31件追加。既存のmissing Offering load失敗期待1件はH02の回復期待へ更新し、strict save拒否とnull selection拒否を維持。manual/auto/none、direct/candidate relation矛盾、frozen state/catalog/profile/records不変、save/reload、expectedRaw競合保護、BACKUP不変、meta/sourceCourseId/row id保持、manual再選択・再取込を検証。helperの変更はH02のみ。
- 境界：削除Offeringを直接参照するPlannerItemは引き続きinvalidで、loadは既存error/initialState結果（rawは保持）となる。無関係なPlannerItemは回復後も保持。PlannerItemやtodos/progress等のannual依存解消、CurriculumVersion、複数年度基盤は今回扱わない。
- 検証：planner **828/828**、audit helper **17/17**、extension **19/19**、bookmarklet **168/168**、fail/skip0。typecheck/lint/build/diff check PASS。grade-import artifact/catalog check PASS（Course321/Offering686不変）。ローカルNode24.13.0で検証、Node22 remote CI成功とは扱わない。既存Vite chunk-size警告は残るがbuild成功。
- production変更は`curriculumIdentityValidation.ts`、`officialCourseCredits.ts`、`storage.ts`のみ。`graduationCheckComplete=false`、`sourceLinksReverified=false`、schemaVersion22、persistent shape、official aggregate正本、Course.mappingIds authorityを維持。H01/H03/H04/H06のguardと他Hxxのassertionは変更していない。

元の66件inventory/A–E/P1/P2集計とH38/H60/H57/H12 follow-upは監査履歴として変更せず保存した。次slice候補はH36の卒論未定による既知数量の隠蔽を、completion statusと参考数量に分けて限定監査すること。

## H36 implementation follow-up — 2026-10-05

- branch：`feature/graduation-h36-reference-known-quantities`。開始時にremoteを再取得し、remote dev/base `6665047467d8efda3b832e3d35482bfc553d141a`（PR #74/H02 merge後、提示SHAから進行なし）から新規作成した。
- 原因は卒論未定reasonをreference全体の数量・targetへ共用していたこと。`referencePrerequisiteReason()`には既存のreference-wide profile/recognition guardを残し、法律の卒論未定reasonだけをoverall target/evaluationへ分離。quantity、target、statusを独立に扱い、既知earnedをstatus unknownだけでnullにしない。
- 安全なfirst-year/current_2026法律O4/S2：旧overall null/null→新earned4/target null/status unknown/coverage unknown（既存卒論未定reasonを保持）。旧global S null/null→新earned2/target30/status partial/coverage partial/reason null。公式のみ・Plannerのみ・両者重複でO4/S2、既知0、複数公式Course O12/S6を確認。official aggregate正本・component非加算・official priorityは不変。
- H12の8 completed Courses/32＋C4/O2/S2はprofessional ordinary34、overall earned34/target null/unknown、global S2/30/partialを保持。partial completed0、count8、permittedPartial2、二重計上防止は未変更。H38はordinary4とforeign unknownを保持し、認定S未確認によるschooling unknownも維持。卒論selected124/not_selected128、専門target82/86、thesis progress unknown、卒論依存generic unknownは不変。undecidedの保存statusは既存契約どおりnot_startedへ正規化し、selectedへ昇格しない。
- transfer認定欠落、invalid recognition、課程unknown/legacy、入学区分unknownの全体holdは維持。bachelorや認定S未確認、official S null、Planner allocation不確定も楽観化しない。H31/H41/H42/H43/H19は別の回帰で現状維持し、helperの他Hxx assertionは未変更。H02 annual Offering removalとCourse.mappingIds authorityも既存回帰で確認。
- 正式H36回帰32件追加、H12/H38の旧H36期待だけ更新。planner **861/861**、audit helper **17/17**、extension **19/19**、bookmarklet **168/168**、fail/skip0。typecheck/lint/build/diff check PASS。buildのgrade-import artifact/catalog check PASS（Course321/Offering686）。ローカルNode24.13.0、既存Vite chunk-size警告あり。最新devの計算との全結果比較でもselected/not_selectedと他学科を確認した。
- productionは`graduationProgress.ts`のみ。UIは既にknown earned＋unknown statusを表示できるため変更なし。persistent shape/storage/migration/profile/type変更なし、schemaVersion22、`graduationCheckComplete=false`、`sourceLinksReverified=false`を維持。H31/H37/H41/H42/H43/H19の解決は今回行っていない。

元の66件inventory、A–E/P1/P2集計、監査当時のbehavior、H38/H60/H57/H12/H02 follow-upは変更せず保存した。次slice候補はH31のmanual-review earnedによる無関係bucketへのunknown伝播を、独立して限定監査すること。

## H31 follow-up（2026-10-05）— earned manual_reviewの影響範囲と既知下限

- baseはremote再取得後の`034a24598cd62fb452401ebc08d01aa8e5c1fcdb`（PR #75/H36 merge後dev）。global `hasUnresolvedEarned`をruntime-only `UnresolvedEarnedImpact`（global fallback・候補Mapping/制度名/method・影響card ID集合）に置換した。manual_reviewの解決・catalog変更は行わない。
- 実装前inventory：raw catalogのmanual_reviewは63件、既存manual/official override後は55件matched・8件manual_review。runtimeの8件は史学演習（日本4件、東洋2件、西洋2件）、全件schooling・2単位・courseId=null・mappingIds空・curriculumCourseId=null・offeringRelations候補空。全件earned入力になり得るが、史学scopeでは既存修得順special routingの除外を維持する。歴史資料学・概説の既存専用allocationも維持。
- `attachCurriculumCatalog`/generatorのcontractを確認：現catalogのrelation候補はmatched Mappingから生成され、manual_reviewに候補Mappingを新しく与える経路は実データにはない。候補があると仮定して名前等から発明しない。回帰fixtureでは明示制度edgeを与えて局所化を検証する。
- impact authorityはOffering.mappingIdsと、Offering.curriculumCourseId／curriculum.offeringRelationsのcurriculumCourseId・candidateCurriculumCourseIds→CurriculumCourse.mappingIds→Mapping metadataの**全候補の合併**。scopeはMapping.scopeIdを使用。制度CourseのcanonicalNameは既存named target・明示transfer familyとのexact比較だけに使用。annual表示名・provisional courseId・fuzzy・候補先頭・候補1件での自動matched化は使用しない。参照欠落、未知scope/category、不正field/type、学科allocatorで扱えないtype、空候補は保守的global hold。
- 全候補のMapping scopeがcurrent/common外ならcurrent ordinary cards/requirementsとoverall referenceはbaseline一致。unsupported rulesは従来のunknownを維持。schooling referenceのglobal uncertaintyはこの場合も従来どおり残す。
- evaluateStructuredは既存mappingMatches・named target・methodの交差にだけH31 unknownを付け、resolved/official earned、projection、既知targetを保持。full-course条件の完成量・matched credits-null guard・未対応条件guardは維持。method条件自体がallowlist外である現contractも拡張しない。
- groupedCardsは一般／外国語／体育を局所化し、affectedでも既存capped earnedを保持。一般・外国語detailはcandidate fieldにのみreasonを付けて数値を保持（detail型にstatusは追加しない）。基礎特講field=nullは一般totalだけに影響。認定overlay後もH31 holdを維持し、H37/H38の既存数量/reason優先を変えない。
- professionalCardsはH31をH34 baseReasonから分離。学科ごとのtype・overflow・total、史学のschooling選択必修→選択、地理の既存stage transfer destinationの閉包にのみhold。制度family不明では当該専門のtransfer先も保守的にhold。法律schooling cardはschooling候補に影響する。resolved/officialの完成・cap・transfer後の値を下限とし、ambiguous/incompleteMetadata/legacyRepeatableのnullとreasonは維持。
- 法律H12の既存公式partial補正はH31 unknown行でも同じsafe allocator量を反映する（他unknownは従来どおり補正対象外）。公式aggregate/Course.mappingIds authority、公式優先でのearned重複排除は不変。generic manual_review candidateのcreditsは算入しない。
- overall referenceは既存互斥/capped card値からknown下限を構成し、current候補又はglobal fallbackがあればstatus/coverage unknown、既知targetを保持（H36卒論未定target=nullも維持）。schooling reference/counting、H41 officialUnknown、H42/H43/H19、H37 recognition lower-bound、H32/H34 guardsは解決対象外のまま。
- 正式回帰は一般3field/基礎特講、外国語、体育、全6学科のtype別、common+professional、scope外、空/壊れた候補、credits-null、未修得projection、matched/outside_mapping_scope、対象5種とmethod、公式併存/二重計上防止、認定/H38/H37併存、法律overflow、地理transfer family、実catalog史学special family、H34 reason、既存UI表示を含む。H31以外のaudit helper assertionは変更しない。
- production UI/persistent schema/storage/migration/profile shapeは変更なし。schemaVersion22、graduationCheckComplete=false、sourceLinksReverified=falseを維持。元本文・66件inventory・A–E/P1/P2集計・既存follow-upは追記前のまま保存。
- 検証：planner 923/923、false-unknown helper 19/19、extension 19/19、bookmarklet 168/168（skip追加なし）。typecheck/lint/build成功、git diff --check成功。buildの既存chunk-size warningは残る。PR/mergeは行わず、通常commit/push対象とする。

### H31 P2 follow-up（2026-10-05）— catalog到達可能性との整合

- `3a40be965393eecd666a8ff8dabfae22d813323d`への独立レビューを受け、schema・validation・override・generator・attach・catalog loaderを再監査した。**ケースA**：manual_reviewのOffering.mappingIdsはschemaで空必須ではなく、既知Mapping参照を持つ状態も既存resolver/attachを通る。通常raw→既存override→generator→attach→validationで直接Mapping edgeを保持し、manual_reviewのまま制度identity/relationは空になることを正式testで確認した。現runtime8件はこのedgeを持たないため、実データでのgeneric局所化caseが存在すると主張しない。
- source分類：Offering.mappingIds＝A（有効な直接edge）。Offering.curriculumCourseId＝manual_review出力ではC（schemaは入力を許すがattachがnullへ上書き；matched出力ならB）。offeringRelations.curriculumCourseId/candidateCurriculumCourseIds＝B（nonemptyはmatched-only）、manual_reviewでnonemptyならC（schema単独は許すがattachがstaleとしてreject）。CurriculumCourse.mappingIds＝Aの直接Mapping owner/metadata lookupだけに使用し、Course ID／relationからの候補発見経路には使用しない。不存在・壊れた参照はDとしてglobal hold又は既存validation failure。provisional courseId/legacyCourseRelationsはimpact authorityにしない。
- production変更はunresolvedEarnedImpact helperのみ。局所化authorityを**直接Offering.mappingIdsだけ**へ限定し、Offering制度Course ID・relation制度Course ID・relation候補からMappingを発見する経路を削除した。manual_reviewのstale/nonempty relation、post-attachのnonnull制度identity、空候補、unsafe Mappingはglobal hold。直接edgeで到達可能な学科別dependency closure・既知下限は維持する。
- H31主要fixtureはUUID参照と686件の年次coverageを持ち、計算前にvalidateCatalog→attachCurriculumCatalog→validateCatalog→全Mapping参照確認を毎回実行する。一般／外国語／体育／全6学科／scope外／named target／method／認定／overflow/transfer/UIの局所化回帰を直接Mappingへ再構築した。旧mixed制度relation fixtureは直接Mapping unionへ変更し、stale candidate/identity経路はattach reject・normalizationとmalformed global fallbackの独立testに再分類。テスト削除/skip追加は行わない。
- raw63→既存override55件matched→runtime8件manual_reviewを再確認。55件はexplicit override mappingsを持つ通常matched allocationであり、unresolved candidateへ戻さない。runtime8件は史学演習日本4/東洋2/西洋2、schooling2、mappingIds空、courseId/制度identity=null、relation候補空。史学scopeの既存special routing/修得順holdとgeneric除外は維持。
- evaluateStructured/groupedCards/professionalCardsの既知下限・candidate credits非算入・overall known下限＋unknownは維持。H02/H12/H32/H34/H36/H38/H41/H42/H43/H19、schoolingUnknown/officialUnknown後段は変更しない。catalog/schema/generator/attach/persistent/UIは変更なし、schema22・両false flagを維持。future manual_review candidate-relation設計は別sliceであり、今回の根拠には使わない。元本文と先行H31 follow-upは履歴として保存した。
- 検証：planner931/931、H31を含むaudit helper20/20、catalog contract系64/64（plannerにも含まれる）を直接実行し成功。extension19/19、bookmarklet168/168、typecheck/lint/build、git diff --check成功。skip追加なし。buildの既存chunk-size warningは残る。

## H37 implementation follow-up — 2026-10-05

- base：最初に専用checkoutを取得し、remoteを再取得した時点の`origin/dev`は`62b07defe2329d4c08d839a36bfc1307caddebb3`（PR #76/H31 merge後、提示SHAから進行なし）。ここから`feature/graduation-h37-preserve-general-recognition-lower-bound`を新規作成した。
- reproduction：公式／resolvedの人文4＋人文認定unknownでは、修正前はdetail/general earnedともnull、overall参考では既知4が消えた。既知認定8＋8と自然unknown、総量36でも自然minimum4/8、放送大学認定併存でも同じ問題を正式testで再現した。
- root cause：`applyRecognition()`が未知の認定増分をdetail earned=nullで表し、そのnullから一般group earnedもnullにした。`countedOverallCredits()`はそのcardを0として合計し、既知修得下限まで参考量から落としていた。
- new contract：`known quantity + evaluation/completion unknown`。通常の安全な一般算入量、値が確定したrecognized、既存contractの放送大学認定だけを1回ずつ加算し、一般36 capを維持する。unknown増分は加算せず、未達fieldのdetail reason／group statusとreasonで未確認を表す。detailにstatus型を追加しない。
- 人文4/8＋認定unknownはdetail4/general4/unknown、overall4/target124/unknownとなる。総量36でも未確認field minimumが残ればunknown。既知量だけで全field minimumと36を満たす場合はsatisfiedを維持する。first-yearと、既にminimumを満たしたfieldの未知追加認定を新たなholdへ広げない。
- overallはH37由来のstatus/coverage/reasonだけを追加し、quantity/targetへglobal prerequisiteを追加しない。既存profile/invalid recognition hold、H36 law thesis target hold、H31 unresolved-earnedのreason優先、H41 officialUnknown後段を維持する。H31併存の旧H37 characterizationはgeneral32/overall42へ更新し、candidate90は加算せず、general/physicalのH31 unknownを解除しない。
- 放送大学10は一般totalだけへ入り、3field minimumには配分しない。aggregate認定totalと内訳を二重計上しない。個別exemptのdetailは従来の要件免除表示を保ち、earned totalへ8を加算しない。all-exemptは従来どおりgeneral earned0で放送大学overlayを抑止する。
- changed files：`src/planner/graduationProgress.ts`、`tests/graduation-audit.test.mjs`、本書の末尾追記だけ。productionは一般認定overlayとoverallのH37 evaluation propagationに限定。外国語／schoolingのproduction分岐、official aggregate authority、Course/Mapping authority、schema/storage/migration/profile/UIは変更しない。schemaVersion22、`graduationCheckComplete=false`、`sourceLinksReverified=false`を維持する。
- 正式H37回帰31件を追加。3field×公式／Planner／混在、既知認定＋unknown、36 cap＋field未達、全条件既知、放送大学／認定aggregate、個別／全免除、法律卒論3状態、独立profile guards、known0、first-year、年次Offering欠落、component40非加算、official/Planner duplicate、H38 foreign4/Snull、H41/H42/H43併存を含む。先行H31/H38 testはH37が変える期待だけ更新し、candidate非算入と既存reason優先を追加確認した。
- 検証：H37/H38/H31-overlay targeted **57/57**、planner **962/962**、extension **19/19**、bookmarklet **168/168**、audit helper **20/20**、fail/skip0。typecheck/lint/build/`git diff --check` PASS。buildのgrade-import artifact/catalog check PASS（Course321/Offering686）。既存Vite chunk-size warningのみ残る。audit helperのH37以外のassertionは変更せずそのまま成功した。
- 未解決の隣接範囲：H25、H39、H14、H20、H32、H34、H41/H42/H43、H19等は今回解決しない。H31局所holdと既知下限、H36数量／target分離、H38 foreign earned4/status unknownは既存の修正を維持する。

元の66件inventory、A–E/P1/P2集計、監査当時のbehavior、および先行follow-upは履歴として変更せず保存した。

## H37 review follow-up — total-only recognition uncertainty — 2026-10-05

- 同じ`feature/graduation-h37-preserve-general-recognition-lower-bound`上で、先行commit `23afceed65276868c1ce30dfec8f60a00540a2d9`へ追加修正する。remote再取得後もbranch/開始時base `62b07defe2329d4c08d839a36bfc1307caddebb3`は維持し、新branch・PR・merge・history rewriteは行わない。
- P1 reproduction：一般教育8/8/8＝total24、12/8/8＝total28は各field minimumが既知で満たされるため、先行実装の`details.some(detail.reason === '認定情報未確認')`がfalseになり、未知の認定増分でtotal36へ到達し得るのにunsatisfiedと確定していた。新回帰の修正前実行ではtotal-only17件中15件が失敗し、既にtotal36を満たす2件だけ成功した。
- field minimumのunknownとtotal36のunknownを分離する。`knownTotal`は従来どおり安全なcard earned＋確定recognized＋既存ルールの放送大学認定だけから計算し、unknown認定増分は加算しない。`recognitionMayApply`かつ既知total36未満かついずれかのgeneral mode unknownなら、field minimumがすべて満たされていてもgroup status/reasonをunknownにする。満たされたdetailへ認定未確認reasonは追加しない。
- 先行follow-upの「既にminimumを満たしたfieldの未知追加認定を新たなholdへ広げない」はfield-level理由の局所性としてのみ維持する。group-levelではtotal36の達成可否への影響も確認する。既知量だけで全field minimumとtotal36を満たせばsatisfiedを維持する。
- overallへのproduction変更は不要。既存H37 evaluation propagationがgroup-level total uncertaintyも受け取り、earned24/28・target124を保ったままstatus/coverage unknownとする。profile hold、H36 target hold、H31 reason優先、H38 foreign4/Snull、H41/H42/H43後段は変更しない。
- 追加回帰19件：8/8/8・12/8/8×unknown3field×公式/Planner、known recognition0/4/12の一度だけ加算と36到達時の解除、放送大学0/8のtotalのみへの算入と36境界、confirmed none/first-year境界。既存の全minimum＋total36達成回帰も維持する。schemaVersion22、`graduationCheckComplete=false`、`sourceLinksReverified=false`を確認する。
- changed files：`graduationProgress.ts`の一般教育overlayのみ、`tests/graduation-audit.test.mjs`への回帰追加、本書末尾の追記。schema/storage/migration/profile/UI、official aggregate正本、Course/Mapping identity authority、外国語／schoolingのproduction分岐は不変。元inventoryと先行follow-upは監査履歴として保存し、今回の訂正をこの追記に限定する。
- 検証：H37/H38/H31-overlay targeted **76/76**、planner **981/981**、extension **19/19**、bookmarklet **168/168**、audit helper **20/20**。fail/skip0、既存test削除/skip追加なし。typecheck/lint/build/`git diff --check` PASS。grade-import artifacts/catalog check PASS（Course321/Offering686）、既存Vite chunk-size warningは維持。

## H41 implementation follow-up — 2026-10-05

- actual base：専用checkout取得後、作業開始時に`git fetch origin`で再取得した`origin/dev`は`1774d0e4c93d797ad0fadb24697ffbd6e4b3a7b8`（PR #77/H37 merge後）。このSHAから`feature/graduation-h41-localize-official-unknown-impact`を作成した。古いfeature branchはbaseにしていない。
- reproduction：exact institutional Courseの専門選択科目で公式amountがnull、又は異なるsource row IDのduplicate4/4・4/8が残るだけで、従来は一般・体育・無関係の専門bucket・structured requirementすべてにH41 reasonが付いた。一般自然の保留でも全専門cardへ伝播した。今回、専門選択の保留は選択＋専門total、一般自然の保留は一般group＋自然field/一般totalのstructured targetへ限定する。既知の専門選択12はearned12/status unknown、overallも12/既知target/unknownのまま保持する。
- root cause：`calculateGraduationProgress()`の`officialUnknown`がordinary/completionとschoolingの両方に使われ、卒論以外の全requirements/cardsに同一の公式算入保留を付けていた。数量を未解決にした理由と、その未解決budgetが影響し得るdestinationの証拠が分離されていなかった。
- localization authority：新しいpure helper `unresolvedOfficialImpact()`が、`deriveOfficialGraduationFacts()`のunknownかつ非all-zero fact、exact `curriculumCourseId`/`canonicalName`、`candidateMappingIds`と制度Courseの`mappingIds`、current/common scopeのMappingを検証する。候補を1件選ばずunionを取る。derive時に不存在edgeが候補から落ちることもあるため、元Courseの全edgeを検証し、candidate集合との一致を確認する。Course.scopeIdsは従来どおりdiagnosticでありallocation/impact authorityにしない。annual Offering、表示名、PlannerItem identity、component creditsはimpactの入力authorityにしない。
- global fallback：orphan record、exact Course不明、候補なし/不一致、Mapping不存在/重複、複数Courseによる同一Mapping所有、不正scope/category/field/type/method flag/数値metadata、Course/Mapping単位metadataの不一致、2026以外のcatalog source/schema、current curriculumを確認できないprofile、recognized_overlap、既存ルールからdependency closureを安全に求められないspecial familyは従来の全体保留を維持する。1つでもunsafe edgeがあれば他のsafe edgeだけで局所化しない。unknown amount自体はdestination不明を意味しないため、両制度metadataが一致してnullの場合やsource row composition不一致でもsafe destinationは保持できる。row aggregateを推定・sum・maxしない。
- dependency closure：一般→group-general、外国語→group-foreign、体育→group-physical。専門はH31の`unresolvedEarnedImpact.ts`の学科/type別closureを参考に、選択必修→選択overflow、法律の科目数gateと選択/total、学科別professional totalを含む。地理は既存`GEOGRAPHY_TRANSFER_RULES_2026`のexact canonical identityとstageのtype/fieldをunion。史学概説は必修・スクーリング選択必修・選択、5科目gateで既存史学演習2が振り替わる選択field/演習cardと名前付き依存先まで含める。史学にはtotal cardを新設しない。既存の算入先・cap・repeatable/special allocation処理は変更せず、史学演習・歴史資料学・公開科目・その他repeatable等のclosure不明familyはglobalに残す。
- structured requirements：category/field/requirement_typeとinstitutional canonical course_name/course_names、上記の振替先/合計への交差だけにordinaryのH41 reasonを付ける。名前付きtargetを制度candidateが安全に特定できる場合、annual Offeringがゼロでも既知算入の下限0とtargetを保持する。official methodを確定できない場合は両methodへの影響可能性を保持し、annual methodで補完しない。未対応condition等の既存unknown reasonを先頭に残す。
- numeric lower bound：helperは単位を生成せず、known allocationだけを既存allocatorが算入する。duplicate/metadata hold/candidate量は非加算。localized holdではoverallの既知下限0もnullにしないが、status/coverageはunknownのまま。H40を含むglobal fallbackのquantity uncertainty、独立profile prerequisite、H36の未定卒論target=nullは維持する。H31/H37/H38等の既存reasonを優先し、H41 reasonは従来の順序で後置する。
- H42/H43 boundary：`officialUnknown`のbroader booleanと`schoolingUnknown`の式を維持し、ordinaryのlocalized impactと分離した。外国語completion・法律schooling card・schooling referenceは依然として広くunknownになる。従来全体official holdでunknownだった`min_schooling_credits`のstructured rowも、局所化時はschooling reasonで保留を継続する。ordinary hold中の独立S2を新たにallocationへ足さず、S referenceの従来nullも保持する。H42/H43のstatusとH41 reasonの有無は別々に正式testで確認する。
- changed files：`src/planner/unresolvedOfficialImpact.ts`（新規pure helper）、`src/planner/graduationProgress.ts`（impact適用・局所化時の既知0保持）、`src/planner/officialGraduationFacts.ts`（既存special判定を同一実装のままexport）、`tests/graduation-audit.test.mjs`、本書末尾の追記。H31 authority/実装、catalog/schema/storage/profile shape、UI、component→aggregate契約は変更しない。
- regression cases：H41正式回帰79件を追加。common3field/外国語/体育、6学科のtype別closure、structured category/field/type/names/依存total、safe candidate union、unsafe edge/metadata、duplicate4/4・4/8・null混在、amount/制度metadata unknown、orphan/component40、all-zero/out-of-scope、known12/overall target、H42/H43、H31 reason併存、H36卒論3状態、special fallback、地理stage、史学概説/演習依存、method不明、stale retained candidates、outside edgeとdiagnostic scopeIds、recognition overlap、frozen rows/records/catalog/profile/previous resultを固定した。通常fixtureはschema→attach→schema→Mapping resolverを通し、malformed safety caseのみ明示的にpost-attachを変更する。既存22回帰のH41が変更する0下限/局所status期待だけを更新し、source amount=null/duplicate非集約、S quantity/reasonのassertionを保持した。test削除/skip追加なし。
- invariants：`PlannerState.schemaVersion=22`、`graduationCheckComplete=false`、`sourceLinksReverified=false`。公式aggregate正本は`ImportedCourseAchievement.earnedCreditsTotal`のまま。component量・candidate/held量をearnedに足さず、unknownを確定0として扱わない。
- unresolved adjacent IDs：H40、H42、H43、H19、H14/H20、H32、H34、H39、H55–H62の未解決special semanticsはこのsliceの対象外。元H01–H66 inventory、過去behavior、先行follow-upは書き換えず履歴として保存した。
- 検証：H41 targeted **79/79**（先行実行）、`npm run test:planner` **1060/1060**、`npm run test:extension` **19/19**、`npm run test:bookmarklet` **168/168**、false-unknown audit helper **20/20**。fail/skip0。`npm run typecheck`、`npm run lint`、`npm run build`、`git diff --check` PASS。build内のgrade-import artifact/catalog check PASS（Course321/Offering686）、既存Vite chunk-size warningのみ残る。監査文書のbase時点の全byteがprefixとして保存されていることも確認した。通常commit/pushのみとし、PR作成・mergeは行わない。

## H41 review follow-up — saturation / monotonicity — 2026-10-05

- 対象：同じ`feature/graduation-h41-localize-official-unknown-impact`上の先行commit `53341c909180f320b575b65f90270690259070cf`への追加修正。remote再取得後もHEAD/remote featureは同SHA。新branch・PR・merge・history rewriteは行わない。
- P2 reproduction：known人文12＋社会12＋自然12で一般36/各field minimum達成済みでも、safe一般Mappingのofficial held factを加えると、先行H41がsatisfiedをunknownへ戻した。体育2や専門最低要件、達成済みstructured minimumも同様。追加回帰の先行21件を修正前に実行し13件が失敗した。
- root cause：potential destinationへの交差とevaluationが変わり得るかを同一視し、affectedなら既存statusを無条件に上書きしていた。
- 修正：pure helper `officialEvaluationCanChange()`を追加し、既存impact判定の後で評価の単調性を確認する。safe localized impact、known earned/target、既存status=satisfiedを前提に、minimum/cappedのgroup/professional_groupを維持する。単純なearned>=targetではなく、既存evaluatorがfield・科目数等の全条件を満たした結果を使う。選択必修32/8科目はsatisfiedを維持し、未達の選択overflow先/専門totalは独立にholdする。dependent側もすでに確定達成なら維持する。
- structured：`min_credits`/`min_courses`/`required_course`と既存lower-bound条件（full_course_credits_required/min_courses、activeな卒論when）に限定して、確定satisfiedならH41 reasonを追加しない。max_credits/exact_credits、choose_one、未知condition、既存unknown、unsafe global fallbackはconservative hold。史学5科目gateによる既存演習の再配分で減少し得る名前/field付きスクーリング選択必修source subsetもholdを継続し、振替に左右されない専門ordinary合計は単調なminimumとして維持する。
- 境界：held/candidate単位は非加算、known earned/target/reasonは保持する。overallは引き続きknown lower bound＋unknown。H42のschooling後段とH43の独立S未算入、H31既存unknown/reason優先、H36/H37/H38の独立条件は変更しない。schemaVersion22、graduationCheckComplete=false、sourceLinksReverified=falseを維持する。
- 回帰22件追加：一般36＋各minimum、体育2、法律32/8科目と未達/達成済みdependent、general36でもfield不足、law32でも科目数不足、structured最低/完成/科目数・max/exact/choose、global fallback、H31優先、H42/H43外国語/S、frozen input/previous result、史学source再配分とordinary total。先行79件は編集せず維持した。
- changed files：`src/planner/unresolvedOfficialImpact.ts`、`src/planner/graduationProgress.ts`、`tests/graduation-audit.test.mjs`、本書の末尾追記のみ。先行監査記録は履歴として保存する。
- 最終検証：H41 targeted **101/101**（既存79＋追加22）、planner **1082/1082**、extension **19/19**、bookmarklet **168/168**。fail/skip0。typecheck/lint/build/`git diff --check` PASS。buildのgrade-import artifact/catalog checkも成功し、既存Vite chunk-size warningのみ残る。通常の追加commit/push対象とし、PR作成・mergeは行わない。
