# F03 S2 connection boundary — local candidate

Baseline: dev `4f6522b43fa66bed7cbc03f5450d4ef30990ec8f`, tree
`937006e2c9d859b542fd9f7242604c1d5219319d`. PR238 is merged. The
existing `/Users/wata/hosei-app` checkout remains untouched at its older local
dev; the fixed commit was fetched into a private repository copy, then checked
out on `work/f03-s2-local-candidate-20261109` in a separate worktree.

This candidate is a learner-progress vertical slice and a saved read-only
projection. Official identity/receipt integration, general reimport, UI, and
F03 completion remain blocked. Verification here is implementer self-check.

| Boundary | Actual fixed-dev contract | S2 decision |
| --- | --- | --- |
| Public session | `production/session.ts`: `load`, `view`, `add`, `update`, `recordContribution`, `progress`, `remove`, `undo`, save/backup/restore previews | Use existing public API only. No direct graph writes, caller Commands, raw store writes, or receipt creation |
| Authority | `persistence/contracts.ts`: `AuthorityRecord={raw,revision,committed,issuedIds}`; closed schema23 migration / schema24 new-plan | No shape, version, namespace, or guard changes |
| Ownership | `types.ts`: `AttemptOwnedRecord` media/correspondence/evaluation with stable `OwnedRecordId` and `owner.attemptId`; UUIDv4 Attempt/operation IDs | Same title/year/Offering never joins owners. Session mints record/operation IDs |
| Typed commands | `workbench/operations.ts`: add_record / edit_payload retain original replay receipts; remove/undo LIFO | Session `progress` selects existing same-kind same-owner record; edits retain record IDs and existing nested rows |
| Video and lesson tests | Media payload uses numbered `lessons`, nullable totalLessons; videoCompleted/testCompleted | Existing public progress command supports numbered lesson edits and new rows. These are distinct from ID-bearing assessments |
| ID-bearing assessments | `progress` refuses an assessment ID not already in the owner's previous payload; `requireSupportedHistory` holds nested UUID issuance without ordered history | Existing migrated non-UUID assessment can be edited; creating a new assessment is RED/BLOCKED_DEP. Do not use invented string IDs |
| Correspondence/evaluation | requiredReports:null is legal; reports preserve reportNumber; exam and learner course grades remain owned payloads | Save/reload/backup/portable restore via public session; never overwrite official retained rows |
| S1 projection | `ProjectionInput`: graph, OfficialObservation[], Association[], EnrollmentEvidence[], optional TrustedEvidenceResolver, nullable verified F02 subtotal | Pure rev3 relocated with only type import changed. Learner adapter supplies no official observations/claims/resolver |
| Saved read adapter | Session createBackup rejects dirty/revoked sessions, locks, verifies complete destination replay, fences reads, validates backup | Parse only returned backup bytes, never a submitted raw backup; avoid racing a verified snapshot against a later `view` or discarding drafts with load |
| Snapshot pin | backup sha256 + graphSha256 and schemaVersion from that verified snapshot | Pins exported content. Host revision is not exposed by this port; no claim to an exposed host revision or permanent freshness after return |
| Official raw/provenance | schema23 `source.raw/rawSha256`, retained original achievement/detail rows and fingerprints; schema24 arrays are closed empty | Return source and retained separately and freeze them. Do not fabricate S1 slot coordinates from names, Offering, legacy links, or fingerprints |
| F01 receipts | Replay Command[] records prove learner mutations; host checkpoints prove saved history under F01 threat model | They do not prove university issuer authentication, enrollment, or same-occurrence association. `TrustedEvidenceResolver` cannot automatically be made true |
| G03 source | `gradeImport/sourceArchive.ts`: GradeSourceArchive(raw/rawUtf8Bytes/rawSha256/dtoSha256/archiveSha256); `preview.ts`: revisionId/observationId and sourceRef(snapshotId,rowIndex,archiveSha256,rawSha256), identity unverified | Preserve these coordinates. Preview/fingerprint/raw hash are not verified association/enrollment |
| G03 host receipt | gradeImportHost/contracts[V2].ts separate string host with grant/adoption receipt/ledger events at the same DB key; F01 uses object authority | No alternate G03 host initialization or second writer; no import/reimport command exists in the F01 session |
| F02 quantity | `session.calculate` returns selected-curriculum combined learner scenario, `sourceLinksReverified:false`, not a verified official-only subtotal port | Adapter uses global null, additionalCredits=0 and no per-owner allocation. Unchanged C2 controls independently exercise global4 once-only; never distribute aggregate values |
| Year-independent creation | Institutional placement search and makeSearchAttempt; plannedYear is nullable 1000–9999, Offering not required | Same-name Offering-free 2027/28 records keep distinct IDs, progress and manual quantity1 |
| Storage | Shared Web Lock; full-record CAS in one IDB transaction; synchronous legacy recheck before put; full replay readback | Memory-host integration verifies public logic; native IDB/Chromium/Safari not run here |
| Portable restore | `prepareRestore` preview then save with explicit backup-specific adoptionSha256; reservations cannot shrink | Tests use only public restore; retain raw, source, graph, history, all IDs, nullable fields and official quantities |

## Candidate change map

| File | Change and purpose |
| --- | --- |
| src/planner/attempts/progress/progressProjection.ts | Audited S1 rev3, only type import relocation. No behavioral edits |
| src/planner/attempts/progress/savedProjection.ts | Read verified saved snapshot; learner projection plus separate unmodified official source/retained; no official trust injection |
| tests/f03-s2-session.test.mjs | Public-command integration on schema24 and 22→23, owner/year isolation, progress edits, manual1, official1/4 retention, CAS, reload, Undo, portable restore and read-only rejection |
| tests/f03-s2-assessment.red.mjs | Explicit expected RED for absent session allocation of new nested assessment identity; outside GREEN suites |
| docs/f03-s2/* | Boundary, blocked API design, case/status handoff |

F01/F02/GEO existing blobs, storage schemas, G03, calendar/Worker, existing UI,
dev/main and PR238 are unchanged. No GitHub write or new PR is authorized.

The pure `editableProgress` flag describes an active learner-owned record. It
is not a session capability. This adapter exposes no edit command; a future UI
must still obey session admission and invoke guarded public session commands.
The SavedSession port is trusted host wiring, not protection against replacing
the actual production session with an adversarial object.
