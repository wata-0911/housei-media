# Calendar first-approver local review

## Status and boundaries

This is a local-only candidate based on `dev` commit `b0a0810ca2e90596b857673a5b71f8001079c98a`, fetched 2026-11-03. No commit, push, PR, merge, deployment, Script Properties change, real approval, LINE send, publication or trigger creation was performed. Owner-reported GAS versions do not establish the code or settings at the live `/exec` URL. Live synchronization failure is not diagnosed by these mock tests.

The existing December draft remains untouched and unapproved. No migration helper or approval request has been executed against either real project. Synthetic fixtures contain no real credentials, account IDs, Drive IDs or deployment identifiers.

## Authority and byte identity

GAS2 owns one complete JSON snapshot in `CALENDAR_DRAFT_SYNC_CURRENT_V1`. The reservation fix wraps current state in a schema3 authority with current image, pending save reservation, terminal receipt, monotonic generation and a default-off runtime approval gate. Nested `schemaVersion:2` adds `imageSha256`, `status` and, only when approved, the winner's verified LINE user ID and server approval timestamp plus bound identity. Existing schema1 remains readable but not approvable. An explicit owner-reviewed identity migration computes the digest without approving. There is no public migration endpoint and no implicit migration during read or resync.

A newly accepted sync captures SHA-256 from the exact validated PNG bytes. Every subsequent canonical read, same-version resync and approval checks those exact bytes again. Changed, deleted, moved or inaccessible files fail closed. This prevents accepting replacement bytes under an existing approval; it is not WORM storage, retained immutable media, a backup or protection against deletion. Project/Drive editors are trusted administrators and can change code/properties. Any future publication path must revalidate the entire approved tuple and digest at point of use; none is enabled here.

The UI displays the PNG returned by the independently authorized preview API. Its full target tuple is covered by an actor-bound, ten-minute server HMAC receipt using a domain-separated receipt subkey. The UI also hashes the received bytes and enables approval only after the bound image loads. File ID and identity in the receipt are authenticated metadata, not caller authority. A receipt is not a bearer authorization: the approval API independently re-verifies the raw LINE ID token and current group membership, derives `userId` only from that verified token, and refuses wrong-actor/expired/tampered receipts.

GAS2 accepts approval only with a separate backend-only `CALENDAR_DRAFT_APPROVAL_SECRET`, different from both the old read and sync write keys. The browser never receives any of those keys. The server forwards the verified actor and complete receipt-bound tuple. LINE verification requests reject redirects. Membership is checked at request time, not atomically with a later LINE membership change or GAS state mutation. Login and Messaging API channels must use the same LINE provider for user IDs to correspond.

## First winner, retries and replacement

Reserve, commit, legacy sync, reads, runtime approval disable, explicit migration/recovery and approval use the same GAS2 ScriptLock. Approval compares month/file ID/generated timestamp/revision/draft ID/digest and re-hashes the PNG under that lock. One canonical property write records winner, timestamp and state together. Same actor retry returns `ALREADY_APPROVED`; another actor gets `ALREADY_APPROVED_BY_OTHER`. Neither changes the winner or approval timestamp. A failed property request is acknowledged only if exact snapshot readback confirms it. Otherwise the outcome is unknown and the client makes no success claim.

Same-identity resync verifies bytes without resetting approval. A strictly newer accepted sync creates fresh `draft_ready` with no old approval. Old requests then fail. A new save first reserves the authority using an exact base-version CAS under the same GAS2 lock as approval. No PNG is created before a durable matching reservation ACK and source save-started journal. Any pending reservation blocks approval of the older current image, including after expiry. Legacy sync writes are rejected after authority rollout. A new committed image resets approval atomically. Resolve all unknown reservations and synchronization before enabling real approval. This candidate stores the current winner, not a permanent historical approval ledger.

UI double-clicks are blocked immediately by a ref. Unknown timeout/network results never auto-retry. The user can explicitly retry the exact same receipt/identity or explicitly reload and review the current image. Expired receipt, stale target or membership failure requires revalidation/re-preview. Revision requests and distribution remain disabled. Browser refresh/unmount cancels requests and revokes Blob URLs; late results cannot bind to a newer image.

## Preserve sync and isolate legacy publication

`get_current_draft` without `includeApprovalBinding:true` retains its five original success fields. Opt-in schema2 binding is available to the revised Vercel preview API. Canonical corruption never falls back to legacy. The old draft-only sync compatibility path remains available only before reservation authority rollout. The new save wrapper requires reserve-before-save; its source journal persists intent, reserved, saving, saved and synced stages. Unknown reserve ACKs create no PNG; unknown save outcomes are never auto-recreated; commit retries reuse the exact saved file and reservation. Expiry requires owner-reviewed recovery and never unlocks automatically.

The local GAS1 candidate disables the public raw saveImageToDrive entry point with UNRESERVED_SAVE_DISABLED and deliberately replaces both `publishApprovedDraft` and `publishApprovedDraftForCurrentMonth` with throwing safety interlocks (`CENTRAL_APPROVAL_PUBLICATION_DISABLED`). It does not copy GAS2 approvals to GAS1's legacy approved flags. This is an intentional behavior change from the draft-only recovery candidate, not an unnoticed compatibility claim. Unseen files, other trigger functions and older deployments can bypass a pasted candidate; the complete live project and all triggers require owner review before rollout. Existing LINE helpers remain in the reference but are never called or wired to approval.

