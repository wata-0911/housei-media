# Planner special cases (2026)

## 35009 日本史特講（日本仏教史）（地理）

`35009` / `HIS300TE` / offeringId `52bd7373-7f4e-4db8-bd65-1096d8365389` remains `manual_review` with no mapping.

- Catalog source: <https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602699&nendo=2026&gakubueng=TKS&t_mode=pc>
- Candidate mappings remain the History Department Japanese-history row (`4a866661-9fe2-4a98-a02e-5eccf97ff513`) and the Geography Department row (`540bd399-8d5a-4133-adf7-2668b266b2e1`).
- The 2026 catalog, mapping audit, and 学習のしおり identify those candidates but do not state whether the offering suffix `（地理）` limits the class to Geography or is merely a display note.
- The public syllabus URL was rechecked on 2026-09-26; the source returned HTTP 403 from this environment. It therefore supplied no additional primary evidence.

No override is added. A syllabus page or official course-offering material that explicitly states the target department (or explains the suffix) is required before mapping it.

## 史学演習

The eight 2026 offerings remain `manual_review` and have no fixed mapping. The 2026 学習のしおり p.53 says that `1` through `4` are assigned in completion order, not by the seminar topic; `1` and `2` are schooling required-elective, while `3` and `4` are elective.

Planner state schema v2 adds `earnedOrder: 1 | 2 | 3 | 4 | null` to every item. It is permitted only for an earned 史学演習, must be unique and consecutive, and is never inferred from an array position, planned term, or date. Loading schema v1 preserves the existing items and migrates all orders to `null`.

For the History Department only, the progress cards use confirmed orders as follows:

| Confirmed order | Graduation bucket | Counted credits |
| --- | --- | --- |
| 1–2 | スクーリング選択必修 | 2 each |
| 3–4 | 選択 | 2 each |
| 5+ | no graduation bucket | 0 |

An earned seminar with an unknown order makes these cards `unknown`, unless all four countable orders are already recorded; remaining earned seminars are then treated as fifth-or-later. Planned and in-progress seminars do not receive an order or count toward satisfaction. The subject field (日本・東洋・西洋) is retained for display only; the four-credit overview prerequisite remains a caution rather than an eligibility decision.

`graduationCheckComplete` remains `false`; these cards are never combined into an overall graduation decision.
