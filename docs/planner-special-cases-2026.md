# Planner special cases (2026)

## 35009 日本史特講（日本仏教史）（地理）

`35009` / `HIS300TE` / offeringId `52bd7373-7f4e-4db8-bd65-1096d8365389` is a `manual_curated` override to the Literature Faculty Geography Department mapping `540bd399-8d5a-4133-adf7-2668b266b2e1` only. In a selected Geography scope it classifies as `専門教育`; it does not connect to the History Department mapping `4a866661-9fe2-4a98-a02e-5eccf97ff513`.

- Catalog source: <https://syllabus.hosei.ac.jp/web/preview.php?no_id=2602699&nendo=2026&gakubueng=TKS&t_mode=pc>
- The 2026 official teacher-training material [`shiori2026202-214.pdf`](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026202-214.pdf) lists `日本史特講（日本仏教史） 4 34525 ※4 / （44533）`. Its note says that the unparenthesized code is for teacher-training students outside Geography and the parenthesized code is for Geography teacher-training students. The Geography Department course list also includes `日本史特講（日本仏教史） 4 44533`.
- These sources establish the Geography-specific curriculum target strongly enough for the user-approved, Geography-only mapping. They do not directly state a one-to-one identity between `35009` / `HIS300TE` and `44533`; the ledger therefore remains `provenance: manual_curated` and `officialVerified: false`.
- The public syllabus URL still returned HTTP 403 when rechecked on 2026-09-26. It supplies no additional primary evidence.

The override preserves the offering name, classCode, subjectCode, and courseId. It must not be widened to History or another scope without new evidence.

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
