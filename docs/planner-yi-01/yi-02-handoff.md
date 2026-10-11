# YI-02: 独立read modelへの引き継ぎ

前提は[監査概要](README.md)と[stable ID契約](stable-id-design.md)。この文書は実装入力の設計であり、read modelの実装開始・runtimeカタログ更新の指示ではない。state22、graduationCheckComplete=false、sourceLinksReverified=falseを継続する。

## 最小データ契約

| record | 必須責務 |
| --- | --- |
| SourceRevision | 資料名・版表示・原版digest・取得元/日（unknown可）・冊子/PDF対応・抽出品質・可視行証拠。PDF版と適用課程版を分離 |
| InstitutionalCourse | stable ID、資料版に属する名称定義、制度identity証拠、名称履歴、unresolved/retired等の状態。単位/分類を恒久fieldにしない |
| CurriculumVersion | 適用課程の公式定義、資料revision参照、明示適用条件・改正根拠・未確認範囲。単なる計画年度から生成しない |
| CurriculumPlacement | ic参照は未確認ならnull＋候補。version/scope/role、構成単位（nullと0区別）、分類/分野/必選、必須方式、脚注・rule参照、原表行locator |
| IdentityDecision / Crosswalk | oldEntityKind/oldId、原版digest集合、候補・採用ID、今回資料版status、placementStatus、歴史連続性、rule ID/version、適用scope/条件、audit revision |
| LegacyArchive | 旧2026 Offeringと209 provisional CourseのID・旧定義・snapshot参照。独立マスターのロード成立に686 relationを要求しない |
| UnresolvedRecord | 元名称・旧ID・原版・候補・証拠不足理由・個人の元scope/数量。stableRefとplacementRefの片方または両方nullを許す |

元PDF digestと元JSONの6 digestはsummary.jsonを参照。raw catalog digestはbackup v2のenriched/semantic digestと同一ではない。バックアップ互換では既存のpin済み原版・canonicalization契約を継承し、この監査digestで置換しない。crosswalk入力は旧定義・override・curriculum sourceを含む同じ原版集合に限定する。

制度マスターはOpeningなしでもロード可能で、Offering/curriculum sourceの名前から必要行をruntime生成しない。旧686 Offeringを検索できる互換archiveと、制度科目の独立検索は別の責務。年度別Opening・開講期・スクーリング日程・年度固有履修条件を新masterへ追加しない。

## safe crosswalkの採用ゲート

- 221 CurriculumCourse/273 Mappingのsafe sliceだけを候補にできる。将来の採用では、原版一致・証拠一意・全memberとscope/roleの整合・ruleVersion1をもう一度検証する。
- `status=safe`でもhistoricalContinuityStatusはunverified。2026資料版の参照が確定したことを、旧課程の自動読替や本人課程確定へ拡張しない。
- 公式原行のlocator対応502件は、identity safe502件の意味ではない。配置とic確定が独立であることをUI/loaderへ保つ。
- 6 C-METHODはadoptedStableId=null、placementStatus=conflict。requirementTypeと方式markerを一緒に読むcontractを確定し、旧bool意味を確認するまで独立Placementへ安全確定しない。
- `legacy Course relation unique209`、`Offering relation unique616`も、そのままstable exactへ昇格しない。各参照先のsafe・scope・資料版のgateを通す。
- 53手動overrideと2公式overrideの来歴を保存。今回の画像照合は個別開講コードとの直接対応証明ではない。古いsource linkは付替えない。

## unresolvedの保持

| 分類 | YI-02の表示・保持 |
| --- | --- |
| ambiguous: CC85 / Mapping214 | candidates/peer、旧equivalence memberと根拠、正式原ラベル、配置locatorを残す。先頭候補を自動選択せず、科目確定と算入保留を別表示 |
| conflict: CC6 / Mapping6 | 双方の元値・原表区分・bool問題を保持。修正した値で原版を上書きしない。未解決参照の記録保持は可能 |
| unmatched: CC9 / Mapping9 | 公開/認定枠の正式行を課程のbucket/rule候補として保持。個別icを捏造しない。旧IDを失わず、利用者の独立公開科目記録も統合しない |
| unknown/legacy applicability | 元課程状態・元名称・公式値のnull/0・手動値を保持。選択scopeの変更で旧実績や手動分類を更新しない |