## Main exclusion and release blockers

All three API routes and the frontend route fail closed unless the build/runtime is the exact `dev` branch of `wata-0911/housei-media` on the verified dedicated Vercel project, with `CALENDAR_APPROVAL_ENABLED=true` and `VERCEL_PROJECT_ID` matching `CALENDAR_APPROVAL_DEV_PROJECT_ID`. `VERCEL_ENV=production` is additionally required because the dedicated dev project uses a production environment. All Vercel preview, absent and unknown environment values are denied even when every dev-project condition and the enabled flag match. Missing metadata/config denies access. A local-only test escape requires VERCEL entirely absent, NODE_ENV not production and explicit CALENDAR_LOCAL_TEST_MODE=true; VERCEL=0 cannot bypass the gate. The UI route is compiled out on disallowed builds and the APIs independently recheck runtime metadata.

No real dev project ID is embedded here. This is **not ready for deployment** until the owner verifies the dedicated project ID, connected Git repository/branch, managed system environment variables, environment scopes, deployment domains/aliases, build/runtime agreement and absence of approval credentials from main's project. This protects accidental cross-project/main exposure under trusted managed metadata, not a malicious project admin forging configuration. Main negative tests are required even when a feature flag is set. Do not merge these changes to main.

Additional release blockers: verify complete current GAS sources/deployments and missing legacy helper/config files; confirm real sync recovery and latest identity; review explicit schema1 migration and preserve December as draft_ready; provision a separate approval credential only with authorization; verify LINE provider and bot/group authorization; deploy reviewed GAS1 publisher interlock in a separately authorized step before enabling approval; run real staging integration and browser visual QA. No current permission authorizes these actions.

## Reproduction

Use Node 22 for generated Vercel function execution. Product dependencies are unchanged. Optional JSDOM, Playwright and official Vercel builder tooling are installed outside product dependencies.

- `node dev/calendar-approval-gas/tools/build-candidate.cjs`
- `node --test dev/calendar-approval-gas/test/*.test.cjs`
- `node --import tsx --test tests/calendar-draft.test.mjs tests/calendar-approval.test.mjs`
- `CALENDAR_JSDOM_MODULE=<jsdom module> node --test tests/calendar-draft-ui.test.mjs`
- `CALENDAR_PLAYWRIGHT_MODULE=<playwright module> CALENDAR_BROWSER_EXECUTABLE=<chromium> node --test tests/calendar-draft.browser.mjs`
- `CALENDAR_VERCEL_NODE_MODULE=<official @vercel/node entry> CALENDAR_VERCEL_BUILD_UTILS_MODULE=<official @vercel/build-utils entry> node scripts/build-calendar-function-artifacts.mjs . <fresh output>`
- `CALENDAR_FUNCTION_ARTIFACT_ROOT=<output> <Node22> --test tests/calendar-function-startup.test.mjs`
- `npm run typecheck`; `npm run lint`; `npm run build`; existing planner/extension/bookmarklet suites.

Generated Functions are tested without tsx, loaders or source imports. The builder emits `.js` helpers for all three function graphs. Local Chromium could not start because its singleton socket was denied by the execution environment; browser tests are blocked, not passed. JSDOM does not replace visual/mobile real-browser QA.

## Reservation recovery and limits

The source journal is CALENDAR_DRAFT_SAVE_JOURNAL_V1. The remote protocol marker is CALENDAR_DRAFT_RESERVATION_PROTOCOL=reserve-before-save-v1. Schema3 initialization preserves an existing schema1/2 current image verbatim and never approves it. Initialization refuses an absent canonical image when populated legacy draft fields exist. No live December migration was performed. The atomic runtime approvalsEnabled field defaults false, is disabled by recovery/migration, and is checked inside the approval lock. Turning off Vercel environment configuration alone does not revoke old deployment URLs; disable the GAS2 runtime approval gate first.

Owner-only recovery requires exact pending/journal identity and the explicit assertion that every writer execution and deployment has been quiesced and the save outcome verified. Expired reservations remain blocking. Abandon advances the authority epoch; stale reserve/commit requests cannot reopen or replace a newer operation. Each newly committed current image retains its full commitReservation receipt, so exact still-current commit retries survive another producer's abandoned operation without replacing winner/time. A newer committed image still rejects the old commit. The exact remote terminal or retained-current receipt lets the owner reconcile interrupted source intent/reserved/saving journals without deleting them. An unaccepted unknown intent needs abandonReviewedIntent to persist a remote terminal tombstone before local reconciliation; an unchanged remote epoch alone never permits local abandonment.

CAS cannot fence a paused legacy Drive writer by itself: a previously executing old GAS1 deployment may still save after an administrator unlocks a reservation. Therefore all old/new writers, direct deployment URLs, editor calls and triggers must be quiesced before recovery or runtime enablement. No code-only claim covers unseen deployed code, privileged editors or unsynchronized copies. The local candidate disables known public raw save and publisher paths; it cannot retire actual deployments or triggers.

See reservation-staged-rollout.md for separately authorized rollout, recovery and rollback gates. No commit SHA was created because commits were not authorized. A SHA-256 manifest identifies the exact local fixed candidate instead.
