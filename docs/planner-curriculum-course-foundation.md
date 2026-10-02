# CurriculumCourse foundation (2026)

## Implementation origin and audit

Started from latest `origin/dev` commit `787dc8635f88a0e0850bd9a0bb91c1a9fb74f3ba` on `feature/curriculum-course-foundation`. No code or migration from `feature/planner-multi-year-v22-foundation` was used. This branch does not introduce attempts, enrollment, plan intents, repeat validators, or multiple-attempt UI.

The pre-change audit covered `plannerCatalog.ts`, generated JSON/Schema, `Course`/`Offering`/`Mapping`, catalog loading and manual/official override ledgers, `gradeImportApply.ts` (`sourceCourseFor`, preview, auto-registration, apply), imported row/component types, identity repair, `unifiedCourseView.ts`, `annualPlan.ts`, `deriveImportedAchievements`, `graduationProgress.ts`, CourseSearch, PlannedCourseList, PlannerPage, storage and migration.

Findings:

- 686 annual offerings, 502 mappings, 209 provisional Course identities. 338 offerings have a legacy Course ID; 348 do not. The overrides preserve those IDs.
- Every old `Course.identityStatus` is `provisional`. The original seed identified its origin as `course_identity_candidate_v1`; UUIDs were minted for promoted Offering-derived candidates, not official curriculum rows. The old Course is neither a complete curriculum master nor a safe official row identity.
- The generated Mapping intentionally omitted its `course_name_snapshot`. It retains composition credits and curriculum scope/field/requirements. Some curriculum mappings have no 2026 opening.
- The original `contract.py`, catalog builder and import scripts are not checked into dev. Their archived 2026 source metadata was inspected for audit only. The implementation and new generation functions were written on current dev.
- Import previously chose the first representative opening once a provisional Course ID was unique, including cases with several annual openings. Auto-registration independently rechecked opening uniqueness and was already conservative.
- PlannerItem, progress, evaluations, annual grouping, search and removal/undo use offering IDs. Graduation uses existing mapping, composition, repeat, history/order and scope rules. Those calculation identities and rules are retained in this foundation.

Decision: add `CurriculumCourse`; retain the old `Course` and `Offering.courseId` as explicitly documented compatibility identities. Do not reinterpret old IDs or replace graduation aggregation in this branch.

## Source of truth and reproducible generation

The official-table source is the existing `curriculum_mappings_2026.json` (printed pp.44–59), with row IDs restored using the original `import_manifest_2026.json`. These archival source data predate the abandoned branch. Their hashes match the records already present in dev's `planner-mapping-cleanup-audit-2026.json`:

- curriculum source SHA-256: `7e8c113d531c0086e1432adabf79cc322eae65b132973ab65d15f5e433459b3a`
- manifest SHA-256: `41c86b7d9742739073359704300f9344f0141ccc074b6daea2b853638ac9674f`

`scripts/inputs/curriculum-rows-2026.json` contains the names and table definitions restored from all 502 original rows. Every corresponding mapping ID, faculty, department, curriculum course scope, category, field, requirement, credits, years, method restrictions and printed page was checked against current dev. These are the source of names and composition credits, including subjects without annual offerings. Offering display names are never used to build this master.

`scripts/inputs/curriculum-equivalences-2026.json` explicitly records 87 groups of equivalent mapping rows. Groups require an identical official course label and composition definition AND connected, pre-existing dev offering-to-mapping edges. Names alone, normalized names, suffix removal, class/subject codes, teachers, periods and delivery methods cannot create a group. Scope, field, eligible years and requirement roles remain on each mapping. Rows without such evidence remain separate, even when their names look alike. Different official composition/method definitions remain separate and annual relations stay ambiguous where necessary.

These equivalences are an audit of current dev mapping relations, not a new university certification. Existing `manual_curated` and `official_source_verified` ledgers retain their original provenance. No manually curated relation is promoted to PDF-verified status. The master is a conservative identity foundation; unresolved cross-table equivalences need source review before future consolidation.

Group IDs are explicitly pinned in the ledger. A singleton uses `curriculum:<mapping UUID>`. IDs contain no annual-opening/name hash. Keep a published group ID when adding a scope; any future institutional merge/split requires an explicit migration, rather than deriving a new ID from its updated members.

Run:

```sh
npm run catalog:generate
npm run catalog:check
```

The generated `src/data/planner_curriculum_2026.json` has 321 courses, 686 annual relations, and 209 legacy crosswalks. Generation validates complete source coverage, duplicate rows, incompatible definitions, connected equivalence evidence and duplicate IDs. Output ordering is deterministic. `npm run build` checks the committed output before building.

Catalog load applies the existing overrides and joins this generated data by IDs; it does not guess a relation from names. It validates source coverage and stale relations. 616 annual relations are single-course, 32 have multiple candidate courses, and 38 have no curriculum relation. All 686 annual openings remain searchable/selectable and existing `resolutionStatus`, `mappingIds`, names and codes are retained. The 38 unresolved relations retain 8 `manual_review` and 30 `outside_mapping_scope` statuses.

