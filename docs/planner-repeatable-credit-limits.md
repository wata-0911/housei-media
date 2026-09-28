# Planner repeatable and transfer rules (2026)

Primary source: `shiori202646-61.pdf`, 2026年度学習のしおり, printed pp.44-59. The Planner remains a partial aid: `graduationCheckComplete` is `false` and no cards are combined into a graduation decision.

| Printed page | Rule implemented | Planner treatment |
| --- | --- | --- |
| 45 | 基礎特講: at most two attempts / 4 credits | Count only the first 4 earned credits in common education; report excess as earned but outside graduation credit. |
| 47 | 法律学特講: at most four attempts / 8 credits; 総合特講: eight / 16 | Apply the repeatable cap. Once eight complete required-elective courses / 32 credits are present, a 2-credit schooling completion of a 4-credit required-elective or elective course is included in the elective estimate. Other partial completions remain uncounted. |
| 53 | 史学概説: first 2 schooling credits per 日本史・東洋史・西洋史概説 go to schooling required-elective, later credits to the 4-credit required course; 歴史資料学: six / 12; 総合特講: eight / 16 | Allocate the overview credits by delivery method and cap the two repeatable courses. Existing confirmed `earnedOrder` allocation for 史学演習 remains unchanged. |
| 55 | 現地研究: 2 credits mandatory then up to 2 elective; 地誌学特講: first 2 required-elective then elective; each human/natural geography seminar: first 2 schooling mandatory, next 2 required-elective, later elective; human + natural geography lectures: combined 4-credit elective cap; 総合特講: eight / 16 | Transfer only earned credit into the stated bucket. Planned and in-progress entries remain reference amounts and never satisfy a card. The 2019 rename/older-course transition and other past-curriculum relief remain unknown. |

The source's law partial-completion exception is deliberately narrow in code: it requires exactly 2 earned schooling credits against a 4-credit mapped course, and the completed eight-course / 32-credit prerequisite. The Planner does not attempt to infer the thesis option, star-marked schooling exclusions, or historical curriculum equivalences.
