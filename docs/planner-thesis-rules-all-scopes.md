# 卒業論文ルール（全scope）監査

2026年度「学習のしおり」抜粋 `shiori202646-61.pdf`（教育課程表 p.46〜59）を正本として、catalogの `requirements` と照合した。判定は卒業可否の全体判定ではなく、Plannerの部分進捗表示に限る。`graduationCheckComplete=false` は維持する。

## 判定基準

- `required`: catalogに無条件の `required_course` / `course_name: 卒業論文` と単位数があり、公式表にも卒業要件として明記される。選択UIは表示しない。
- `optional`: `conditions.when.thesis_selected: true` と `false` の両方に公式の構造化ルールがある。3択UIを表示する。
- `unknown`: 上記のどちらも満たさない。履修時の前提指導だけ、または「含む」だけでは、必要単位・非履修時の分岐を推測しない。

## scope別結果

| scope | policy | 公式根拠・catalog根拠 | Plannerでの扱い |
| --- | --- | --- | --- |
| 法学部 / 法律学科 | `optional` | p.46: 卒業論文は選択4単位、これを含む選択50 / 専門82、選択しない場合は54 / 86。p.47: 選択時のみ一般指導が必要。`law_*_with_thesis` と `law_*_without_thesis`。 | 未定 / 履修する / 履修しないを表示。未定時は依存要件を保留。 |
| 文学部 / 日本文学科 / 文学コース | `required` | p.49: 卒業論文（第1次・第2次指導が必修）8単位。`japanese_literature_thesis_required_course`。 | 選択UIなし。卒業論文8単位カードを表示。指導は `before` 条件が未対応のため保留。 |
| 文学部 / 日本文学科 / 言語コース | `required` | p.50: 卒業論文（第1次・第2次指導が必修）8単位。`japanese_language_thesis_required_course`。 | 同上。 |
| 文学部 / 日本文学科 / 芸能文化コース | `required` | p.51: 卒業論文（第1次・第2次指導が必修）8単位。`japanese_performance_thesis_required_course`。 | 同上。 |
| 文学部 / 史学科 | `required` | p.52: 卒業論文（第1〜3次指導が必修）8単位。`history_thesis_required_course`。 | 選択UIなし。卒業論文8単位カードを表示。第1〜3次指導は保留。 |
| 文学部 / 地理学科 | `required` | p.54: 卒業論文（第1〜3次指導が必修）8単位。`geography_thesis_required_course`。 | 選択UIなし。卒業論文8単位カードを表示。第1〜3次指導は保留。 |
| 経済学部 / 経済学科 | `optional` | p.57: 選択に6単位の卒業論文を含む。履修時には計画書・中間報告書指導が必要。 | 専用進捗で未定 / 取り組む / 取り組まないを記録。専門82・全体124は選択未定でも判定対象。 |
| 経済学部 / 商業学科 | `optional` | p.59: 選択に6単位の卒業論文を含む。履修時には計画書・中間報告書指導が必要。 | 同上。 |

## 実装範囲と保留事項

- 既存catalogの構造化ルールのみを参照し、offering / mappingは変更しない（686件のまま）。
- 卒業論文は年度別offering / mappingから独立したscope別の専用進捗で記録する。required scopeは未着手でも0/8の未達として表示し、`planned` / `in_progress` / `earned` を安全に反映する。将来の成績取込・offeringはこの専用進捗へ自動加算せず、二重計上を防ぐ。
- 第1〜3次指導、一般指導、計画書指導、中間報告書指導の `before: 卒業論文` は、履修順・offering対応を現engineが安全に解釈できないため保留する。指導を受けたことを卒業論文8単位の修得とは扱わない。
- required scopeで卒業論文が将来offering化されても、専門教育の区分別カードへ重ねて算入しない。卒業論文8単位カードと区分別カードを別の要件として扱う。
- 経済・商業は公式PDFを確認済みだが、必要な分岐値がないため `unknown` を維持する。推測によるcatalog補強や `graduationProgress` への手書き数値追加はしない。
- 2026年度の単位数metadataは、法4・文8・経済/商業6として `graduationSources.ts` に記録する。これは選択必要量を固定する根拠にはならない。


## 現行表示の補足（Issue #54 / #55、2026-10-09）

本文の「optionalには両方の数値分岐が必要」「経済・商業はunknownを維持」は旧段階の記述であり、上の学科別表・現行 `thesisPolicyForScope()`・既存の6学科テストとは一致しない。今回は既存policy（法律・経済・商業optional、文学部3学科required）を維持し、新しい必要単位数は追加しない。判断根拠と変更範囲は [卒論選択の現行整合記録](planner-thesis-selection.md#現行実装との整合issue-54--552026-10-09) に記載した。

選択制では、選択時のみ卒論カードと指導手続きを表示し、非選択時は両方を対象外にする。未定時は卒論カードを保留表示し、手続き詳細は表示しない。必修学科は既存正規化によって両方を表示する。保存済み指導記録は表示にかかわらず学科別に保持する。指導手続きの参考表示は卒業単位の正本・catalogの指導要件の達成証明にはしない。
