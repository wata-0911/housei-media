# Calendar approval authority design review

Reviewed 2026-11-03. Read-only investigation; no live approval, GAS changes, deployment, configuration, commit, push, or PR. Implementation recommendation only, not production verification.

## Principal finding

GAS2 can own a single versioned approval state. Existing GAS1 legacy publishing cannot safely consume that state through a mirrored `approved` flag. Proposed local migration must leave publishing disabled until a separately reviewed publisher consumes the exact GAS2-approved byte identity.

## Evidence

- `calendar-gas-sync-recovery/src/Gas2Receiver.gs:5-10`: existing canonical validator accepts schemaVersion 1 and draft_ready only.
- Same file lines 25-46: incoming sync is serialized by shared GAS2 ScriptLock, compares revision/full metadata, then writes one canonical property.
- Same file lines 57-60: preview rereads Drive bytes from fileId, without digest pinning.
- `calendar-gas-sync-recovery/src/Shared.gs:33-49`: ScriptLock wrapper; one JSON property; write exceptions resolved only by exact readback.
- Same file lines 63-76: file existence, parent folder, MIME, createdAt and PNG structure validated; fileId/createdAt alone do not establish byte identity.
- `calendar-gas-sync-recovery/reference/GAS1.current.redacted.gs:849-863`: save replaces six legacy properties and resets approval/publication dates.
- Same file lines 935-993: publisher reads legacy approved without shared lock or version identity; it reads mutable file content and trashes prior published file before creating replacement.
- GitHub dev `server/calendar-authorization.ts` blob `35b1988419fe8dd6193dde2fda64ea59f2bee07f`: verifies token through LINE, checks issuer/audience/expiry/sub, then checks configured group membership, but discards verified sub from returned public response. https://github.com/wata-0911/housei-media/blob/dev/server/calendar-authorization.ts

## Required protocol

1. Browser sends only LINE ID token, exact preview identity, and server-issued receipt. Browser-supplied actor, group, approval timestamp, or status must not become authority.
2. Every image/status/approve operation independently verifies token and current configured group membership. Return an internal auth result with verified sub; preserve existing public auth response. The LINE Login and Messaging API channels must belong to the same provider.
3. Vercel signs a bounded, expiring, actor-bound preview receipt covering protocol/domain, yearMonth, fileId, generatedAt, revision, draftId, and image SHA256. Its input must derive from exact validated preview bytes and canonical metadata. Distinguish receipt expiry from state version. An independent secret or explicitly domain-separated derived key must protect it.
4. GAS2 accepts approval only over a server-only credential distinct from read and sync credentials. The verified actor forwarded by trusted server is never taken from browser input. Client tokens and secrets must never appear in URLs, logs, error responses or bundled frontend code.
5. Under the same GAS2 ScriptLock as sync, load and strictly validate canonical state, compare full identity, validate exact PNG bytes and hash, compare status, and write winner/approvedAt/full identity in one snapshot. Another approver never overwrites the first winner. Same identity resync preserves approval; newer identity resets to draft_ready.
6. Approval success after storage error requires exact canonical readback. Otherwise outcome is unknown and UI reconciles through a new authenticated read. No automatic approval retry or publication side effect.
7. Schema v1/legacy remains readable but not approvable until explicit owner-reviewed migration or a fresh accepted v2 sync. Corrupt v2 must not fall back to legacy. Draft_ready with approval fields and approved without valid approval evidence must be rejected.

## Anti-substitution guarantee and limits

Hash pinning with revalidation on every later use meets the requested prevention of substituting a different PNG for the approved image. It does not make Drive physically immutable or preserve availability. If the file is changed, removed, moved, or permission is revoked, reads and approval fail closed. It must not silently rehash and update the approved identity. Future publication must use already-verified bytes, never reopen an unverified current Drive blob afterward.

GAS2 knows the latest accepted sync, not a newer GAS1 save whose outbox has not arrived. ScriptLock is project-local, not a distributed lock with GAS1 or LINE. Group membership is checked per request, not atomically with state commit. Properties/Drive/HTTP are not one transaction. A write can commit before a network timeout. Administrative edits to script code/properties and credential compromise are outside a normal application-level integrity guarantee.

## Dev-only isolation

Deny by default unless trusted Vercel metadata confirms the designated dev project and exact dev branch plus an explicit enable flag. Gate every API before reading credentials/calling LINE; gate route at build time too. Unknown or main metadata must deny. Do not rely solely on VERCEL_ENV because a dev project's production branch may itself be dev. Local tests need explicit opt-in with VERCEL absent, never fallback when cloud metadata is malformed. Actual project identity, system env availability, Git source, and domain assignments remain owner-verified release blockers.

## Staged release (not executed)

1. Local implementation and adversarial mocked tests only. Archive baseline and review changed legacy publisher behavior.
2. Owner verifies all GAS files/triggers/deployments, connected LINE provider/group, folder permissions, dedicated dev Vercel identity, and existing publisher invocation routes. No approval/publication enabled.
3. Apply reviewed GAS2 schema/protocol and disable legacy GAS1 publishing as a separate coordinated migration. Confirm old handlers cannot bypass canonical approval or hash checks. Preserve a documented non-destructive rollback that does not reactivate old approval flags.
4. Configure server-only approval/receipt credentials and explicit dev gates in the correct environment. Validate migration with disposable staging data; no production approval is implied.
5. Test two real authorized staging actors racing, replaced image/revision, revoked membership, malformed state, write/HTTP failure reconciliation, and main/API negative isolation. Enable only after evidence is reviewed.
6. Future publisher is separate scope: request an immutable approved identity from GAS2, validate bytes, publish idempotently, confirm output, and retire old output only after new confirmed success. Never treat approval alone as publication.

## Required adversarial tests

- Two actors approving same revision: exactly one winner/timestamp, loser sees existing outcome.
- Same actor duplicate/retry and response loss: original winner remains unchanged.
- Approval versus newer sync in both lock orders; stale preview never approves replacement.
- Same identity resync after approval preserves all approval fields.
- Same Drive id and createdAt but different valid PNG: preview, approval, and future consumer reject.
- Digest mismatch and identity/header/receipt mix-and-match rejected; receipt wrong actor/expiry rejected.
- Invalid token, revoked group member, mismatched member.userId, LINE timeout/429/5xx: no GAS mutation.
- Missing/malformed canonical state, schema v1, incomplete approved metadata, lock timeout, write error before/after commit.
- Delayed image onLoad/preview response after refresh/logout, double clicks, unknown approval outcome.
- Main/wrong project/missing metadata/malformed VERCEL/local flag: no API auth call or GAS action.

## Primary documentation verified

- LINE ID token verification: https://developers.line.biz/en/reference/line-login/#verify-id-token
- LINE group member profile: https://developers.line.biz/en/reference/messaging-api/#get-group-member-profile
- Same-provider user identity: https://developers.line.biz/en/docs/messaging-api/getting-user-ids/
- Apps Script lock semantics: https://developers.google.com/apps-script/reference/lock/lock
- Apps Script Properties quota: https://developers.google.com/apps-script/guides/services/quotas (9 KB/value; do not store PNG Base64 in canonical property).
- Vercel system environment metadata: https://vercel.com/docs/environment-variables/system-environment-variables
- Drive revision retention is not physical immutability: https://developers.google.com/workspace/drive/api/reference/rest/v3/revisions
