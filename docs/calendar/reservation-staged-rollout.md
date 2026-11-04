# Reservation rollout and recovery runbook

Prepared 2026-11-03 from the local candidate and official platform documentation. **Planning only: no step below has been performed against a live project.** Local changes and tests are authorized; deployment, configuration, credential changes, trigger changes, real approval, LINE delivery and publication are not. Every live stage needs separate authorization for its exact targets and consequences.

## Required outcome

- The existing **2026-12** draft remains the same file and same PNG bytes, **unapproved**. Do not regenerate it, use it for an approval smoke test, set legacy approval flags, or overwrite it with a test fixture.
- GAS2 accepts and durably records an update reservation **before** GAS1 can start the authoritative Drive save. From reservation acceptance until an exact successful commit or reviewed recovery, approval stays blocked.
- Uncertainty stops progress. A timeout, expired reservation or missing acknowledgment does not mean a save failed, a lock is free, or old approval may resume.
- Both legacy GAS1 publishers stay disabled. No release step here enables publication or LINE delivery.
- `main` stays unchanged and isolated. The dedicated dev Vercel project may itself use the Vercel `production` environment; the environment name is not the security boundary.

## Implementation anchors to verify against the final candidate

These names describe the reservation implementation being reviewed; the final independent review must verify their behavior before live use.

- GAS2 canonical property: `CALENDAR_DRAFT_SYNC_CURRENT_V1`, schema 3 envelope containing `generation`, `current`, `pending`, `lastOperation`, and `approvalsEnabled`. The runtime gate defaults to `false` and is checked inside the approval lock.
- Protocol marker: `CALENDAR_DRAFT_RESERVATION_PROTOCOL=reserve-before-save-v1`.
- GAS1 durable journal: `CALENDAR_DRAFT_SAVE_JOURNAL_V1`, stages `intent`, `reserved`, `saving`, `saved`, `synced`, and owner-reconciled `abandoned`.
- Owner-only cutover helper: `CalendarDraftReservation.enableReviewedAuthority(expectedRaw, 'ALL_WRITERS_QUIESCED_AND_LEGACY_PUBLISHERS_DISABLED')`. It initializes the envelope while preserving current state; it **does not set the protocol marker**.
- Owner-only GAS2 recovery: `CalendarDraftReservation.recoverReviewedReservation(exactPending, savedMetaOrNull, 'ALL_WRITERS_QUIESCED_AND_SAVE_OUTCOME_VERIFIED')`. `null` abandons a verified non-committed operation; verified saved metadata adopts a reviewed saved file. Neither path grants approval.
- Owner-only source recovery for an uncertain save: `CalendarReservedSender.recoverSaved(month, fileId, opId, 'ALL_WRITERS_QUIESCED_AND_SAVE_OUTCOME_VERIFIED')`.
- Owner-only runtime stop: obtain the exact version from `CalendarDraftReservation.version(CalendarDraftReservation.envelope())`, then call `CalendarDraftReservation.setApprovalEnabled(false, exactVersion, 'REVIEWED_APPROVAL_RUNTIME_GATE')`. Read back the flag. The same helper accepts `true` only with an exact current version and no pending reservation; enabling is a separate decision. Recovery and a schema1 image-identity migration force it back to `false`.
- Owner-only unaccepted-intent retirement: `CalendarDraftReservation.abandonReviewedIntent(exactIntent, exactCurrentVersion, 'ALL_WRITERS_QUIESCED_AND_SAVE_OUTCOME_VERIFIED')`. With no pending reservation, it checks the freshly reviewed current version, creates a terminal abandoned receipt for the original intent, advances the generation and keeps approval off. The separate current-version argument permits approval to be stopped first without changing the original intent.
- Owner-only journal reconciliation: `CalendarReservedSender.reconcileReviewedJournal(exactRaw, 'ALL_WRITERS_QUIESCED_AND_SAVE_OUTCOME_VERIFIED')`. Require matching remote terminal receipt/current-operation evidence, including the full original intent/reservation where applicable. A source-only abandonment because the remote epoch appears unchanged is prohibited. This helper is not a journal reset.
- The generated public `saveImageToDrive` entry point is required to throw `UNRESERVED_SAVE_DISABLED`; both legacy publisher functions must throw `CENTRAL_APPROVAL_PUBLICATION_DISABLED`.
- An older schema 1 draft remains non-approvable until an explicit identity-only migration. The inspected candidate supports `CalendarDraftReceiver.migrateReviewedCurrent(exactMetadata, 'MIGRATE_REVIEWED_DRAFT_WITHOUT_APPROVAL')` after schema3 initialization and marker activation: it upgrades only nested `current` to schema2 and leaves approval off. No direct migration from legacy `draft_*` properties without a canonical snapshot is implemented; `LEGACY_AUTHORITY_REQUIRES_REVIEW` is a stop condition.