未知課程・未確認科目を保存できる契約を先に用意する。新しい完全masterがないことを理由に原記録を消さない。記録保持・制度科目照合・卒業算入の3状態を分ける。earnedCreditsTotalは公式修得単位の正本で、内訳・マスター・手動寄与・進捗から再計算/補完しない。

## loaderが検証する不変条件

1. namespaceごとのID一意性、未知namespace拒否、oldEntityKind＋digest＋IDでの互換resolve。裸UUIDや名前fallbackを使わない。
2. SourceRevision digest/証拠locatorの存在、version→source参照、scopeの存在。未知版を最新と同じとして通さない。
3. Placementのic参照（nullable）、候補の監査registry参照（未採用ic候補はlegacy/audit候補として保持し、確定master参照と区別）、version/scope/roleの一意性。ic+version+scopeだけでは同名複数配置を禁止しない。
4. safeは一採用ID・候補一つ・根拠あり・矛盾なし・rule版一致。非safeはadoptedStableId=null。同名peer/異単位/番号差をnormで統合しない。
5. 構成単位null≠0、個別単位≠卒業所要総枠、必須方式と区分/記号の一致。旧Offering単位fallbackで構成単位を埋めない。
6. 公式identityと読替relationの区別。統合/分割や充当が一対一exactに混入しない。relation循環・dangling・矛盾した方向/条件を検出する。
7. 原版旧321/502/686/209の互換coverage。未知/保留でも旧参照を保持し、source linkと個人数量を変えない。
8. 制度read modelのロード・検索はOffering relation coverageに依存しない。開講なし36件も表示できる。
9. historicalContinuityStatusとapplicabilityが未確認なら未確認のまま。入学年、plannedYear、試験/取得日時、capturedAtからcvを選ばない。
10. 校正/追加確認後は新audit revision＋訂正履歴。前のdecisionを消してPASS率を上げない。

YI-02で必要なテストは、公式原行だけでロードできること、null/unknown保持、同名4/2配置の同一scope内共存、番号I/Ⅱ/A/B/(1)/(2)の保持、bucket非科目、学科別コード、safeと歴史連続性の分離、原版不一致拒否。保存migrationやAttemptの実装はYI-02へ先取りしない。

## 大学・公式追加資料への確認事項

問い合わせは本監査で送信していない。資料取得・回答原本・対象学科・適用条件・確認日を新根拠として保存してから判定を改訂する。

| 問い | 必要な公式根拠 / 対象 |
| --- | --- |
| 学科を跨る同名科目の制度上同一扱い | A-GROUP58とA-PEER22の全一覧。共通コードでも同一科目扱いか、重複履修・読替・成績名称がどうなるか。学科別単位/分類差をidentity差と決めない |
| 史学科概説4＋2のidentity | p.52/53 c。同一科目の別配置か、別の公式科目identityか。成績原行と修得順の結び付き |
| 史学演習・歴史資料学のidentity粒度 | p.53 e/f/i。順序slotと日本/東洋/西洋分野・内容科目との関係、現在の1〜4/1〜6表示と成績上科目コード |
| 地理の演習・現地研究・特講 | p.54/55 d/e/f/g/h/i。必修→選択必修→選択への算入は同一科目履修回の配分か、別identity参照か。2008/2009/2019の旧名称を一意に識別する資料 |
| S必須6のbool意味 | 元source parser/manifest原本を追加取得。公式の必須区分と個別Ⓢ印を分けたfield契約をYI-02で決める。これは大学質問と元生成者確認を区別 |
| 教育法/商法の旧条件 | p.60/65、p.200/202。履修途中・未着手・復籍の公式照合に必要な情報、過年度原表とコード履歴 |
| 2013改正全体と過年度課程 | ログイン後「2013年度からの変更点」、2012年度以前の全学科表。p.60-65は抜粋なので不足範囲を追加取得 |
| 卒業論文の学科別同一性 | 4/6/8と指導条件。横断icにする直接根拠がなければ個別候補を維持 |
| 教職と本科生用途 | 社会思想史2/4、34534/44531等、政治学教職override。p.214の続きと教職手引きの対象版。免許課程確認を通常卒業masterへ混入しない |
| 明記名称変更の旧原行 | 情報科学実習、論文作成基礎講座、現地研究系。名称変更の事実だけで歴史的成績の元ID/版を推測しない |

YI-02は未解決を持つ独立read modelまで進められる。全ambiguousを解消することをloader完成の前提にしないが、保留をsafeへ無根拠で変更して完了させない。卒業判定完了・sourceリンク全再検証のflagは維持する。
