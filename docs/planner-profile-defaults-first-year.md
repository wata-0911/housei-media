# Profile defaults and first-year recognition (#57 / #98)

## Behavior and storage

New `initialGraduationProfile()` instances use `current_2026`. Storage migrations use an explicit historical default (`unknown`) and then preserve saved values. This includes old states that predate GraduationProfile. No schema change: PlannerState remains 22.

For first-year admission, the profile screen shows “入学時の認定単位：なし”, an editable applicability selector, and a closed optional Open University section. General-field, foreign-language, physical-education, aggregate, entrance-schooling, and professional-recognition controls are hidden. Other admission routes retain the controls and official-prefill action.

`effectiveRecognitionForAdmission()` is a pure calculation projection. Raw recognition values stay in the saved profile. First-year calculation gets `none` general/foreign/physical modes, no professional courses or entrance aggregate, and zero entrance-schooling recognition. Open University input is preserved, including its null/zero distinction. Switching back restores the original entrance inputs; save/load and scope changes do not erase them.

Projection consumers are graduation calculation (including all category overlays and synthetic professional items), direct official-fact derivation, global official-schooling evidence checks, and thesis-guidance eligibility totals. Validation uses the active projection so dormant totals do not prevent editing first-year Open University input. Transfer validation is unchanged: returning to a transfer route with a newly contradictory Open University/aggregate combination is rejected until the conflicting input is corrected; no saved value is silently rewritten.

`PlannerPage.tsx` already passes raw profiles to both the settings and calculation boundary, and `stateForScopeChange()` preserves the profile. These call sites were audited and need no change. `plannerCatalog.ts` requires no new state fields.

## Official sources checked on 2026-10-09

- [2026 学習のしおり](https://www.tsukyo.hosei.ac.jp/wp/wp-content/uploads/2026/02/shiori2026.pdf), printed p.135 (PDF p.137), visually checked: in-study Open University credits, excluding foreign language and physical education, may be officially recognized up to 10 credits in general education “その他” and schooling. Recognition uses the university result, not the unconverted number of Open University credits. The page also specifies application deadlines and course-type conversion cautions.
- [単位修得について](https://www.tsukyo.hosei.ac.jp/system/credits-examination/): graduation requires 30 schooling credits; entrance recognition is explained for second/third-year transfers; Open University recognition applies to in-study work, excluding leave of absence, foreign language and physical education.
- [スクーリング学習](https://www.tsukyo.hosei.ac.jp/system/schooling/): schooling modes and procedures checked; this page is not used to infer a new recognition aggregation rule.
- [出願にあたって FAQ](https://www.tsukyo.hosei.ac.jp/faq/100-2): the Open University entry confirms up to 10 graduation/schooling credits and excludes third-year and bachelor admissions; internal transfers have separate individual recognition circumstances.

## Ordinary, schooling and source authority

Before: `openUniversityCredits` was included by `applyRecognition()` in the general total only (not named field minima). The overall reference obtained it through that card. `referenceProgress()` forced first-year schooling recognition to zero, and did not show the Open University quantity in its recognized-credit metadata.

After: first-year officially recognized Open University credits still enter general education once and therefore overall earned once. The same recognition contributes to the independent global schooling-30 reference once. It does not enter foreign-language S, professional S8, structured departmental S, attendance/completion evidence, or synthetic professional items. Null contributes no known increment, stays null in recognized-credit metadata and displays “—”; it is not reported as officially confirmed zero. Optional missing input does not create an entrance-recognition requirement for first-year students.

For transfers, `schoolingEquivalentCredits` remains the existing global aggregate. Open University is not added on top because this schema has no provenance proving whether that aggregate already includes it. No H-family source authority was changed: `ImportedCourseAchievement.earnedCreditsTotal` remains ordinary authority; positive `recognizedExemption`, conflicting/unknown mappings, duplicate source rows, ordinary/S/completion distinctions and departmental safeguards remain effective.

## Deferred issue candidates

1. **P2: transfer Open University schooling provenance.** A second-year profile with Open University4 and schooling-equivalent7 currently shows global S7, not S11. The schema does not establish whether 7 includes that4. Separate entrance and in-study schooling evidence plus migration/source-overlap rules are needed before additive treatment is safe.
2. **P2: Open University eligibility and source identity.** Existing input does not enforce the FAQ's third-year/bachelor exclusion as a calculation gate (bachelor general exemptions suppress the general overlay). Also, aggregate Open University input lacks a source ID to reconcile a future independently imported Open University achievement. This PR adds explicit UI guidance and preserves current transfer calculations; a separate source-backed change should address these existing limitations.

## Verification and review

Regression coverage includes new versus historical defaults; saved current/legacy/unknown across schemas; missing-profile migration; UI controls; all five recognition routes; transfer -> first-year -> scope switches -> transfer with raw equality; Open University null/0/4/10 and rejected11; frozen-input projection; ordinary/foreign/physical/professional/global totals; normal/H19/H43 official S plus Open University; repeated official source idempotence; and unchanged H21 positive-recognition holds.

Existing recognition-audit fixtures that incorrectly used first-year admission to activate entrance recognition now explicitly use `other_transfer`. Their safety assertions remain. First-year exceptions are asserted separately. No tests were deleted or skipped. H20's first-year synthetic recognition assertion now expects ordinary0; unentered Open University metadata is null instead of an asserted official0.

Unchanged invariants: schema22, `graduationCheckComplete=false`, `sourceLinksReverified=false`, aggregate authority, identity/duplicate controls, thesis/repeatable/public-course and departmental rules, and scope limited to 2026 requirements. No Auth/Cloud/Bookmarklet/Extension/Media implementation changes or schedule-calendar image edits.

Self-review: P1 — no outstanding finding in this change; checked state preservation and recognition leakage across all consumers. P2 — source/aggregate limitations are listed above and not silently expanded. P3 — PC/mobile optional input, bounds, labels, editable curriculum and horizontal overflow checked in a fresh browser context.