Do not paste redacted candidate identifiers into a real project. Do not put secret values, raw LINE tokens or full property exports in this repository or a shared report.

## Stage 0: finish the local release candidate

1. Freeze the exact candidate source snapshot and record its commit/base, file hashes, test commands and independent review result. Regenerate both assembled GAS files from the reviewed modules and compare their hashes.
2. Require local tests for reserve-versus-approve in both orders; reserve ACK loss; reserve write failure before/after commit; source journal failure; save failure/uncertain save; final commit/ACK loss; duplicate and delayed requests; expired pending state; explicit adoption/abandonment; stale recovery; same-byte migration; image replacement; schema corruption; and multiple producers.
3. Prove that reserve-before-save is enforced by every authoritative save route, not just the current button. In particular inspect public `saveImageToDrive`, the private legacy save body, manual recovery, all `google.script.run` methods, and trigger handlers.
4. Run typecheck, lint, affected API/GAS/UI tests, Vercel emitted-function startup under Node 22, production main/dev build exclusion tests, and existing regression suites against the final tree. Report blocked/not-run checks separately from passes.
5. Perform real-browser desktop/mobile visual and interrupted-flow QA. An earlier Chromium startup restriction means JSDOM alone is not sufficient browser evidence.

**Exit:** no unresolved correctness issue; final candidate and reproduction evidence agree. This does not authorize deployment.

## Stage 1: inventory live surfaces without changing them

With separately authorized access, record the following in an owner-controlled checklist, keeping credentials private:

- Exact GAS1 and GAS2 project IDs; complete `.gs`, HTML and manifest files; current saved source; libraries; all active versioned deployment IDs, URLs, version numbers, access modes and execution identities. Record which endpoint each producer and Vercel server actually uses.
- Every GAS1/GAS2 trigger: creator account, handler, event source and schedule. Check each creator account, and any standalone or bound projects that touch these files. A single `ScriptApp.getProjectTriggers()` result is limited to the current project and current user, not all owners. [Google ScriptApp reference](https://developers.google.com/apps-script/reference/script/script-app#getProjectTriggers())
- Menu/button handlers, manual editor functions, API executables, web-app methods, external schedules, deploy hooks and other projects that can call the old writers, send LINE messages, write `draft_status`, or copy/trash/change published files.
- The missing supplied-source dependencies: `CONFIG`, `findFileByNameInFolder_`, `formatYearMonth_`, and `sendLinePushMessageAsMultipleBubbles`. Identify their actual implementations before claiming the project is covered.
- Exact December canonical identity and schema; source outbox and save journal; legacy source pointers; pending operations; actual Drive file MIME, parent folder, created time, size and SHA-256. Verify canonical and source identity agree. A historical `synced` label is insufficient.
- Dedicated dev and main Vercel project IDs, repository connection, production branch, domains/aliases, accessible immutable deployment URLs and relevant environment-variable names/scopes. Verify LINE Login and Messaging API channel provider match and that the bot can verify members of the configured group.

Apps Script HEAD follows saved source, but versioned deployments retain their own code and multiple versions can remain active. Saving the new candidate alone cannot retire old `/exec` code. [Google deployment documentation](https://developers.google.com/apps-script/concepts/deployments)

Installable triggers run under the account that created them; another account may not see them. Absence from one owner's trigger list does not prove absence. [Google installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)

**Stop if:** any writer, publisher, trigger owner, deployed code version or actual endpoint is unverified; December is already approved or differs from the expected image; source has a newer unsynchronized draft; current state is corrupt. Record the discrepancy instead of changing state to make it fit.

## Stage 2: prepare a controlled maintenance cutover

1. Obtain explicit approval for the exact dev/GAS targets, code changes, runtime stop mechanism, trigger/deployment changes and non-approval migration. Keep main, real approval, LINE and publication excluded.
2. Stop approval **at GAS2**, in addition to the Vercel UI/API gate. Once the reservation-aware envelope exists, use the exact-version `setApprovalEnabled(false, ...)` helper and read back the flag. Before that migration, quiesce all approval callers and use an explicitly authorized, tested backend deny mechanism if any old approval endpoint remains reachable. Do not assume changing only Vercel environment settings revokes older deployments.
3. Quiesce **all** source writers and publishers identified in Stage 1. Disable their triggers/callers or make the reviewed handlers fail closed. Restrict/retire obsolete writer deployments and wait for known in-flight executions to end. Coordinate with editors so no manual save/recovery runs during cutover.
4. Capture an owner-controlled recovery snapshot of canonical state, source journal/outbox and legacy metadata, plus exact December identity and a verified backup of its PNG. Preserve current sharing boundaries. Backups containing credentials must use the owner's secure store, not the engineering artifact.
5. Review the snapshot for any existing save uncertainty. Reconcile it under the old paused system before migration, or keep the migration blocked. Do not silently discard an unsynchronized newer save in favor of the December pointer.

**Exit:** all writers are demonstrably stopped, no in-flight action can later save or publish, approval is blocked at the backend, and December preservation evidence is complete.

## Stage 3: migrate without approving or replacing December

1. Install the reviewed GAS2 schema/reservation code and reviewed GAS1 reserved-save code while callers remain stopped. Use either assembled candidates or split modules, never both. Keep the two publisher interlocks in place.
2. Update each retained versioned deployment to the reviewed version, or retire it explicitly. Check both projects, not GAS1 alone: an old GAS2 endpoint must not accept writes that bypass the new envelope/fence. Confirm HEAD/editor and API-executable routes too.
3. Read the **exact raw canonical property** immediately before calling `enableReviewedAuthority`. It must match the owner-reviewed expected snapshot, still point to the exact December image, and contain no approval. If anything changed, stop and reread/review; do not merely replace the expected argument until the helper passes.
4. Invoke `enableReviewedAuthority` once. It preserves the entire existing schema1/schema2 current object unchanged inside a schema3 envelope, initializes a newer generation, and sets `pending=null`, `lastOperation=null`, `approvalsEnabled=false`. Verify the raw property readback and unchanged current object; `envelope()` intentionally refuses to operate until the marker is set. It does not create an image, grant approval or yet add a digest to schema1.
5. Only after that exact raw readback succeeds, set `CALENDAR_DRAFT_RESERVATION_PROTOCOL` to its reviewed value and read it back. Now `envelope()` can validate the wrapper. Keep writers and approvals stopped. If current is schema1, call `migrateReviewedCurrent(exactMetadata, 'MIGRATE_REVIEWED_DRAFT_WITHOUT_APPROVAL')`: it validates the existing Drive PNG and stores its SHA-256 in nested schema2 current, without changing identity or approving it. If already schema2, revalidate its existing digest; do not rehash around a mismatch.
6. Read back the complete validated envelope and verify exact December identity/digest, unchanged PNG bytes, valid generation, no pending state, `approvalsEnabled=false`, `current.status=draft_ready`, and no approval evidence. Confirm missing marker, missing envelope, malformed envelope and legacy sync traffic fail closed in local/staging tests. Preserve the marker and fence thereafter, including rollback.
7. Recheck the source journal/outbox against the wrapped December current state. No new journal is needed merely to preserve the existing image. Do not regenerate December, call the legacy post-save recovery, or run legacy resync to force a new ACK after cutover. Legacy outbox metadata is historical and the old sync action is intentionally refused. If an unresolved old outbox exists, stop for reviewed recovery rather than clearing it.

**Exit:** the exact December file is unchanged and unapproved; every retained writer is reservation-aware; approval remains stopped. If the final candidate has no tested direct schema1-to-schema3 helper path, migration is a release blocker rather than permission to invent one.

## Stage 4: configure and verify dev isolation

The current frontend build gate and all three API runtime gates require:

- `VERCEL=1`.
- `VERCEL_GIT_REPO_OWNER=wata-0911`, `VERCEL_GIT_REPO_SLUG=housei-media`, and `VERCEL_GIT_COMMIT_REF=dev`.
- Actual managed `VERCEL_PROJECT_ID` equals the owner-verified `CALENDAR_APPROVAL_DEV_PROJECT_ID`.
- `CALENDAR_APPROVAL_ENABLED=true` only at the authorized enablement stage. Keep false during migration and tests that must not admit real approvals.

Verify the real project ID in the Vercel project, not from its friendly name or a mock/local `.vercel` file. Enable Vercel's access to System Environment Variables if needed, with authorization. Inspect the build and runtime identity without logging credentials. Do not manually spoof `VERCEL_*` values to make a denied deployment pass. Vercel documents project/Git variables at build and runtime; missing values must remain a denial. [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)

Keep the GAS approval credential server-only, separate from read and sync-write credentials; verify the exact GAS2 `/exec` target. No secret may have a `VITE_` prefix or appear in browser assets. Apply the narrow scopes needed by the dedicated dev project, not team-wide/shared scopes inherited by main. Verify main contains no approval credential and the feature flag is absent/false.

Test main branch, wrong project, wrong owner/repository, missing metadata, flag false, malformed `VERCEL` and local-test flag on a cloud deployment. All APIs must return the unavailable response **before** LINE/GAS calls; disallowed builds must exclude the approval UI. Also verify main's real domains, dev aliases and old direct deployment URLs. Do not merge to main.

Environment edits affect only newly created deployments; older deployments retain old values. Redeploy and verify the new build/runtime agreement after any setting change, and treat older URLs as a separate exposure inventory. [Vercel environment-variable behavior](https://vercel.com/docs/environment-variables/managing-environment-variables)

## Stage 5: disposable integration acceptance, then a separate enable decision

Use a separate authorized staging GAS pair/folder and disposable image, never the preserved December file. The strict Vercel gate must not be weakened or its identity metadata spoofed for testing; use the authorized dev project with an isolated staging backend during a planned maintenance window, or first obtain approval for an equally strict staging allowlist.

1. Two authorized actors race approval: exactly one winner; replay does not change winner/time.
2. Reservation wins the shared GAS2 lock: old preview approval is refused throughout `intent/reserved/saving/saved` uncertainty until exact final commit. Approval wins first: reservation based on pre-approval state fails, and no new save starts from that stale base.
3. Drop reserve response before and after remote persistence. The source must not save merely because the request was sent; retry/reconcile the same operation.
4. Inject failures at each durable journal and Drive boundary, including file created but save response/state unavailable. Require explicit recovery, never blind regeneration.
5. Drop commit response and replay exact commit after a newer reservation. A historical ACK must not clear a newer fence or claim the current operation is synced.
6. Expire a reservation, advance time and retry approval. Expiry must **not** clear the block. Test both exact adoption and exact abandonment after writers are quiesced; delayed old reserve/commit/recovery must fail afterward.
7. Replace PNG bytes under the same file ID, move/trash it, revoke access, corrupt the canonical state and remove the marker. Reads/approval/commit must fail closed where applicable, not silently restore legacy state or rehash an already-approved target.
8. Verify browser late responses, logout/refresh, canceled navigation, mobile image load, double clicks and unknown results. No hidden auto-approval or new-image substitution.
9. Exercise the backend stop mechanism from both new and older Vercel deployment URLs; then exercise rollback/recovery below using disposable state.

After reviewing results, request a distinct enablement decision. Enabling the feature is not permission to approve December. Recheck December bytes and `draft_ready` before and after any permitted deployment/configuration step. No real approval is part of this runbook.

## Recovery decision procedure

First stop admission of new approvals and quiesce all writers. Record the exact pending operation, generation/base identity, source journal stage, Drive evidence and all known executions. Do not log credentials. Re-read before any recovery write.

- **Reserve result unknown, source still at intent, no save started:** do not allocate a new operation or mark the source intent abandoned merely because one remote read found no pending state. A delayed reserve can still arrive. If GAS2 has the exact pending reservation, use exact-pending reviewed abandonment after quiescence. If it has no pending state, first stop approval, then read the exact current version and call `abandonReviewedIntent(originalJournal.intent, exactCurrentVersion, confirmation)`. Read back the matching abandoned terminal receipt and advanced generation; only then reconcile the exact source journal. A pending state, changed current version or committed same operation makes this path refuse. Inspect that result instead of forcing retirement.
- **Reserved but no save happened:** only after confirming all possible writers have stopped, review exact pending identity and abandon with the owner-only helper. A timestamp or expired lease is not proof that no later write can happen.
- **Journal says saving, result unknown:** inspect Drive and source metadata under the paused system. If the exact produced file is established, use `CalendarReservedSender.recoverSaved` with the same month/file/op and then the reviewed commit or receiver recovery path. Never call the generator/save again as a retry.
- **Saved image exists, sync missing:** validate the exact PNG, folder, created time, digest, month and operation. Retry the same commit while valid. For `RESERVATION_EXPIRED_RECOVERY_REQUIRED`, have the owner use exact-pending adoption rather than bypassing expiry or manually changing timestamps.
- **Commit succeeded but response/local synced journal write failed:** reconcile exact current identity, retained current.commitReservation receipt, last operation and pending state before treating it as success. A different producer's later abandonment must not prevent exact still-current retry/reconciliation; it must preserve any existing winner/time. Replaying that operation must not create a second file or release a later operation.
- **Confirmed no authoritative saved image, or deliberately abandoning an unusable one:** inspect the entire outcome and quiesce all delayed producers first, then use exact-pending `null` recovery. It must preserve the previously reviewed current image and leave it unapproved; if there is prior approval evidence, stop for explicit review rather than erasing it.
- **Wrong operation/base/generation, stale recovery request, unknown Drive outcome, corrupt state or an unaccounted writer:** keep pending blocked and escalate. Do not clear properties, roll back generation, edit timestamps or remove the protocol marker.

After any recovery, read back current/pending/terminal-operation/generation, `approvalsEnabled=false` and the image digest. Use exact-raw `reconcileReviewedJournal` only after the matching terminal operation/current state is established, and demonstrate the old operation can no longer commit or clear a newer reservation. Resume only reviewed writers. Resume approval only after a separate decision and exact-version gate change. A still-in-flight Drive writer cannot be fenced merely by changing a GAS2 property, so quiescence is a precondition, not a convenience.

## Rollback must remain fail-closed

1. Read the current GAS2 envelope/version, call `setApprovalEnabled(false, exactVersion, 'REVIEWED_APPROVAL_RUNTIME_GATE')`, then read back the flag. If version comparison fails, inspect and review the changed state before retrying; never force the write. Then deploy the Vercel-disabled build and verify aliases **and old direct URLs**. Changing the Vercel flag without a new deployment is not a stop. Verify no retained legacy GAS2 endpoint ignores the new runtime gate.
2. Quiesce/resume neither old nor new writers until their state is reconciled. Keep the GAS1 publisher interlocks; do not restore a version with legacy publishing or unreserved saves.
3. Preserve the schema 3 envelope, monotonic generation, pending reservation, terminal-operation record, source journal and protocol marker. Never restore a pre-reservation property backup over current state: it could erase the only fence against a delayed operation.
4. If a rollback binary is needed, use a reviewed reservation-aware read-only/fail-closed version. Do not point active deployments back to a legacy version merely because it was previously stable. Maintenance unavailability is safer than reopening approval on unknown state.
5. If a property request or deployment change had an uncertain outcome, inspect it before retrying. Recover the exact operation using the procedure above. Never retry a save to discover whether the earlier save succeeded.
6. Re-verify December still has its original identity/digest, is unapproved and unpublished. Verify no LINE delivery or publication occurred, main remains unaffected, old URLs cannot mutate, and the approved stop condition actually holds.

## Unresolved release blockers at preparation time

- Live project/source/deployment/trigger inventory, all trigger owners and missing source files are **unverified**, not verified safe.
- Dedicated dev Vercel ID, real Git/system metadata, scopes, aliases and historical deployment exposure are **unverified**.
- Latest actual sync/journal state and exact December bytes are **unverified by this local work**. Nothing here changes them.
- The inspected candidate implements the schema1-to-schema3 preservation path, runtime stop, disabled raw save entry point, exact recovery and remotely fenced unaccepted-intent retirement. This runbook was checked against those helpers; final release still requires the complete independent audit and exact release snapshot.
- Full real-browser and disposable live integration acceptance remain distinct gates. Mock tests cannot establish live routing, account/Drive permissions or deployment version.
- No authorization has been given for any live mutation listed here. This is a concrete proposed sequence, not a record of completed rollout.

## Local verification performed for this runbook

- Independently exercised synthetic schema1 current → schema3 envelope → marker → nested schema2 digest migration: same month/file/generatedAt/revision/draftId, same PNG bytes/digest, no approval/pending, approval gate off.
- Re-ran `node --test dev/calendar-approval-gas/test/reservation.test.cjs`: **37/37 passed** at preparation time, including runtime-stop-before-unaccepted-intent retirement and rejection of the delayed original reserve.
- `git diff --check` passed. These checks use synthetic in-memory projects and do not prove live deployment, trigger, credential, browser or Drive state.