## Identity hierarchy

```text
CurriculumCourse = 教育課程表上の制度科目
  id / canonicalName / curriculumCredits / mappingIds / scopeIds

AnnualOffering = 年度ごとの具体的開講 (existing Offering type)
  id / curriculumCourseId (nullable) / academicYear / display name
  method / period / syllabus source / subjectCode / classCode / credits

Planner attempt = ユーザーの1回の履修計画・履修実績
  to be introduced in the next branch
```

A course can have multiple mappings and multiple openings. An opening with several candidate institutional courses does not automatically select one. `Offering.courseId` remains the old calculation identity, distinct from `Offering.curriculumCourseId`. No one-opening/one-course restriction or new same-course duplicate prohibition is introduced. PlannerItem still uses `offeringId` in this branch. CourseSearch remains an annual-opening search.

Eligibility and scope-specific rules stay on the official mappings. Teachers, syllabus, annual availability, delivery category and period remain on openings; this branch does not invent missing teacher metadata.

## Credits and preserved graduation rules

`CurriculumCourse.curriculumCredits != Offering.credits`.

`Offering.credits` means **offeringCredits**, retaining its existing name for compatibility. A four-credit curriculum course may have a two-credit schooling opening. The imported row's `compositionCredits`, `earnedCreditsTotal`, `schoolingCreditsTotal` and component credits remain distinct official facts. Neither master nor import matching copies opening credits into composition credits.

Official PDF rules supplied for this work: a course normally enters required graduation credits only after its composition credits are completed; normally it cannot be repeated after completion. A four-credit course can be completed by correspondence 4, schooling 2 + correspondence 2, or separate schooling schedules 2 + 2. Schooling 2 alone normally does not complete the course for graduation. Department exceptions and special repeatable subjects prevent a universal `credits >= composition => block` rule.

The existing general-education/natural cap, foreign-language, PE, schooling, annual-limit, law partial-two-credit exception/repeat limits, history sequencing/special rules, geography transfers, economics, commerce, thesis, Open University and recognition logic are preserved. Neither the new master nor new curriculum match drives a replacement graduation engine yet. New curriculum-only matches can remain pending in the legacy graduation calculation; they must not bypass its completion safeguards.

`graduationCheckComplete=false` remains unchanged. Normal planning uses generated relations, without name inference. Import alone may infer a match to reduce user operations.

## Independent import matching

Stage A (`matchImportedCurriculumCourse`): canonical official names and constrained normalized aliases produce source-row candidates. Offering aliases participate only through an existing explicit, matched `curriculumCourseId`. Imported category and official composition credits constrain candidates. Number/theme suffixes remain distinct; no generic removal of `[1]`, `[2]`, `[表計算]` or course variants is introduced. A canonical curriculum name can match even with no annual opening or detail rows.

Stored fields:

- `curriculumCourseId`: a single institutional identity, or null.
- `curriculumMatch`: `exact_unique`, `ambiguous`, or `unmatched`.
- `candidateCurriculumCourseIds`: retained institutional candidates.
- `offeringMatch`: independent annual-opening match status.

Stage B retains the existing strict exact-name/method matcher. It does not expand auto-registration through the broader curriculum alias matcher. A source row's `selectedOfferingId` is automatically set only when its exact-name annual candidates, constrained by the row's correspondence/schooling evidence, have one matched opening. Multiple applicable annual candidates produce null. Rows with both methods do not select a representative; a single evidenced method can identify one opening independently of other-method candidates. Each detail component independently matches its method; ambiguous components also start with `offeringId=null`, allowing an intentional later manual choice.

Course exact / Offering ambiguous (or unmatched) is a normal imported achievement. The institution match and all official facts are saved; multiple opening candidates do not produce an automatic PlannerItem. If a component independently identifies one opening by the existing strict matcher, its existing safe auto PlannerItem behavior is retained. Auto-registration still requires the existing matched mapping/provisional identity safeguards, does not set final grades and does not convert the plan to earned. A curriculum-only match does not relax those guards.

Old `courseId`/`match` remain legacy calculation fields. They are not aliases for the new fields. An import can have a known curriculum identity while its legacy Course identity is null. `unifiedCourseView` and legacy achievement calculations retain their compatibility path during this foundation. Preview and ImportedAchievements minimally show independent curriculum/opening confidence; ImportedAchievements shows the institutional course and separately the 2026 opening. Clearing an opening selection retains the independently known curriculum identity.

Reimport keeps immutable source IDs, official duplicate detection and learner metadata. Manual selections retain their legacy and curriculum identities when official aggregate facts update. Composition-credit changes also count as official fact updates. Undo and direct handoff continue through their existing paths.

## Persistence contract: v21 → v22

State schema becomes **22** because imported achievements now persist independent institutional and annual match information. Catalog snapshot schema remains 1; it has an optional typed curriculum extension. Storage and recovery keys are unchanged.

