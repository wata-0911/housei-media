# Planner: elective cleanup audit (2026)

## Scope and evidence

This audit covers the six 2026 departments represented by the planner: Japanese Literature, History, Geography, Law, Economics, and Commerce. The primary source is `shiori202646-61.pdf`, printed pp. 44-59. The PDF was not present in this worktree at audit time; therefore this document rechecks only the page-specific rules already transcribed into the catalog and the prior source audits on `dev` (`planner-repeatable-credit-limits.md` and `planner-public-course-limits.md`). No new curriculum interpretation is inferred from a course name, an offering's faculty, or a null field.

`graduationCheckComplete` remains `false`. These cards are partial progress only, not a graduation decision.

## Official-rule inventory

| Department | Printed page | Professional requirements used by cards | Official transfer / special elective treatment | Kept unknown |
| --- | ---: | --- | --- | --- |
| Japanese Literature | 48-51 | Required 20, required-elective 20, elective 24 | Required-elective credits beyond 20 transfer to elective only. Public courses count toward elective at 8 courses / 16 credits max. General lecture has its separate 16-credit cap. | The 82-credit professional total includes thesis; the cards do not synthesize a graduation result. Course-specific variants remain selected by scope. |
| History | 53 | Required 16, schooling required-elective 8, elective 50 plus one course each in Japanese, Oriental, and Western history | Seminar completions 3-4 enter elective only after user-recorded completion order. Public courses: 8 / 16 maximum. General lecture 16 and historical materials 12 have independent caps. | Thesis prerequisites and any unresolved seminar order; no required-elective-overflow-to-elective rule is recorded for this department. |
| Geography | 55 | Required 12, schooling required 6, required-elective 36, elective 12 | Required-elective credits above 36 transfer to elective. Field study, chorography, human/natural seminars, and the combined geography-lecture cap use their page-specific destinations. Public courses: 8 / 16 maximum. | Pre-2013 relief and older-course transition notes. |
| Law | 47 | Required-elective 32 and 8 complete courses; professional schooling 8 excluding `＊` rows | Required-elective credits beyond 32 transfer to elective after the eight-course condition. The narrow 2-credit schooling partial-completion exception is retained. Public courses: 8 / 16 maximum. | Thesis choice changes elective requirement (50 with thesis / 54 without) and total (82 / 86); `＊` cannot be identified from catalog data. Both remain explicit card reasons rather than assumed values. |
| Economics | 57 | Required-elective 24; professional total 82 includes thesis | Required-elective credits above 24 transfer to elective. Public courses: 8 / 16 maximum. Economics, management, general lectures and seminars keep independent caps. | The elective amount after thesis is not safely derivable from PlannerState. |
| Commerce | 59 | Required-elective 20; professional total 82 includes thesis | Required-elective credits above 20 transfer to elective. Public courses: 8 / 16 maximum. Economics, management, general lectures and seminars keep independent caps. | The elective amount after thesis is not safely derivable from PlannerState. |

## Catalog and mapping audit

Snapshot data contains 686 offerings, 502 mappings, 142 structured requirements, and 40 unsupported requirements.

- For the six departments, 464 mappings apply. `requirementType` is present for all 464 and `curriculumCredits` is present for all 464. `field` is null for 409; this is normal for unfielded professional rows, not a guessed classification.
- Across the entire catalog, 411 mappings have a null `field`, zero have a null `requirementType`, and one has null `curriculumCredits`. The latter remains an unknown when it is an earned professional item.
- There are 286 six-department mappings to professional elective. All are consumed only through the selected scope; an offering mapped for another department is not credited to the selected department.
- The raw snapshot has 593 matched, 63 `manual_review`, and 30 `outside_mapping_scope` offerings. Applying the approved ledgers resolves 55 distinct manual-review offerings (24 manual-curated entries / 53 offerings; one official-source-verified entry / 2 offerings), leaving 8 manual-review and 30 outside-scope offerings.
- No offering repeats an identical mapping ID. Within any single selected scope, 26 offerings have more than one mapping edge, but zero duplicate the same category / field / requirement type / curriculum-credit bucket. The 26 mixed-type edges are intentional special transfers (not additive edges); the professional allocator handles those named geography/history cases before normal mapping aggregation. Other multiple-scope edges are alternatives for different departments, never simultaneous credit.

`outside_mapping_scope` and remaining `manual_review` are not converted into zero credits or a completed requirement. They stay visible in the annual-plan classification and do not enter a graduation bucket.

## Accounting model and implementation

The planner has two different views, deliberately kept separate:

1. **Annual-plan category totals** report actual earned, in-progress, and planned credits. A ninth public course, or credits above a repeatable cap, remain actual earned credits here.
2. **Graduation-progress cards** receive only countable earned credit. Terminal states (`waiting`, `failed`, `dropped`) enter neither view. A repeatable/public cap is applied before its value reaches a professional elective card.

The professional allocator completes a curriculum mapping before counting it, then selects exactly one normal mapping bucket. It holds an earned item with conflicting buckets or missing curriculum-credit metadata as unknown instead of adding it twice. For a required-elective overflow, the required-elective card is capped at its own official threshold and only the excess is placed in elective; this prevents double counting.

This cleanup also removes duplicated threshold constants from `graduationProgress.ts`: the card now reads the structured, official `overflow_credit_transfer` rule for the selected scope, including Law's eight-completed-course condition. If that source rule is missing or structurally unsafe, the elective card becomes unknown instead of assuming a transfer.

## Verification coverage

Tests cover each department's professional buckets, all five official required-elective overflow thresholds, the Law partial exception, geography special transfers, repeatable caps, the public-course 8 / 16 cap, 35009's 2 / 4 completion rule, History seminar completion order, duplicate mapping edges, terminal statuses, and the permanent `graduationCheckComplete: false` contract.
