# Work B 正値計算の実装・自己検証報告

対象: wata-0911/housei-media、Issue #188。基点は2026-11-04に照合した最新dev c71a53ffbe7268e1da4b2e5c5c71c374a78e76cb。

**判定: 正値の条件付き計算を実装した部分成果。本人適用が証明済みの卒業算入を完成したとは扱えず、初回公開の阻害事項は残る。** 11月8日の目標達成を保証する成果ではない。独立clone/detached HEADで実装し、依存パッケージのみ既存node_modulesを参照。Work A保存、Work C画面、schema、公式原行は変更していない。commit/push/PR作成/merge/本番接続/独立監査起動なし。

## 照合したものと公式根拠

PR #179 cd0609f5e9d6ea38d465f3547e0016f50f2a7dd0はmerged、#181 eac55bdd5bac3083a946d517e3c5dfbdd587ee08はOpen/Draft。#181は本人適用・方法・detail排他associationを証明せず、正値allocatorを解放しない。未マージPR全体を取り込んでいない。

年度非依存化設計書docs/planner-year-independent-design.mdの、stable科目→配置→既存学科規則、公式数量/本人寄与/算入の分離、計画年度で適用を確定しない条件を維持した。Work A監査候補のdocs/planner-attempt-production-handoff.mdを照合。schema24のscope null/applicability unknown/not_evaluatedを計算のために書き換えない。

公式ルールの根拠はYI-01/YI-02で確認済みの科目表と注記（一般教育p44–45、法律p46、日本文学p49–51、史学p52–53、地理p54–55、経済p56–57、商業p58–59）。2013変更への注記はあるが、masterの唯一のcurriculumVersionはapplicabilityStatus=unknown/effectiveConditions=[]のまま。自己申告の入学年・計画年度・名称一致を、大学が確認した本人適用へ昇格させる規則は追加していない。

大学公開資料の検索で[2026学習のしおり](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf)、[2013変更資料](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2024/12/curr_2013henkou.pdf)、[訂正案内](https://www.tsukyo.hosei.ac.jp/topics/20260302_6371.html)を確認。2026 PDFの全文取得はwebツールのサイズ制限で失敗した。今回、大学版PDF全体と既存原版の一致・訂正全体の再監査は完了していない。sourceLinksReverifiedをtrueにしない。

不足する本人根拠は所属学科/コース、入学・編入・復籍/再入学等の公式な履歴、適用・経過措置との対応。資料だけでは任意の利用者のこれらの事実を証明できない。schema24に公式取込がない利用者にも「記録を選択課程へ当てはめた場合」の計算はできるが、本人適用はunverifiedを返す。この条件付き数値を証明済みの卒業要件達成値と表示してはいけない。

## 実装

`graduationProgress.ts`の公式科目単位入力のうち、配分に必要な部分をCourseAllocationInputとして共通化した。既存のgroupedCards/professionalCards/evaluateStructuredを同じ実装のまま利用する。通常の既存呼出しでは追加配分入力は空であり、既存出力を変えない。新しい公式成績行・Offering・PlannerItemを作らない。

新入口は`calculateRecordedCredits(graphJson, source, scopeId)`。graphJsonは最大1Mi UTF-16 code unitsのprimitive JSON文字列。private parse後に既存validateAttemptGraphを使用する。入力の自己参照、getter等を直接計算へ渡さない。

通常科目は確定ICと明示選択配置の一致、安全なcrosswalk、数量の明示、方法制約を検査してまとめる。通信2だけの4単位科目は完成0。通信2+S2、通信4は完成4。通信4を二回記録しても通常科目を8単位にしない。超過とS配分が混在して配分が決まらない場合は保留する。未完成S単独例外は未接続のため保留。反復は既存のREPEATABLE_CREDIT_RULESを再利用し、法律学演習の2単位×6を記録12/算入入力8へ制限する。学科配分は既存allocatorで行う。

公式成績が同一科目を所有すると本人増分を0にし、公式のnull/0も手動値で埋めない。公式科目が未確定なら重複可能性を保留する。異なる公式行への明示リンクも手動補完を認めない。

`graduation_rules.json`は既存の適用済み科目/区分/規則を抽出した計算用データ。offerings/coursesは空、curriculum.offeringRelationsも空。生成元はscripts/work-b/extract-rules.mjsであり、準備時に既存catalogを読み出すが、新計算の実行時には年間Offeringを検索・数量参照しない。2026は資料版であり将来開講の保証ではない。旧データのsource decoder、YI-07のschema23検査には旧catalogとの互換経路が残る。

## schema23/24・Work A/C契約

- schema23: 保存層が検証したSourceArchiveを使う。requireDecodedと既存YI-07のsource-bound検査を通し、公式原行をsource.stateから読む。呼出側が任意の公式数量を追加する引数はない。
- schema24: createNewPlanSourceが返すpinned sourceをそのまま受ける。clone/偽sourceは拒否。SourceArchiveにcastしたり、空の旧rawを偽造しない。公式原行は空として実際の新規利用を計算する。
- 保存層のgraph/viewは読取データ。呼出側が信頼済みgraphをJSONへencodeし、committedかdraftかを表示側で明示する。本APIは保存資格・CAS・履歴資格を発行しない。Work A source/stateを変更しない。

出力のbasisはselected_curriculum_learner_record_scenario。personalApplicabilityはunverifiedと不足証拠。coursesは本人記録の合計、完成単位、配分入力の単位とS単位、公式優先の増分0を示す。**courses.incrementは既存allocatorへの入力であり、学科間の配分・上限適用後の全体卒業単位ではない。** 最終の条件付き要件値はprogress.cards/requirementsを使用する。

informationalは予定・履修中・修得済みをstatusと明示寄与で分離。予定/履修中の要件別配分は今回未実装なので、該当状態が存在する場合のprogressの対応列はnullにする。数量省略/nullを構成単位で補完しない。holdsがあればprogressは保留分を含まない部分計算であり、完成した総合進捗として表示しない。releaseReady=false、graduationCheckComplete=false。

## 自己検証と残課題

最終の正値suiteは62件: 全8課程の共通4単位科目によるT2/T2+S2/T4/再履修上限/予定と履修中、全8課程の専門科目正値、公式優先、schema24偽source拒否、年度Offering空、法律学演習の正値反復上限、曖昧な総合特講の保留。正値期待値をassertしている。ただし本人適用の公式証明ではなく、選択課程の条件付き算入である。

固定192ケースは既存卒業計算と科目完成の全出力一致を確認。既存回帰1,527件もPASS（FAIL/SKIP 0）。最終typecheck/lint/build、差分検査を確認し、verificationに保存した。62件にはschema23の公式成績なし正値と公式null優先も含む。最初の反復テストは対象科目が見つからない際に空のassertで終了しており、正値上限を検証できていなかったため採用しない。実在する法律学演習の正値テストへ置換した。総合特講の8課程テストはidentityが曖昧なため保留をassertするもので、正値反復の全8課程対応と数えない。

未完成: 本人適用の検証済み入口、全8課程すべての反復科目identity解消、史学演習の順序/史学概説の方式配分、地理の特殊科目配分、書道、未完成S単独例外、予定/履修中の要件別配分、Work A/Cの実接続。schema23の専門認定行は旧Offeringとの関連を捨てないため新入口では明示拒否する。保存済みの学科別卒論進捗は既存helper経由で計算に引き継ぐ。特殊科目を一般科目の合計で代替せず保留している。**ユーザー指定の「十分な本人適用根拠がある記録を含めた正の卒業算入完成」の条件は未達で、独立監査候補の部分実装として停止する。**