The migration is additive and occurs after the existing migrations through v21. It does not modify any old imported row fields, source IDs/fingerprints, raw names, official credits, component rows, selected openings, manual selection source, PlannerItems, progress, evaluations, user metadata or recognition information.

- Legacy Course IDs use a generated crosswalk only when **all** related annual openings have one consistent curriculum identity. Unknown or inconsistent crosswalks stay unresolved and retain candidates.
- Explicit manual opening selection can confirm a curriculum identity only when its saved old Course identity agrees with the selected matched opening. A disagreement stays unresolved.
- Rows without an old Course ID can migrate from retained candidate openings only when every candidate has the same safe relation. Unknown candidates prevent confirmation.
- No name-based migration or automatic representative fallback is allowed.
- Old automatic representative IDs are retained losslessly, but `offeringMatch=ambiguous` prevents presenting them as exact. The UI shows 2026開講: 未特定 until confirmed. New imports do not write representatives.
- v22 load is idempotent. Load never writes; the original raw bytes remain the optimistic-save reference. Invalid data keeps its recovery lock and exact raw bytes.
- Recognition recovery shadow, unrelated-save preservation and explicit recovery backup behavior are unchanged.

For compatibility with old caller-owned achievement objects, the four extension fields may all be absent; new preview output and migration populate all four. Partial extensions, invalid curriculum references and contradictory curriculum match fields cannot be saved. Older application builds reject v22 rather than guessing a downgrade.

## Repeat policy and university phone guidance

No new enrollment/repeat blocker is implemented. Future validation must distinguish incomplete composition from completed subjects, with explicit department exceptions and special repeat policies. Candidate special subjects include 基礎特講, 政治学, 法律学演習, 法律学特講, 総合特講, 経済学特講, 経営学特講, 史学演習, 歴史資料学 and 公開科目. These are not a universal allow-list; preserve each existing rule's category/scope/order/limits.

**University phone guidance, reported by the user in October 2026, not a PDF rule:** Media schooling is not permitted for re-enrollment. For ordinary non-Media schooling or correspondence, enrollment that includes the same content may be permitted when needed to reach that named course's composition credits. Do not generalize this to all repeat circumstances or mark it as PDF-verified evidence. It is intended for the next Attempt/repeat validation stage, with this lower evidence certainty kept visible.

## Verification and next stage

The original 214 planner tests remain, with version expectations and explicit added fields updated. They were not deleted or weakened. The obsolete first-representative expectation was replaced by the requested null-opening contract. Twenty-two foundation tests cover generation/determinism/source coverage, explicit cross-scope sharing, display-name variants, same/similar-name safety, credits, independent matches, raw facts, auto-registration, direct handoff, v21 lossless migration, unsafe crosswalks, recovery shadow, invalid extensions, reimport/manual metadata, UI labels and graduation regression. Extension tests retain their import contract.

Graduation regression compares current dev's existing catalog/rules against the enriched catalog for every non-common affiliation, six item statuses, ordinary/recognition profiles, public courses and three thesis selections (288 comparisons). Existing targeted law/history/geography/general/foreign/PE/thesis/recognition/Open University tests remain authoritative.

Next branch:

1. Introduce Attempt identity below CurriculumCourse without making a course ID a uniqueness constraint. Define which official imported row/component describes which attempt before changing aggregation.
2. Replace legacy calculation and unified-view identities with explicit curriculum/attempt semantics while preserving partial-credit, repeat, order and recognition policies.
3. Resolve 32 ambiguous annual relations and any remaining cross-table equivalence questions with official scope-specific evidence, never by suffix guesses.
4. Model completion/repeat policy and Media phone guidance separately, including evidence certainty. Repeated history and special courses need attempt order and department limits.
5. Define an annual selection/availability contract before adding actual 2027+ opening data. This branch retains only the real 2026 catalog.

Preview checklist:

- CourseSearch still exposes all 686 openings and their old names/codes/categories; existing planned rows and controls survive reload.
- Import a unique course with several openings: institutional course is displayed, 2026開講 is 未特定, official totals/details are saved, no ambiguous auto plan appears.
- Import an existing safely unique opening: one planned item appears, final evaluation stays empty, and repeated import/backfill/undo behave as before.
- Confirm an opening manually, reimport updated official totals, and verify the manual choice and user metadata survive.
- Load a v21 saved example; verify every old field, uncertain/manual matches and recognition warnings remain, then save and reload v22.
- For all affiliations, confirm the existing completion rules and `graduationCheckComplete=false` disclaimer; do not expect new 2/4 progress or multiple-attempt UI.

Final validation (2026-10-02): `npm run test:planner` **236/236**, `npm run test:extension` **18/18**, `npm run typecheck`, `npm run lint`, and `npm run build` all exited 0. The build's generated-data check passed; Vite still reports its large-chunk warning, without a build failure. `git diff --check` passed. Local browser Preview confirmed course exact/opening ambiguous with zero automatic items, both exact with one ordinary planned item and an unrated final evaluation, and Undo restoring the empty state. Both Preview examples used fictitious grades and were undone; no user grade data was used.
