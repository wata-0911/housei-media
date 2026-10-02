# CurriculumCourse-centered Planner list (v22)

Based on dev `4120ed921a1d5b138cf2b055e34e2877d3047aa9`, architecture decision B in [planner-curriculum-centered-model.md](planner-curriculum-centered-model.md).

`PlannerPage` derives `deriveCurriculumCourseView(state, catalog)` for the履修・修得一覧 only. Exact saved 2026 CurriculumCourse identities group each parent. Official achievements and Offering-owned learner attempts are separate children even when they have the same source link. Names do not merge identities. A parent has no studyYear; each attempt retains its own year, studyYear and term.

## Presentation and ownership

- `CurriculumCourseList` / `CurriculumCourseCard`: uncapped earned/projected credits, remaining credits, both completion states, excess candidates and warnings. Repeatable courses display cumulative credits without a normal completion denominator. Course completion is separate from graduation allocation.
- `OfficialAchievementChild`: raw source name, aggregate earned/schooling/composition credits, display status, source year/provenance, separate user metadata and all source-linked study records. A missing Offering never hides an exact official achievement. Metadata callbacks remain keyed by achievement.id.
- `PlannerAttemptChild`: saved Offering-owned status, schedule, order, contribution, final/method grades, correspondence details and full4/split2, media editing link, classification, future advisory and removal. The existing Page remove/undo and progress/evaluation persistence handlers are reused. Missing Offering progress remains visible read-only; saved evaluation and basic item fields remain visible.
- `UnresolvedCurriculumSection`: complete unresolved official/attempt children, reasons, and official candidate identities. No name-based resolution or source rewriting.
- Orphan study records: independent read-only details with raw names, never new aggregates or inferred Course parents.
- `PublicCourseList`: independent existing public-course desktop/mobile editors and study-year grouping. Public courses never join a CurriculumCourse by name.

Curriculum children use one responsive DOM tree for desktop and mobile. The same editors and facts are present at every breakpoint; only grid layout changes. Public-course editors retain their previous table/card presentation.

The view has no write callback for parent data and is never passed to a persistence handler. All writes remain in the existing source-owner callbacks. `ImportedAchievements` remains the manual association/repair management surface. Graduation, annual 49, summaries, export/share, media managed state, import/parser, thesis/profile and storage policy remain on their existing inputs. Schema22 and graduationCheckComplete=false are unchanged. Official4 + linked earned remains4; official4 + independent earned2 displays6/excess2 without feeding6 to graduation.

## Legacy presentation audit

`PlannerPage` no longer calls `createUnifiedCourseRows` or mounts `PlannedCourseList` / the separate `CurriculumCourseProgress` summary. The latter's summary is included in the new parent, while `deriveCurriculumCourseProgress` remains an input to CourseSearch advisories. The old components and `createUnifiedCourseRows` remain for unchanged characterization tests; cleanup is outside this slice.

`unifiedCourseView.ts` still provides `importedAchievementDisplayStatus` to the pure Course projection, `importedAchievementStatusLabel` to the official child, and `safeImportedStudyOffering` to source detail display. These helpers have not been removed or rewritten.

## Validation

The existing 377 planner tests remain unchanged. `curriculum-course-ui.test.mjs` adds 19 React server-rendering and callback integration tests using existing React, node:test and tsx dependencies. Coverage includes exact/unresolved/orphan source retention, same-name separate identities, repeatable uncapped totals, source-linked dedup, separate manual earned excess, all owner callbacks, full4/split2, delete/undo, persistence/reload, future/media/public presentation, and the existing Economics extractor fixture. No heavy test dependency is added.

The Economics fixture is synthetic source-shaped data, not a personal live transcript. Browser Preview verification is tracked separately; server rendering does not establish responsive visual quality or a clean browser console.

## Next slice

Review Course-aware export rows (official/unresolved/orphan source types) separately, or audit stable InstitutionalCourse/crosswalk and CurriculumPlacement boundaries. Persisted identity changes and multi-year registry support require their own evidence and migration work. This change does not implement v23 or replace the graduation allocator.

Verification run: `npm run typecheck`, `npm run lint`, `npm run test:planner`, `npm run test:extension`, and `npm run build` pass. Planner: 377 existing + 19 UI integration = 396. Extension: 19. Catalog check: 321 Course identities / 686 annual Offerings. The existing Vite chunk-size advisory remains.

Preview: a local Vite server was started and the Planner URL was opened in the Codex browser panel. Browser automation then rejected access to the tab's error-page URL under its protocol policy. A manual reopening of the HTTP Planner URL was requested. A–F browser checks, mobile visual layout and console errors are therefore **not verified**. No live personal transcript was supplied; the Economics source scenario is covered by the existing synthetic extractor fixture. These limitations must not be reported as passing browser checks.
